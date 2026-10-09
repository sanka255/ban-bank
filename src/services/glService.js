const prisma = require('../prisma');

const DEFAULT_ACCOUNTS = [
  { accountNo: '1000', name: 'Cash on Hand', accountType: 'asset' },
  { accountNo: '1100', name: 'Banquet Receivable', accountType: 'asset' },
  { accountNo: '4100', name: 'Banquet Revenue', accountType: 'revenue' },
  { accountNo: '2200', name: 'Tax Payable', accountType: 'liability' },
  { accountNo: '5100', name: 'Complementary Write-off', accountType: 'expense' },
  { accountNo: '2100', name: 'Deposit Liability', accountType: 'liability' },
];

function normalizeMoney(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? Number(num.toFixed(2)) : 0;
}

async function ensureDefaultAccounts(tx = prisma) {
  const existing = await tx.chartOfAccount.findMany({
    where: { accountNo: { in: DEFAULT_ACCOUNTS.map((account) => account.accountNo) } },
  });
  const byNo = new Map(existing.map((account) => [account.accountNo, account]));
  const missing = DEFAULT_ACCOUNTS.filter((account) => !byNo.has(account.accountNo));

  if (missing.length) {
    await tx.chartOfAccount.createMany({
      data: missing.map((account) => ({
        accountNo: account.accountNo,
        name: account.name,
        accountType: account.accountType,
        isActive: true,
      })),
    });
  }

  return tx.chartOfAccount.findMany({
    where: { accountNo: { in: DEFAULT_ACCOUNTS.map((account) => account.accountNo) } },
  });
}

async function getAccountByName(tx, name) {
  const accounts = await ensureDefaultAccounts(tx);
  const account = accounts.find((candidate) => candidate.name === name);
  if (!account) throw new Error(`GL account not found: ${name}`);
  return account;
}

async function findOrCreateMapping(tx, mappingType, sourceId, fallbackName) {
  const fallbackAccount = await getAccountByName(tx, fallbackName);
  const existing = await tx.accountMapping.findFirst({
    where: {
      mappingType,
      sourceId: sourceId ?? null,
    },
    include: { account: true },
  });

  if (existing) return existing.account;

  const created = await tx.accountMapping.create({
    data: {
      mappingType,
      sourceId: sourceId ?? null,
      accountId: fallbackAccount.id,
    },
    include: { account: true },
  });

  return created.account;
}

async function resolveRevenueAccount(tx, context = {}) {
  const { functionAccountId, menuCategoryId, lineType, isComplementary } = context;
  if (isComplementary) {
    return getAccountByName(tx, 'Complementary Write-off');
  }

  if (functionAccountId) {
    const mapping = await tx.accountMapping.findFirst({
      where: { mappingType: 'function_account', sourceId: Number(functionAccountId) },
      include: { account: true },
    });
    if (mapping && mapping.account) return mapping.account;
  }

  if (lineType === 'menu' && menuCategoryId) {
    const mapping = await tx.accountMapping.findFirst({
      where: { mappingType: 'menu_category', sourceId: Number(menuCategoryId) },
      include: { account: true },
    });
    if (mapping && mapping.account) return mapping.account;
    return getAccountByName(tx, 'Banquet Revenue');
  }

  return getAccountByName(tx, 'Banquet Revenue');
}

function validateDoubleEntry(entries) {
  const totalDebits = entries
    .filter((entry) => entry.entryType === 'debit')
    .reduce((sum, entry) => sum + normalizeMoney(entry.amount), 0);
  const totalCredits = entries
    .filter((entry) => entry.entryType === 'credit')
    .reduce((sum, entry) => sum + normalizeMoney(entry.amount), 0);

  return {
    ok: Math.abs(totalDebits - totalCredits) < 0.01,
    totalDebits: Number(totalDebits.toFixed(2)),
    totalCredits: Number(totalCredits.toFixed(2)),
    variance: Number((totalDebits - totalCredits).toFixed(2)),
  };
}

async function createEntries(tx, entries, userId) {
  if (!entries.length) return []; 

  const check = validateDoubleEntry(entries);
  if (!check.ok) {
    throw new Error(`GL double-entry validation failed: debit ${check.totalDebits} vs credit ${check.totalCredits} (variance ${check.variance})`);
  }

  const created = [];
  for (const entry of entries) {
    const inserted = await tx.gLEntry.create({
      data: {
        accountId: Number(entry.accountId),
        entryType: entry.entryType,
        amount: normalizeMoney(entry.amount),
        sourceType: entry.sourceType,
        sourceId: Number(entry.sourceId),
        description: entry.description,
        postedBy: Number(userId),
      },
    });
    created.push(inserted);
  }
  return created;
}

