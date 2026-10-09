/**
 * Sprint 2 — all 7 exit criteria in one script.
 * Run: node scripts/sprint2/runAllTests.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = 'http://localhost:4003/api/banquet';
const jwt  = require('jsonwebtoken');
const TOKEN = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function pass(msg) { console.log(`  PASS ✅  ${msg}`); }
function fail(msg) { console.error(`  FAIL ❌  ${msg}`); process.exitCode = 1; }
function check(cond, msg) { cond ? pass(msg) : fail(msg); }

// ─── Setup helpers ─────────────────────────────────────────────────────────────

async function ensureHallAndPartitions() {
  // Re-use partition 1 & 2 from Sprint 1 (or create fresh if needed)
  const hall = await prisma.banquetHall.findFirst();
  const partitions = await prisma.hallPartition.findMany({ where: { hallId: hall.id } });
  return { hall, p1: partitions[0], p2: partitions[1] };
}

async function createTiers() {
  // Clear existing tiers, create fresh
  await prisma.hallCancellationTier.deleteMany();
  const t1 = await prisma.hallCancellationTier.create({ data: { daysMin: 0, daysMax: 7,  refundPct: 0  } });
  const t2 = await prisma.hallCancellationTier.create({ data: { daysMin: 8, daysMax: 30, refundPct: 50 } });
  const t3 = await prisma.hallCancellationTier.create({ data: { daysMin: 31, daysMax: 365, refundPct: 100 } });
  return { t1, t2, t3 };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

async function test1_twoSlotReservation({ p1, p2 }) {
  console.log('\n=== TEST 1: Create reservation with 2 slots on different partitions ===');

  // Use future dates well clear of Sprint 1 test data
  const r = await api('POST', '/reservations', {
    guest: { firstName: 'Sprint2', lastName: 'Test1', phone: '111' },
    numberOfGuests: 80,
    isComplementary: false,
    dateSlots: [
      { partitionId: p1.id, fromDate: '2026-11-10', toDate: '2026-11-10', fromTime: '09:00', toTime: '12:00' },
      { partitionId: p2.id, fromDate: '2026-11-10', toDate: '2026-11-10', fromTime: '14:00', toTime: '17:00' },
    ],
  });

  check(r.status === 201, `201 created (got ${r.status})`);
  check(r.data.dateSlots?.length === 2, `2 date slots returned (got ${r.data.dateSlots?.length})`);
  check(r.data.dateSlots?.every((s) => s.status === 'active'), 'Both slots are active');
  return r.data;
}

async function test2_conflictRejection({ p1 }) {
  console.log('\n=== TEST 2: Conflict → 409, no partial creation ===');

  // Book the slot first
  const pre = await api('POST', '/reservations', {
    guest: { firstName: 'Sprint2', lastName: 'Blocker', phone: '222' },
    numberOfGuests: 50,
    dateSlots: [{ partitionId: p1.id, fromDate: '2026-11-15', toDate: '2026-11-15', fromTime: '10:00', toTime: '13:00' }],
  });
  check(pre.status === 201, `Blocker reservation created (status ${pre.status})`);

  // Count slots before
  const slotsBefore = await prisma.banquetDateSlot.count();

  // Now try creating one with a conflicting slot AND a non-conflicting one
  const r = await api('POST', '/reservations', {
    guest: { firstName: 'Sprint2', lastName: 'Conflicting', phone: '333' },
    numberOfGuests: 50,
    dateSlots: [
      { partitionId: p1.id, fromDate: '2026-11-15', toDate: '2026-11-15', fromTime: '11:00', toTime: '14:00' }, // conflicts
      { partitionId: p1.id, fromDate: '2026-11-20', toDate: '2026-11-20', fromTime: '09:00', toTime: '11:00' }, // clear
    ],
  });

  check(r.status === 409, `409 conflict returned (got ${r.status})`);
  check(r.data.conflictingSlots?.length >= 1, 'Conflict list returned');

  // Verify ZERO partial slots were created
  const slotsAfter = await prisma.banquetDateSlot.count();
  check(slotsAfter === slotsBefore, `No partial creation: slots before=${slotsBefore} after=${slotsAfter}`);
}

async function test3_complementary({ p1 }) {
  console.log('\n=== TEST 3: Complementary validation ===');

  // Without reason → should fail
  const r1 = await api('POST', '/reservations', {
    guest: { firstName: 'Sprint2', lastName: 'Comp', phone: '444' },
    numberOfGuests: 30,
    isComplementary: true,
    dateSlots: [{ partitionId: p1.id, fromDate: '2026-11-12', toDate: '2026-11-12', fromTime: '09:00', toTime: '11:00' }],
  });
  check(r1.status === 400, `400 when complementary but no reason (got ${r1.status})`);

  // With reason → should succeed, charge still computed
  const r2 = await api('POST', '/reservations', {
    guest: { firstName: 'Sprint2', lastName: 'CompOK', phone: '555' },
    numberOfGuests: 30,
    isComplementary: true,
    complementaryReason: 'Staff member event',
    dateSlots: [{ partitionId: p1.id, fromDate: '2026-11-12', toDate: '2026-11-12', fromTime: '09:00', toTime: '11:00' }],
  });
  check(r2.status === 201, `201 complementary created (got ${r2.status})`);
  check(r2.data.isComplementary === true, 'isComplementary=true on reservation');
  check(r2.data.complementaryReason === 'Staff member event', 'reason persisted');
}

async function test4_cancellationTiers({ p1 }) {
  console.log('\n=== TEST 4: Cancellation tiers — different refund % by days before event ===');

  // Create a slot that is exactly 3 days away → tier1 (0% refund)
  const d3 = new Date(); d3.setUTCDate(d3.getUTCDate() + 3);
  const date3 = d3.toISOString().slice(0, 10);

  const r3 = await api('POST', '/reservations', {
    guest: { firstName: 'Sprint2', lastName: 'Cancel3', phone: '666' },
    numberOfGuests: 50,
    dateSlots: [{ partitionId: p1.id, fromDate: date3, toDate: date3, fromTime: '09:00', toTime: '11:00', charge: 10000 }],
  });
  check(r3.status === 201, `3-day slot created (status ${r3.status})`);

  const slotId3 = r3.data.dateSlots[0].id;
  const cancel3 = await api('POST', `/date-slots/${slotId3}/cancel`, { reason: 'Test 3 days' });
  check(cancel3.status === 200, `Cancel 3-day slot OK (status ${cancel3.status})`);
  check(cancel3.data.refundPct === 0, `0% refund for 3-day cancel (got ${cancel3.data.refundPct}%)`);
  check(cancel3.data.cancellationFee === 10000, `Full cancellation fee 10000 (got ${cancel3.data.cancellationFee})`);

  // Create a slot 20 days away → tier2 (50% refund)
  const d20 = new Date(); d20.setUTCDate(d20.getUTCDate() + 20);
  const date20 = d20.toISOString().slice(0, 10);

  const r20 = await api('POST', '/reservations', {
    guest: { firstName: 'Sprint2', lastName: 'Cancel20', phone: '777' },
    numberOfGuests: 50,
    dateSlots: [{ partitionId: p1.id, fromDate: date20, toDate: date20, fromTime: '13:00', toTime: '15:00', charge: 10000 }],
  });
  check(r20.status === 201, `20-day slot created (status ${r20.status})`);

  const slotId20 = r20.data.dateSlots[0].id;
  const cancel20 = await api('POST', `/date-slots/${slotId20}/cancel`, { reason: 'Test 20 days' });
  check(cancel20.status === 200, `Cancel 20-day slot OK (status ${cancel20.status})`);
  check(cancel20.data.refundPct === 50, `50% refund for 20-day cancel (got ${cancel20.data.refundPct}%)`);
  check(cancel20.data.refundableAmount === 5000, `Refundable 5000 (got ${cancel20.data.refundableAmount})`);
}

async function test5_noTierMatch({ p1 }) {
  console.log('\n=== TEST 5: No tier match → 0% refund + warning flag ===');

  // Tiers: 0-7, 8-30, 31-365. Create a slot 400 days away (no tier)
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 400);
  const dateStr = d.toISOString().slice(0, 10);

  const r = await api('POST', '/reservations', {
    guest: { firstName: 'Sprint2', lastName: 'NoTier', phone: '888' },
    numberOfGuests: 50,
    dateSlots: [{ partitionId: p1.id, fromDate: dateStr, toDate: dateStr, fromTime: '09:00', toTime: '11:00', charge: 8000 }],
  });
  check(r.status === 201, `No-tier slot created (status ${r.status})`);

  const slotId = r.data.dateSlots[0].id;
  const cancel = await api('POST', `/date-slots/${slotId}/cancel`, { reason: 'Test no tier' });
  check(cancel.status === 200, `Cancel response OK (status ${cancel.status})`);
  check(cancel.data.tierMatched === false, `tierMatched=false (got ${cancel.data.tierMatched})`);
  check(cancel.data.refundPct === 0, `0% refund default (got ${cancel.data.refundPct}%)`);
  check(!!cancel.data.warning, `Warning message present: "${cancel.data.warning}"`);
}

async function test6_postpone({ p1 }) {
  console.log('\n=== TEST 6: Postpone — old slot becomes postponed, new active slot created ===');

  const r = await api('POST', '/reservations', {
    guest: { firstName: 'Sprint2', lastName: 'Postpone', phone: '999' },
    numberOfGuests: 50,
    dateSlots: [{ partitionId: p1.id, fromDate: '2026-12-01', toDate: '2026-12-01', fromTime: '09:00', toTime: '12:00', charge: 5000 }],
  });
  check(r.status === 201, `Reservation created for postpone test (status ${r.status})`);

  const oldSlotId = r.data.dateSlots[0].id;

  const pp = await api('POST', `/date-slots/${oldSlotId}/postpone`, {
    fromDate: '2026-12-10', toDate: '2026-12-10', fromTime: '10:00', toTime: '13:00',
  });
  check(pp.status === 201, `Postpone 201 (got ${pp.status})`);
  check(pp.data.postponedSlot?.status === 'postponed', `Old slot is 'postponed' (got ${pp.data.postponedSlot?.status})`);
  check(pp.data.newSlot?.status === 'active', `New slot is 'active' (got ${pp.data.newSlot?.status})`);
  check(pp.data.newSlot?.fromDate !== null, 'New slot has new dates');

  // Verify old slot still exists (not deleted) in DB
  const oldInDb = await prisma.banquetDateSlot.findUnique({ where: { id: oldSlotId } });
  check(oldInDb?.status === 'postponed', `Old slot still exists in DB with status 'postponed'`);
}

async function test7_cancelAll_cascadesReservation({ p1 }) {
  console.log('\n=== TEST 7: Cancel all slots → reservation.status becomes cancelled ===');

  const r = await api('POST', '/reservations', {
    guest: { firstName: 'Sprint2', lastName: 'CancelAll', phone: '1000' },
    numberOfGuests: 50,
    dateSlots: [
      { partitionId: p1.id, fromDate: '2026-12-15', toDate: '2026-12-15', fromTime: '09:00', toTime: '11:00', charge: 3000 },
      { partitionId: p1.id, fromDate: '2026-12-15', toDate: '2026-12-15', fromTime: '13:00', toTime: '15:00', charge: 3000 },
    ],
  });
  check(r.status === 201, `Created 2-slot reservation (status ${r.status})`);

  const resId = r.data.id;
  const [s1, s2] = r.data.dateSlots;

  // Cancel slot 1 → reservation should still be active (1 slot remains)
  await api('POST', `/date-slots/${s1.id}/cancel`, { reason: 'first cancel' });
  const afterFirst = await prisma.banquetReservation.findUnique({ where: { id: resId } });
  check(afterFirst.status !== 'cancelled', `Reservation still not cancelled after 1st slot cancel (status: ${afterFirst.status})`);

  // Cancel slot 2 → NOW reservation should be cancelled
  await api('POST', `/date-slots/${s2.id}/cancel`, { reason: 'second cancel' });
  const afterAll = await prisma.banquetReservation.findUnique({ where: { id: resId } });
  check(afterAll.status === 'cancelled', `Reservation auto-cancelled after all slots cancelled (got '${afterAll.status}')`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Sprint 2 — Exit Criteria Tests\n' + '='.repeat(40));

  const { p1, p2 } = await ensureHallAndPartitions();
  await createTiers();

  await test1_twoSlotReservation({ p1, p2 });
  await test2_conflictRejection({ p1 });
  await test3_complementary({ p1 });
  await test4_cancellationTiers({ p1 });
  await test5_noTierMatch({ p1 });
  await test6_postpone({ p1 });
  await test7_cancelAll_cascadesReservation({ p1 });

  console.log('\n' + '='.repeat(40));
  if (process.exitCode === 1) {
    console.error('Some tests FAILED ❌');
  } else {
    console.log('All Sprint 2 tests PASSED ✅');
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
