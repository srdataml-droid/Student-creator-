import {createHash} from 'node:crypto';
import {createCurrentSupabaseAuth} from './supabase-current-auth.mjs';
import {createPaystackClient} from '../../payment-core/src/paystack-client.mjs';
import {decodeVerifiedPaystackWebhookV1} from '../../payment-core/src/webhooks.mjs';
import {readDedicatedSupabaseRuntimeConfig,supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';
const REF='jnkqmlbkkvccnxrgkpno',UUID=/^[0-9a-f-]{36}$/i,REFERENCE=/^sc_[0-9a-f]{32}$/,TX=/^[A-Za-z0-9_-]{1,128}$/;
const unavailable=()=>new Error('Hosted payment unavailable');
const refPattern=domain=>domain==='live'?/^lc_[0-9a-f]{32}$/:REFERENCE;
const json=(status,data)=>Response.json(data,{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer'}});
function checkoutUrl(value){if(typeof value!=='string'||/[\\\s]/.test(value))throw unavailable();const u=new URL(value);if(u.protocol!=='https:'||!['checkout.paystack.com','paystack.com'].includes(u.hostname)||u.username||u.password||u.port||u.hash||u.href.length>2048)throw unavailable();return u.href;}
async function readRaw(request,cap){
 const reader=request.body?.getReader();if(!reader)throw unavailable();
 let size=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>cap){await reader.cancel();throw unavailable();}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
 return Buffer.concat(chunks,size);
}
export function createHostedCheckoutHandler({auth,store,gateway,origin,domain='test',checkoutEnabled=domain==='test'}){
 return async(request,{lessonId}={})=>{
  if(request.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
  if(!['test','live'].includes(domain)||!checkoutEnabled)return json(503,{error:'CHECKOUT_DISABLED'});
  if(request.headers.get('origin')!==origin)return json(403,{error:'ORIGIN_FORBIDDEN'});
  if(!UUID.test(lessonId??'')||request.body)return json(400,{error:'BAD_REQUEST'});
  const key=request.headers.get('idempotency-key'),token=/^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization')??'')?.[1];
  if(!token)return json(401,{error:'AUTH_REQUIRED'});
  if(!/^[A-Za-z0-9_-]{16,128}$/.test(key??''))return json(400,{error:'IDEMPOTENCY_KEY_REQUIRED'});
  const terms=request.headers.get('x-student-creators-terms-version');
  if(domain==='live'&&!/^[A-Za-z0-9._-]{3,128}$/.test(terms??''))return json(400,{error:'TERMS_VERSION_REQUIRED'});
  try{
   const user=await auth.getUser(token);if(!user)return json(401,{error:'AUTH_REQUIRED'});
   const o=domain==='live'?await store.reserve(user.id,lessonId,key,terms):await store.reserve(user.id,lessonId,key);if(!o||!UUID.test(o.orderId??''))return json(403,{error:'CHECKOUT_UNAVAILABLE'});
   if(o.status==='ready'){
    if(o.domain!==domain||!refPattern(domain).test(o.reference??'')||(domain==='live'&&(await auth.getUser(token))?.id!==user.id))throw unavailable();
    return json(200,{orderId:o.orderId,authorizationUrl:checkoutUrl(o.authorizationUrl)});
   }
   if(o.create!==true)return json(o.status==='paid'?200:202,{orderId:o.orderId,status:o.status});
   if(o.domain!==domain||!refPattern(domain).test(o.reference??'')||!Number.isSafeInteger(o.amountKobo)||o.amountKobo<20000)throw unavailable();
   let result;
   try{result=await gateway.initialize(o);}catch{await store.finish(o.orderId,null);return json(503,{error:'CHECKOUT_RECONCILIATION_REQUIRED'});}
   if(result.reference!==o.reference||await store.finish(o.orderId,checkoutUrl(result.authorizationUrl))!==true)throw unavailable();
   if(domain==='live'&&((await auth.getUser(token))?.id!==user.id||await store.canReturn(user.id,o.reference,terms)!==true))return json(409,{error:'CHECKOUT_REVIEW_REQUIRED'});
   return json(201,{orderId:o.orderId,authorizationUrl:checkoutUrl(result.authorizationUrl)});
  }catch{return json(503,{error:'CHECKOUT_UNAVAILABLE'});}
 };
}
export function createHostedPaystackWebhook({store,signingSecrets,domain='test'}){
 return async request=>{
  if(request.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
  let raw,event;
  try{raw=await readRaw(request,1048576);event=decodeVerifiedPaystackWebhookV1(raw,request.headers.get('paystack-signature'),signingSecrets);}catch{return json(401,{error:'INVALID_SIGNATURE_OR_BODY'});}
  if(event.event!=='charge.success')return json(200,{received:true,ignored:true});
  const d=event.data;
  if(d.domain!==domain||!refPattern(domain).test(d.reference??'')||!(typeof d.id==='string'&&TX.test(d.id)||typeof d.id==='number'&&Number.isSafeInteger(d.id)&&d.id>0))return json(400,{error:domain==='test'?'INVALID_TEST_EVENT':'INVALID_LIVE_EVENT'});
  try{const result=await store.record(d.reference,String(d.id),createHash('sha256').update(raw).digest('hex'));
   if(result==='unknown')return json(200,{received:true,ignored:true});
   if(result==='collision')return json(409,{error:'EVENT_COLLISION'});
   if(!['accepted','duplicate'].includes(result))throw unavailable();return json(200,{received:true});
  }catch{return json(503,{error:'INBOX_UNAVAILABLE'});}
 };
}
export async function processHostedPaystackCharge({store,gateway,domain='test'}){
 const event=await store.claim();if(!event)return {state:'empty'};
 try{
  const o=await store.snapshot(event.reference);
  if(!o||o.domain!==domain||!refPattern(domain).test(event.reference??'')||o.reference!==event.reference)throw unavailable();
  const charge=await gateway.verify(o);
  if(charge.providerTransactionId!==event.providerTx||charge.domain!==domain||charge.currency!=='NGN'||charge.amountKobo!==o.amountKobo||(domain==='live'&&(charge.reference!==o.reference||!Number.isSafeInteger(charge.providerFeeKobo)||charge.providerFeeKobo<0||charge.providerFeeKobo>o.amountKobo)))throw unavailable();
  if(await store.settle(event.key,event.leaseId,charge)!==true)throw unavailable();
  return {state:'processed'};
 }catch{
  if(await store.retry(event.key,event.leaseId)!==true)throw unavailable();
  return {state:'retry'};
 }
}
// Two explicit server-only slots support Paystack's signed rotation overlap.
export function readPaystackSigningSecrets(env){
 const pairs=[
  [env.PAYSTACK_WEBHOOK_KEY_ID,env.PAYSTACK_WEBHOOK_SIGNING_SECRET],
  [env.PAYSTACK_WEBHOOK_PREVIOUS_KEY_ID,env.PAYSTACK_WEBHOOK_PREVIOUS_SIGNING_SECRET]
 ];
 const result=[];
 for(const [id,secret] of pairs){
  if(id===undefined&&secret===undefined&&result.length)continue;
  if(typeof id!=='string'||!/^whk_[A-Za-z0-9_-]{3,80}$/.test(id)||
   typeof secret!=='string'||!/^whsec_[A-Za-z0-9_-]{4,256}$/.test(secret)||
   result.some(k=>k.id===id||k.secret===secret))throw unavailable();
  result.push(Object.freeze({id,secret}));
 }
 return Object.freeze(result);
}
export function createHostedPaystackRuntime({env=process.env,fetcher=fetch}={}){
 if(env.APP_DATA_MODE!=='hosted'||env.STUDENT_CREATORS_PROJECT_REF!==REF||env.STUDENT_CREATORS_STAGING_APPROVED!=='true'||env.STUDENT_CREATORS_PUBLIC_REGISTRATION!=='false'||env.STUDENT_CREATORS_REAL_PAYMENT_ENABLED!=='false'||env.STUDENT_CREATORS_PAYSTACK_TEST_ENABLED!=='true'||env.STUDENT_CREATORS_DISTRIBUTION_CHANNEL!=='independent_web')throw unavailable();
 const cfg=readDedicatedSupabaseRuntimeConfig(env,{server:true});
 if(!cfg||cfg.url!=='https://'+REF+'.supabase.co')throw unavailable();
 const keys=['PAYSTACK_TEST_SECRET_KEY','paystack_secret_key'].map(k=>env[k]).filter(Boolean);
 if(!keys.length||keys.some(k=>k!==keys[0])||!/^sk_test_[A-Za-z0-9]+$/.test(keys[0]))throw unavailable();
 const signingSecrets=readPaystackSigningSecrets(env);
 const origin=env.STUDENT_CREATORS_PAYSTACK_ORIGIN,parsed=new URL(origin);
 if(parsed.protocol!=='https:'||parsed.origin!==origin||parsed.username||parsed.password)throw unavailable();
 const gateway=createPaystackClient({secretKey:keys[0],environment:'test',fetchImpl:fetcher});
 const auth=createCurrentSupabaseAuth({url:cfg.url,publicKey:cfg.publishableKey,serverKey:cfg.serverKey,requireStudent:true,fetcher});
 const rpc=async(name,body)=>{const r=await fetcher(new URL('/rest/v1/rpc/'+name,cfg.url),{method:'POST',headers:{...supabaseServerHeaders(cfg.serverKey),'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw unavailable();return r.json();};
 const store={reserve:(buyer,content,key)=>rpc('reserve_hosted_paystack_checkout',{_buyer:buyer,_content:content,_key:key}),finish:(order,url)=>rpc('finish_hosted_paystack_checkout',{_order:order,_url:url}),
 record:(ref,tx,digest)=>rpc('record_hosted_paystack_charge',{_reference:ref,_tx:tx,_digest:digest}),claim:()=>rpc('claim_hosted_paystack_charge',{}),snapshot:reference=>rpc('hosted_paystack_order_snapshot',{_reference:reference}),
 settle:(key,lease,c)=>rpc('settle_hosted_paystack_charge',{_key:key,_lease:lease,_tx:c.providerTransactionId,_amount:c.amountKobo,_fee:c.providerFeeKobo}),retry:(key,lease)=>rpc('retry_hosted_paystack_charge',{_key:key,_lease:lease})};
 return {auth,store,gateway,origin,signingSecrets};
}
export function buildHostedPaystackRoute({webhook=false,getEnv=()=>process.env,fetcher=fetch}={}){
 return async(request,context)=>{try{const runtime=createHostedPaystackRuntime({env:getEnv(),fetcher});return webhook?await createHostedPaystackWebhook(runtime)(request):await createHostedCheckoutHandler(runtime)(request,context);}catch{return json(503,{error:'PAYSTACK_TEST_UNAVAILABLE'});}};
}
