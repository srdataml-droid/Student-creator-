/**
 * Verified hosted Supabase user boundary — server only, no browser exports.
 * Supabase Auth verifies the bearer token remotely. A trusted backend must
 * independently verify that the session is still active and the student is
 * currently eligible (including suspension, expiry and enrollment status).
 *
 * This is NOT a wired Next.js endpoint or production enrollment approval.
 * Docs: https://supabase.com/docs/guides/auth/jwts
 */
const fault=(code,status)=>Object.assign(new Error(code),{code,status});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const REF=/^[a-z0-9]{20}$/;

/**
 * @returns {{userId:string}} only; never returns raw profile or identity info.
 * Inject fetchImpl for isolated deterministic tests; do not substitute a fake
 * fetch or permissive callbacks in the hosted production environment.
 */
export async function verifyCurrentStudentBearer({
 accessToken,projectRef,publishableKey,isCurrentSession,authorizeStudent,
 fetchImpl=globalThis.fetch
}={}){
 if(typeof accessToken!=='string'||accessToken.length<12||accessToken.length>8192||
    !TOKEN.test(accessToken))throw fault('AUTH_REQUIRED',401);
 if(typeof projectRef!=='string'||!REF.test(projectRef)||
    typeof publishableKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(publishableKey)||
    typeof fetchImpl!=='function')
    throw fault('HOSTED_AUTH_NOT_CONFIGURED',503);
 if(typeof isCurrentSession!=='function'||typeof authorizeStudent!=='function')
    throw fault('HOSTED_AUTH_POLICIES_UNAVAILABLE',503);

 const endpoint='https://'+projectRef+'.supabase.co/auth/v1/user';
 let response;
 try{
  response=await fetchImpl(endpoint,{
   method:'GET',
   headers:{apikey:publishableKey,Authorization:'Bearer '+accessToken,Accept:'application/json'},
   redirect:'error',
   cache:'no-store',
   signal:AbortSignal.timeout(8000)
  });
 }catch{throw fault('HOSTED_AUTH_UNAVAILABLE',503);}
 if(response?.status===401||response?.status===403)throw fault('AUTH_REQUIRED',401);
 if(response?.status!==200||typeof response.json!=='function')
  throw fault('HOSTED_AUTH_UNAVAILABLE',503);
 let user;
 try{user=await response.json();}catch{throw fault('HOSTED_AUTH_UNAVAILABLE',503);}
 if(!user||typeof user!=='object'||!UUID.test(user.id||'')||
   user.is_anonymous===true||typeof user.email!=='string'||
   !user.email_confirmed_at)
  throw fault('VERIFIED_STUDENT_REQUIRED',403);
 // Do not trust user_metadata or client-side identity flags for permissions.
 // Both callbacks must perform fresh trusted server/database checks.
 let sessionOK,studentOK;
 try{
  sessionOK=await isCurrentSession({userId:user.id,accessToken});
  if(sessionOK===true)studentOK=await authorizeStudent({userId:user.id});
 }catch{throw fault('HOSTED_AUTH_CHECK_UNAVAILABLE',503);}
 if(sessionOK!==true)throw fault('SESSION_NOT_ACTIVE',401);
 if(studentOK!==true)throw fault('STUDENT_NOT_ELIGIBLE',403);
 return Object.freeze({userId:user.id});
}
