# Product release standard

Founder direction — 2026-11-24. Student Creators is a real product, not a prototype or demonstration. The first release is deliberately limited in enrollment, not a different application. Maintain and upgrade the same application.

- Student and creator interfaces contain only professional product language, real feature states, helpful errors, and relevant terms. Developer instructions, SQLite, environment variables, synthetic fixtures, debug codes and test results belong in engineering documentation, protected logs and CI, not product screens.
- Never relabel synthetic balances or transactions as real funds. Disable unavailable operations server-side; present short truthful availability messages. No fabricated activity, fake earnings, real payment activation or user enrollment without authorization.
- Preserve security checks, tests, migrations and rollback paths. Use separate staging and production infrastructure, managed authentication, RLS, private storage, transactional payments, observability and tested backup/restore.
- Deliver actual creator discovery, publishing, video storage/playback, messaging, communities and live-session integrations; scheduled events alone are not live streaming. Validate mobile devices and low-bandwidth behavior. Deploy the web application on Vercel, connect a founder-controlled custom domain, and prepare a signed Android release and Play Console submission; do not claim these integrations work before verification.
- Friday 2026-11-27 pitch: show the actual application and only working capabilities; track incomplete services privately. A pitch does not authorize public launch, external communications, paid services or real enrollment.
