/**
 * pmsPostingService.js
 *
 * Posts banquet GuestBillLines to Ella PMS's guest_charges + guest_charge_tax tables.
 * Idempotency: we store a reference in guest_charges.description as
 * "[BANQUET:lineId]" — before inserting, check if a row with that marker exists.
 *
 * Uses a direct MySQL connection to ella_pms (ELLA_PMS_DATABASE_URL).
 */
const mysql  = require('mysql2/promise');
const prisma = require('../prisma');

let _conn = null;

async function getEllaConnection() {
  if (_conn) {
    try { await _conn.ping(); return _conn; } catch { _conn = null; }
  }
  const url = process.env.ELLA_PMS_DATABASE_URL;
  const m   = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
  if (!m) throw new Error('Cannot parse ELLA_PMS_DATABASE_URL');
  const [, user, password, host, port, database] = m;
  _conn = await mysql.createConnection({
    host, port: Number(port), user, password, database,
    ssl: { rejectUnauthorized: false },
  });
  return _conn;
}

/**
 * verifyPmsReservation(pmsReservationId)
 * Returns the ella_pms reservation row, or throws if not found / not active.
 */
async function verifyPmsReservation(pmsReservationId) {
  const conn = await getEllaConnection();
  const [rows] = await conn.query(
    `SELECT id, status, guest_id FROM reservations WHERE id = ? LIMIT 1`,
    [pmsReservationId]
  );
  if (!rows.length) throw Object.assign(new Error(`PMS reservation ${pmsReservationId} not found`), { statusCode: 404 });
  const r = rows[0];
  // Allow checked-in or confirmed statuses
  const active = ['confirmed', 'checked_in', 'in_house'].includes(r.status);
  if (!active) throw Object.assign(new Error(`PMS reservation ${pmsReservationId} has status '${r.status}' — cannot post charges`), { statusCode: 409 });
  return r;
}

/**
 * postBillLinesToRoom(banquetReservationId, pmsReservationId, userId)
 *
 * Posts all unposted (fromPms=false) GuestBillLines for a banquet reservation
 * to ella_pms.guest_charges. Idempotent — skips lines already posted.
 */
async function postBillLinesToRoom(banquetReservationId, pmsReservationId, userId) {
  await verifyPmsReservation(pmsReservationId);

  const conn = await getEllaConnection();

  // Load unposted bill lines
  const lines = await prisma.guestBillLine.findMany({
    where: { reservationId: banquetReservationId, fromPms: false },
  });

  if (!lines.length) {
    return { posted: 0, skipped: 0, message: 'No unposted bill lines found' };
  }

  // Default banquet charge type — look up or use 1
  const [ctRows] = await conn.query(
    `SELECT id FROM charge_types WHERE name LIKE '%banquet%' OR name LIKE '%Banquet%' LIMIT 1`
  );
  const chargeTypeId = ctRows[0]?.id ?? 1;

  let posted = 0, skipped = 0;
  const postedIds = [];

  for (const line of lines) {
    const marker = `[BANQUET:${line.id}]`;

    // Idempotency check
    const [existing] = await conn.query(
      `SELECT id FROM guest_charges WHERE reservation_id = ? AND description LIKE ? LIMIT 1`,
      [pmsReservationId, `%${marker}%`]
    );
    if (existing.length > 0) { skipped++; continue; }

    // Insert guest_charge row
    const [result] = await conn.query(
      `INSERT INTO guest_charges (reservation_id, charge_type_id, description, amount, posted_by, posted_at, is_void)
       VALUES (?, ?, ?, ?, ?, NOW(), 0)`,
      [
        pmsReservationId,
        chargeTypeId,
        `${line.description} ${marker}`,
        Number(line.chargeWithTax),  // post the full charge including tax
        userId,
      ]
    );
    const guestChargeId = result.insertId;

    // Insert tax rows if there's a non-zero tax
    if (Number(line.taxAmount) > 0) {
      // Store as a single VAT entry for simplicity (tax breakdown was computed at generate-bill time)
      await conn.query(
        `INSERT INTO guest_charge_tax (guest_charge_id, tax_config_id, tax_type, amount, tax_rate, taxable_amount)
         VALUES (?, ?, 'VAT', ?, 0, ?)`,
        [guestChargeId, 0, Number(line.taxAmount), Number(line.charge)]
      );
    }

    postedIds.push(line.id);
    posted++;
  }

  // Mark posted lines in banquet DB
  if (postedIds.length > 0) {
    await prisma.guestBillLine.updateMany({
      where: { id: { in: postedIds } },
      data:  { fromPms: true },
    });
  }

  return { posted, skipped, pmsReservationId };
}

module.exports = { verifyPmsReservation, postBillLinesToRoom };
