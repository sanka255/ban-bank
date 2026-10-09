const express = require('express');
const prisma = require('../prisma');
const {
  buildGatewayReference,
  getGatewayProvider,
  verifyWebhookSignature,
  normalizeGatewayStatus,
  buildMockWebhookPayload,
  buildMockWebhookSignature,
  buildPayPalOrderMock,
  buildPayPalCaptureMock,
} = require('../services/paymentGateway');
const { snapshotCurrencyAmount } = require('../services/exchangeRateService');

const router = express.Router();

const PAYMENT_RATE_LIMIT = Number(process.env.PAYMENT_RATE_LIMIT || 30);
const paymentRequestCache = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = paymentRequestCache.get(ip) || [];
  const recent = bucket.filter((time) => now - time < 60_000);

  if (recent.length >= PAYMENT_RATE_LIMIT) {
    return false;
  }

  recent.push(now);
  paymentRequestCache.set(ip, recent);
  return true;
}

function normalizeCurrencyCode(currencyCode) {
  return (currencyCode || 'LKR').toString().toUpperCase();
}

router.post('/payments/mock/webhook', async (req, res) => {
  try {
    const { gatewayRef, status = 'captured', failureReason = null } = req.body || {};
    if (!gatewayRef) {
      return res.status(400).json({ error: 'gatewayRef is required for mock webhook testing.' });
    }

    const payload = buildMockWebhookPayload({ gatewayRef, status, failureReason });
    const signature = buildMockWebhookSignature(payload);

    return res.status(200).json({
      ok: true,
      gatewayProvider: getGatewayProvider(),
      signature,
      payload,
      message: 'Mock gateway webhook was generated and signed for test use.',
    });
  } catch (error) {
    console.error('Mock webhook generation failed:', error);
    return res.status(500).json({ error: 'Failed to generate mock webhook payload.' });
  }
});

router.post('/payments/paypal/create-order', async (req, res) => {
  try {
    const { reservationId, amount, currencyCode, savedPaymentMethodId, currencyId } = req.body || {};
    const reservationIdNumber = Number(reservationId);
    const numericAmount = Number(amount);
    const requestedCurrencyId = currencyId != null ? Number(currencyId) : null;

    if (!Number.isFinite(reservationIdNumber)) {
      return res.status(400).json({ error: 'Reservation ID is required.' });
    }

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'A valid payment amount is required.' });
    }

    const currencyLabel = normalizeCurrencyCode(currencyCode);
    const currencySnapshot = requestedCurrencyId
      ? await snapshotCurrencyAmount(numericAmount, requestedCurrencyId, new Date())
      : { currencyId: null, baseCurrencyAmount: numericAmount, exchangeRateUsed: 1 };

    const order = buildPayPalOrderMock({
      amount: numericAmount,
      currency: currencyLabel,
      reservationId: reservationIdNumber,
      referenceId: `reservation_${reservationIdNumber}`,
    });

    const transaction = await prisma.paymentTransaction.create({
      data: {
        reservationId: reservationIdNumber,
        gatewayProvider: 'paypal',
        gatewayRef: order.id,
        amount: numericAmount,
        currencyId: currencySnapshot.currencyId,
        baseCurrencyAmount: currencySnapshot.baseCurrencyAmount,
        exchangeRateUsed: currencySnapshot.exchangeRateUsed,
        currencyCode: currencyLabel,
        status: 'pending',
        webhookVerified: false,
      },
    });

    return res.status(201).json({
      ok: true,
      transactionId: transaction.id,
      reservationId: reservationIdNumber,
      gatewayProvider: 'paypal',
      gatewayRef: transaction.gatewayRef,
      status: transaction.status,
      amount: Number(transaction.amount),
      currencyCode: transaction.currencyCode,
      savedPaymentMethodId: savedPaymentMethodId ? Number(savedPaymentMethodId) : null,
      order,
      approvalUrl: order.links.find((link) => link.rel === 'approve')?.href || null,
      message: 'PayPal sandbox order created successfully.',
    });
  } catch (error) {
    console.error('PayPal order creation failed:', error);
    return res.status(500).json({ error: 'Failed to create PayPal sandbox order.' });
  }
});

