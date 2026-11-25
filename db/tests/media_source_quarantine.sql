BEGIN;
DO $$ BEGIN
 IF has_table_privilege('service_role','public.media_source_uploads','INSERT,UPDATE,DELETE') OR has_function_privilege('authenticated','public.claim_live_media_source()','EXECUTE') OR has_function_privilege('anon','public.reserve_live_media_source(uuid,uuid,text,bigint,text)','EXECUTE') THEN RAISE EXCEPTION 'Unsafe media quarantine privileges'; END IF;
 IF public.claim_live_media_source() IS NOT NULL OR public.begin_live_media_dispatch('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',repeat('a',64),'ClamAV fixture') IS NOT NULL THEN RAISE EXCEPTION 'Nonexistent source dispatch'; END IF;
END $$;
ROLLBACK;
