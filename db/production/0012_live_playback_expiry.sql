-- Bound signed live playback to authoritative entitlement expiry in epoch seconds.
CREATE OR REPLACE FUNCTION public.authorized_mux_live_playback(_viewer uuid,_content uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_build_object('id',c.id,'status',c.status,'videoStatus','ready','playbackPolicy','signed',
 'playbackId',u.playback_id,'assetId',u.asset_id,'reservationId',u.id,'uploadId',u.upload_id,'viewerId',_viewer,'entitlementExpiresAt',CASE WHEN c.creator_id=_viewer OR NOT EXISTS(SELECT 1 FROM public.listings l WHERE l.content_id=c.id) THEN NULL ELSE paid.expires_epoch END)
 FROM public.mux_video_uploads u JOIN public.content_items c ON c.id=u.content_id
 JOIN public.courses course ON course.id=c.course_id JOIN public.institutions i ON i.id=c.institution_id
 LEFT JOIN LATERAL (SELECT floor(extract(epoch FROM max(e.expires_at)))::bigint AS expires_epoch
 FROM public.entitlements e JOIN public.orders o ON o.id=e.order_id
 WHERE e.content_id=c.id AND e.buyer_id=_viewer AND e.state='active' AND o.status='paid'
 AND o.content_id=c.id AND o.buyer_id=_viewer AND o.currency='NGN' AND o.environment='live' AND e.expires_at>now()) paid ON true
 WHERE c.id=_content AND c.status='published' AND course.active=true AND i.active AND u.state='ready'
 AND public.affiliation_eligible(_viewer) AND public.affiliation_eligible(c.creator_id)
 AND NOT EXISTS(SELECT 1 FROM public.creator_restrictions r WHERE r.creator_id=c.creator_id AND r.viewer_id=_viewer AND r.deny_view)
 AND EXISTS(SELECT 1 FROM public.content_assets a WHERE a.content_id=c.id
 AND a.private_object_key='private/mux/'||u.asset_id AND a.processing_status='ready' AND a.scan_verdict='clean')
 AND (c.creator_id=_viewer OR NOT EXISTS(SELECT 1 FROM public.listings l WHERE l.content_id=c.id)
 OR paid.expires_epoch IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION public.authorized_mux_live_playback(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorized_mux_live_playback(uuid,uuid) TO service_role;
