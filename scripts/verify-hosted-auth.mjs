import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readDedicatedSupabaseRuntimeConfig,supabaseServerHeaders} from '../packages/content-core/src/supabase-runtime-config.mjs';
import {createHostedAuthProvider} from '../packages/hosted-core/src/hosted-auth-lifecycle.mjs';
import {createCurrentSupabaseAuth} from '../packages/hosted-core/src/supabase-current-auth.mjs';
import {readBoundedGatewayResponse} from '../packages/payment-core/src/bounded-response.mjs';

const EMAIL='wk-auth-test@example.invalid';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=code=>Object.assign(new Error(code),{code});
const assert=(ok,code)=>{if(!ok)throw fail(code);};
const codes=new Set(['ACCEPTANCE_DISABLED','STAGING_NOT_APPROVED','SYNTHETIC_CREDENTIALS_REQUIRED','LOGIN_FAILED',
 'SYNTHETIC_ACCOUNT_REQUIRED','CURRENT_SESSION_DENIED','PROFILE_READ_FAILED','PROFILE_MISMATCH','REFRESH_ROTATION_FAILED',
 'SESSION_ID_CHANGED','LOGOUT_FAILED','REVOKED_SESSION_STILL_ACTIVE','STALE_TOKEN_PROFILE_ACCESS','SESSION_CLEANUP_UNVERIFIED']);
const safe=e=>codes.has(e?.code)?e.code:'AUTH_PROVIDER_UNAVAILABLE';
function claims(token){
 try{
  const p=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
  assert(UUID.test(p.sub??'')&&UUID.test(p.session_id??'')&&p.role==='authenticated','SYNTHETIC_ACCOUNT_REQUIRED');return p;
 }catch{throw fail('SYNTHETIC_ACCOUNT_REQUIRED');}
}
export async function verifyHostedAuth({env=process.env,fetcher=fetch}={}){
 assert(env.STUDENT_CREATORS_AUTH_ACCEPTANCE_ENABLED==='true','ACCEPTANCE_DISABLED');
 const cfg=readDedicatedSupabaseRuntimeConfig(env,{server:true});assert(cfg,'STAGING_NOT_APPROVED');
 const password=env.STUDENT_CREATORS_AUTH_TEST_PASSWORD,origin=env.STUDENT_CREATORS_AUTH_ORIGIN;
 let validOrigin=false;try{const u=new URL(origin);validOrigin=u.protocol==='https:'&&u.origin===origin;}catch{}
 assert(typeof password==='string'&&password.length>=12&&Buffer.byteLength(password)<=128&&validOrigin,'SYNTHETIC_CREDENTIALS_REQUIRED');
 const provider=createHostedAuthProvider({url:cfg.url,publicKey:cfg.publishableKey,serverKey:cfg.serverKey,origin,fetcher});
 const current=createCurrentSupabaseAuth({url:cfg.url,publicKey:cfg.publishableKey,serverKey:cfg.serverKey,fetcher});
 await provider.assertSafeSettings();
 async function call(path,token,body){
  const headers=token?{apikey:cfg.publishableKey,authorization:'Bearer '+token}:supabaseServerHeaders(cfg.serverKey);
  return fetcher(new URL(path,cfg.url),{method:body?'POST':'GET',headers:{...headers,...(body?{'content-type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
 }
 async function json(r){
  if(!r.ok)throw fail('PROFILE_READ_FAILED');
  return JSON.parse(await readBoundedGatewayResponse(r,32768,()=>fail('PROFILE_READ_FAILED')));
 }
 async function liveSession(p){
  const value=await json(await call('/rest/v1/rpc/student_creators_session_active',null,{_user_id:p.sub,_session_id:p.session_id}));
  assert(typeof value==='boolean','CURRENT_SESSION_DENIED');return value;
 }
 async function profile(token,id){
  const r=await call('/rest/v1/student_profiles?select=user_id&user_id=eq.'+id,token);
  if([401,403].includes(r.status))return [];
  const rows=await json(r);assert(Array.isArray(rows),'PROFILE_READ_FAILED');return rows;
 }
 function verifyAccount(s){
  assert(s&&s.user?.email?.toLowerCase()===EMAIL&&UUID.test(s.user.id??''),'SYNTHETIC_ACCOUNT_REQUIRED');
  const p=claims(s.accessToken);assert(p.sub===s.user.id,'SYNTHETIC_ACCOUNT_REQUIRED');return p;
 }
 let first,fresh,p,revoked=false,failure=null;
 try{
  first=await provider.signIn(EMAIL,password);assert(first,'LOGIN_FAILED');
  p=verifyAccount(first);
  assert((await current.getUser(first.accessToken))?.id===p.sub&&await liveSession(p),'CURRENT_SESSION_DENIED');
  const rows=await profile(first.accessToken,p.sub);
  assert(rows.length===1&&rows[0].user_id===p.sub,'PROFILE_MISMATCH');
  fresh=await provider.refresh(first.refreshToken);assert(fresh&&fresh.refreshToken!==first.refreshToken,'REFRESH_ROTATION_FAILED');
  const p2=verifyAccount(fresh);assert(p2.sub===p.sub&&p2.session_id===p.session_id,'SESSION_ID_CHANGED');
  assert((await current.getUser(fresh.accessToken))?.id===p.sub,'CURRENT_SESSION_DENIED');
  assert(await provider.logout(fresh.accessToken)===true,'LOGOUT_FAILED');
  revoked=await liveSession(p)===false;assert(revoked,'REVOKED_SESSION_STILL_ACTIVE');
  for(const token of new Set([first.accessToken,fresh.accessToken])){
   assert(await current.getUser(token)===null,'REVOKED_SESSION_STILL_ACTIVE');
   assert((await profile(token,p.sub)).length===0,'STALE_TOKEN_PROFILE_ACCESS');
  }
 }catch(e){failure=safe(e);}
 // Cleanup only the newly created synthetic login session, never global
 // logout, account deletion or any other user's session. If the returned
 // identity cannot be confirmed synthetic, never use its token for cleanup.
 if(first&&p&&!revoked){
  try{
   const token=fresh?.accessToken??first.accessToken;
   await provider.logout(token);
   if(p)revoked=await liveSession(p)===false;
   else revoked=false;
  }catch{revoked=false;}
 }
 if(first&&p&&!revoked)throw fail('SESSION_CLEANUP_UNVERIFIED');
 if(failure)throw fail(failure);
 return {status:'passed',login:true,refreshRotated:true,logout:true,staleAccessDenied:true,sessionCleanupVerified:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await verifyHostedAuth()));}
 catch(e){console.error(JSON.stringify({status:'failed',code:safe(e)}));process.exitCode=1;}
}
