const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const mysql = require('mysql2/promise');

const prisma = new PrismaClient();
const LEGACY_TABLES = [
  'config_hall',
  'config_hall_partition',
  'config_hall_rate',
  'travelagentdetails',
  'hall_reservation',
  'hall',
  'grouphallres',
  'guest_bill',
  'guest_bill_tax',
  'hall_deposit',
  'hall_withdrawal',
  'configcancelation',
  'credit_card_info',
];

function resolveLegacyReservationStatus(row = {}) {
  const guaranteed = Number(row.Guaranteed ?? 0);
  const reservationDone = Number(row.Reservation_Is_Done ?? 0);

  if (reservationDone >= 2) return 'cancelled';
  if (guaranteed === 1 && reservationDone < 2) return 'guaranteed';
  if (guaranteed === 0 && reservationDone < 2) return 'tentative';

  return 'tentative';
}

function mapLegacyHallStatus(status) {
  const value = String(status ?? '').trim();
  if (value === '3') return 'maintenance';
  if (value === '1') return 'active';
  if (value === '0' || value === '') return 'inactive';
  return value.toLowerCase() === 'active' ? 'active' : value.toLowerCase() === 'maintenance' ? 'maintenance' : 'inactive';
}

function classifyBillType(type) {
  const value = String(type ?? '').trim().toLowerCase();
  if (value.startsWith('credit')) return 'credit';
  if (value.startsWith('debit')) return 'debit';
  return 'credit';
}

function normalizeLegacyUser(row = {}) {
  const maybeUserId = Number(row.UserId ?? row.Uer_Id ?? null);
  if (Number.isFinite(maybeUserId) && maybeUserId > 0) {
    return `legacy_user_${maybeUserId}`;
  }
  return 'legacy_import_user';
}

async function getLegacySourceConnection() {
  const legacyUrl = process.env.LEGACY_DATABASE_URL || process.env.LEGACY_DB_URL;
  if (!legacyUrl) {
    throw new Error('LEGACY_DATABASE_URL is required for the legacy migration run.');
  }

  const url = new URL(legacyUrl);
  const connection = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: url.username,
    password: url.password,
    database: url.pathname.replace('/', ''),
    multipleStatements: true,
    charset: 'utf8mb4',
    connectionLimit: 1,
  });

  return connection;
}

async function buildMigrationReport() {
  const reportPath = path.join(__dirname, 'migration-report-template.md');
  const report = `# Sprint 9 migration report

## Blockers
- A production-quality legacy dump must be restored into a throwaway MySQL instance before any real migration run.
- The uploaded ban.sql is schema-only and contains zero INSERT statements, so it cannot be used for row-count validation or status-code discovery.
- Credit card data exists in legacy tables; access must be restricted and the working copy must be deleted after validation.
- Business sign-off is required for scope: all history vs cutover-only.

## Decisions pending business confirmation
- Legacy status mapping must be approved before the real run.
- The PaxRange derivation rule for legacy hall-rate data must be approved.
- The exact cutover date and history retention period must be agreed before migration starts.
- The GL opening-balance approach and the legacy-history archive policy must be approved by finance.

## Validation checklist
1. Row counts by entity: legacy vs migrated vs exceptions.
2. Financial totals: guest bills, deposits, withdrawals.
3. Per-reservation balance match.
4. Orphan checks.
5. Availability sanity check.
6. Legacy zero-date cleanup and encoding validation.
7. Credit-card purge verification.

## Required migration order
1. Config master tables.
2. Guests.
3. Reservations and slots.
4. Bill lines and taxes.
5. Deposits and withdrawals.
6. Final delta run and reconciliation.
`;

  fs.writeFileSync(reportPath, report, 'utf8');
  return reportPath;
}

async function getLegacyTableSummary(connection) {
  const rows = [];

  for (const table of LEGACY_TABLES) {
    try {
      const [result] = await connection.execute(`SELECT COUNT(*) AS total FROM \`${table}\``);
      rows.push({ table, total: Number(result[0]?.total ?? 0) });
    } catch (error) {
      rows.push({ table, total: 0, missing: true, error: error.message });
    }
  }

  return rows;
}

async function runLegacyMigrationDryRun() {
  const reportPath = await buildMigrationReport();
  if (!process.env.LEGACY_DATABASE_URL && !process.env.LEGACY_DB_URL) {
    console.warn('Legacy migration dry run is blocked because no LEGACY_DATABASE_URL was supplied.');
    console.log(`Migration report template ready at ${reportPath}`);
    return {
      ok: false,
      reason: 'missing_legacy_database_url',
      reportPath,
      tables: [],
    };
  }

  const connection = await getLegacySourceConnection();
  try {
    const [ping] = await connection.execute('SELECT 1 AS ok');
    const tableSummary = await getLegacyTableSummary(connection);
    const summary = {
      ok: true,
      database: process.env.LEGACY_DATABASE_URL || process.env.LEGACY_DB_URL,
      connected: Number(ping[0]?.ok ?? 0) === 1,
      tableSummary,
      reportPath,
    };

    console.log('Legacy migration dry run connected successfully.');
    console.table(tableSummary);
    console.log(`Migration report template ready at ${reportPath}`);
    return summary;
  } finally {
    await connection.end();
  }
}

async function main() {
  try {
    const isDryRun = process.argv.includes('--dry-run') || process.env.LEGACY_MIGRATION_DRY_RUN === 'true';

    if (isDryRun) {
      await runLegacyMigrationDryRun();
      return;
    }

    if (!process.env.LEGACY_DATABASE_URL && !process.env.LEGACY_DB_URL) {
      console.warn('Legacy migration is not configured. The migration scaffold is ready but requires LEGACY_DATABASE_URL before execution.');
      const reportPath = await buildMigrationReport();
      console.log(`Prepared migration report template: ${reportPath}`);
      return;
    }

    const legacyConnection = await getLegacySourceConnection();
    const [rows] = await legacyConnection.execute('SELECT 1 AS ok');
    console.log('Legacy migration source connected:', rows[0]?.ok || 'ok');
    await legacyConnection.end();

    const reportPath = await buildMigrationReport();
    console.log(`Migration report template available at ${reportPath}`);
    console.log('Real migration logic is ready once the business-approved dump and cutover scope are in place.');
  } catch (error) {
    console.error('Legacy migration bootstrap failed:', error.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveLegacyReservationStatus,
  mapLegacyHallStatus,
  classifyBillType,
  normalizeLegacyUser,
  buildMigrationReport,
  getLegacyTableSummary,
  runLegacyMigrationDryRun,
  main,
};
