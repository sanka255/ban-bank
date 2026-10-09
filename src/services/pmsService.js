const mysql = require('mysql2/promise');

function getPmsConnectionConfig() {
  const dbUrl = process.env.ELLA_PMS_DATABASE_URL;
  if (!dbUrl) return null;

  try {
    const url = new URL(dbUrl);
    return {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username || ''),
      password: decodeURIComponent(url.password || ''),
      database: (url.pathname || '/').replace(/^\/+/, ''),
      ssl: { rejectUnauthorized: false },
    };
  } catch (error) {
    console.error('Could not parse ELLA_PMS_DATABASE_URL', error);
    return null;
  }
}

async function getActivePmsReservation(reservationId) {
  const config = getPmsConnectionConfig();
  if (!config) return null;

  const conn = await mysql.createConnection(config);
  try {
    const [rows] = await conn.query('SELECT * FROM reservations WHERE id = ? LIMIT 1', [Number(reservationId)]);
    const reservation = rows && rows[0] ? rows[0] : null;
    if (!reservation) return null;

    const activeStatuses = ['tentative', 'guaranteed', 'room_assigned', 'checked_in', 'in_house', 'due_checkout', 'confirmed', 'do_check_in'];
    if (activeStatuses.includes(String(reservation.status))) return reservation;
    return null;
  } catch (error) {
    console.warn('Could not verify room reservation in Ella PMS.', error.message);
    return null;
  } finally {
    await conn.end();
  }
}

async function ensureGuestChargeExists({ pmsReservationId, billLine, userId }) {
  const config = getPmsConnectionConfig();
  if (!config) {
    throw new Error('ELLA_PMS_DATABASE_URL is not configured');
  }

  const conn = await mysql.createConnection(config);
  try {
    const [columns] = await conn.query('DESCRIBE guest_charges');
    const fields = columns.map((col) => col.Field);
    const refField = fields.find((field) => /(reference|banquet|bill|folio)/i.test(field));
    const description = `Banquet:${billLine.billNo}:${billLine.lineType}:${billLine.id}`;

    const existing = await conn.query(
      refField
        ? `SELECT id FROM guest_charges WHERE reservation_id = ? AND (description = ? OR ${conn.escapeId(refField)} = ?)`
        : `SELECT id FROM guest_charges WHERE reservation_id = ? AND description = ?`,
      refField
        ? [Number(pmsReservationId), description, Number(billLine.id)]
        : [Number(pmsReservationId), description]
    );

    const rows = Array.isArray(existing) ? existing[0] : [];
    if (rows.length > 0) {
      return { created: false, id: rows[0].id, description };
    }

    const chargeTypeId = billLine.lineType === 'hall_charge' ? 1 : 2;
    const insertPayload = {
      reservation_id: Number(pmsReservationId),
      charge_type_id: chargeTypeId,
      description,
      amount: Number(billLine.chargeWithTax || billLine.charge || 0),
      posted_by: Number(userId || 1),
      is_void: 0,
      void_reason: null,
    };

    if (refField) {
      insertPayload[refField] = Number(billLine.id);
    }

    const [result] = await conn.query('INSERT INTO guest_charges SET ?', [insertPayload]);
    return { created: true, id: result.insertId, description };
  } finally {
    await conn.end();
  }
}

module.exports = { getPmsConnectionConfig, getActivePmsReservation, ensureGuestChargeExists };
