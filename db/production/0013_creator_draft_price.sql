-- Only the verified owner may explicitly set or clear a price before review.
-- No automatic listing, no payment, no mutation of an already sold listing.
CREATE FUNCTION student_catalog_private.set_draft_price(_content uuid,_amount bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); c public.content_items%ROWTYPE;
BEGIN
 IF actor IS NULL OR NOT public.current_student_eligible() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 IF _amount IS NULL OR _amount<0 OR _amount>1000000000 OR (_amount>0 AND _amount<20000) THEN RAISE EXCEPTION 'INVALID_PRICE' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM public.content_items WHERE id=_content AND creator_id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF c.status NOT IN ('draft','rejected') OR c.published_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.orders WHERE content_id=c.id) THEN RAISE EXCEPTION 'PRICE_LOCKED' USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM public.listings WHERE content_id=c.id AND state<>'active') THEN RAISE EXCEPTION 'PRICE_LOCKED' USING ERRCODE='23505'; END IF;
 IF _amount=0 THEN
  DELETE FROM public.listings WHERE content_id=c.id AND creator_id=actor;
 ELSE
  UPDATE public.listings SET price_kobo=_amount WHERE content_id=c.id AND creator_id=actor AND state='active';
  IF NOT FOUND THEN INSERT INTO public.listings(content_id,creator_id,price_kobo,currency,state) VALUES(c.id,actor,_amount,'NGN','active'); END IF;
 END IF;
 RETURN jsonb_build_object('contentId',c.id,'priceKobo',_amount,'currency','NGN');
END $$;
REVOKE ALL ON FUNCTION student_catalog_private.set_draft_price(uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_catalog_private.set_draft_price(uuid,bigint) TO authenticated;
CREATE FUNCTION public.set_draft_price(_content uuid,_amount bigint) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT student_catalog_private.set_draft_price(_content,_amount)
$$;
REVOKE ALL ON FUNCTION public.set_draft_price(uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_draft_price(uuid,bigint) TO authenticated;

CREATE FUNCTION student_catalog_private.get_draft_price(_content uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); c public.content_items%ROWTYPE; p bigint;
BEGIN
 IF actor IS NULL OR NOT public.current_student_eligible() THEN RAISE EXCEPTION 'STUDENT_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.content_items WHERE id=_content AND creator_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND' USING ERRCODE='42501'; END IF;
 SELECT price_kobo INTO p FROM public.listings WHERE content_id=c.id AND state='active';
 RETURN jsonb_build_object('contentId',c.id,'priceKobo',COALESCE(p,0),'currency','NGN','editable',c.status IN ('draft','rejected') AND c.published_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.orders WHERE content_id=c.id) AND NOT EXISTS(SELECT 1 FROM public.listings WHERE content_id=c.id AND state<>'active'));
END $$;
REVOKE ALL ON FUNCTION student_catalog_private.get_draft_price(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION student_catalog_private.get_draft_price(uuid) TO authenticated;
CREATE FUNCTION public.get_draft_price(_content uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT student_catalog_private.get_draft_price(_content) $$;
REVOKE ALL ON FUNCTION public.get_draft_price(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_draft_price(uuid) TO authenticated;
