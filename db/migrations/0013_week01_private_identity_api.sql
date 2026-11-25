-- Private identity evidence, one immutable object per pending manual request.
-- Dedicated staging only. Requires independent privacy/security review.
CREATE TABLE public.private_identity_uploads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE REFERENCES public.verification_requests(id),
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 object_key text NOT NULL UNIQUE,
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','application/pdf')),
 bytes integer NOT NULL CHECK(bytes BETWEEN 8 AND 4194304),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','quarantined','clean','malicious','inconclusive')),
 scanner_version text CHECK(length(scanner_version) BETWEEN 1 AND 120),
 created_at timestamptz NOT NULL DEFAULT now(),
 uploaded_at timestamptz,
 scanned_at timestamptz,
 scan_attempts integer NOT NULL DEFAULT 0 CHECK(scan_attempts BETWEEN 0 AND 5),
 next_scan_at timestamptz NOT NULL DEFAULT now(),
 scan_lease_id uuid,
 scan_lease_until timestamptz,
 CHECK((scan_lease_id IS NULL)=(scan_lease_until IS NULL)),
 CHECK(object_key='private/'||owner_id::text||'/'||request_id::text||'/'||id::text||
 CASE mime_type WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' ELSE '.pdf' END)
);
ALTER TABLE public.private_identity_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_identity_uploads FROM PUBLIC,anon,authenticated,service_role;
-- Queue access uses service-only bounded lease RPCs below; no browser or direct service table access.

