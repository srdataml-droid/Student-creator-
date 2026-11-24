# Week 1 — hosted read access and isolation

Scope: Student Creators, **not** the separate AI-generated design project.

The dedicated Supabase staging database received migration `student_creators_rls_read_grants_staging_0003` after core and comment migrations. Independent review identified that its initial full-table `content_items` grant could expose internal columns on published rows; `0008` must revoke that grant and allowlist metadata columns. A separate hosted corrective migration is required and must be verified before calling it safe. This repository mirrors that access rule in `db/migrations/0008_hosted_rls_read_grants.sql`; the filename differs from the Supabase-generated migration version because the project already reserves 0003–0007 for other schema contracts. Do not reapply core schema to a nonempty database.

## Security evidence
- Public published-content reads expose only allowlisted metadata columns; internal creation keys/hashes, rights attestation and reviewer details have no client SELECT grant. Public discovery rows remain governed by RLS.
- Signed-in students have RLS-filtered reads for their own profile, verification requests, orders and entitlements.
- No direct authenticated write grants were added to verification, profiles, payment or moderation tables.
- Run `psql -v ON_ERROR_STOP=1 -f db/tests/hosted_rls_isolation.sql` only on disposable Postgres or explicitly isolated staging with safe credentials. Test inserts two synthetic users and rolls the entire transaction back.
- Manual hosted test: two synthetic student profiles and verification rows were isolated by RLS; rollback was verified by zero-user/zero-profile counts afterward.
- These tests **do not** prove browser Auth wiring, storage bucket privacy, cross-device session revocation, real student ID collection, Paystack test charging or complete production readiness.

## Testing order
Run database bootstrap, SQL migrations 0001–0008, smoke and existing regression SQL, then `hosted_rls_isolation.sql` in the ephemeral GitHub Actions Postgres service. Ensure all five CI jobs pass at the exact PR head before merging.

## Rollout
Founder tests first with a separately consented student identity after security approval; subsequent named testers require their own opt-in. Keep public enrollment, live money and Firebase activation gated.