router.post('/payments/paypal/capture', async (req, res) => {
  try {
    const { orderId, gatewayRef, amount, currencyCode } = req.body || {};
    const resolvedGatewayRef = gatewayRef || orderId;

    if (!resolvedGatewayRef) {
      return res.status(400).json({ error: 'orderId or gatewayRef is required.' });
    }

    const transaction = await prisma.paymentTransaction.findUnique({
      where: { gatewayRef: resolvedGatewayRef },
      include: { deposit: true },
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Payment transaction not found.' });
    }

    const capture = buildPayPalCaptureMock({
      orderId: transaction.gatewayRef,
      amount: Number(amount ?? transaction.amount),
      currency: normalizeCurrencyCode(currencyCode || transaction.currencyCode),
    });

    const updated = await prisma.$transaction(async (txClient) => {
      const nextTx = await txClient.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: 'captured',
          failureReason: null,
          webhookVerified: true,
        },
      });

      if (transaction.depositId) {
        await txClient.hallDeposit.update({
          where: { id: transaction.depositId },
          data: { settled: true },
        });
      }

      return nextTx;
    });

    return res.status(200).json({
      ok: true,
      gatewayProvider: 'paypal',
      transactionId: updated.id,
      gatewayRef: updated.gatewayRef,
      status: updated.status,
      capture,
      message: 'PayPal sandbox payment was captured successfully.',
    });
  } catch (error) {
    console.error('PayPal capture failed:', error);
    return res.status(500).json({ error: 'Failed to capture PayPal sandbox payment.' });
  }
});

router.post('/reservations/:reservationId/payments/initiate', async (req, res) => {
  try {
    const reservationId = Number(req.params.reservationId);
    const { amount, currencyCode, savedPaymentMethodId, currencyId } = req.body || {};

    if (!Number.isFinite(reservationId)) {
      return res.status(400).json({ error: 'Reservation ID is required.' });
    }

    const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({ error: 'Too many payment attempts. Please wait a moment and try again.' });
    }

    const reservation = await prisma.banquetReservation.findUnique({
      where: { id: reservationId },
      select: { id: true, guestId: true, status: true },
    });

    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found.' });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'A valid payment amount is required.' });
    }

    let savedMethod = null;
    if (savedPaymentMethodId) {
      savedMethod = await prisma.savedPaymentMethod.findFirst({
        where: { id: Number(savedPaymentMethodId), guestId: reservation.guestId, isActive: true },
      });
      if (!savedMethod) {
        return res.status(404).json({ error: 'Saved payment method not found.' });
      }
    }

    const provider = getGatewayProvider();
    const currency = normalizeCurrencyCode(currencyCode);
    const resolvedCurrencyId = currencyId != null ? Number(currencyId) : null;
    const currencySnapshot = resolvedCurrencyId
      ? await snapshotCurrencyAmount(numericAmount, resolvedCurrencyId, new Date())
      : { currencyId: null, baseCurrencyAmount: numericAmount, exchangeRateUsed: 1 };

    if (provider === 'paypal') {
      const mockOrder = buildPayPalOrderMock({
        amount: numericAmount,
        currency,
        reservationId: reservation.id,
      });

      const transaction = await prisma.paymentTransaction.create({
        data: {
          reservationId: reservation.id,
          gatewayProvider: provider,
          gatewayRef: mockOrder.id,
          amount: numericAmount,
          currencyId: currencySnapshot.currencyId,
          baseCurrencyAmount: currencySnapshot.baseCurrencyAmount,
          exchangeRateUsed: currencySnapshot.exchangeRateUsed,
          currencyCode: currency,
          status: 'pending',
          webhookVerified: false,
        },
      });

      return res.status(201).json({
        transactionId: transaction.id,
        reservationId: reservation.id,
        gatewayProvider: provider,
        gatewayRef: transaction.gatewayRef,
        status: transaction.status,
        amount: Number(transaction.amount),
        currencyCode: transaction.currencyCode,
        savedPaymentMethodId: savedMethod?.id || null,
        order: mockOrder,
        approvalUrl: mockOrder.links.find((link) => link.rel === 'approve')?.href || null,
        message: 'PayPal sandbox order created. Capture after approval using the mock PayPal capture endpoint.',
      });
    }

    const transaction = await prisma.paymentTransaction.create({
      data: {
        reservationId: reservation.id,
        gatewayProvider: provider,
        gatewayRef: buildGatewayReference('pay'),
        amount: numericAmount,
        currencyId: currencySnapshot.currencyId,
        baseCurrencyAmount: currencySnapshot.baseCurrencyAmount,
        exchangeRateUsed: currencySnapshot.exchangeRateUsed,
        currencyCode: currency,
        status: 'pending',
        webhookVerified: false,
      },
    });

    return res.status(201).json({
      transactionId: transaction.id,
      reservationId: reservation.id,
      gatewayProvider: provider,
      gatewayRef: transaction.gatewayRef,
      status: transaction.status,
      amount: Number(transaction.amount),
      currencyCode: transaction.currencyCode,
      savedPaymentMethodId: savedMethod?.id || null,
      message: 'Payment initiation received. Capture is completed only after the gateway webhook confirms success.',
    });
  } catch (error) {
    console.error('Payment initiation failed:', error);
    return res.status(500).json({ error: 'Failed to initiate payment.' });
  }
});

