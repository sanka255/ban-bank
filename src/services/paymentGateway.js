const crypto = require('crypto');

function getGatewayProvider() {
  return (process.env.PAYMENT_GATEWAY_PROVIDER || 'mock').toLowerCase();
}

function getWebhookSecret() {
  return process.env.PAYMENT_WEBHOOK_SECRET || 'dev-payment-webhook-secret';
}

function getPayPalCredentials() {
  return {
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    secret: process.env.PAYPAL_SECRET || '',
    mode: (process.env.PAYPAL_MODE || 'sandbox').toLowerCase(),
  };
}

async function getPayPalAccessToken() {
  const { clientId, secret } = getPayPalCredentials();
  if (!clientId || !secret) {
    return 'mock-paypal-access-token';
  }

  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const response = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`PayPal token request failed: ${response.status} ${details}`);
  }

  const payload = await response.json();
  return payload.access_token;
}

function toMoneyString(amount) {
  return Number(amount || 0).toFixed(2);
}

function buildPayPalReference(prefix = 'PAY') {
  const now = Date.now();
  const random = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `${prefix}-${now}-${random}`;
}

function buildPayPalOrderMock({ amount, currency = 'LKR', reservationId, referenceId } = {}) {
  const orderId = buildPayPalReference('PAY');
  const resolvedReference = referenceId || `reservation_${reservationId ?? 'unknown'}`;
  const approvalToken = crypto.randomBytes(12).toString('hex');

  return {
    id: orderId,
    intent: 'CAPTURE',
    status: 'CREATED',
    purchase_units: [
      {
        reference_id: resolvedReference,
        amount: {
          currency_code: String(currency || 'LKR').toUpperCase(),
          value: toMoneyString(amount),
        },
        payee: {
          merchant_id: process.env.PAYPAL_CLIENT_ID || 'mock-paypal-merchant',
        },
      },
    ],
    payer: {
      payment_method: 'PAYPAL',
    },
    links: [
      {
        rel: 'self',
        href: `https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderId}`,
        method: 'GET',
      },
      {
        rel: 'approve',
        href: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}&approve=${approvalToken}`,
        method: 'GET',
      },
      {
        rel: 'capture',
        href: `https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderId}/capture`,
        method: 'POST',
      },
    ],
  };
}

function buildPayPalCaptureMock({ orderId, amount, currency = 'LKR' } = {}) {
  const captureId = buildPayPalReference('CAP');

  return {
    id: captureId,
    status: 'COMPLETED',
    payer: {
      payment_method: 'PAYPAL',
    },
    purchase_units: [
      {
        reference_id: orderId || 'reservation_unknown',
        payments: {
          captures: [
            {
              id: captureId,
              status: 'COMPLETED',
              amount: {
                currency_code: String(currency || 'LKR').toUpperCase(),
                value: toMoneyString(amount),
              },
            },
          ],
        },
      },
    ],
  };
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function signPayload(payload, secret = getWebhookSecret()) {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', secret).update(serialized).digest('hex');
}

function verifyWebhookSignature(rawBody, signatureValue, secret = getWebhookSecret()) {
  if (!rawBody || !signatureValue) return false;

  const expected = signPayload(rawBody, secret);
  const received = String(signatureValue).replace(/^sha256=/i, '').trim();

  if (!received || received.length !== expected.length) {
    return false;
  }

  return safeCompare(expected, received);
}

function normalizeGatewayStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (['captured', 'success', 'succeeded', 'paid', 'completed'].includes(normalized)) {
    return 'captured';
  }
  if (['failed', 'declined', 'error', 'rejected'].includes(normalized)) {
    return 'failed';
  }
  if (['pending', 'processing'].includes(normalized)) {
    return 'pending';
  }
  if (['refunded', 'partially_refunded'].includes(normalized)) {
    return normalized;
  }
  return 'pending';
}

function buildGatewayReference(prefix = 'pay') {
  const ts = Date.now();
  const rand = crypto.randomBytes(6).toString('hex');
  return `${prefix}_${ts}_${rand}`;
}

function buildMockWebhookPayload({ gatewayRef, status = 'captured', failureReason = null }) {
  return {
    id: gatewayRef,
    gatewayRef,
    status,
    failureReason,
    event: status,
    amount: 0,
    currency: 'LKR',
    verified: true,
  };
}

function buildMockWebhookSignature(payload, secret = getWebhookSecret()) {
  return `sha256=${signPayload(JSON.stringify(payload), secret)}`;
}

module.exports = {
  getGatewayProvider,
  getWebhookSecret,
  getPayPalCredentials,
  getPayPalAccessToken,
  buildPayPalReference,
  buildPayPalOrderMock,
  buildPayPalCaptureMock,
  verifyWebhookSignature,
  normalizeGatewayStatus,
  buildGatewayReference,
  signPayload,
  buildMockWebhookPayload,
  buildMockWebhookSignature,
};