async function postBillLineToGL(tx, billLine, userId, context = {}) {
  const receivableAccount = await getAccountByName(tx, 'Banquet Receivable');
  const taxAccount = await getAccountByName(tx, 'Tax Payable');
  const revenueAccount = await resolveRevenueAccount(tx, context);

  const charge = normalizeMoney(billLine.charge);
  const taxAmount = normalizeMoney(billLine.taxAmount);
  const totalCharge = normalizeMoney(billLine.chargeWithTax);

  const basePostingAmount = charge > 0 ? charge : (context.complementaryCharge ? normalizeMoney(context.complementaryCharge) : 0);
  const effectiveTax = taxAmount > 0 ? taxAmount : (context.complementaryTaxAmount ? normalizeMoney(context.complementaryTaxAmount) : 0);

  const entries = [];

  if (context.isComplementary || basePostingAmount > 0 || totalCharge > 0) {
    const receivableAmount = normalizeMoney(context.isComplementary ? (context.complementaryCharge || totalCharge || charge) : totalCharge);
    entries.push({
      accountId: receivableAccount.id,
      entryType: 'debit',
      amount: receivableAmount,
      sourceType: 'guest_bill_line',
      sourceId: billLine.id,
      description: billLine.description || 'Banquet bill line',
    });

    if (context.isComplementary) {
      const complementaryAccount = await getAccountByName(tx, 'Complementary Write-off');
      entries.push({
        accountId: complementaryAccount.id,
        entryType: 'credit',
        amount: receivableAmount,
        sourceType: 'guest_bill_line',
        sourceId: billLine.id,
        description: `${billLine.description || 'Complementary bill line'} (write-off)`,
      });
    } else {
      entries.push({
        accountId: revenueAccount.id,
        entryType: 'credit',
        amount: basePostingAmount,
        sourceType: 'guest_bill_line',
        sourceId: billLine.id,
        description: `${billLine.description || 'Banquet bill line'} (revenue)`,
      });
      if (effectiveTax > 0) {
        entries.push({
          accountId: taxAccount.id,
          entryType: 'credit',
          amount: effectiveTax,
          sourceType: 'guest_bill_line',
          sourceId: billLine.id,
          description: `${billLine.description || 'Banquet bill line'} (tax)`,
        });
      }
    }
  }

  if (!entries.length) return [];
  return createEntries(tx, entries, userId);
}

async function postDepositToGL(tx, deposit, userId) {
  // Deposit received: debit Cash on Hand (asset), credit Deposit Liability
  const cashAccount = await getAccountByName(tx, 'Cash on Hand');
  const depositLiabilityAccount = await getAccountByName(tx, 'Deposit Liability');
  const entries = [
    {
      accountId: cashAccount.id,
      entryType: 'debit',
      amount: normalizeMoney(deposit.amount),
      sourceType: 'hall_deposit',
      sourceId: deposit.id,
      description: `Deposit received ${deposit.receiptNo || deposit.id}`,
    },
    {
      accountId: depositLiabilityAccount.id,
      entryType: 'credit',
      amount: normalizeMoney(deposit.amount),
      sourceType: 'hall_deposit',
      sourceId: deposit.id,
      description: `Deposit liability ${deposit.receiptNo || deposit.id}`,
    },
  ];

  return createEntries(tx, entries, userId);
}

async function settleDepositToRevenue(tx, deposit, userId) {
  const depositLiabilityAccount = await getAccountByName(tx, 'Deposit Liability');
  const revenueAccount = await getAccountByName(tx, 'Banquet Revenue');
  const entries = [
    {
      accountId: depositLiabilityAccount.id,
      entryType: 'debit',
      amount: normalizeMoney(deposit.amount),
      sourceType: 'hall_deposit',
      sourceId: deposit.id,
      description: `Deposit settled to revenue ${deposit.receiptNo || deposit.id}`,
    },
    {
      accountId: revenueAccount.id,
      entryType: 'credit',
      amount: normalizeMoney(deposit.amount),
      sourceType: 'hall_deposit',
      sourceId: deposit.id,
      description: `Deposit recognition ${deposit.receiptNo || deposit.id}`,
    },
  ];

  return createEntries(tx, entries, userId);
}

async function postCancellationToGL(tx, withdrawal, userId) {
  const receivableAccount = await getAccountByName(tx, 'Banquet Receivable');
  const revenueAccount = await getAccountByName(tx, 'Banquet Revenue');
  const entries = [];

  const refundableAmount = normalizeMoney(withdrawal.refundableAmount);
  const cancellationFee = normalizeMoney(withdrawal.cancellationFee);

  if (cancellationFee > 0) {
    entries.push({
      accountId: receivableAccount.id,
      entryType: 'debit',
      amount: cancellationFee,
      sourceType: 'hall_withdrawal',
      sourceId: withdrawal.id,
      description: `Cancellation fee on withdrawal ${withdrawal.id}`,
    });
    entries.push({
      accountId: revenueAccount.id,
      entryType: 'credit',
      amount: cancellationFee,
      sourceType: 'hall_withdrawal',
      sourceId: withdrawal.id,
      description: `Cancellation fee revenue ${withdrawal.id}`,
    });
  }

  if (refundableAmount > 0) {
    entries.push({
      accountId: revenueAccount.id,
      entryType: 'debit',
      amount: refundableAmount,
      sourceType: 'hall_withdrawal',
      sourceId: withdrawal.id,
      description: `Refund reversal ${withdrawal.id}`,
    });
    entries.push({
      accountId: receivableAccount.id,
      entryType: 'credit',
      amount: refundableAmount,
      sourceType: 'hall_withdrawal',
      sourceId: withdrawal.id,
      description: `Receivable reversal ${withdrawal.id}`,
    });
  }

  return createEntries(tx, entries, userId);
}

module.exports = {
  normalizeMoney,
  ensureDefaultAccounts,
  getAccountByName,
  resolveRevenueAccount,
  validateDoubleEntry,
  postBillLineToGL,
  postDepositToGL,
  settleDepositToRevenue,
  postCancellationToGL,
};
