# Sprint 9 migration report

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
