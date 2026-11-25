# Upstream research candidates — hosted identity and email

- Supabase JS official project: https://github.com/supabase/supabase-js (GitHub license metadata: MIT, repository active when checked 2026-11-24). Use pinned official dependency and test RLS/session refresh; no source copied yet.
- Resend Node official project: https://github.com/resend/resend-node ; pinned code sample at `f469296e8affa8be59d9c1f73119909ec1554bc7`, MIT license. One small standalone `has-dot-segment.ts` utility is staged under `references/` with complete MIT notice and an explicit file-level static review. **It is not part of the runtime or production integrations.**

Review concerns before adoption: outbound email API calls and provider data handling, domain verification, logging, rate limits, account recovery enumeration, GDPR/privacy, dependency scripts, and consent. No malware-free guarantee and no copied student data.