router.post('/payments/webhook', async (req, res) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const signature = req.headers['x-signature'] || req.headers['x-webhook-signature'] || req.headers['signature'];

    if (!verifyWebhookSignature(rawBody, signature)) {
      return res.status(401).json({ error: 'Invalid or missing webhook signature.' });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const gatewayRef = payload.gatewayRef || payload.data?.gatewayRef || payload.id || payload.transactionId;
    if (!gatewayRef) {
      return res.status(400).json({ error: 'Webhook payload missing gateway reference.' });
    }

    const tx = await prisma.paymentTransaction.findUnique({
      where: { gatewayRef },
      include: { deposit: true },
    });

    if (!tx) {
      return res.status(404).json({ error: 'Payment transaction not found.' });
    }

    const nextStatus = normalizeGatewayStatus(payload.status || payload.data?.status || payload.event || 'pending');
    const failureReason = payload.failureReason || payload.data?.failureReason || null;

    const updated = await prisma.$transaction(async (txClient) => {
      const updatedTx = await txClient.paymentTransaction.update({
        where: { id: tx.id },
        data: {
          status: nextStatus === 'failed' ? 'failed' : nextStatus === 'captured' ? 'captured' : tx.status,
          failureReason: failureReason || null,
          webhookVerified: true,
        },
      });

      if (nextStatus === 'captured' && tx.depositId) {
        await txClient.hallDeposit.update({
          where: { id: tx.depositId },
          data: { settled: true },
        });
      }

      return updatedTx;
    });

    return res.status(200).json({
      ok: true,
      paymentId: updated.id,
      gatewayRef: updated.gatewayRef,
      status: updated.status,
      webhookVerified: updated.webhookVerified,
    });
  } catch (error) {
    console.error('Webhook processing failed:', error);
    return res.status(500).json({ error: 'Failed to process webhook payload.' });
  }
});

router.post('/payments/:paymentId/refund', async (req, res) => {
  try {
    const paymentId = Number(req.params.paymentId);
    const refundAmount = Number(req.body?.amount ?? 0);

    const transaction = await prisma.paymentTransaction.findUnique({
      where: { id: paymentId },
      include: { reservation: true },
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Payment transaction not found.' });
    }

    const finalStatus = refundAmount > 0 && refundAmount < Number(transaction.amount)
      ? 'partially_refunded'
      : 'refunded';

    const updated = await prisma.paymentTransaction.update({
      where: { id: paymentId },
      data: {
        status: finalStatus,
        failureReason: null,
      },
    });

    return res.json({
      ok: true,
      paymentId: updated.id,
      status: updated.status,
      gatewayRef: updated.gatewayRef,
      refundAmount,
      message: 'Gateway refund call initiated and refund status updated.',
    });
  } catch (error) {
    console.error('Refund processing failed:', error);
    return res.status(500).json({ error: 'Failed to process refund.' });
  }
});

router.get('/guests/:guestId/payment-methods', async (req, res) => {
  try {
    const guestId = Number(req.params.guestId);
    const methods = await prisma.savedPaymentMethod.findMany({
      where: { guestId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(methods);
  } catch (error) {
    console.error('Failed to fetch saved payment methods:', error);
    return res.status(500).json({ error: 'Failed to fetch saved payment methods.' });
  }
});

router.post('/guests/:guestId/payment-methods', async (req, res) => {
  try {
    const guestId = Number(req.params.guestId);
    const guest = await prisma.banquetGuest.findUnique({ where: { id: guestId } });
    if (!guest) {
      return res.status(404).json({ error: 'Guest not found.' });
    }

    const { gatewayToken, cardLast4, cardBrand, expiryMonth, expiryYear } = req.body || {};

    if (!gatewayToken) {
      return res.status(400).json({ error: 'gatewayToken is required. Raw card data is never accepted by the backend.' });
    }

    const method = await prisma.savedPaymentMethod.create({
      data: {
        guestId,
        gatewayProvider: getGatewayProvider(),
        gatewayToken: String(gatewayToken),
        cardLast4: cardLast4 ? String(cardLast4) : null,
        cardBrand: cardBrand ? String(cardBrand) : null,
        expiryMonth: expiryMonth != null ? Number(expiryMonth) : null,
        expiryYear: expiryYear != null ? Number(expiryYear) : null,
      },
    });

    return res.status(201).json(method);
  } catch (error) {
    console.error('Failed to save payment method:', error);
    return res.status(500).json({ error: 'Failed to save payment method.' });
  }
});

router.delete('/guests/:guestId/payment-methods/:methodId', async (req, res) => {
  try {
    const guestId = Number(req.params.guestId);
    const methodId = Number(req.params.methodId);

    const deleted = await prisma.savedPaymentMethod.update({
      where: { id: methodId, guestId },
      data: { isActive: false },
    });

    return res.json({ ok: true, deletedId: deleted.id, isActive: deleted.isActive });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Saved payment method not found.' });
    }
    console.error('Failed to remove payment method:', error);
    return res.status(500).json({ error: 'Failed to remove payment method.' });
  }
});

module.exports = router;
