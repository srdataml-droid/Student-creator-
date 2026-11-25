# Founder-provided Vercel variable names — names only, no values

Confirmed via Vercel environment metadata without requesting decrypted values:

| Service | Existing Vercel keys | Intended safe handling |
|---|---|---|
| Paystack | `paystack_public_key`, `paystack_secret_key` | Server-owned test mode only; fail closed on `pk_live_` or `sk_live_` |
| Resend | `resend_api` | Keep server-only; sender verification pending |
| Mux | `mux_sigining_secret_key`, `mux_signing_key`, `mux_token_id`, `mux_api`, `mux_env_key`, `mux_env_id`, `mux_secret_key` | Map names to **opaque candidates**, do not infer which is API ID, API secret, signing key ID or playback private key until individually validated |
| Supabase | `supabase_secret_key`, `superbase_secret_key`, `supabase_connection_string`, `supabase_publishable_key`, `supabase_url`, `SUPABASE_JWKS_URL` | Permit known aliases, reject conflicting secrets and mismatched project/JWKS host; never expose server keys |
| LiveKit | `livekit_apikey`, `livekit_project_id`, `livekit_project_url`, `livekit_sip` | Require WSS for room URL; token minting must be server-only and permissioned |

The server-only normalization implementation and tests are in draft [PR #36](https://github.com/worthkind/Student-creator-/pull/36), exact-head GitHub CI should be checked before merge. No Vercel variables were changed by this document. The existence of a key name does not confirm a valid credential or working integration. Staging/public enrollment and live charging remain disabled.
