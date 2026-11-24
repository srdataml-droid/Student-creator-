-- Week 1: provision *empty* private storage buckets in the dedicated
-- Student Creators Supabase staging project only.
-- Requires operator verification of project ref jnkqmlbkkvccnxrgkpno.
-- Never run in another Worthkind app or an unreviewed production environment.
-- Source: original SQL; compare Supabase Storage access-control documentation.
-- No public upload/download policies, provider calls, sample ID files or charges.

DO $storage_preflight$
BEGIN
  IF to_regclass('storage.buckets') IS NULL
     OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'Supabase Storage schema not installed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = 'storage.objects'::regclass
      AND relrowsecurity = TRUE
  ) THEN
    RAISE EXCEPTION 'Storage object RLS is not enabled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id IN ('student-creators-private-media',
                 'student-creators-private-identity')
  ) THEN
    RAISE EXCEPTION 'Student Creators bucket already exists; review configuration';
  END IF;
  -- Do not assume pre-existing storage access policies are safe. Review them
  -- first; our initial staging project is expected to have no object policies.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
  ) THEN
    RAISE EXCEPTION 'Existing Storage object policies need independent review';
  END IF;
END;
$storage_preflight$;

INSERT INTO storage.buckets
  (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('student-creators-private-identity',
   'student-creators-private-identity',
   FALSE,
   5242880,
   ARRAY['image/jpeg','image/png','application/pdf']::text[]),
  ('student-creators-private-media',
   'student-creators-private-media',
   FALSE,
   104857600,
   ARRAY['video/mp4','video/webm','image/jpeg','image/png','text/vtt']::text[]);

-- Intentionally do not CREATE POLICY on storage.objects. Default-deny RLS
-- prevents direct anon/authenticated object reads, writes, or listing.
-- The future server handler must check live Auth, verification, ownership,
-- moderation, scan verdict and entitlements before issuing short-lived grants.
-- Neither bucket is intended as a public URL or student-ID sharing mechanism.
