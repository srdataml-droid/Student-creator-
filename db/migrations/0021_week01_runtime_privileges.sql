-- Dedicated staging only, independent review required.
-- Supabase does not necessarily grant SQL-created tables to service_role.
-- BYPASSRLS is not a substitute for ordinary SQL privileges.
-- Grant only the existing content REST adapters' required operations.
GRANT SELECT ON public.institutions,public.departments,public.courses,public.course_topics,
 public.student_profiles,public.platform_staff,public.content_items,public.content_assets TO service_role;
GRANT INSERT(creator_id,institution_id,course_id,topic_id,title,description,preview_text,rights_attested_at,
 status,creation_key,creation_hash) ON public.content_items TO service_role;
GRANT UPDATE(status,reviewer_id,review_reason,reviewed_at,published_at) ON public.content_items TO service_role;
-- Invoker-rights submit/review transitions append audit rows transactionally.
GRANT INSERT(actor_id,action,target_kind,target_id,reason) ON public.audit_events TO service_role;
GRANT SELECT(id,action,target_kind,target_id,created_at) ON public.audit_events TO service_role;
-- No direct profile verification, entitlement, payment, ledger, deletion,
-- or unrestricted moderation/audit mutation grants are introduced.
-- Financial and identity state transitions remain reviewed service-only RPCs.

-- Client row-level restrictions do not hide internal columns.
REVOKE SELECT ON public.content_comments FROM PUBLIC,anon,authenticated;
REVOKE SELECT(creation_key,creation_hash,hidden_at) ON public.content_comments FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,content_id,author_id,body,created_at) ON public.content_comments TO authenticated;
REVOKE SELECT ON public.verification_requests FROM PUBLIC,anon,authenticated;
REVOKE SELECT(private_evidence_path,reviewer_id) ON public.verification_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,user_id,institution_id,method,status,reviewed_at,expires_at,created_at)
 ON public.verification_requests TO authenticated;