CREATE FUNCTION public.reserve_private_identity_upload(_owner uuid,_request uuid,_mime text,_bytes integer,_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r public.private_identity_uploads; new_id uuid;
BEGIN
 IF _mime IS NULL OR _mime NOT IN ('image/jpeg','image/png','application/pdf')
 OR _bytes IS NULL OR _bytes NOT BETWEEN 8 AND 4194304
 OR _digest IS NULL OR _digest !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
 -- Lock the verification request; concurrent attempts cannot choose different objects.
 PERFORM 1 FROM public.verification_requests v
 JOIN public.student_profiles p ON p.user_id=v.user_id
 WHERE v.id=_request AND v.user_id=_owner AND v.method='manual_id'
 AND v.status='pending' AND v.expires_at>now() AND p.suspended=false
 FOR UPDATE OF v;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public.private_identity_uploads WHERE request_id=_request;
 IF FOUND THEN
  IF r.owner_id<>_owner OR r.mime_type<>_mime OR r.bytes<>_bytes OR r.digest<>_digest THEN
   RETURN jsonb_build_object('conflict',true);
  END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.verification_requests WHERE id=_request AND private_evidence_path IS NOT NULL)
  THEN RETURN jsonb_build_object('conflict',true); END IF;
  new_id:=gen_random_uuid();
  INSERT INTO public.private_identity_uploads(id,request_id,owner_id,object_key,mime_type,bytes,digest)
  VALUES(new_id,_request,_owner,'private/'||_owner::text||'/'||_request::text||'/'||new_id::text||
  CASE _mime WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' ELSE '.pdf' END,_mime,_bytes,_digest)
  RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('id',r.id,'objectKey',r.object_key,'state',r.state);
END $$;

CREATE FUNCTION public.mark_private_identity_uploaded(_owner uuid,_request uuid,_upload uuid,_digest text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 UPDATE public.private_identity_uploads u SET state='quarantined',uploaded_at=coalesce(uploaded_at,now())
 WHERE u.id=_upload AND u.owner_id=_owner AND u.request_id=_request AND u.digest=_digest AND u.state='reserved';
 IF FOUND THEN RETURN true; END IF;
 RETURN EXISTS(SELECT 1 FROM public.private_identity_uploads u WHERE u.id=_upload AND u.owner_id=_owner
 AND u.request_id=_request AND u.digest=_digest AND u.state IN ('quarantined','clean','malicious','inconclusive'));
END $$;

-- One bounded lease per worker. Failed/crashed attempts leave the evidence
-- inaccessible. No claim after five attempts; operator review is required.
CREATE FUNCTION public.claim_private_identity_scan()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r public.private_identity_uploads;
BEGIN
 SELECT u.* INTO r FROM public.private_identity_uploads u
 WHERE u.state IN ('quarantined','inconclusive') AND u.scan_attempts<5
 AND u.next_scan_at<=now() AND (u.scan_lease_until IS NULL OR u.scan_lease_until<=now())
 AND EXISTS(SELECT 1 FROM public.verification_requests v WHERE v.id=u.request_id AND v.status='pending' AND v.expires_at>now())
 ORDER BY u.next_scan_at,u.created_at,u.id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.private_identity_uploads SET scan_attempts=scan_attempts+1,scan_lease_id=gen_random_uuid(),
 scan_lease_until=now()+interval '90 seconds' WHERE id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('id',r.id,'objectKey',r.object_key,'ownerId',r.owner_id,'requestId',r.request_id,
 'mime',r.mime_type,'bytes',r.bytes,'digest',r.digest,'leaseId',r.scan_lease_id);
END $$;

-- Trusted scanner calls only after downloading exact bytes and checking digest.
-- A late or expired worker cannot override a newer lease or a terminal verdict.
CREATE FUNCTION public.record_private_identity_scan(_upload uuid,_lease uuid,_digest text,_verdict text,_scanner text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r public.private_identity_uploads;
BEGIN
 IF _verdict IS NULL OR _verdict NOT IN ('clean','malicious','inconclusive') OR _scanner IS NULL
 OR length(_scanner) NOT BETWEEN 1 AND 120 THEN RETURN false; END IF;
 SELECT * INTO r FROM public.private_identity_uploads WHERE id=_upload AND digest=_digest
 AND scan_lease_id=_lease AND scan_lease_until>now() AND state IN ('quarantined','inconclusive') FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.private_identity_uploads SET state=_verdict,scanner_version=_scanner,scanned_at=now(),
 scan_lease_id=NULL,scan_lease_until=NULL,
 next_scan_at=now()+make_interval(mins=>5*scan_attempts)
 WHERE id=r.id;
 IF _verdict='clean' THEN
  UPDATE public.verification_requests SET private_evidence_path=r.object_key
  WHERE id=r.request_id AND user_id=r.owner_id AND status='pending' AND expires_at>now()
  AND (private_evidence_path IS NULL OR private_evidence_path=r.object_key);
 ELSIF _verdict='malicious' THEN
  INSERT INTO public.audit_events(action,target_kind,target_id)
  VALUES('identity.evidence.scan_malicious','verification_request',r.request_id);
 END IF;
 RETURN true;
END $$;

-- Conservative initial access: active platform admins only. Identity-specific
-- reviewer roles must be approved and supplied by the governance workstream.
CREATE FUNCTION public.get_private_identity_review_object(_actor uuid,_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r public.private_identity_uploads;
BEGIN
 SELECT u.* INTO r FROM public.private_identity_uploads u
 JOIN public.verification_requests v ON v.id=u.request_id AND v.user_id=u.owner_id
 JOIN public.platform_staff s ON s.user_id=_actor AND s.active=true AND s.role='admin'
 WHERE u.request_id=_request AND u.owner_id<>_actor AND u.state='clean'
 AND v.status='pending' AND v.expires_at>now() AND v.private_evidence_path=u.object_key;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id)
 VALUES(_actor,'identity.evidence.access_requested','verification_request',_request);
 RETURN jsonb_build_object('objectKey',r.object_key,'ownerId',r.owner_id,'id',r.id,
 'mime',r.mime_type,'bytes',r.bytes,'digest',r.digest);
END $$;

REVOKE ALL ON FUNCTION public.reserve_private_identity_upload(uuid,uuid,text,integer,text),
 public.mark_private_identity_uploaded(uuid,uuid,uuid,text),
 public.claim_private_identity_scan(),
 public.record_private_identity_scan(uuid,uuid,text,text,text),
 public.get_private_identity_review_object(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_private_identity_upload(uuid,uuid,text,integer,text),
 public.mark_private_identity_uploaded(uuid,uuid,uuid,text),
 public.claim_private_identity_scan(),
 public.record_private_identity_scan(uuid,uuid,text,text,text),
 public.get_private_identity_review_object(uuid,uuid) TO service_role;
