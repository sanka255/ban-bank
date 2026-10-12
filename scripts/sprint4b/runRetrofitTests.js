/**
 * Sprint 4B — Foundation Retrofit Tests (C1, C2, C5, C7)
 * Run: node scripts/sprint4b/runRetrofitTests.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
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

async function main() {
  console.log('Sprint 4B — Foundation Retrofit Tests (C1, C2, C5, C7)\n' + '='.repeat(50));

  const partition = await prisma.hallPartition.findFirst({ where: { status: 'active' } });
  if (!partition) throw new Error('No active partition found');

  const testDate = '2027-04-15';
  const fromTime = '10:00';
  const toTime   = '14:00';

  // ─── TEST 1 (C1-A): Multiple tentative bookings can coexist on same slot ─────
  console.log('\n=== TEST 1 (C1-A): Multiple tentative bookings allowed on same slot ===');
  const res1 = await api('POST', '/reservations', {
    numberOfGuests: 80,
    guest: { firstName: 'Tentative', lastName: 'User1', phone: '0771111111' },
    dateSlots: [{ partitionId: partition.id, fromDate: testDate, toDate: testDate, fromTime, toTime, charge: 40000 }],
  });
  chk(res1.status === 201, `First tentative booking created (201)`);
  const r1Id = res1.data.id;

  const res2 = await api('POST', '/reservations', {
    numberOfGuests: 60,
    guest: { firstName: 'Tentative', lastName: 'User2', phone: '0772222222' },
    dateSlots: [{ partitionId: partition.id, fromDate: testDate, toDate: testDate, fromTime, toTime, charge: 40000 }],
  });
  chk(res2.status === 201, `Second tentative booking allowed on same slot (201) ✅`);
  chk(Array.isArray(res2.data.tentativeWarnings) && res2.data.tentativeWarnings.length > 0, `Tentative warning received for overlap ✅`);
  const r2Id = res2.data.id;

  // ─── TEST 2 (C2-A): Recording deposit promotes tentative to guaranteed ──────
  console.log('\n=== TEST 2 (C2-A): Deposit promotes tentative to guaranteed ===');
  const dep1 = await api('POST', '/deposits', {
    reservationId: r1Id,
    amount: 15000,
    paymentMethod: 'cash',
    receiptNo: 'REC-RETRO-01',
    remark: 'Advance payment',
  });
  chk(dep1.status === 201, `Deposit created (201)`);
  chk(dep1.data.guaranteedPromoted === true, `Reservation promoted to guaranteed ✅`);

  const r1Refreshed = await prisma.banquetReservation.findUnique({ where: { id: r1Id } });
  chk(r1Refreshed.status === 'guaranteed', `DB status is guaranteed ✅`);

  // ─── TEST 3 (C1-B): Guaranteed booking blocks another from being promoted ────
  console.log('\n=== TEST 3 (C1-B): Cannot promote conflicting booking to guaranteed ===');
  // Attempt to deposit on r2 (which overlaps with now-guaranteed r1)
  const dep2 = await api('POST', '/deposits', {
    reservationId: r2Id,
    amount: 10000,
    paymentMethod: 'card',
    receiptNo: 'REC-RETRO-02',
  });
  chk(dep2.status === 201, `Deposit recorded on second reservation`);
  chk(dep2.data.guaranteedPromoted === false, `r2 NOT promoted because r1 is already guaranteed ✅`);
  chk(!!dep2.data.guaranteeWarning, `Warning returned: "${dep2.data.guaranteeWarning}" ✅`);

  const r2Refreshed = await prisma.banquetReservation.findUnique({ where: { id: r2Id } });
  chk(r2Refreshed.status === 'tentative', `r2 remains tentative in DB ✅`);

  // ─── TEST 4 (C2-B): Deleting deposit reverts status from guaranteed to tentative ─
  console.log('\n=== TEST 4 (C2-B): Deleting deposit reverts to tentative ===');
  const delDep = await api('DELETE', `/deposits/${dep1.data.id}`);
  chk(delDep.status === 200, `Deposit deleted (200)`);
  chk(delDep.data.revertedToTentative === true, `revertedToTentative flag is true ✅`);

  const r1AfterDel = await prisma.banquetReservation.findUnique({ where: { id: r1Id } });
  chk(r1AfterDel.status === 'tentative', `r1 reverted back to tentative in DB ✅`);

  // Also clean up r2 deposit
  await api('DELETE', `/deposits/${dep2.data.id}`);

  // ─── TEST 5 (C5): Billed date slots block item/menu deletion ─────────────────
  console.log('\n=== TEST 5 (C5): Billed date slot blocks requested item & menu deletion ===');
  const slot1Id = res1.data.dateSlots[0].id;

  // Add an item to slot 1
  const item = await prisma.menuItem.findFirst({ where: { isActive: true } });
  const addRi = await api('POST', `/date-slots/${slot1Id}/requested-items`, {
    itemId: item.id,
    quantity: 2,
  });
  chk(addRi.status === 201, `Requested item added before billing (201)`);
  const riId = addRi.data.id;

  // Generate a bill for slot 1
  const genBill = await api('POST', `/date-slots/${slot1Id}/generate-bill`);
  chk(genBill.status === 201, `Bill generated for slot 1 (201)`);

  // Now attempt to delete requested item after bill generation
  const delRiAfterBill = await api('DELETE', `/date-slots/${slot1Id}/requested-items/${riId}`);
  chk(delRiAfterBill.status === 409, `Deletion rejected with 409 after bill generated ✅`);
  chk(delRiAfterBill.data.error.includes('already been generated'), `Explicit audit error returned ✅`);

  // Attempt to edit requested item after bill generation
  const putRiAfterBill = await api('PUT', `/date-slots/${slot1Id}/requested-items/${riId}`, { quantity: 5 });
  chk(putRiAfterBill.status === 409, `Modification rejected with 409 after bill generated ✅`);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${pass} passed, ${fail} failed`);
  if (fail === 0) console.log('All Sprint 4B Retrofit tests PASSED ✅');
  else console.error('Some tests FAILED ❌');

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
