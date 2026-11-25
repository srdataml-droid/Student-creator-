-- Original SQL; extends migration 0009 hosted contract, no external code.
-- Dedicated staging only. Run with ON_ERROR_STOP; never as a migration.
BEGIN;
DO $config$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='student-creators-private-identity' AND public IS FALSE AND file_size_limit=5242880 AND allowed_mime_types @> ARRAY['image/jpeg','image/png','application/pdf']::text[] AND cardinality(allowed_mime_types)=3) THEN
  RAISE EXCEPTION 'Identity bucket configuration mismatch';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='student-creators-private-media' AND public IS FALSE AND file_size_limit=104857600 AND allowed_mime_types @> ARRAY['video/mp4','video/webm','image/jpeg','image/png','text/vtt']::text[] AND cardinality(allowed_mime_types)=5) THEN
  RAISE EXCEPTION 'Media bucket configuration mismatch';
 END IF;
END;
$config$;
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES
 ('student-creators-private-identity','private/write-denial-existing','11111111-1111-4111-8111-111111111111'),
 ('student-creators-private-media','private/write-denial-existing','22222222-2222-4222-8222-222222222222');
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $probe$
DECLARE b text; n integer;
BEGIN
 FOR b IN SELECT unnest(ARRAY['student-creators-private-identity','student-creators-private-media']) LOOP
  BEGIN
   INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES (b,'private/write-denial-new','11111111-1111-4111-8111-111111111111');
   RAISE EXCEPTION 'Unauthorized INSERT succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
   UPDATE storage.objects SET name='private/write-denial-renamed' WHERE bucket_id=b AND name='private/write-denial-existing';
   GET DIAGNOSTICS n = ROW_COUNT;
   IF n <> 0 THEN RAISE EXCEPTION 'Unauthorized UPDATE succeeded'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
   DELETE FROM storage.objects WHERE bucket_id=b AND name='private/write-denial-existing';
   GET DIAGNOSTICS n = ROW_COUNT;
   IF n <> 0 THEN RAISE EXCEPTION 'Unauthorized DELETE succeeded'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
 END LOOP;
END;
$probe$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $probe$
DECLARE b text; n integer;
BEGIN
 FOR b IN SELECT unnest(ARRAY['student-creators-private-identity','student-creators-private-media']) LOOP
  BEGIN
   INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES (b,'private/write-denial-new','11111111-1111-4111-8111-111111111111');
   RAISE EXCEPTION 'Unauthorized INSERT succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
   UPDATE storage.objects SET name='private/write-denial-renamed' WHERE bucket_id=b AND name='private/write-denial-existing';
   GET DIAGNOSTICS n = ROW_COUNT;
   IF n <> 0 THEN RAISE EXCEPTION 'Unauthorized UPDATE succeeded'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
   DELETE FROM storage.objects WHERE bucket_id=b AND name='private/write-denial-existing';
   GET DIAGNOSTICS n = ROW_COUNT;
   IF n <> 0 THEN RAISE EXCEPTION 'Unauthorized DELETE succeeded'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
 END LOOP;
END;
$probe$;
RESET ROLE;
DO $integrity$
BEGIN
 IF (SELECT count(*) FROM storage.objects WHERE bucket_id IN ('student-creators-private-identity','student-creators-private-media') AND name='private/write-denial-existing') <> 2 THEN
  RAISE EXCEPTION 'Probe objects changed';
 END IF;
END;
$integrity$;
ROLLBACK;
SELECT 'PASS: storage configuration and direct SQL write denials' AS result;
