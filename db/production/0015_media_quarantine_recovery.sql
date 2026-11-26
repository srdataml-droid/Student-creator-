-- Preserve prior quarantined bytes and metadata; replace only pre-dispatch jobs.
ALTER TABLE public.media_source_uploads ADD COLUMN superseded_at timestamptz;
ALTER TABLE public.media_source_uploads ADD CONSTRAINT media_source_superseded_safe CHECK(superseded_at IS NULL OR (state IN ('reserved','rejected','review') AND mux_reservation IS NULL AND lease_id IS NULL AND provider_upload_id IS NULL));
ALTER TABLE public.media_source_uploads DROP CONSTRAINT media_source_uploads_content_id_key;
CREATE UNIQUE INDEX media_source_active_content ON public.media_source_uploads(content_id) WHERE superseded_at IS NULL;
CREATE OR REPLACE FUNCTION public.reserve_live_media_source(_creator uuid,_content uuid,_mime text,_bytes bigint,_digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.media_source_uploads%ROWTYPE; v_id uuid:=gen_random_uuid();
BEGIN
 IF NOT public.affiliation_eligible(_creator) OR _mime IS NULL OR _mime NOT IN ('video/mp4','video/webm') OR _bytes IS NULL OR _bytes NOT BETWEEN 12 AND 104857600 OR _digest IS NULL OR _digest !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 PERFORM 1 FROM public.student_profiles WHERE user_id=_creator FOR UPDATE;
 PERFORM 1 FROM public.content_items WHERE id=_content AND creator_id=_creator AND status IN ('draft','rejected') FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public.media_source_uploads WHERE content_id=_content AND superseded_at IS NULL;
 IF FOUND THEN
  IF r.digest<>_digest OR r.bytes<>_bytes OR r.mime<>_mime THEN RETURN jsonb_build_object('conflict',true); END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.mux_video_uploads WHERE content_id=_content) THEN RETURN jsonb_build_object('conflict',true); END IF;
  IF (SELECT count(*) FROM public.media_source_uploads WHERE creator_id=_creator AND created_at>now()-interval '1 day')>=5 THEN RETURN jsonb_build_object('limited',true); END IF;
  INSERT INTO public.media_source_uploads(id,content_id,creator_id,mime,bytes,digest,object_key) VALUES(v_id,_content,_creator,_mime,_bytes,_digest,'private/media/'||_creator::text||'/'||_content::text||'/'||v_id::text||CASE _mime WHEN 'video/mp4' THEN '.mp4' ELSE '.webm' END) RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('id',r.id,'state',r.state,'objectKey',r.object_key);
END $$;
CREATE OR REPLACE FUNCTION public.get_live_media_source(_creator uuid,_content uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',s.id,'state',s.state,'videoState',u.state) FROM public.media_source_uploads s LEFT JOIN public.mux_video_uploads u ON u.id=s.mux_reservation WHERE s.creator_id=_creator AND s.content_id=_content AND s.superseded_at IS NULL AND public.affiliation_eligible(_creator)
$$;
CREATE OR REPLACE FUNCTION public.queue_live_media_source(_creator uuid,_content uuid,_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.affiliation_eligible(_creator) THEN RETURN false; END IF;
 UPDATE public.media_source_uploads SET state='queued',updated_at=now() WHERE id=_id AND creator_id=_creator AND content_id=_content AND superseded_at IS NULL AND state='reserved';
 RETURN FOUND OR EXISTS(SELECT 1 FROM public.media_source_uploads WHERE id=_id AND creator_id=_creator AND content_id=_content AND superseded_at IS NULL AND state IN ('queued','leased','dispatching','dispatched'));
END $$;
CREATE FUNCTION public.restart_live_media_source(_creator uuid,_content uuid,_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.affiliation_eligible(_creator) THEN RETURN false;END IF;
 PERFORM 1 FROM public.student_profiles WHERE user_id=_creator FOR UPDATE;
 PERFORM 1 FROM public.content_items WHERE id=_content AND creator_id=_creator AND status IN ('draft','rejected') FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.mux_video_uploads WHERE content_id=_content) THEN RETURN false;END IF;
 UPDATE public.media_source_uploads SET superseded_at=now(),updated_at=now() WHERE id=_id AND content_id=_content AND creator_id=_creator AND superseded_at IS NULL AND state IN ('reserved','rejected','review') AND mux_reservation IS NULL AND lease_id IS NULL AND provider_upload_id IS NULL;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.restart_live_media_source(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.restart_live_media_source(uuid,uuid,uuid) TO service_role;
