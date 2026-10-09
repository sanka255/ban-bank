/**
 * taxService.js
 *
 * Computes tax amounts for banquet bill lines using Ella PMS's tax_config table.
 * Tax types: VAT, SC (Service Charge), TDL, NBT — each with its own rate and date range.
 *
 * Algorithm mirrors Ella PMS taxInvoiceService logic:
 *   1. Load active tax configs covering the charge date.
 *   2. SC is applied on the base charge.
 *   3. VAT is applied on (base + SC) if compound_on = 'room_revenue_plus_sc', otherwise on base.
 *   4. TDL and NBT are applied on base only.
 *   5. Total tax = sum of all applicable taxes.
 */
const mysql = require('mysql2/promise');

let _conn = null;

async function getEllaConnection() {
  if (_conn) {
    try { await _conn.ping(); return _conn; } catch { _conn = null; }
  }
  const url  = process.env.ELLA_PMS_DATABASE_URL;
  const m    = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
  if (!m) throw new Error('Cannot parse ELLA_PMS_DATABASE_URL');
  const [, user, password, host, port, database] = m;
  _conn = await mysql.createConnection({
    host, port: Number(port), user, password, database,
    ssl: { rejectUnauthorized: false },
  });
  return _conn;
}

/**
 * calculateTax(chargeAmount, chargeDate)
 *
 * Returns { taxAmount, chargeWithTax, breakdown: [{ taxType, rate, amount }] }
 * Uses active tax_config rows covering chargeDate.
 */
async function calculateTax(chargeAmount, chargeDate) {
  const conn = await getEllaConnection();
  const dateStr = chargeDate instanceof Date
    ? chargeDate.toISOString().slice(0, 10)
    : String(chargeDate).slice(0, 10);

  const [configs] = await conn.query(
    `SELECT tax_type, rate, compound_on FROM tax_config
     WHERE effective_from <= ? AND effective_to >= ?
     ORDER BY tax_type`,
    [dateStr, dateStr]
  );

  const base    = Number(chargeAmount);
  const scConfig = configs.find(c => c.tax_type === 'SC');
  const scAmount = scConfig ? Number(((scConfig.rate / 100) * base).toFixed(2)) : 0;

  const breakdown = [];
  let totalTax = 0;

  for (const cfg of configs) {
    let taxable = base;
    if (cfg.tax_type === 'VAT' && cfg.compound_on === 'room_revenue_plus_sc') {
      taxable = base + scAmount;
    }
    const amount = Number(((cfg.rate / 100) * taxable).toFixed(2));
    breakdown.push({ taxType: cfg.tax_type, rate: cfg.rate, amount });
    totalTax += amount;
  }

  totalTax = Number(totalTax.toFixed(2));

  return {
    taxAmount:     totalTax,
    chargeWithTax: Number((base + totalTax).toFixed(2)),
    breakdown,
  };
}

module.exports = { calculateTax };
