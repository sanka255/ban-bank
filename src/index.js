require('dotenv').config();

const express = require('express');
const cors    = require('cors');

const { authenticateToken } = require('./middleware/auth');
const authRouter              = require('./routes/auth');
const hallsRouter             = require('./routes/halls');
const paxRangesRouter         = require('./routes/paxRanges');
const hallRatesRouter         = require('./routes/hallRates');
const functionAccountsRouter  = require('./routes/functionAccounts');
const availabilityRouter      = require('./routes/availability');
const reservationsRouter      = require('./routes/reservations');
const dateSlotsRouter         = require('./routes/dateSlots');
const dateSlotItemsRouter     = require('./routes/dateSlotItems');
const cancellationTiersRouter = require('./routes/cancellationTiers');
const calendarRouter          = require('./routes/calendar');
const menuCategoriesRouter    = require('./routes/menuCategories');
const menuItemsRouter         = require('./routes/menuItems');
const menusRouter             = require('./routes/menus');
const menuRatePlansRouter     = require('./routes/menuRatePlans');
const billingRouter           = require('./routes/billing');
const currenciesRouter        = require('./routes/currencies');
const exchangeRatesRouter     = require('./routes/exchangeRates');

const app  = express();
const PORT = process.env.PORT || 4003;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Health (unauthenticated) ──────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'synora-banquet-back' }));

app.use('/api/auth', authRouter);

// ─── JWT guard for all banquet routes ─────────────────────────────────────────
app.use('/api/banquet', authenticateToken);

// Sprint 1
app.use('/api/banquet/halls',             hallsRouter);
app.use('/api/banquet/pax-ranges',        paxRangesRouter);
app.use('/api/banquet/hall-rates',        hallRatesRouter);
app.use('/api/banquet/function-accounts', functionAccountsRouter);
app.use('/api/banquet/availability',      availabilityRouter);

// Sprint 2
app.use('/api/banquet/reservations',       reservationsRouter);
app.use('/api/banquet/date-slots',         dateSlotsRouter);
app.use('/api/banquet/date-slots',         dateSlotItemsRouter);   // /:id/requested-items & /:id/requested-menus
app.use('/api/banquet/cancellation-tiers', cancellationTiersRouter);
app.use('/api/banquet/calendar',           calendarRouter);

// Sprint 3
app.use('/api/banquet/menu-categories',  menuCategoriesRouter);
app.use('/api/banquet/menu-items',       menuItemsRouter);
app.use('/api/banquet/menus',            menusRouter);
app.use('/api/banquet/menu-rate-plans',  menuRatePlansRouter);

// Sprint 4 — billing: mounts at /date-slots (for generate-bill) and /reservations (for folio/post-to-room) and /deposits
app.use('/api/banquet/date-slots',   billingRouter);  // POST /:id/generate-bill, /:id/regenerate-bill
app.use('/api/banquet',              billingRouter);  // GET /reservations/:id/folio, POST /reservations/:id/post-to-room, GET/POST /deposits, PUT /deposits/:id/settle

// Sprint 8 — multi-currency
app.use('/api/banquet/currencies', currenciesRouter);
app.use('/api/banquet/exchange-rates', exchangeRatesRouter);

// ─── Fallbacks ─────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Internal server error' }); });

app.listen(PORT, () => console.log(`✅  synora-banquet-back running on port ${PORT}`));
