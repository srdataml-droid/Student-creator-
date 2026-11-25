import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {readDedicatedSupabaseRuntimeConfig,supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';
import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';

const digest=value=>createHash('sha256').update(value).digest();
const safeToken=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{32,128}$/.test(value);
const unavailable=()=>new Error('Health probe unavailable');
const output=(status,body)=>Response.json(body,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
const buckets=[
 {id:'student-creators-private-identity',size:5242880,types:['application/pdf','image/jpeg','image/png']},
 {id:'student-creators-private-media',size:104857600,types:['image/jpeg','image/png','text/vtt','video/mp4','video/webm']}
];
function sameTypes(a,b){return Array.isArray(a)&&a.length===b.length&&[...a].sort().every((v,i)=>v===[...b].sort()[i]);}

export function buildHostedHealthRoute({getEnv=()=>process.env,fetcher=fetch}={}){
 return async request=>{
  if(request.method!=='GET')return output(405,{error:'METHOD_NOT_ALLOWED'});
  const env=getEnv(),provided=/^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization')??'')?.[1];
  const expected=env.STUDENT_CREATORS_HEALTH_TOKEN;
  // Do not reveal whether the route or its credentials are configured.
  if(env.STUDENT_CREATORS_HEALTH_ENABLED!=='true'||!safeToken(expected)||!safeToken(provided)||
   !timingSafeEqual(digest(provided),digest(expected)))return output(404,{error:'NOT_FOUND'});
  const requestId=randomUUID();
  let cfg;
  try{cfg=readDedicatedSupabaseRuntimeConfig(env,{server:true});if(!cfg)throw unavailable();}
  catch{return output(503,{status:'unavailable',requestId,checks:{configuration:false},releaseApproved:false});}
  const authHeaders={apikey:cfg.publishableKey};
  const serverHeaders=supabaseServerHeaders(cfg.serverKey);
  async function call(path,headers,body){
   const r=await fetcher(new URL(path,cfg.url),{method:body?'POST':'GET',
    headers:{...headers,...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
   return r;
  }
  async function json(r){
   if(!r.ok)throw unavailable();
   return JSON.parse(await readBoundedGatewayResponse(r,32768,unavailable));
  }
  const probe=async fn=>{try{return await fn()===true;}catch{return false;}};
  const sessionBody={_user_id:'00000000-0000-4000-8000-000000000001',_session_id:'00000000-0000-4000-8000-000000000002'};
  const rpc='/rest/v1/rpc/student_creators_session_active';
  const [auth,catalog,session,publicDenied,identityBucket,mediaBucket]=await Promise.all([
   probe(async()=>{const r=await json(await call('/auth/v1/settings',authHeaders));return r.disable_signup===true;}),
   probe(async()=>{const r=await json(await call('/rest/v1/institutions?select=id&limit=0',authHeaders));return Array.isArray(r)&&r.length===0;}),
   probe(async()=>await json(await call(rpc,serverHeaders,sessionBody))===false),
   probe(async()=>{const r=await call(rpc,authHeaders,sessionBody);return [401,403,404].includes(r.status);}),
   ...buckets.map(b=>probe(async()=>{
    const r=await json(await call('/storage/v1/bucket/'+b.id,serverHeaders));
    return r.id===b.id&&r.public===false&&r.file_size_limit===b.size&&sameTypes(r.allowed_mime_types,b.types);
   }))
  ]);
  const checks={configuration:true,authSignupsDisabled:auth,catalogRead:catalog,serviceSessionRpc:session,
    publicSessionRpcDenied:publicDenied,identityBucketPrivate:identityBucket,mediaBucketPrivate:mediaBucket};
  const ok=Object.values(checks).every(Boolean);
  // No claim about provider delivery, enrollment, streaming, payment, scanner,
  // restore, or release readiness. Never echo provider error bodies or secrets.
  return output(ok?200:503,{status:ok?'foundation_reachable':'degraded',requestId,checks,releaseApproved:false});
 };
}
