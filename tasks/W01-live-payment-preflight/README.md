# Live payments: production preflight

Founder authorized work on live environment and payment activation on 2026-11-25, with no Vercel deployment. The hosted checkout/settlement bridge currently implements test-only accounting; it must not be repointed to a live key. No live charging is enabled by this change.

Use a separate, founder-owned production Supabase project (never jnkqmlbkkvccnxrgkpno). Provide APP_DATA_MODE=hosted, STUDENT_CREATORS_ENVIRONMENT=production, STUDENT_CREATORS_PRODUCTION_PROJECT_REF and matching STUDENT_CREATORS_PROJECT_REF, production Supabase server credentials, PAYSTACK_LIVE_SECRET_KEY, PAYSTACK_LIVE_WEBHOOK_KEY_ID and PAYSTACK_LIVE_WEBHOOK_SIGNING_SECRET, STUDENT_CREATORS_PAYSTACK_ORIGIN, STUDENT_CREATORS_DISTRIBUTION_CHANNEL=independent_web. Do not include test credentials or staging flags in that environment. Never commit secret values.

Run `node scripts/verify-live-paystack-preflight.mjs` in an approved secret-injected environment. This calls the Paystack transaction list read-only, checks live-mode evidence when a transaction exists, and prints only coarse booleans. A successful response is not commercial activation approval or proof of webhook delivery. It never initializes a checkout.

Remaining live implementation: production-specific session/auth guards and private storage; approved price/commission/fee/refund/license policies; live-only order, receipt, ledger, entitlement and reversal persistence; test/live isolation; production webhook and worker acceptance; provider business activation and authorized real payment acceptance. Keep payouts disabled. No deployment or customer charges until these are verified. Official reference: https://paystack.com/docs/api/transaction/ and https://paystack.com/docs/payments/webhooks/.
