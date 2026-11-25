# Live payment backend and activation gates

Founder directed use of the existing Student Creators project jnkqmlbkkvccnxrgkpno for the first live customer. On 2026-11-25 the auth foundation and live commerce migrations were applied there successfully. The empty sandbox tables were retained and sandbox checkout is permanently disabled by a database constraint. The live SQL contract passed in a rollback transaction on the actual project. Live charging remains disabled pending provider credentials and commercial policy.

Backend routes:
- POST /api/lessons/{id}/live-checkout: current verified student bearer token, exact web Origin, Idempotency-Key (16–128 safe characters), X-Student-Creators-Terms-Version (approved terms version), empty body. Price and order identity are server-controlled. Returns an order ID and trusted Paystack checkout URL only after durable reservation and rechecking current access.
- POST /api/webhooks/paystack-live: documented raw-body x-paystack-signature (live API key), optional v1 signing keys, live-only charge.success, durable inbox before acknowledgment.
- node scripts/process-live-paystack-charge.mjs: independent Paystack verification, leased settlement, immutable journal, expiring entitlement; callable after checkout disabled to reconcile existing charges.

Production uses the existing project, APP_DATA_MODE=hosted, STUDENT_CREATORS_ENVIRONMENT=production, STUDENT_CREATORS_PROJECT_REF=jnkqmlbkkvccnxrgkpno, test checkout disabled, and live Paystack key. Run scripts/verify-live-paystack-preflight.mjs first. New charges require STUDENT_CREATORS_REAL_PAYMENT_ENABLED=true, PAYSTACK_LIVE_PAYMENTS_ENABLED=1, STUDENT_CREATORS_LIVE_DELIVERY_APPROVED=true, STUDENT_CREATORS_LIVE_REVERSAL_APPROVED=true, STUDENT_CREATORS_LIVE_PROVIDER_APPROVED=true and a database-owner approved live_finance.runtime_gate row specifying actual terms version, refund policy version, commission in basis points, fee bearer, license duration in seconds and approval time. Do not set approval flags without corresponding evidence. No real policy values assumed; all SQL test amounts and durations are disposable fixtures.

Outstanding: provider activation and live key acceptance, production Auth and media delivery, provider-backed verified refund/dispute ingestion, license renewal behavior, worker scheduling and dead-letter alerting, independent security/financial review, authorized live acceptance. The reversal RPC handles verified full reversal evidence only; partial refunds and PSP fee refund reconciliation require policy and implementation. Payouts are not enabled. Vercel deployment deferred.

Official docs: https://paystack.com/docs/api/transaction/ and https://paystack.com/docs/payments/webhooks/.
