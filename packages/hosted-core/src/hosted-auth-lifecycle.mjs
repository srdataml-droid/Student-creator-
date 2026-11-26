import {requireSafePilotAuthSettings} from './supabase-auth-settings.mjs';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {readDedicatedSupabaseRuntimeConfig,supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';
import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';
import {createCurrentSupabaseAuth} from './supabase-current-auth.mjs';
const REF='jnkqmlbkkvccnxrgkpno',COOKIE='__Secure-wk_refresh';
const emailPattern=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const REFRESH=/^[A-Za-z0-9_-]{10,512}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unavailable=()=>new Error('Hosted Auth unavailable');
const json=(status,data,cookie)=>Response.json(data,{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer',...(cookie?{'set-cookie':cookie}:{})}});
const clearCookie=()=>COOKIE+'=; Max-Age=0; Path=/api/hosted-auth; HttpOnly; Secure; SameSite=Strict';
const refreshCookie=value=>COOKIE+'='+value+'; Max-Age=604800; Path=/api/hosted-auth; HttpOnly; Secure; SameSite=Strict';
const digest=(pepper,kind,value)=>createHmac('sha256',pepper).update(kind+'\0'+value).digest('hex');
const normalized=email=>typeof email==='string'?email.trim().toLowerCase():'';
const validEmail=email=>email.length<=254&&emailPattern.test(email);
const passwordOK=p=>typeof p==='string'&&p.length>=12&&Buffer.byteLength(p,'utf8')<=128;
function readRefresh(request){
 const values=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(COOKIE+'='));
 if(values.length!==1)return null;const v=values[0].slice(COOKIE.length+1);return REFRESH.test(v)?v:null;
}
async function body(request){
 if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type')??''))throw unavailable();
 const text=await readBoundedGatewayResponse(request,4096,unavailable);
 const b=JSON.parse(text);if(!b||typeof b!=='object'||Array.isArray(b))throw unavailable();return b;
}
function session(data){
 if(!data||!JWT.test(data.access_token??'')||data.access_token.length>8192||!REFRESH.test(data.refresh_token??'')||
 !Number.isSafeInteger(data.expires_in)||data.expires_in<1||data.expires_in>86400)throw unavailable();
 return {accessToken:data.access_token,refreshToken:data.refresh_token,expiresIn:data.expires_in,user:data.user};
}
export function createHostedAuthProvider({url,publicKey,serverKey,origin,fetcher=fetch}){
 if(url!=='https://'+REF+'.supabase.co'||!publicKey||!serverKey)throw unavailable();
 async function call(path,{data,token,admin=false,method='POST',sessionResponse=false}={}){
  const headers=admin?supabaseServerHeaders(serverKey):{apikey:publicKey,...(token?{authorization:'Bearer '+token}:{})};
  const r=await fetcher(new URL('/auth/v1/'+path,url),{method,headers:{...headers,'content-type':'application/json'},
   ...(data?{body:JSON.stringify(data)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
  if([400,401,403,422,429].includes(r.status))return null;
  if(!r.ok)throw unavailable();
  if(!sessionResponse)return true;
  return session(JSON.parse(await readBoundedGatewayResponse(r,65536,unavailable)));
 }
 return {
  assertSafeSettings:()=>requireSafePilotAuthSettings({url,publicKey,fetcher}),
  invite:email=>call('invite?redirect_to='+encodeURIComponent(origin+'/auth/confirm'),{admin:true,data:{email}}),
  signIn:(email,password)=>call('token?grant_type=password',{data:{email,password},sessionResponse:true}),
  refresh:refreshToken=>call('token?grant_type=refresh_token',{data:{refresh_token:refreshToken},sessionResponse:true}),
  verify:(email,code,purpose)=>call('verify',{data:{email,token:code,type:purpose==='signup'?'email':purpose},sessionResponse:true}),
  updatePassword:(accessToken,password)=>call('user',{method:'PUT',token:accessToken,data:{password}}),
  logout:(accessToken,global=false)=>call('logout?scope='+(global?'global':'local'),{token:accessToken}),
  recover:email=>call('recover?redirect_to='+encodeURIComponent(origin+'/auth/confirm'),{data:{email}})
 };
}
export function createHostedAuthStore({url,serverKey,fetcher=fetch}){
 if(url!=='https://'+REF+'.supabase.co'||!serverKey)throw unavailable();
 const rpc=async(name,data)=>{
  const r=await fetcher(new URL('/rest/v1/rpc/'+name,url),{method:'POST',headers:{...supabaseServerHeaders(serverKey),'content-type':'application/json'},
   body:JSON.stringify(data),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(3000)});
  if(!r.ok)throw unavailable();return r.json();
 };
 return {
  admit:({kind,digest})=>rpc('admit_hosted_auth_attempt',{_kind:kind,_digest:digest}),
  claimInvite:recipient=>rpc('claim_hosted_pilot_invite',{_recipient:recipient}),
  finishInvite:(recipient,state)=>rpc('finish_hosted_pilot_invite',{_recipient:recipient,_state:state}),
  enqueueRecovery:({recipient,eligible})=>rpc('enqueue_hosted_recovery',{_recipient:recipient,_eligible:eligible}),
  claimRecovery:recipient=>rpc('claim_hosted_recovery',{_recipient:recipient}),
  finishRecovery:({id,leaseId,state})=>rpc('finish_hosted_recovery',{_id:id,_lease:leaseId,_state:state})
 };
}
export function createHostedAuthHandler({provider,store,currentAuth,origin,pilotEmail,adminEmail,inviteSecret,pepper}){
 const recipient=digest(pepper,'pilot',pilotEmail);
 const allowedLogin=email=>email===pilotEmail||Boolean(adminEmail&&email===adminEmail);
 const admit=(kind,value)=>store.admit({kind,digest:digest(pepper,kind,value)});
 const accepted=()=>json(202,{accepted:true});
 const unauthorized=()=>json(401,{error:'AUTH_REQUIRED'});
 async function publishSession(s){
  if(!s||!allowedLogin(normalized(s.user?.email)))return unauthorized();
  const current=await currentAuth.getUser(s.accessToken);
  if(!current||current.id!==s.user.id)return unauthorized();
  return json(200,{accessToken:s.accessToken,expiresIn:s.expiresIn,userId:current.id},refreshCookie(s.refreshToken));
 }
 return async(request,{action}={})=>{
  if(request.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
  if(request.headers.get('origin')!==origin)return json(403,{error:'ORIGIN_FORBIDDEN'});
  if(!['invite','sign-in','refresh','logout','recover','complete'].includes(action))return json(404,{error:'NOT_FOUND'});
  try{
   if(action==='refresh'){
    const refresh=readRefresh(request);if(!refresh)return unauthorized();
    if(await admit('refresh',refresh)!==true)return json(429,{error:'TRY_LATER'});
    if(await provider.assertSafeSettings()!==true)throw unavailable();
    const s=await provider.refresh(refresh);
    if(!s)return json(401,{error:'AUTH_REQUIRED'},clearCookie());
    return await publishSession(s);
   }
   if(action==='logout'){
    let token=/^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization')??'')?.[1];
    if(!token||!JWT.test(token)||token.length>8192){
     const refresh=readRefresh(request);
     if(refresh){const s=await provider.refresh(refresh);token=s?.accessToken;}
    }
    if(!token)return json(200,{signedOut:true},clearCookie());
    let revoked=false;try{revoked=await provider.logout(token)===true;}catch{}
    return json(revoked?200:503,{signedOut:true,remoteRevoked:revoked},clearCookie());
   }
   const b=await body(request).catch(()=>null);
   if(!b)return json(400,{error:'INVALID_REQUEST'});
   if(action==='invite'){
    if(await admit('invite','pilot')!==true)return json(429,{error:'TRY_LATER'});
    const code=typeof b.inviteCode==='string'&&b.inviteCode.length<=128?b.inviteCode:'';
    const left=Buffer.from(digest(pepper,'invite',code),'hex'),right=Buffer.from(digest(pepper,'invite',inviteSecret),'hex');
    if(!timingSafeEqual(left,right))return json(403,{error:'INVITATION_NOT_AVAILABLE'});
    if(await provider.assertSafeSettings()!==true)throw unavailable();
    if(await store.claimInvite(recipient)!==true)return accepted();
    let requested=false;try{requested=await provider.invite(pilotEmail)===true;}catch{}
    const done=await store.finishInvite(recipient,requested?'requested':'uncertain');
    return requested&&done===true?accepted():json(503,{error:'INVITATION_STATUS_UNCERTAIN'});
   }
   const email=normalized(b.email);
   if(action==='recover'){
    // Same bounded DB-only route for all addresses; no provider timing or existence disclosure.
    if(validEmail(email)&&await admit('recover',email)===true)
     await store.enqueueRecovery({recipient,eligible:email===pilotEmail});
    return accepted();
   }
   if(!validEmail(email))return unauthorized();
   if(await admit(action,email)!==true)return json(429,{error:'TRY_LATER'});
   if(action==='sign-in'){
    if(!allowedLogin(email)||!passwordOK(b.password))return unauthorized();
    if(await provider.assertSafeSettings()!==true)throw unavailable();
    return await publishSession(await provider.signIn(email,b.password));
   }
   if(email!==pilotEmail||!['invite','signup','recovery'].includes(b.purpose)||!/^\d{6,10}$/.test(b.code??'')||!passwordOK(b.password))
    return unauthorized();
   if(await provider.assertSafeSettings()!==true)throw unavailable();
   const verified=await provider.verify(email,b.code,b.purpose);
   if(!verified||normalized(verified.user?.email)!==email)return unauthorized();
   const user=await currentAuth.getUser(verified.accessToken);
   if(!user||user.id!==verified.user.id)return unauthorized();
   // The OTP-derived session never reaches the browser; complete password
   // establishment/recovery and globally revoke sessions before returning.
   if(await provider.updatePassword(verified.accessToken,b.password)!==true)return json(503,{error:'PASSWORD_UPDATE_UNAVAILABLE'},clearCookie());
   if(await provider.logout(verified.accessToken,true)!==true)return json(503,{error:'SESSION_REVOCATION_UNVERIFIED'},clearCookie());
   return json(200,{completed:true,signInRequired:true},clearCookie());
  }catch{
   // Recovery always returns the same response; worker/provider failure is
   // not an account existence oracle. Operators inspect the private queue.
   if(action==='recover')return accepted();
   return json(503,{error:'HOSTED_AUTH_UNAVAILABLE'},action==='logout'||action==='complete'?clearCookie():undefined);
  }
 };
}
export function hostedAuthDependencies(env,fetcher=fetch){
 if(env.APP_DATA_MODE!=='hosted'||env.STUDENT_CREATORS_PROJECT_REF!==REF||
 env.STUDENT_CREATORS_PUBLIC_REGISTRATION!=='false'||
 env.STUDENT_CREATORS_HOSTED_AUTH_ENABLED!=='true'||env.STUDENT_CREATORS_SUPABASE_SIGNUPS_DISABLED_CONFIRMED!=='true'||
 env.STUDENT_CREATORS_AUTH_EMAIL_ENABLED!=='true'||env.STUDENT_CREATORS_PILOT_SEATS!=='1')throw unavailable();
 const cfg=readDedicatedSupabaseRuntimeConfig(env,{server:true});
 if(!cfg||cfg.url!=='https://'+REF+'.supabase.co')throw unavailable();
 const origin=env.STUDENT_CREATORS_AUTH_ORIGIN,o=new URL(origin);
 const pilotEmail=normalized(env.STUDENT_CREATORS_PILOT_EMAIL),adminEmail=normalized(env.STUDENT_CREATORS_STAGING_ADMIN_EMAIL);
 const inviteSecret=env.STUDENT_CREATORS_PILOT_INVITE_SECRET,pepper=env.STUDENT_CREATORS_HOSTED_AUTH_PEPPER;
 if(o.origin!==origin||o.protocol!=='https:'||!validEmail(pilotEmail)||(adminEmail&&!validEmail(adminEmail))||
 !/^[A-Za-z0-9_-]{32,128}$/.test(inviteSecret??'')||!/^[A-Za-z0-9_-]{32,128}$/.test(pepper??'')||pepper===inviteSecret)throw unavailable();
 const provider=createHostedAuthProvider({url:cfg.url,publicKey:cfg.publishableKey,serverKey:cfg.serverKey,origin,fetcher});
 const store=createHostedAuthStore({url:cfg.url,serverKey:cfg.serverKey,fetcher});
 const currentAuth=createCurrentSupabaseAuth({url:cfg.url,publicKey:cfg.publishableKey,serverKey:cfg.serverKey,fetcher});
 return {provider,store,currentAuth,origin,pilotEmail,adminEmail,inviteSecret,pepper};
}
export function buildHostedAuthRoute({getEnv=()=>process.env,fetcher=fetch}={}){
 return async(request,context)=>{if(request.method==='POST'&&context?.action==='refresh'&&!readRefresh(request)){const origin=request.headers.get('origin');if(origin!==new URL(request.url).origin)return json(403,{error:'ORIGIN_FORBIDDEN'});return json(401,{error:'AUTH_REQUIRED'});}try{return await createHostedAuthHandler(hostedAuthDependencies(getEnv(),fetcher))(request,context);}
 catch{return json(503,{error:'HOSTED_AUTH_UNAVAILABLE'});}};
}
export async function processHostedRecovery({provider,store,pilotEmail,pepper}){
 if(await provider.assertSafeSettings()!==true)throw unavailable();
 const job=await store.claimRecovery(digest(pepper,'pilot',pilotEmail));
 if(job===null)return {status:'idle'};
 if(!UUID.test(job?.id??'')||!UUID.test(job.leaseId??''))throw unavailable();
 let requested=false;try{requested=await provider.recover(pilotEmail)===true;}catch{}
 const state=requested?'requested':'uncertain';
 if(await store.finishRecovery({id:job.id,leaseId:job.leaseId,state})!==true)throw unavailable();
 return {status:state}; // Provider request, not verified inbox delivery.
}
