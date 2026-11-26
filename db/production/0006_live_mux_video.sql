-- Existing production project: real Mux signed video, live paid entitlements.
CREATE TABLE public.mux_video_uploads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 content_id uuid NOT NULL UNIQUE,
 creator_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'initializing' CHECK(state IN ('initializing','waiting','processing','ready','errored','cancelled','timed_out','deleted','unsafe')),
 upload_id text UNIQUE CHECK(upload_id ~ '^[A-Za-z0-9_-]{6,128}$'),
 asset_id text UNIQUE CHECK(asset_id ~ '^[A-Za-z0-9_-]{6,128}$'),
 playback_id text UNIQUE CHECK(playback_id ~ '^[A-Za-z0-9_-]{6,128}$'),
 test_asset boolean NOT NULL DEFAULT false CHECK(NOT test_asset),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(content_id,creator_id) REFERENCES public.content_items(id,creator_id),
 CHECK(state<>'ready' OR (upload_id IS NOT NULL AND asset_id IS NOT NULL AND playback_id IS NOT NULL)),
 CHECK(state='ready' OR playback_id IS NULL)
);
ALTER TABLE public.mux_video_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mux_video_uploads FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.reserve_mux_live_upload(_creator uuid,_content uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r public.mux_video_uploads; create_it boolean:=false;
BEGIN
 IF NOT public.affiliation_eligible(_creator) THEN RETURN NULL; END IF;
 -- Serialize per creator so the daily cap also applies to different drafts.
 PERFORM 1 FROM public.student_profiles WHERE user_id=_creator FOR UPDATE;
 PERFORM 1 FROM public.content_items WHERE id=_content AND creator_id=_creator AND status IN ('draft','rejected') FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public.mux_video_uploads WHERE content_id=_content;
 IF NOT FOUND THEN
  IF (SELECT count(*) FROM public.mux_video_uploads WHERE creator_id=_creator AND created_at>now()-interval '24 hours')>=5
  THEN RETURN jsonb_build_object('limited',true); END IF;
  INSERT INTO public.mux_video_uploads(content_id,creator_id) VALUES(_content,_creator) RETURNING * INTO r;
  create_it:=true;
 END IF;
 RETURN jsonb_build_object('id',r.id,'state',r.state,'uploadId',r.upload_id,'create',create_it);
END $$;

CREATE FUNCTION public.get_mux_live_upload(_creator uuid,_content uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_build_object('id',u.id,'state',u.state,'uploadId',u.upload_id)
 FROM public.mux_video_uploads u WHERE u.content_id=_content AND u.creator_id=_creator
 AND public.affiliation_eligible(_creator)
$$;

-- Trusted Mux API snapshots only. Identity/asset binding is immutable;
-- stale states cannot re-open a terminal upload or downgrade ready media.
CREATE FUNCTION public.apply_mux_live_snapshot(_reservation uuid,_upload text,_asset text,_playback text,_state text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r public.mux_video_uploads; next_state text;
BEGIN
 IF _upload IS NULL OR _upload !~ '^[A-Za-z0-9_-]{6,128}$'
 OR (_asset IS NOT NULL AND _asset !~ '^[A-Za-z0-9_-]{6,128}$')
 OR (_playback IS NOT NULL AND _playback !~ '^[A-Za-z0-9_-]{6,128}$')
 OR _state IS NULL OR _state NOT IN ('waiting','processing','ready','errored','cancelled','timed_out','deleted','unsafe')
 OR (_state='ready' AND (_asset IS NULL OR _playback IS NULL))
 OR (_state<>'ready' AND _playback IS NOT NULL) THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public.mux_video_uploads WHERE id=_reservation FOR UPDATE;
 IF NOT FOUND OR (r.upload_id IS NOT NULL AND r.upload_id<>_upload)
 OR (r.asset_id IS NOT NULL AND _asset IS NOT NULL AND r.asset_id<>_asset)
 OR (r.playback_id IS NOT NULL AND _playback IS NOT NULL AND r.playback_id<>_playback)
 THEN RETURN NULL; END IF;
 next_state:=_state;
 IF r.state IN ('errored','cancelled','timed_out','deleted','unsafe') THEN next_state:=r.state;
 ELSIF r.state='ready' AND _state IN ('waiting','processing','errored','cancelled','timed_out') THEN next_state:='ready';
 ELSIF r.state='processing' AND _state='waiting' THEN next_state:='processing'; END IF;
 UPDATE public.mux_video_uploads SET upload_id=coalesce(upload_id,_upload),asset_id=coalesce(asset_id,_asset),
 state=next_state,playback_id=CASE WHEN next_state='ready' THEN coalesce(playback_id,_playback) ELSE NULL END,updated_at=now()
 WHERE id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('id',r.id,'state',r.state,'uploadId',r.upload_id);
END $$;

-- Published signed playback only: a Mux-ready asset is NOT a clean scan.
-- A separate trusted scan must create a matching ready/clean content_assets row.
-- Live-only entitlements, including license expiry.
CREATE FUNCTION public.authorized_mux_live_playback(_viewer uuid,_content uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_build_object('id',c.id,'status',c.status,'videoStatus','ready','playbackPolicy','signed',
 'playbackId',u.playback_id,'assetId',u.asset_id,'reservationId',u.id,'uploadId',u.upload_id,'viewerId',_viewer)
 FROM public.mux_video_uploads u JOIN public.content_items c ON c.id=u.content_id
 JOIN public.courses course ON course.id=c.course_id JOIN public.institutions i ON i.id=c.institution_id
 WHERE c.id=_content AND c.status='published' AND course.active=true AND i.active AND u.state='ready'
 AND public.affiliation_eligible(_viewer) AND public.affiliation_eligible(c.creator_id)
 AND NOT EXISTS(SELECT 1 FROM public.creator_restrictions r WHERE r.creator_id=c.creator_id AND r.viewer_id=_viewer AND r.deny_view)
 AND EXISTS(SELECT 1 FROM public.content_assets a WHERE a.content_id=c.id
 AND a.private_object_key='private/mux/'||u.asset_id AND a.processing_status='ready' AND a.scan_verdict='clean')
 AND (c.creator_id=_viewer OR NOT EXISTS(SELECT 1 FROM public.listings l WHERE l.content_id=c.id)
 OR EXISTS(SELECT 1 FROM public.entitlements e JOIN public.orders o ON o.id=e.order_id
 WHERE e.content_id=c.id AND e.buyer_id=_viewer AND e.state='active' AND o.status='paid'
 AND o.content_id=c.id AND o.buyer_id=_viewer AND o.currency='NGN' AND o.environment='live' AND e.expires_at>now()))
$$;
REVOKE ALL ON FUNCTION public.reserve_mux_live_upload(uuid,uuid), public.get_mux_live_upload(uuid,uuid),
 public.apply_mux_live_snapshot(uuid,text,text,text,text), public.authorized_mux_live_playback(uuid,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_mux_live_upload(uuid,uuid), public.get_mux_live_upload(uuid,uuid),
 public.apply_mux_live_snapshot(uuid,text,text,text,text), public.authorized_mux_live_playback(uuid,uuid)
 TO service_role;
