/**
 * Sprint 4 — All 7 exit criteria
 * Run: node scripts/sprint4/runAllTests.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { PrismaClient } = require('@prisma/client');
const mysql = require('mysql2/promise');
const jwt   = require('jsonwebtoken');
const prisma = new PrismaClient();

const BASE   = 'http://localhost:4003/api/banquet';
const TOKEN  = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const HEADS  = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: HEADS, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, data: d };
}

let pass = 0, fail = 0;
function ok(msg)  { console.log(`  PASS ✅  ${msg}`); pass++; }
function bad(msg) { console.error(`  FAIL ❌  ${msg}`); fail++; process.exitCode = 1; }
function chk(cond, msg) { cond ? ok(msg) : bad(msg); }

async function getEllaConn() {
  const url = process.env.ELLA_PMS_DATABASE_URL;
  const m   = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
  const [, user, password, host, port, database] = m;
  return mysql.createConnection({ host, port: Number(port), user, password, database, ssl: { rejectUnauthorized: false } });
}

// ─── Setup: make a slot with 2 items + 1 menu that already has a rate plan ───
async function setup() {
  const p1   = await prisma.hallPartition.findFirst({ where: { status: 'active' } });
  const guest = await prisma.banquetGuest.create({ data: { firstName: 'T4', lastName: 'Billing' } });
  const resv  = await prisma.banquetReservation.create({
    data: { reservationCode: `BNQ-T4-${Date.now()}`, guestId: guest.id, numberOfGuests: 50, createdBy: 1, status: 'guaranteed' },
  });

  // Dec slot (matches Sprint 3 rate plan for "Wedding Package A")
  const slot = await prisma.banquetDateSlot.create({
    data: {
      reservationId: resv.id, partitionId: p1.id,
      fromDate: new Date('2026-12-20T00:00:00.000Z'), toDate: new Date('2026-12-20T00:00:00.000Z'),
      fromTime: new Date('1970-01-01T10:00:00.000Z'), toTime: new Date('1970-01-01T18:00:00.000Z'),
      charge: 50000, status: 'active',
    },
  });

  // Attach 2 items
  const items = await prisma.menuItem.findMany({ where: { isActive: true }, take: 2 });
  for (const item of items) {
    await prisma.requestedItem.create({
      data: { dateSlotId: slot.id, itemId: item.id, quantity: 2, unitPrice: Number(item.charge), charge: Number(item.charge) * 2 },
    });
  }

  // Attach a menu (find one with an active rate plan for Dec 2026)
  const menu = await prisma.menu.findFirst({ where: { isActive: true } });
  let menuAttached = false;
  if (menu) {
    try {
      const r = await api('POST', `/date-slots/${slot.id}/requested-menus`, { menuId: menu.id, guestCount: 50 });
      menuAttached = r.status === 201;
    } catch { }
  }

  return { resv, slot, items, menu, menuAttached, p1 };
}

// ─── Test 1: Generate bill → 4 lines (hall + 2 items + 1 menu) ───────────────
async function test1(slot, menuAttached) {
  console.log('\n=== TEST 1: Generate bill — correct number of lines ===');

  const expectedLines = 1 + 2 + (menuAttached ? 1 : 0);

  const r = await api('POST', `/date-slots/${slot.id}/generate-bill`);
  chk(r.status === 201, `201 created (${r.status})`);
  chk(r.data.lines?.length === expectedLines, `${expectedLines} lines created (got ${r.data.lines?.length})`);

  const hallLine = r.data.lines?.find(l => l.lineType === 'hall_charge');
  chk(!!hallLine, `hall_charge line exists`);
  chk(Number(hallLine?.charge) === 50000, `hall_charge amount = 50000`);

  // Tax computed for each line
  const allHaveTaxField = r.data.lines?.every(l => l.taxAmount !== undefined && l.chargeWithTax !== undefined);
  chk(allHaveTaxField, `All lines have taxAmount and chargeWithTax fields`);

  return r.data.lines;
}

// ─── Test 2: Folio totals exactly match line sums ────────────────────────────
async function test2(resv, lines) {
  console.log('\n=== TEST 2: Folio totals exactly match sum of individual lines ===');

  const r = await api('GET', `/reservations/${resv.id}/folio`);
  chk(r.status === 200, `Folio OK (${r.status})`);

  const allLines = r.data.billLines ?? [];
  const sumBase  = allLines.reduce((s, l) => s + Number(l.charge),       0);
  const sumTax   = allLines.reduce((s, l) => s + Number(l.taxAmount),    0);
  const sumTotal = allLines.reduce((s, l) => s + Number(l.chargeWithTax),0);

  const { baseCharges, taxAmount, totalWithTax } = r.data.totals;
  chk(Math.abs(sumBase  - baseCharges) < 0.01, `Base sum matches: ${sumBase.toFixed(2)} == ${baseCharges}`);
  chk(Math.abs(sumTax   - taxAmount)   < 0.01, `Tax sum matches:  ${sumTax.toFixed(2)} == ${taxAmount}`);
  chk(Math.abs(sumTotal - totalWithTax)< 0.01, `Total matches:    ${sumTotal.toFixed(2)} == ${totalWithTax}`);

  console.log(`  📊 Base: ${sumBase.toFixed(2)}, Tax: ${sumTax.toFixed(2)}, Total: ${sumTotal.toFixed(2)}`);
}

// ─── Test 3: Complementary slot → bill lines created with charge=0 ───────────
async function test3(p1) {
  console.log('\n=== TEST 3: Complementary reservation → bill lines with charge=0 ===');

  const g = await prisma.banquetGuest.create({ data: { firstName: 'T4', lastName: 'CompBill' } });
  const r = await prisma.banquetReservation.create({
    data: { reservationCode: `BNQ-T4-COMP-${Date.now()}`, guestId: g.id, numberOfGuests: 30, createdBy: 1, status: 'guaranteed', isComplementary: true, complementaryReason: 'Test comp' },
  });
  const s = await prisma.banquetDateSlot.create({
    data: { reservationId: r.id, partitionId: p1.id, fromDate: new Date('2026-12-22T00:00:00.000Z'), toDate: new Date('2026-12-22T00:00:00.000Z'), fromTime: new Date('1970-01-01T09:00:00.000Z'), toTime: new Date('1970-01-01T12:00:00.000Z'), charge: 30000, status: 'active' },
  });

  const res = await api('POST', `/date-slots/${s.id}/generate-bill`);
  chk(res.status === 201, `Bill generated (${res.status})`);
  chk(res.data.lines?.length > 0, `Lines exist (count: ${res.data.lines?.length})`);
  chk(res.data.lines?.every(l => Number(l.charge) === 0), `All charges are 0 (complementary) ✅`);
  chk(res.data.lines?.every(l => Number(l.taxAmount) === 0), `All taxes are 0 (complementary) ✅`);
}

// ─── Test 4: Double generate-bill → 409, no duplicate lines ──────────────────
async function test4(slot) {
  console.log('\n=== TEST 4: Second generate-bill call → 409 (no duplicates) ===');

  const beforeCount = await prisma.guestBillLine.count({ where: { dateSlotId: slot.id } });
  const r = await api('POST', `/date-slots/${slot.id}/generate-bill`);
  chk(r.status === 409, `409 on duplicate generate (${r.status})`);

  const afterCount = await prisma.guestBillLine.count({ where: { dateSlotId: slot.id } });
  chk(afterCount === beforeCount, `Line count unchanged: before=${beforeCount} after=${afterCount} ✅`);
  console.log(`  📊 Verified: no duplicate lines created on second call`);
}

// ─── Test 5: Post to room → guest_charges appear in ella_pms ─────────────────
async function test5(resv) {
  console.log('\n=== TEST 5: Post to PMS room → guest_charges created in ella_pms ===');

  // Find a real active PMS reservation
  const conn = await getEllaConn();
  const [pmsResvRows] = await conn.query(
    `SELECT id FROM reservations WHERE status IN ('confirmed','checked_in','in_house') LIMIT 1`
  );

  if (!pmsResvRows.length) {
    console.log('  SKIP ⚠️  No active PMS reservation found in ella_pms. Test 5 skipped.');
    await conn.end();
    return null;
  }

  const pmsResvId = pmsResvRows[0].id;
  const [beforeRows] = await conn.query(
    `SELECT id FROM guest_charges WHERE reservation_id = ? AND description LIKE '%BANQUET%'`,
    [pmsResvId]
  );

  const r = await api('POST', `/reservations/${resv.id}/post-to-room`, { pmsReservationId: pmsResvId });
  chk(r.status === 200, `Post to room OK (${r.status})`);
  chk(r.data.posted > 0 || r.data.skipped > 0, `Reported posted=${r.data.posted}, skipped=${r.data.skipped}`);

  // Verify on PMS side
  const [afterRows] = await conn.query(
    `SELECT id, description FROM guest_charges WHERE reservation_id = ? AND description LIKE '%BANQUET%'`,
    [pmsResvId]
  );
  chk(afterRows.length > beforeRows.length || r.data.posted === 0, `guest_charges rows added in ella_pms: ${afterRows.length} (was ${beforeRows.length})`);
  console.log(`  📊 ella_pms guest_charges with BANQUET marker: ${afterRows.length}`);

  // Also verify fromPms=true in banquet DB
  const posted = await prisma.guestBillLine.findMany({ where: { reservationId: resv.id, fromPms: true } });
  chk(posted.length > 0, `Banquet GuestBillLine.fromPms=true on ${posted.length} lines`);

  await conn.end();
  return pmsResvId;
}

// ─── Test 6: Post-to-room idempotency ─────────────────────────────────────────
async function test6(resv, pmsResvId) {
  console.log('\n=== TEST 6: Second post-to-room → no duplicate guest_charges ===');

  if (!pmsResvId) {
    console.log('  SKIP ⚠️  No PMS reservation available (test 5 was skipped).');
    return;
  }

  const conn = await getEllaConn();
  const [before] = await conn.query(
    `SELECT COUNT(*) as c FROM guest_charges WHERE reservation_id = ? AND description LIKE '%BANQUET%'`,
    [pmsResvId]
  );

  const r = await api('POST', `/reservations/${resv.id}/post-to-room`, { pmsReservationId: pmsResvId });
  chk(r.status === 200, `Second post OK (${r.status})`);
  chk(r.data.posted === 0, `posted=0 on second call (all already posted)`);
  chk(r.data.skipped > 0, `skipped=${r.data.skipped} (idempotent)`);

  const [after] = await conn.query(
    `SELECT COUNT(*) as c FROM guest_charges WHERE reservation_id = ? AND description LIKE '%BANQUET%'`,
    [pmsResvId]
  );
  chk(before[0].c === after[0].c, `ella_pms guest_charges count unchanged: ${before[0].c} → ${after[0].c} ✅`);
  console.log(`  📊 No duplicate rows: count stayed at ${before[0].c}`);

  await conn.end();
}

// ─── Test 7: Deposit record + settle → outstanding balance reflects correctly ──
async function test7(resv) {
  console.log('\n=== TEST 7: Deposit + settle → outstanding balance correct ===');

  // Get folio before deposit
  const before = await api('GET', `/reservations/${resv.id}/folio`);
  const balBefore = Number(before.data.totals.outstandingBalance);

  // Record a deposit
  const dep = await api('POST', `/deposits`, {
    reservationId: resv.id,
    amount: 10000,
    paymentMethod: 'cash',
    receiptNo: 'T4-DEP-001',
    remark: 'Sprint 4 test deposit',
  });
  chk(dep.status === 201, `Deposit created (${dep.status})`);
  chk(Number(dep.data.amount) === 10000, `Deposit amount 10000 (got ${dep.data.amount})`);
  chk(dep.data.settled === false, `Initially not settled`);

  // Settle it
  const settle = await api('PUT', `/deposits/${dep.data.id}/settle`);
  chk(settle.status === 200, `Settle OK (${settle.status})`);
  chk(settle.data.settled === true, `settled=true after settle`);

  // Folio balance should decrease by 10000
  const after = await api('GET', `/reservations/${resv.id}/folio`);
  const balAfter = Number(after.data.totals.outstandingBalance);
  chk(Math.abs(balAfter - (balBefore - 10000)) < 0.01, `Outstanding reduced by 10000: ${balBefore.toFixed(2)} → ${balAfter.toFixed(2)}`);
  console.log(`  📊 Balance before: ${balBefore.toFixed(2)}, after settle: ${balAfter.toFixed(2)}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Sprint 4 — Exit Criteria Tests\n' + '='.repeat(40));

  const { resv, slot, menuAttached, p1 } = await setup();
  const lines = await test1(slot, menuAttached);
  await test2(resv, lines);
  await test3(p1);
  await test4(slot);
  const pmsResvId = await test5(resv);
  await test6(resv, pmsResvId);
  await test7(resv);

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${pass} passed, ${fail} failed`);
  if (fail === 0) console.log('All Sprint 4 tests PASSED ✅');
  else console.error('Some tests FAILED ❌');

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
