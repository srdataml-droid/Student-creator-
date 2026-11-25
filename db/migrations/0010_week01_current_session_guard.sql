-- Week 1 proposed session guard; staging only after independent review.
-- RPC is service-role only: no Auth schema records or arbitrary-user lookup
-- is exposed to browser roles. Apply to the dedicated project only.
CREATE FUNCTION public.student_creators_session_active(_user_id uuid,_session_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
 SELECT EXISTS (
   SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id
   WHERE s.id=_session_id AND s.user_id=_user_id
   AND (s.not_after IS NULL OR s.not_after>now())
   AND u.deleted_at IS NULL
   AND u.email_confirmed_at IS NOT NULL
   AND u.is_anonymous IS NOT TRUE
   AND (u.banned_until IS NULL OR u.banned_until<=now())
 );
$$;
REVOKE ALL ON FUNCTION public.student_creators_session_active(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.student_creators_session_active(uuid,uuid) TO service_role;
