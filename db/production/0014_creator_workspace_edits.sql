-- Owner-only creator workspace changes. No direct client write grants.
CREATE FUNCTION student_catalog_private.save_creator_profile(_handle text,_name text,_bio text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); previous public.creator_public_profiles%ROWTYPE; r public.creator_public_profiles%ROWTYPE;
BEGIN
 IF actor IS NULL OR NOT public.current_student_eligible() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _handle IS NULL OR _handle !~ '^[a-z][a-z0-9_]{2,23}$' OR _handle ~ '^(admin|administrator|staff|official|verified|support|moderator|system|platform|worthkind|registrar|school_admin)(_|$)' OR _name IS NULL OR length(btrim(_name)) NOT BETWEEN 3 AND 60 OR _bio IS NULL OR length(_bio)>280 OR _name ~ '[[:cntrl:]]' OR _bio ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'INVALID_PROFILE' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.student_profiles WHERE user_id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO previous FROM public.creator_public_profiles WHERE user_id=actor;
 IF FOUND THEN
  IF (previous.handle,previous.display_name,previous.bio)=(_handle,btrim(_name),btrim(_bio)) THEN RETURN jsonb_build_object('handle',previous.handle,'displayName',previous.display_name,'bio',previous.bio); END IF;
  IF previous.updated_at>now()-interval '30 seconds' THEN RAISE EXCEPTION 'PROFILE_RATE_LIMIT' USING ERRCODE='22023'; END IF;
 END IF;
 INSERT INTO public.creator_public_profiles(user_id,handle,display_name,bio,updated_at) VALUES(actor,_handle,btrim(_name),btrim(_bio),now())
 ON CONFLICT(user_id) DO UPDATE SET handle=excluded.handle,display_name=excluded.display_name,bio=excluded.bio,updated_at=excluded.updated_at RETURNING * INTO r;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(actor,'creator.profile.saved','creator_profile',actor);
 RETURN jsonb_build_object('handle',r.handle,'displayName',r.display_name,'bio',r.bio);
END $$;
CREATE FUNCTION student_catalog_private.edit_creator_draft(_content uuid,_title text,_description text,_preview text,_rights boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); r public.content_items%ROWTYPE;
BEGIN
 IF actor IS NULL OR NOT public.current_student_eligible() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _rights IS DISTINCT FROM true OR _title IS NULL OR length(btrim(_title)) NOT BETWEEN 3 AND 160 OR _description IS NULL OR length(_description)>2500 OR _preview IS NULL OR length(_preview)>800 THEN RAISE EXCEPTION 'INVALID_DRAFT' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.content_items WHERE id=_content AND creator_id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF r.status NOT IN ('draft','rejected') OR r.published_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.orders WHERE content_id=r.id) THEN RAISE EXCEPTION 'DRAFT_LOCKED' USING ERRCODE='23505'; END IF;
 UPDATE public.content_items SET title=btrim(_title),description=btrim(_description),preview_text=btrim(_preview),rights_attested_at=now() WHERE id=r.id RETURNING * INTO r;
 INSERT INTO public.audit_events(actor_id,action,target_kind,target_id) VALUES(actor,'creator.draft.edited','content',r.id);
 RETURN jsonb_build_object('id',r.id,'title',r.title,'description',r.description,'previewText',r.preview_text,'status',r.status);
END $$;
REVOKE ALL ON FUNCTION student_catalog_private.save_creator_profile(text,text,text),student_catalog_private.edit_creator_draft(uuid,text,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_catalog_private.save_creator_profile(text,text,text),student_catalog_private.edit_creator_draft(uuid,text,text,text,boolean) TO authenticated;
CREATE FUNCTION public.save_creator_profile(_handle text,_name text,_bio text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT student_catalog_private.save_creator_profile(_handle,_name,_bio) $$;
CREATE FUNCTION public.edit_creator_draft(_content uuid,_title text,_description text,_preview text,_rights boolean) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT student_catalog_private.edit_creator_draft(_content,_title,_description,_preview,_rights) $$;
REVOKE ALL ON FUNCTION public.save_creator_profile(text,text,text),public.edit_creator_draft(uuid,text,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_creator_profile(text,text,text),public.edit_creator_draft(uuid,text,text,text,boolean) TO authenticated;
