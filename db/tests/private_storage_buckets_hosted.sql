-- Read-only-with-rollback hosted RLS contract for migration 0009.
-- RUN ONLY in approved, dedicated Student Creators staging. Do not apply as
-- a migration or use real student files; this writes transient metadata only.
BEGIN;

DO $bucket_check$
BEGIN
 IF (SELECT count(*) FROM storage.buckets
     WHERE id IN ('student-creators-private-identity',
                  'student-creators-private-media')) <> 2 THEN
    RAISE EXCEPTION 'Two expected Student Creators buckets are missing';
 END IF;
 IF EXISTS (SELECT 1 FROM storage.buckets
    WHERE id IN ('student-creators-private-identity',
                 'student-creators-private-media')
      AND public IS DISTINCT FROM FALSE) THEN
    RAISE EXCEPTION 'Student Creators bucket is public';
 END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class
          WHERE oid='storage.objects'::regclass) THEN
    RAISE EXCEPTION 'Storage objects RLS is disabled';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects') THEN
    RAISE EXCEPTION 'Unexpected Storage object policy: manual review required';
 END IF;
END;
$bucket_check$;

-- No actual bytes are uploaded, and no user account is registered.
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES
 ('student-creators-private-identity','private/rls-probe-identity','11111111-1111-4111-8111-111111111111'),
 ('student-creators-private-media','private/rls-probe-video','22222222-2222-4222-8222-222222222222');

SET LOCAL ROLE anon;
DO $anon_check$
DECLARE n integer := 0;
BEGIN
 BEGIN
   SELECT count(*) INTO n FROM storage.objects
     WHERE bucket_id IN ('student-creators-private-identity',
                         'student-creators-private-media');
 EXCEPTION WHEN insufficient_privilege THEN
   n := 0;
 END;
 IF n <> 0 THEN RAISE EXCEPTION 'Anonymous caller can read private objects'; END IF;
END;
$anon_check$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $student_check$
DECLARE n integer := 0;
BEGIN
 BEGIN
   SELECT count(*) INTO n FROM storage.objects
     WHERE bucket_id IN ('student-creators-private-identity',
                         'student-creators-private-media');
 EXCEPTION WHEN insufficient_privilege THEN
   n := 0;
 END;
 IF n <> 0 THEN RAISE EXCEPTION 'Authenticated user can bypass default-deny private storage'; END IF;
END;
$student_check$;

RESET ROLE;
ROLLBACK;

SELECT 'PASS: private identity/media bucket boundaries; synthetic object metadata rolled back' AS result,
 (SELECT count(*) FROM storage.objects
  WHERE bucket_id IN ('student-creators-private-identity',
                      'student-creators-private-media')) AS remaining_objects;
