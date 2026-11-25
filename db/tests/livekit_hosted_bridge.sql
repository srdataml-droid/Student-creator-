BEGIN;
INSERT INTO auth.users(id) VALUES('f1810000-0000-4000-8000-000000000001'),('f1810000-0000-4000-8000-000000000002'),('f1810000-0000-4000-8000-000000000003');
INSERT INTO public.institutions(id,slug,name) VALUES('f1820000-0000-4000-8000-000000000001','fixture-livekit-18','Synthetic');
INSERT INTO public.departments(id,institution_id,slug,name) VALUES('f1830000-0000-4000-8000-000000000001','f1820000-0000-4000-8000-000000000001','fixture','Synthetic');
INSERT INTO public.courses(id,institution_id,department_id,code,title) VALUES('f1840000-0000-4000-8000-000000000001','f1820000-0000-4000-8000-000000000001','f1830000-0000-4000-8000-000000000001','LIVE18','Synthetic');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at) SELECT id,'f1820000-0000-4000-8000-000000000001','Synthetic',now() FROM auth.users WHERE id IN ('f1810000-0000-4000-8000-000000000001','f1810000-0000-4000-8000-000000000002','f1810000-0000-4000-8000-000000000003');
INSERT INTO public.interactive_classes(id,institution_id,course_id,host_id,title,starts_at,ends_at,capacity,price_kobo,status,room_name,creation_key)
 VALUES('f1850000-0000-4000-8000-000000000001','f1820000-0000-4000-8000-000000000001','f1840000-0000-4000-8000-000000000001','f1810000-0000-4000-8000-000000000001','Synthetic class',now()-interval '1 minute',now()+interval '1 hour',12,0,'room_open','wk-class-f1850000-0000-4000-8000-000000000001','fixture-livekit-18');
INSERT INTO public.interactive_class_enrollments(class_id,student_id,state) VALUES('f1850000-0000-4000-8000-000000000001','f1810000-0000-4000-8000-000000000002','enrolled');
DO $$ DECLARE c uuid:='f1850000-0000-4000-8000-000000000001'; h uuid:='f1810000-0000-4000-8000-000000000001'; p uuid:='f1810000-0000-4000-8000-000000000002'; x uuid:='f1810000-0000-4000-8000-000000000003'; BEGIN
 IF has_function_privilege('authenticated','public.authorized_hosted_class_room(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Browser can spoof actor'; END IF;
 IF public.authorized_hosted_class_room(h,c)->>'role' IS DISTINCT FROM 'host' OR public.authorized_hosted_class_room(p,c)->>'role' IS DISTINCT FROM 'participant' OR public.authorized_hosted_class_room(x,c) IS NOT NULL THEN RAISE EXCEPTION 'Room role violation'; END IF;
 UPDATE public.interactive_classes SET price_kobo=30000 WHERE id=c;
 IF public.authorized_hosted_class_room(p,c) IS NOT NULL THEN RAISE EXCEPTION 'Unpaid access'; END IF;
 INSERT INTO public.learning_purchase_orders(reference,buyer_id,creator_id,resource_kind,resource_id,buyer_email,amount_kobo,request_key,state,provider_transaction_id,paid_at) VALUES('lsc_181818181818181818181818181818181818',p,h,'class',c,'fixture@example.invalid',30000,'fixture-livekit-order-18','paid','fixture-livekit-charge-18',now());
 INSERT INTO public.learning_payment_entitlements(buyer_id,resource_kind,resource_id,order_reference,state) VALUES(p,'class',c,'lsc_181818181818181818181818181818181818','active');
 IF public.authorized_hosted_class_room(p,c)->>'role' IS DISTINCT FROM 'participant' THEN RAISE EXCEPTION 'Paid fixture denied'; END IF;
 UPDATE public.learning_payment_entitlements SET state='revoked',revoked_at=now() WHERE buyer_id=p;
 IF public.authorized_hosted_class_room(p,c) IS NOT NULL THEN RAISE EXCEPTION 'Revoked entitlement accepted'; END IF;
 UPDATE public.interactive_classes SET status='completed' WHERE id=c;
 IF public.authorized_hosted_class_room(h,c) IS NOT NULL THEN RAISE EXCEPTION 'Closed room granted'; END IF;
END $$;
ROLLBACK;
