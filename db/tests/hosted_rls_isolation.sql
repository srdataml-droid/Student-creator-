-- Rollback-only two-user security regression for disposable PostgreSQL and
-- the explicitly approved isolated Student Creators Supabase staging project.
-- NEVER run this script against a production database.
-- No students or real identities are created; synthetic auth rows are rolled back.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id) VALUES
 ('7e2b60c6-ec7f-4872-9d84-abb5e14f233a'),
 ('8a5a7193-ea31-49f0-8ac7-f7f06624a4d1');
INSERT INTO public.institutions(id,slug,name) VALUES
 ('1048f1cb-abcd-47b7-a1da-8a12e3e29e56',
  'isolated-rls-test','Rollback-only institution');
INSERT INTO public.student_profiles(user_id,institution_id,display_name,verified_at)
VALUES
 ('7e2b60c6-ec7f-4872-9d84-abb5e14f233a',
  '1048f1cb-abcd-47b7-a1da-8a12e3e29e56','Synthetic A',now()),
 ('8a5a7193-ea31-49f0-8ac7-f7f06624a4d1',
  '1048f1cb-abcd-47b7-a1da-8a12e3e29e56','Synthetic B',now());
INSERT INTO public.verification_requests(user_id,institution_id,method,status,expires_at)
VALUES
 ('7e2b60c6-ec7f-4872-9d84-abb5e14f233a',
  '1048f1cb-abcd-47b7-a1da-8a12e3e29e56','manual_id','pending',now()+interval '1 day'),
 ('8a5a7193-ea31-49f0-8ac7-f7f06624a4d1',
  '1048f1cb-abcd-47b7-a1da-8a12e3e29e56','manual_id','pending',now()+interval '1 day');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7e2b60c6-ec7f-4872-9d84-abb5e14f233a',true);
DO $rls$
BEGIN
 IF auth.uid() IS DISTINCT FROM '7e2b60c6-ec7f-4872-9d84-abb5e14f233a'::uuid
 OR (SELECT count(*) FROM public.student_profiles) <> 1
 OR (SELECT count(*) FROM public.student_profiles
     WHERE user_id='8a5a7193-ea31-49f0-8ac7-f7f06624a4d1') <> 0
 OR (SELECT count(*) FROM public.verification_requests) <> 1
 OR (SELECT count(*) FROM public.verification_requests
     WHERE user_id='8a5a7193-ea31-49f0-8ac7-f7f06624a4d1') <> 0
 THEN RAISE EXCEPTION 'Authenticated student A can view another student or lost own rows'; END IF;
 IF NOT has_column_privilege(current_user,'public.content_items','title','SELECT')
 OR has_column_privilege(current_user,'public.content_items','creation_key','SELECT')
 OR has_column_privilege(current_user,'public.content_items','creation_hash','SELECT')
 OR has_column_privilege(current_user,'public.content_items','reviewer_id','SELECT')
 OR has_column_privilege(current_user,'public.content_items','review_reason','SELECT')
 OR has_column_privilege(current_user,'public.content_items','rights_attested_at','SELECT')
 OR has_table_privilege(current_user,'public.content_assets','SELECT')
 OR has_table_privilege(current_user,'public.ledger_entries','SELECT')
 OR has_table_privilege(current_user,'public.platform_staff','SELECT')
 OR has_table_privilege(current_user,'public.student_profiles','INSERT,UPDATE,DELETE')
 THEN RAISE EXCEPTION 'Unexpected authenticated privilege over a private table'; END IF;
END
$rls$;

SELECT set_config('request.jwt.claim.sub','8a5a7193-ea31-49f0-8ac7-f7f06624a4d1',true);
DO $rls$
BEGIN
 IF auth.uid() IS DISTINCT FROM '8a5a7193-ea31-49f0-8ac7-f7f06624a4d1'::uuid
 OR (SELECT count(*) FROM public.student_profiles) <> 1
 OR (SELECT count(*) FROM public.student_profiles
     WHERE user_id='7e2b60c6-ec7f-4872-9d84-abb5e14f233a') <> 0
 OR (SELECT count(*) FROM public.verification_requests) <> 1
 OR (SELECT count(*) FROM public.verification_requests
     WHERE user_id='7e2b60c6-ec7f-4872-9d84-abb5e14f233a') <> 0
 THEN RAISE EXCEPTION 'Authenticated student B can view another student or lost own rows'; END IF;
END
$rls$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $rls$
BEGIN
 IF has_table_privilege(current_user,'public.student_profiles','SELECT')
 OR has_table_privilege(current_user,'public.verification_requests','SELECT')
 OR has_table_privilege(current_user,'public.orders','SELECT')
 OR NOT has_table_privilege(current_user,'public.institutions','SELECT')
 OR NOT has_column_privilege(current_user,'public.content_items','title','SELECT')
 OR has_column_privilege(current_user,'public.content_items','creation_key','SELECT')
 OR has_column_privilege(current_user,'public.content_items','creation_hash','SELECT')
 OR has_column_privilege(current_user,'public.content_items','review_reason','SELECT')
 THEN RAISE EXCEPTION 'Anonymous privilege boundary incorrect'; END IF;
END
$rls$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: authenticated student A/B isolated, anonymous restricted, synthetic rows rolled back'
