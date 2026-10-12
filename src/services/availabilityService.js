const prisma = require('../prisma');

/**
 * Convert a time value to minutes-from-midnight.
 * Handles both:
 *   - JS Date objects returned by Prisma from @db.Time columns
 *     (stored as MySQL TIME, returned with date component 1970-01-01 UTC)
 *   - "HH:mm" or "HH:mm:ss" strings from query params / user input
 */
function toMinutes(t) {
  if (t instanceof Date) {
    // Prisma returns @db.Time as a Date where the time is in UTC
    return t.getUTCHours() * 60 + t.getUTCMinutes();
  }
  if (typeof t === 'string') {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }
  throw new Error(`Invalid time value: ${t}`);
}

/**
 * checkPartitionAvailability
 *
 * Corrected replacement for the legacy checkThisHallnew() — no unparenthesized
 * OR conditions. Implements the standard interval-overlap check:
 *   overlap exists iff fromTime < slot.toTime AND toTime > slot.fromTime
 *
 * Step 1 (DB): filter by date range overlap — fetches candidate slots
 * Step 2 (JS): filter candidates by time overlap — handles same-day bookings
 *              correctly for all cases (enclosing, enclosed, partial)
 *
 * @param {object} params
 * @param {number}          params.partitionId        - Partition to check
 * @param {string|Date}     params.fromDate           - Start date "YYYY-MM-DD"
 * @param {string|Date}     params.toDate             - End date "YYYY-MM-DD"
 * @param {string|Date}     params.fromTime           - Start time "HH:mm"
 * @param {string|Date}     params.toTime             - End time "HH:mm"
 * @param {number|null}     params.excludeDateSlotId  - Slot to ignore (for edits)
 * @returns {{ available: boolean, conflicts: object[] }}
 */
async function checkPartitionAvailability({
  partitionId,
  fromDate,
  toDate,
  fromTime,
  toTime,
  excludeDateSlotId = null,
  forStatus = 'tentative', // 'tentative' or 'guaranteed'
}) {
  // Normalise dates to Date objects (midnight UTC) so Prisma date comparisons work
  const fromDateObj = fromDate instanceof Date ? fromDate : new Date(`${fromDate}T00:00:00.000Z`);
  const toDateObj   = toDate   instanceof Date ? toDate   : new Date(`${toDate}T00:00:00.000Z`);

  // Step 1: DB query — date-range overlap candidates only; cancelled/postponed excluded
  const candidates = await prisma.banquetDateSlot.findMany({
    where: {
      partitionId,
      status: 'active',
      ...(excludeDateSlotId != null ? { id: { not: excludeDateSlotId } } : {}),
      // slot.fromDate <= our toDate  AND  slot.toDate >= our fromDate
      fromDate: { lte: toDateObj },
      toDate:   { gte: fromDateObj },
    },
    include: {
      reservation: {
        select: { id: true, reservationCode: true, status: true },
      },
    },
  });

  // Step 2: Time-overlap check in application code
  // Standard correct interval overlap: A.start < B.end AND A.end > B.start
  const reqFromMin = toMinutes(fromTime);
  const reqToMin   = toMinutes(toTime);

  const conflicts = candidates.filter((slot) => {
    const slotFromMin = toMinutes(slot.fromTime);
    const slotToMin   = toMinutes(slot.toTime);
    return reqFromMin < slotToMin && reqToMin > slotFromMin;
  });

  // Split into guaranteed conflicts and tentative conflicts
  const guaranteedStatuses = ['guaranteed', 'in_progress', 'completed'];
  const guaranteedConflicts = conflicts.filter((c) =>
    guaranteedStatuses.includes(c.reservation?.status)
  );
  const tentativeConflicts = conflicts.filter(
    (c) => c.reservation?.status === 'tentative'
  );

  // If booking as tentative: only blocked if another GUARANTEED reservation exists.
  // If booking as guaranteed: blocked if ANY guaranteed reservation exists.
  const isAvailable = guaranteedConflicts.length === 0;

  return {
    available: isAvailable,
    hasGuaranteedConflict: guaranteedConflicts.length > 0,
    hasTentativeConflict: tentativeConflicts.length > 0,
    guaranteedConflicts,
    tentativeConflicts,
    conflicts, // all conflicts (backwards-compatible)
  };
}

module.exports = { checkPartitionAvailability };
