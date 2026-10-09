# Sprint 9: Legacy Data Migration

This folder contains the migration scaffold for the Banquet legacy-to-new cutover.

## Blockers that must be resolved before the real run

1. A full production dump is required. The uploaded `ban.sql` is schema-only and cannot support row counts, dry-run validation, or status-code discovery.
2. The source dump contains plaintext card data in `credit_card_info.Credi_Card_No`. Restrict access to the working copy and delete it after validation.
3. The business must confirm the scope: all history or only open/future plus the last N years.
4. Status mapping, hall-status mapping, and PaxRange derivation must be approved against the real data before the migration is executed.

## Migration principle

The migration is idempotent and traceable by `legacyId` on all migrated tables. Every write should use upsert semantics keyed on the source primary key so the delta run can be repeated safely.

## Files
- `legacyMigration.js` — bootstrap migration script and helper functions for status mapping and legacy-user normalization.
- `migration-report-template.md` — reconciliation report template to be filled once the real legacy dump is restored.

## Required runtime variables

```bash
LEGACY_DATABASE_URL=mysql://user:pass@host:3306/banquet
DATABASE_URL=mysql://user:pass@host:3306/synora_banquet
```

## Required validation before go-live

- Row count reconciliation: legacy vs migrated vs exceptions
- Financial reconciliation: charges, deposits, withdrawals, rounding tolerance
- Reservation-balance reconciliation for every migrated reservation
- Orphan checks and availability checks
- Zero-date cleanup and encoding validation
- Confirm no `credit_card_info` values remain in the target DB

## Safety rules

- Never write to the legacy server.
- Restore to a throwaway source instance only.
- Snapshot the target DB before each run.
- Keep the legacy DB as a read-only archive for pre-cutover history.
