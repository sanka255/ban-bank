# Banquet Rebuild — Implementation Backlog from the Gap Analysis

## Priority 0: Business decisions required before build

1. Confirm guaranteed vs tentative booking rules.
   - Decision required: can multiple tentative bookings overlap?
   - Decision required: what happens to prior tentative bookings when one is guaranteed?

2. Confirm deposit-to-guarantee rule.
   - Accept deposit amount threshold.
   - Define whether guarantee is reversible when the last deposit is deleted.

3. Confirm finance integration model.
   - Separate banquet GL vs property finance system.
   - Decide whether `payment_type.Account_No` and `tax_and_account` are required mappings.

4. Confirm the legal operational print set.
   - Function sheet
   - tax-invoice format
   - deposit/receipt format
   - check-in / check-out forms

5. Confirm which optional modules are live.
   - Packages
   - Themes
   - Floor plan
   - Equipment
   - Discount usage

---

## Priority 1: Blockers for go-live

### P1.1 Availability and guarantee logic
- Add reservation state model: `tentative`, `guaranteed`, `cancelled`.
- Refine availability checks to exclude non-cancelled reservations while allowing overlapping tentatives by policy.
- Add a deposit-triggered guarantee transition and rollback when the final deposit is removed.
- Add a warning/flag when a guaranteed booking overlaps another guaranteed booking on the same hall/partition/time.

### P1.2 Billing and GL integration
- Add payment mapping table: `payment_type` to GL account.
- Add tax mapping table: `tax_and_account` to GL account.
- Add a journal/posting outbox with a separate finance integration decision.
- Require debit credit mapping before any posting flow is activated.

### P1.3 Function order sheet
- Create a printable event-order document by reservation/day.
- Support department sections: banquet operations, security, housekeeping, front office, F&B, engineering, chief steward, special instructions, billing, room setup, menu, and equipment.
- Ensure the document is generated from reservation details, requested setups, and departmental notes.

### P1.4 Printed billing documents
- Add bill print templates for hall, menu, item, package, extra, deposit, cancellation.
- Add deposit slip and receipt printing.
- Add check-in / check-out document flow.
- Add letterhead and amount-in-words rendering.

---

## Priority 2: Business-critical features

### P2.1 Menu and package rules
- Add adult/child menu support with `menuType` and pax groups.
- Add max-allowance checks per category.
- Add reservation-level negotiated menu rate override.
- Add package model and package selection configuration.

### P2.2 Extras, discounts, refunds
- Add theme configuration and chargeable theme assignment.
- Add extra-request creation and billing flow.
- Add discount model and tax impact logic.
- Add debtor posting and stand-alone refund handling.

### P2.3 Event lifecycle
- Add hall change audit flow.
- Add check-in / check-out lifecycle states.
- Add over-booking visibility for tentative vs available capacity.
- Add flat cancellation and postponement fee support.

---

## Priority 3: Reporting and master data

- Add forecasting, flash income, tentative summary, confirmed summary, history, item invoice, function summary, and availability chart reports.
- Add richer guest / travel-agent master data.
- Add discussed-by / brought-by staff mapping.
- Add user log, audit privileges, and security-option matrix aligned with legacy expectations.

---

## Delivery sequence

1. Sprint 1/2: guarantee + deposit + availability policy cleanup
2. Sprint 3: menus, packages, extras, discounts
3. Sprint 4: billing, tax, GL, business-date posting
4. Sprint 5: report layer and admin screens
5. Sprint 6: finance integration and posting decisions
6. Sprint 9: migration updates for the new modules and guarantee semantics

---

## Definition of done

A gap is considered finished only when:
- the business decision is confirmed,
- the data model matches the chosen rule,
- the UI flow is implemented,
- the print/report is generated,
- the migration map includes the table and historical behavior,
- the audit trail records the change.
