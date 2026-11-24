# W01 — private Storage staging gates

Scope: **Week 1 only**. Dedicated hosted Supabase project ref `jnkqmlbkkvccnxrgkpno`.
No real student enrollment, identity files, public URLs, live payment, paid tiers,
provider calls, service changes or data spending.

## Source review

- Official Supabase Storage access-control documentation and private bucket
  guidance: https://supabase.com/docs/guides/storage/security/access-control
- Vetted public upstream research: `supabase/supabase` at
  `9298ed68c1580bb48e6d864511acc3f8aa0d9351`, especially
  `apps/docs/content/guides/local-development/database-migrations.mdx`.
  Verified root LICENSE: Apache-2.0. **No upstream code, runtime scripts,
  dependencies, telemetry, remote commands, or sample objects were imported.**
  The SQL in this PR is original and depends only on existing Supabase Storage
  tables.

## Review order

1. Recheck `main` exact SHA, Issue #34, and migrations (especially 0008).
2. Verify the target project has no pre-existing buckets and no object policies.
3. Review `db/migrations/0009_private_storage_buckets.sql`, specifically
   locked-down defaults, two distinct bucket names, MIME allowlists and 5 MiB
   identity / 100 MiB media file limits.
4. Confirm no object uploads, identity evidence or fee-bearing requests.
5. After 5/5 exact-head CI and a successful transaction-rolled-back
   migration+RLS dry run, apply only to authorized isolated staging.
   **Executed on 24 Nov 2026:** migration version `20261124214412`
   (`student_creators_private_storage_staging_0009`) succeeded.
   The exact `db/tests/private_storage_buckets_hosted.sql` passed there.
   Both buckets are private with 0 objects.
6. Independent code/security reviewer approval remains REQUIRED before merging
   this pull request into main; do not count a self-review as independent.
   Preserve exact CI, hosted tests, migration version and unresolved lints
   in Issue #34.
7. Do **not** expose browser upload, list or download permissions yet.
   A future server route must enforce Auth, institution, scan/quarantine and
   paid-view rights before granting limited upload/playback access.

CI in this repository runs a disposable PostgreSQL bootstrap **without**
Supabase Storage. The hosted Storage RLS contract is deliberately not added
to that disposable bootstrap and **must not be counted as CI verified**
until executed against the real dedicated project.

No review of Firebase, Weeks 2–8, or production release is implied.
