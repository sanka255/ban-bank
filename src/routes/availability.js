const express = require('express');
const { checkPartitionAvailability } = require('../services/availabilityService');

const router = express.Router();

/**
 * GET /api/banquet/availability
 *
 * Query params:
 *   partitionId      {number}  required
 *   fromDate         {string}  required  "YYYY-MM-DD"
 *   toDate           {string}  required  "YYYY-MM-DD"
 *   fromTime         {string}  required  "HH:mm"
 *   toTime           {string}  required  "HH:mm"
 *   excludeDateSlotId {number} optional  (use when checking an existing slot for edits)
 *
 * Response:
 *   { available: boolean, conflicts: BanquetDateSlot[] }
 */
router.get('/', async (req, res) => {
  const { partitionId, fromDate, toDate, fromTime, toTime, excludeDateSlotId } = req.query;

  // Validate required params
  if (!partitionId || !fromDate || !toDate || !fromTime || !toTime) {
    return res.status(400).json({
      error: 'partitionId, fromDate, toDate, fromTime, and toTime are all required',
    });
  }

  // Validate date/time formats
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const timeRe = /^\d{2}:\d{2}(:\d{2})?$/;
  if (!dateRe.test(fromDate) || !dateRe.test(toDate)) {
    return res.status(400).json({ error: 'Dates must be in YYYY-MM-DD format' });
  }
  if (!timeRe.test(fromTime) || !timeRe.test(toTime)) {
    return res.status(400).json({ error: 'Times must be in HH:mm format' });
  }
  if (fromDate > toDate) {
    return res.status(400).json({ error: 'fromDate must be <= toDate' });
  }

  try {
    const result = await checkPartitionAvailability({
      partitionId: Number(partitionId),
      fromDate,
      toDate,
      fromTime,
      toTime,
      excludeDateSlotId: excludeDateSlotId ? Number(excludeDateSlotId) : null,
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Availability check failed', detail: err.message });
  }
});

module.exports = router;
