---
name: payments-ledger
description: Engineer safe NGN paid viewing access orders, PSP verification, idempotent entitlements, balanced journals, refunds and provider-reconciled payout states.
---

# payments ledger

## When to use
Use for related GitHub issues and features; this file is scoped guidance, not a granted external permission.

## Procedure
Review packages/payment-core and Brandur Leach's idempotency research. Price snapshot from backend: free NGN 0 or paid >= NGN 200; commission and PSP fee bearer must be founder-approved. Validate PSP origin plus authoritative transaction/order lookup, amount/currency/reference/environment/status. Apply one atomic entitlement and balanced journal for each verified payment, with unique constraints and retries. Model pending/settled/available/reserved/paid/refunded. Tests: duplicate/concurrent webhook, slow/timeout, tampered client price, refund/chargeback, double withdrawal, unverified transaction. Use sandbox, not live charges or payouts, until provider/owner/legal approval.

## Output checklist
- Linked issue, role, required decision and user behavior.
- Source URLs/paths inspected; separate verified behavior from proposal.
- Risks/negative tests; exact results and commit SHA.
- Acceptance/status and next step; do not invent success or approval.
