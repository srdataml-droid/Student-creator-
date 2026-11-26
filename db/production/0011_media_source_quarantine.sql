-- Private immutable media quarantine; only trusted worker sends scanned bytes to Mux.
CREATE TABLE public.media_source_uploads(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),content_id uuid NOT NULL UNIQUE,creator_id uuid NOT NULL,
 mime text NOT NULL CHECK(mime IN ('video/mp4','video/webm')),bytes bigint NOT NULL CHECK(bytes BETWEEN 12 AND 104857600),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),object_key text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','queued','leased','dispatching','dispatched','rejected','review')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),lease_id uuid,lease_until timestamptz,
 scanner_version text,scanned_at timestamptz,mux_reservation uuid UNIQUE REFERENCES public.mux_video_uploads(id),provider_upload_id text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(content_id,creator_id) REFERENCES public.content_items(id,creator_id),
 CHECK(object_key='private/media/'||creator_id::text||'/'||content_id::text||'/'||id::text||CASE mime WHEN 'video/mp4' THEN '.mp4' ELSE '.webm' END),
 CHECK((state IN ('leased','dispatching'))=(lease_id IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK(state NOT IN ('dispatching','dispatched') OR (scanner_version IS NOT NULL AND scanned_at IS NOT NULL AND mux_reservation IS NOT NULL)),
 CHECK(state<>'dispatched' OR provider_upload_id IS NOT NULL)
);
CREATE INDEX media_source_queue_idx ON public.media_source_uploads(state,created_at) WHERE state IN ('queued','leased');
CREATE INDEX media_source_creator_idx ON public.media_source_uploads(creator_id,created_at);
ALTER TABLE public.media_source_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_source_uploads FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.reserve_live_media_source(_creator uuid,_content uuid,_mime text,_bytes bigint,_digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.media_source_uploads%ROWTYPE; v_id uuid:=gen_random_uuid();
BEGIN
 IF NOT public.affiliation_eligible(_creator) OR _mime IS NULL OR _mime NOT IN ('video/mp4','video/webm') OR _bytes IS NULL OR _bytes NOT BETWEEN 12 AND 104857600 OR _digest IS NULL OR _digest !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 PERFORM 1 FROM public.student_profiles WHERE user_id=_creator FOR UPDATE;
 PERFORM 1 FROM public.content_items WHERE id=_content AND creator_id=_creator AND status IN ('draft','rejected') FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public.media_source_uploads WHERE content_id=_content;
 IF FOUND THEN
  IF r.digest<>_digest OR r.bytes<>_bytes OR r.mime<>_mime THEN RETURN jsonb_build_object('conflict',true); END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.mux_video_uploads WHERE content_id=_content) THEN RETURN jsonb_build_object('conflict',true); END IF;
  IF (SELECT count(*) FROM public.media_source_uploads WHERE creator_id=_creator AND created_at>now()-interval '1 day')>=5 THEN RETURN jsonb_build_object('limited',true); END IF;
  INSERT INTO public.media_source_uploads(id,content_id,creator_id,mime,bytes,digest,object_key) VALUES(v_id,_content,_creator,_mime,_bytes,_digest,'private/media/'||_creator::text||'/'||_content::text||'/'||v_id::text||CASE _mime WHEN 'video/mp4' THEN '.mp4' ELSE '.webm' END) RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('id',r.id,'state',r.state,'objectKey',r.object_key);
END $$;
CREATE FUNCTION public.get_live_media_source(_creator uuid,_content uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',s.id,'state',s.state,'videoState',u.state) FROM public.media_source_uploads s LEFT JOIN public.mux_video_uploads u ON u.id=s.mux_reservation WHERE s.creator_id=_creator AND s.content_id=_content AND public.affiliation_eligible(_creator)
$$;
CREATE FUNCTION public.queue_live_media_source(_creator uuid,_content uuid,_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.affiliation_eligible(_creator) THEN RETURN false; END IF;
 UPDATE public.media_source_uploads SET state='queued',updated_at=now() WHERE id=_id AND creator_id=_creator AND content_id=_content AND state='reserved';
 RETURN FOUND OR EXISTS(SELECT 1 FROM public.media_source_uploads WHERE id=_id AND creator_id=_creator AND content_id=_content AND state IN ('queued','leased','dispatching','dispatched'));
END $$;
CREATE FUNCTION public.claim_live_media_source() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.media_source_uploads%ROWTYPE;
BEGIN
 UPDATE public.media_source_uploads SET state='review',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE state IN ('leased','dispatching') AND lease_until<=now() AND (attempts>=5 OR state='dispatching');
 SELECT * INTO r FROM public.media_source_uploads WHERE (state='queued' OR (state='leased' AND lease_until<=now())) AND attempts<5 ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.media_source_uploads SET state='leased',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('id',r.id,'creatorId',r.creator_id,'contentId',r.content_id,'mime',r.mime,'bytes',r.bytes,'digest',r.digest,'objectKey',r.object_key,'leaseId',r.lease_id);
END $$;
CREATE FUNCTION public.fail_live_media_source(_id uuid,_lease uuid,_verdict text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _verdict IS NULL OR _verdict NOT IN ('malicious','inconclusive','review') THEN RETURN false; END IF;
 UPDATE public.media_source_uploads SET state=CASE WHEN _verdict='malicious' THEN 'rejected' WHEN _verdict='review' OR attempts>=5 OR state='dispatching' THEN 'review' ELSE 'queued' END,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=_id AND lease_id=_lease AND lease_until>now() AND state IN ('leased','dispatching');
 RETURN FOUND;
END $$;
CREATE FUNCTION public.begin_live_media_dispatch(_id uuid,_lease uuid,_digest text,_scanner text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.media_source_uploads%ROWTYPE; reservation jsonb;
BEGIN
 IF _scanner IS NULL OR _scanner !~ '^ClamAV [[:print:]]{1,112}$' THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public.media_source_uploads WHERE id=_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM 1 FROM public.student_profiles WHERE user_id=r.creator_id FOR UPDATE;
 PERFORM 1 FROM public.content_items WHERE id=r.content_id AND creator_id=r.creator_id AND status IN ('draft','rejected') FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public.media_source_uploads WHERE id=_id FOR UPDATE;
 IF r.state<>'leased' OR r.lease_id IS DISTINCT FROM _lease OR r.lease_until<=now() OR r.digest IS DISTINCT FROM _digest OR EXISTS(SELECT 1 FROM public.mux_video_uploads WHERE content_id=r.content_id) THEN RETURN NULL; END IF;
 reservation:=public.reserve_mux_live_upload(r.creator_id,r.content_id);
 IF reservation->>'create' IS DISTINCT FROM 'true' THEN RETURN NULL; END IF;
 UPDATE public.media_source_uploads SET state='dispatching',scanner_version=_scanner,scanned_at=now(),mux_reservation=(reservation->>'id')::uuid,lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=r.id;
 RETURN jsonb_build_object('reservationId',reservation->>'id');
END $$;
CREATE FUNCTION student_catalog_private.record_scanned_mux_asset(_reservation uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.content_assets(content_id,private_object_key,mime_type,bytes,processing_status,scan_verdict)
 SELECT s.content_id,'private/mux/'||u.asset_id,s.mime,s.bytes,'ready','clean'
 FROM public.media_source_uploads s JOIN public.mux_video_uploads u ON u.id=s.mux_reservation AND u.content_id=s.content_id AND u.creator_id=s.creator_id
 WHERE u.id=_reservation AND u.state='ready' AND s.state='dispatched' AND s.provider_upload_id=u.upload_id AND s.scanned_at IS NOT NULL
 ON CONFLICT(private_object_key) DO NOTHING
$$;
REVOKE ALL ON FUNCTION student_catalog_private.record_scanned_mux_asset(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION student_catalog_private.on_scanned_mux_ready() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN IF NEW.state='ready' THEN PERFORM student_catalog_private.record_scanned_mux_asset(NEW.id); END IF; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION student_catalog_private.on_scanned_mux_ready() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER scanned_mux_ready AFTER UPDATE OF state,asset_id ON public.mux_video_uploads FOR EACH ROW EXECUTE FUNCTION student_catalog_private.on_scanned_mux_ready();
CREATE FUNCTION public.finish_live_media_dispatch(_id uuid,_lease uuid,_upload text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.media_source_uploads%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.media_source_uploads WHERE id=_id AND state='dispatching' AND lease_id=_lease AND lease_until>now() FOR UPDATE;
 IF NOT FOUND OR _upload IS NULL THEN RETURN false; END IF;
 PERFORM 1 FROM public.mux_video_uploads WHERE id=r.mux_reservation AND upload_id=_upload AND content_id=r.content_id AND creator_id=r.creator_id AND state IN ('waiting','processing','ready') FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.media_source_uploads SET state='dispatched',provider_upload_id=_upload,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=_id;
 PERFORM student_catalog_private.record_scanned_mux_asset(r.mux_reservation);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.reserve_live_media_source(uuid,uuid,text,bigint,text),public.get_live_media_source(uuid,uuid),public.queue_live_media_source(uuid,uuid,uuid),public.claim_live_media_source(),public.fail_live_media_source(uuid,uuid,text),public.begin_live_media_dispatch(uuid,uuid,text,text),public.finish_live_media_dispatch(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_live_media_source(uuid,uuid,text,bigint,text),public.get_live_media_source(uuid,uuid),public.queue_live_media_source(uuid,uuid,uuid),public.claim_live_media_source(),public.fail_live_media_source(uuid,uuid,text),public.begin_live_media_dispatch(uuid,uuid,text,text),public.finish_live_media_dispatch(uuid,uuid,text) TO service_role;
