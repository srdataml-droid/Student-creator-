-- Week 1 provider bridge; depends on reviewed Week 6 class/enrollment/payment contracts.
-- No new class engine, no payment mutation, no live room created by SQL.
CREATE FUNCTION public.authorized_hosted_class_room(_actor uuid,_class uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('room',c.room_name,'identity','student-'||_actor::text,'role',CASE WHEN c.host_id=_actor THEN 'host' ELSE 'participant' END,'capacity',c.capacity)
 FROM public.interactive_classes c JOIN public.student_profiles p ON p.user_id=_actor
 JOIN public.courses co ON co.id=c.course_id
 WHERE c.id=_class AND p.institution_id=c.institution_id AND co.active
 AND c.room_name='wk-class-'||c.id::text AND c.status='room_open'
 AND now()>=c.starts_at-interval '15 minutes' AND now()<c.ends_at
 AND public.affiliation_eligible(_actor) AND public.affiliation_eligible(c.host_id)
 AND NOT EXISTS(SELECT 1 FROM public.creator_restrictions r WHERE r.creator_id=c.host_id AND r.viewer_id=_actor AND r.deny_view)
 AND (c.host_id=_actor OR (EXISTS(SELECT 1 FROM public.interactive_class_enrollments e WHERE e.class_id=c.id AND e.student_id=_actor AND e.state='enrolled')
 AND (c.price_kobo=0 OR EXISTS(SELECT 1 FROM public.learning_payment_entitlements ent JOIN public.learning_purchase_orders o ON o.reference=ent.order_reference
 WHERE ent.buyer_id=_actor AND ent.resource_kind='class' AND ent.resource_id=c.id AND ent.state='active' AND o.state='paid'
 AND o.payment_environment='test' AND o.currency='NGN' AND o.amount_kobo=c.price_kobo AND o.buyer_id=_actor AND o.creator_id=c.host_id AND o.resource_kind='class' AND o.resource_id=c.id))))
$$;
REVOKE ALL ON FUNCTION public.authorized_hosted_class_room(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorized_hosted_class_room(uuid,uuid) TO service_role;
