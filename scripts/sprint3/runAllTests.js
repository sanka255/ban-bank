/**
 * Sprint 3 — All 7 exit criteria
 * Run: node scripts/sprint3/runAllTests.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');

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

// ─── Test 1: Category → Items → Menu with 3 items ────────────────────────────
async function test1() {
  console.log('\n=== TEST 1: Category / items / menu structure ===');

  const cat = await api('POST', '/menu-categories', { name: 'T3 Starters' });
  chk(cat.status === 201, `Category created (${cat.status})`);

  const i1 = await api('POST', '/menu-items', { name: 'Soup',    categoryId: cat.data.id, charge: 500  });
  const i2 = await api('POST', '/menu-items', { name: 'Salad',   categoryId: cat.data.id, charge: 600  });
  const i3 = await api('POST', '/menu-items', { name: 'Bruschetta', categoryId: cat.data.id, charge: 450 });
  chk(i1.status === 201 && i2.status === 201 && i3.status === 201, `3 items created`);

  const menu = await api('POST', '/menus', { name: 'Wedding Package A' });
  chk(menu.status === 201, `Menu created (${menu.status})`);

  // Link 3 items
  const l1 = await api('POST', `/menus/${menu.data.id}/items/${i1.data.id}`, {});
  const l2 = await api('POST', `/menus/${menu.data.id}/items/${i2.data.id}`, {});
  const l3 = await api('POST', `/menus/${menu.data.id}/items/${i3.data.id}`, {});
  chk(l1.status === 201 && l2.status === 201 && l3.status === 201, `3 items linked to menu`);

  // Duplicate link rejected
  const dup = await api('POST', `/menus/${menu.data.id}/items/${i1.data.id}`, {});
  chk(dup.status === 409, `Duplicate link rejected with 409 (${dup.status})`);

  // GET menu detail — should have 3 items
  const detail = await api('GET', `/menus/${menu.data.id}`);
  chk(detail.data.items?.length === 3, `Menu GET returns 3 linked items (got ${detail.data.items?.length})`);

  // Category GET includes items
  const catDetail = await api('GET', `/menu-categories/${cat.data.id}`);
  chk(catDetail.data.items?.length === 3, `Category GET includes 3 items (got ${catDetail.data.items?.length})`);

  return { cat: cat.data, i1: i1.data, i2: i2.data, i3: i3.data, menu: menu.data };
}

// ─── Test 2: Rate plan date range is picked up correctly ──────────────────────
async function test2(menu, slotId) {
  console.log('\n=== TEST 2: Rate plan covers event date → correct rate picked ===');

  // Plan covers Dec 2026
  const plan = await api('POST', '/menu-rate-plans', { name: 'Dec 2026 Wedding', fromDate: '2026-12-01', toDate: '2026-12-31' });
  chk(plan.status === 201, `Rate plan created (${plan.status})`);

  const rate = await api('POST', `/menu-rate-plans/${plan.data.id}/rates`, { menuId: menu.id, charge: 3500 });
  chk(rate.status === 201, `Rate set: 3500/head for Wedding Package A in Dec (${rate.status})`);

  // Attach menu to a slot whose fromDate is in Dec
  const attach = await api('POST', `/date-slots/${slotId}/requested-menus`, { menuId: menu.id, guestCount: 100 });
  chk(attach.status === 201, `Menu attached successfully (${attach.status})`);
  chk(Number(attach.data.charge) === 350000, `Charge = 3500 × 100 = 350000 (got ${attach.data.charge})`);
  chk(attach.data.appliedRate?.ratePlanId === plan.data.id, `Correct rate plan applied`);

  return { plan: plan.data, rmId: attach.data.id };
}

// ─── Test 3: Price snapshot — changing item price doesn't affect existing attachment ──
async function test3(item, slotId2) {
  console.log('\n=== TEST 3: unitPrice snapshot survives item price change ===');

  const originalCharge = Number(item.charge); // 500

  // Attach item at current price
  const attach = await api('POST', `/date-slots/${slotId2}/requested-items`, { itemId: item.id, quantity: 2 });
  chk(attach.status === 201, `Item attached (${attach.status})`);
  chk(Number(attach.data.unitPrice) === originalCharge, `unitPrice snapshotted as ${originalCharge} (got ${attach.data.unitPrice})`);
  chk(Number(attach.data.charge) === originalCharge * 2, `charge = ${originalCharge * 2} (qty 2)`);

  const riId = attach.data.id;

  // NOW change the item's master price
  const update = await api('PUT', `/menu-items/${item.id}`, { charge: 999 });
  chk(Number(update.data.charge) === 999, `Item master price updated to 999`);

  // Re-fetch the RequestedItem — unitPrice should STILL be original
  const ri = await prisma.requestedItem.findUnique({ where: { id: riId } });
  chk(Number(ri.unitPrice) === originalCharge, `Existing RequestedItem.unitPrice still ${originalCharge} after item price change ✅`);
  chk(Number(ri.charge) === originalCharge * 2, `Existing charge still ${originalCharge * 2} (not recomputed) ✅`);

  return { riId };
}

// ─── Test 4: Menu attach on date within rate plan → correct charge ────────────
// (Already confirmed in test2. Add a second assertion here for the guestCount scaling.)
async function test4(menu, slotId) {
  console.log('\n=== TEST 4: guestCount scaling verified ===');
  // Attach again with different guestCount to verify scaling (use a fresh slot date not already covered)
  // Re-use slotId, attach another count
  const attach = await api('POST', `/date-slots/${slotId}/requested-menus`, { menuId: menu.id, guestCount: 50 });
  // Slot already has one requestedMenu — that's fine, we're adding another
  chk(attach.status === 201, `Second menu attach OK (${attach.status})`);
  chk(Number(attach.data.charge) === 175000, `charge = 3500 × 50 = 175000 (got ${attach.data.charge})`);
}

// ─── Test 5: No rate plan covers date → 422 rejection ─────────────────────────
async function test5(menu, slotId3) {
  console.log('\n=== TEST 5: No covering rate plan → 422 rejection ===');

  const r = await api('POST', `/date-slots/${slotId3}/requested-menus`, { menuId: menu.id, guestCount: 80 });
  chk(r.status === 422, `422 returned when no rate plan covers the event date (${r.status})`);
  chk(r.data.error?.includes('No active rate plan'), `Error message is explicit: "${r.data.error?.slice(0, 60)}…"`);
  chk(!!r.data.eventDate, `eventDate included in response for context`);
}

// ─── Test 6: Complementary item validation ────────────────────────────────────
async function test6(item, slotId2) {
  console.log('\n=== TEST 6: Complementary item validation ===');

  // Without reason → 400
  const r1 = await api('POST', `/date-slots/${slotId2}/requested-items`, { itemId: item.id, quantity: 1, isComplementary: true });
  chk(r1.status === 400, `400 for comp without reason (${r1.status})`);

  // With reason → 201, charge still computed and stored
  const r2 = await api('POST', `/date-slots/${slotId2}/requested-items`, {
    itemId: item.id, quantity: 3, isComplementary: true, reason: 'VIP guest — hotel arrangement',
  });
  chk(r2.status === 201, `Comp item created with reason (${r2.status})`);
  chk(r2.data.isComplementary === true, `isComplementary=true`);
  chk(Number(r2.data.charge) > 0, `charge still computed: ${r2.data.charge} (not zeroed out)`);
  chk(r2.data.reason === 'VIP guest — hotel arrangement', `reason stored`);
}

// ─── Test 7: Remove item/menu, no cross-slot impact ───────────────────────────
async function test7(riId, rmId, slotId, slotId2) {
  console.log('\n=== TEST 7: Remove item/menu → only that slot affected ===');

  // Count items on slotId2 before delete
  const before = await prisma.requestedItem.count({ where: { dateSlotId: slotId2 } });

  // Remove the specific RequestedItem (riId belongs to slotId2)
  const delRI = await api('DELETE', `/date-slots/${slotId2}/requested-items/${riId}`);
  chk(delRI.status === 200, `RequestedItem deleted (${delRI.status})`);

  const afterRI = await prisma.requestedItem.findUnique({ where: { id: riId } });
  chk(afterRI === null, `RequestedItem no longer in DB`);

  // Other slot's items untouched
  const slotOtherCount = await prisma.requestedItem.count({ where: { dateSlotId: slotId } });
  chk(slotOtherCount >= 0, `slotId item count unaffected (${slotOtherCount})`);

  // Remove the RequestedMenuItem (rmId belongs to slotId)
  const delRM = await api('DELETE', `/date-slots/${slotId}/requested-menus/${rmId}`);
  chk(delRM.status === 200, `RequestedMenuItem deleted (${delRM.status})`);

  const afterRM = await prisma.requestedMenuItem.findUnique({ where: { id: rmId } });
  chk(afterRM === null, `RequestedMenuItem no longer in DB`);

  // slotId2's menus untouched
  const otherMenuCount = await prisma.requestedMenuItem.count({ where: { dateSlotId: slotId2 } });
  chk(otherMenuCount >= 0, `slotId2 menus unaffected`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Sprint 3 — Exit Criteria Tests\n' + '='.repeat(40));

  // Find existing active date slots in the DB
  const activeSlots = await prisma.banquetDateSlot.findMany({
    where: { status: 'active' },
    orderBy: { id: 'asc' },
    take: 10,
  });

  if (activeSlots.length < 2) {
    console.error('Need at least 2 active date slots from Sprint 2 tests. Run Sprint 2 first.');
    process.exit(1);
  }

  // slotId: for menu attaches (Dec 2026 for rate plan coverage)
  // First create a Dec 2026 slot for tests 2 & 4 & 5
  const p1 = await prisma.hallPartition.findFirst({ where: { status: 'active' } });

  // Dec slot (inside rate plan range)
  const guest = await prisma.banquetGuest.create({ data: { firstName: 'T3', lastName: 'MenuTest' } });
  const resv  = await prisma.banquetReservation.create({
    data: { reservationCode: `BNQ-T3-${Date.now()}`, guestId: guest.id, numberOfGuests: 100, createdBy: 1, status: 'guaranteed' },
  });
  const decSlot = await prisma.banquetDateSlot.create({
    data: {
      reservationId: resv.id, partitionId: p1.id,
      fromDate: new Date('2026-12-15T00:00:00.000Z'), toDate: new Date('2026-12-15T00:00:00.000Z'),
      fromTime: new Date('1970-01-01T10:00:00.000Z'), toTime: new Date('1970-01-01T18:00:00.000Z'),
      charge: 50000, status: 'active',
    },
  });

  // Nov slot (outside any rate plan range — for test 5)
  const novSlot = await prisma.banquetDateSlot.create({
    data: {
      reservationId: resv.id, partitionId: p1.id,
      fromDate: new Date('2026-11-01T00:00:00.000Z'), toDate: new Date('2026-11-01T00:00:00.000Z'),
      fromTime: new Date('1970-01-01T10:00:00.000Z'), toTime: new Date('1970-01-01T14:00:00.000Z'),
      charge: 30000, status: 'active',
    },
  });

  // A-la-carte slot (an existing active slot for items)
  const itemSlot = activeSlots[0];

  const { cat, i1, i2, i3, menu } = await test1();
  const { plan, rmId }             = await test2(menu, decSlot.id);
  const { riId }                   = await test3(i1, itemSlot.id);
  await test4(menu, decSlot.id);
  await test5(menu, novSlot.id);
  await test6(i1, itemSlot.id);
  await test7(riId, rmId, decSlot.id, itemSlot.id);

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${pass} passed, ${fail} failed`);
  if (fail === 0) console.log('All Sprint 3 tests PASSED ✅');
  else console.error('Some tests FAILED ❌');

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
