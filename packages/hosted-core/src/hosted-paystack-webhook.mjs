/** Signed, size-bounded staging webhook. Acknowledge only durable inbox acceptance.
 * No public checkout route and no live payment/refund support.
 */
import {createHostedPaymentRpc,createHostedTestCommerce} from './hosted-test-commerce.mjs';
import {resolveWeek1ProviderEnvironment} from './week1-provider-env.mjs';
import {createPaystackClient} from '../../payment-core/src/paystack-client.mjs';
const MAX_BYTES=1024*1024;
const respond=(body,status)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function rawBody(request){
 if(Number(request.headers.get('content-length')||0)>MAX_BYTES)throw Object.assign(Error('BODY_TOO_LARGE'),{status:413});
 const reader=request.body?.getReader();
 if(!reader)throw Object.assign(Error('INVALID_EVENT'),{status:400});
 const chunks=[];let total=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   total+=value.byteLength;
   if(total>MAX_BYTES){void reader.cancel().catch(()=>{});throw Object.assign(Error('BODY_TOO_LARGE'),{status:413});}
   chunks.push(Buffer.from(value));
  }
 }finally{reader.releaseLock();}
 if(total===0)throw Object.assign(Error('INVALID_EVENT'),{status:400});
 return Buffer.concat(chunks,total);
}
export function buildHostedPaystackWebhook({env=process.env,fetchImpl=fetch}={}){
 return async function POST(request){
  if(env.STUDENT_CREATORS_WEEK05_WEBHOOK_ENABLED!=='1')return respond({error:'HOSTED_WEBHOOK_DISABLED'},503);
  let service;
  try{
   const c=resolveWeek1ProviderEnvironment(env);
   const id=env.PAYSTACK_WEBHOOK_KEY_ID,secret=env.PAYSTACK_WEBHOOK_SIGNING_SECRET;
   if(!c.paystack.testKey||typeof id!=='string'||!/^whk_[A-Za-z0-9_-]{3,80}$/.test(id)||typeof secret!=='string'||!/^whsec_[A-Za-z0-9_-]{4,256}$/.test(secret))throw Error('invalid configuration');
   service=createHostedTestCommerce({
    rpc:createHostedPaymentRpc({url:new URL(c.supabase.url).origin,projectRef:env.STUDENT_CREATORS_PROJECT_REF,serverKey:c.supabase.secretKey,fetchImpl}),
    gateway:createPaystackClient({secretKey:c.paystack.testKey,environment:'test',fetchImpl}),signingSecrets:[{id,secret}]
   });
  }catch{return respond({error:'HOSTED_WEBHOOK_UNAVAILABLE'},503);}
  const signature=request.headers.get('paystack-signature');
  if(!signature)return respond({error:'INVALID_SIGNATURE'},401);
  if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type')||''))return respond({error:'JSON_REQUIRED'},415);
  try{
   const result=await service.receiveWebhook(await rawBody(request),signature);
   if(result?.ignored!==true&&result?.received!==true)return respond({error:'INBOX_UNAVAILABLE'},503);
   return respond({received:true},200);
  }catch(e){
   if(e?.code==='INVALID_SIGNATURE')return respond({error:'INVALID_SIGNATURE'},401);
   if(['INVALID_EVENT','BAD_JSON'].includes(e?.code)||e?.status===400||e?.status===422)return respond({error:'INVALID_EVENT'},400);
   if(e?.status===413)return respond({error:'BODY_TOO_LARGE'},413);
   return respond({error:'INBOX_UNAVAILABLE'},503);
  }
 };
}
