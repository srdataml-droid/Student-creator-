import {createHash} from 'node:crypto';
import {verifyMuxWebhookEnvelope} from './mux-webhook-verify.mjs';
import {readSupabaseRuntimeConfig,supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';

const MAX_BYTES=262144;
const fail=(code,status)=>Object.assign(new Error(code),{status,code});
const json=(status,error)=>Response.json(error?{error}:{received:true},{status,headers:{'cache-control':'no-store'}});
async function readRaw(request){
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>MAX_BYTES))
  throw fail('MUX_WEBHOOK_BODY_SIZE_INVALID',413);
 const reader=request.body?.getReader();
 if(!reader)throw fail('MUX_WEBHOOK_BODY_SIZE_INVALID',413);
 const chunks=[];let total=0;
 try{
  while(true){
   const {value,done}=await reader.read();
   if(done)break;
   total+=value.byteLength;
   if(total>MAX_BYTES){await reader.cancel();throw fail('MUX_WEBHOOK_BODY_SIZE_INVALID',413);}
   chunks.push(Buffer.from(value));
  }
 }finally{reader.releaseLock();}
 return Buffer.concat(chunks,total);
}

/** Persist verified event metadata, never provider URLs, credentials or raw payloads.
 * A downstream worker must query Mux with server credentials for authoritative
 * resource state before changing assets. HTTP 200 means durable receipt only.
 */
export function createMuxWebhookHandler({secret,record,now=()=>Math.floor(Date.now()/1000)}={}){
 return async request=>{
  if(request.method!=='POST')return json(405,'METHOD_NOT_ALLOWED');
  if(typeof record!=='function'||typeof secret!=='string'||secret.length<12)
   return json(503,'MUX_WEBHOOK_UNAVAILABLE');
  if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type')||''))
   return json(415,'INVALID_MEDIA_TYPE');
  let raw,event;
  try{
   raw=await readRaw(request);
   event=verifyMuxWebhookEnvelope({rawBody:raw,signatureHeader:request.headers.get('mux-signature'),webhookSecret:secret,nowSeconds:now()});
   if(!/^[a-z][a-z0-9_.-]{0,127}$/.test(event.type))throw fail('MUX_WEBHOOK_ENVELOPE_INVALID',400);
  }catch(e){return json([400,413].includes(e?.status)?e.status:400,'INVALID_MUX_WEBHOOK');}
  try{
   const result=await record({eventId:event.eventId,kind:event.type,resourceId:event.assetId,
    digest:createHash('sha256').update(raw).digest('hex')});
   if(result==='collision')return json(409,'MUX_EVENT_COLLISION');
   if(result!=='accepted'&&result!=='duplicate')throw Error('Unexpected receipt');
   return json(200);
  }catch{return json(503,'MUX_INBOX_UNAVAILABLE');}
 };
}

export function buildMuxWebhookRoute({getEnv=()=>process.env,fetcher=fetch}={}){
 return async request=>{
  try{
   const env=getEnv();
   // This endpoint cannot be enabled incidentally by existing provider aliases.
   if(env.STUDENT_CREATORS_STAGING_APPROVED!=='true'||env.APP_DATA_MODE!=='hosted'||
      env.STUDENT_CREATORS_PROJECT_REF!=='jnkqmlbkkvccnxrgkpno'||
      env.STUDENT_CREATORS_PUBLIC_REGISTRATION!=='false'||
      env.STUDENT_CREATORS_REAL_PAYMENT_ENABLED!=='false'||
      env.STUDENT_CREATORS_MUX_WEBHOOK_ENABLED!=='true')return json(503,'MUX_WEBHOOK_UNAVAILABLE');
   const config=readSupabaseRuntimeConfig(env,{server:true});
   if(!config||config.url!=='https://jnkqmlbkkvccnxrgkpno.supabase.co')return json(503,'MUX_WEBHOOK_UNAVAILABLE');
   const record=async event=>{
    const response=await fetcher(new URL('/rest/v1/rpc/record_verified_mux_delivery',config.url),{
     method:'POST',headers:{...supabaseServerHeaders(config.serverKey),'content-type':'application/json'},
     body:JSON.stringify({_event_id:event.eventId,_digest:event.digest,_event_type:event.kind,_resource_id:event.resourceId}),
     cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)
    });
    if(!response.ok)throw Error('Inbox unavailable');
    return response.json();
   };
   return await createMuxWebhookHandler({secret:env.MUX_WEBHOOK_SIGNING_SECRET,record})(request);
  }catch{return json(503,'MUX_WEBHOOK_UNAVAILABLE');}
 };
}
