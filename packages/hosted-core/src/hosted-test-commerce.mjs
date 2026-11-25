/** Server-only hosted payment transport and recovery service.
 * Never import into a browser, accept a client amount, or fulfill from webhook JSON.
 * Week 1 owns current-session authentication. This module does not expose HTTP routes.
 */
import {createHash} from 'node:crypto';
import {createPaystackClient} from '../../payment-core/src/paystack-client.mjs';
import {decodeVerifiedPaystackWebhookV1} from '../../payment-core/src/webhooks.mjs';
import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';
import {supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';
import {resolveWeek1ProviderEnvironment} from './week1-provider-env.mjs';
const fault=(code,status=503)=>Object.assign(new Error(code),{code,status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tx=/^[A-Za-z0-9_-]{1,128}$/;
const ref=/^sc_[a-f0-9]{32}$/;
const errorCode=e=>typeof e?.code==='string'&&/^[A-Z_]{1,60}$/.test(e.code)?e.code:'VERIFICATION_FAILED';
const endpoints=Object.freeze({
 create:'week05_create_test_order',lookup:'week05_get_test_order',apply:'week05_apply_test_charge',
 enqueue:'week05_enqueue_test_charge',claim:'week05_claim_test_charge',finish:'week05_finish_test_charge',
 beginCheckout:'week05_begin_test_checkout',finishCheckout:'week05_finish_test_checkout'
});
export function createHostedPaymentRpc({url,projectRef,serverKey,fetchImpl=fetch}={}){
 if(typeof projectRef!=='string'||!/^[a-z0-9]{20}$/.test(projectRef)||
 url!=='https://'+projectRef+'.supabase.co'||typeof serverKey!=='string'||
 !/^sb_secret_[A-Za-z0-9_-]{12,}$/.test(serverKey)||typeof fetchImpl!=='function')throw fault('HOSTED_PAYMENT_CONFIGURATION');
 return async function rpc(action,params={}){
  if(!Object.hasOwn(endpoints,action))throw fault('UNKNOWN_PAYMENT_RPC');
  let response;
  try{
   response=await fetchImpl(url+'/rest/v1/rpc/'+endpoints[action],{
    method:'POST',headers:{...supabaseServerHeaders(serverKey),'content-type':'application/json',Accept:'application/json'},
    body:JSON.stringify(params),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)
   });
   if(!response?.ok){
    // Do not expose database errors or PII to clients/logs.
    const status=response?.status;
    throw fault(status===403?'PAYMENT_OPERATION_DENIED':status===404?'ORDER_NOT_FOUND':status===409?'PAYMENT_CONFLICT':'PAYMENT_DATABASE_UNAVAILABLE',status===403?403:status===404?404:status===409?409:503);
   }
   const raw=await readBoundedGatewayResponse(response,65536,()=>fault('PAYMENT_DATABASE_RESPONSE'));
   return JSON.parse(raw);
  }catch(e){if(e?.code&&/^(PAYMENT_|ORDER_NOT_FOUND)/.test(e.code))throw e;throw fault('PAYMENT_DATABASE_UNAVAILABLE');}
 };
}
function validateSnapshot(o){
 if(!o||!ref.test(o.reference||'')||o.domain!=='test'||o.currency!=='NGN'||
 !Number.isSafeInteger(o.amountKobo)||o.amountKobo<20000||typeof o.buyerEmail!=='string'||
 !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.buyerEmail))throw fault('INVALID_ORDER_SNAPSHOT');
 return {reference:o.reference,amountKobo:o.amountKobo,buyerEmail:o.buyerEmail,domain:'test'};
}
function publicOrder(o){return {orderId:o.orderId,reference:o.reference,amountKobo:o.amountKobo,currency:'NGN',status:o.status};}
function checkoutUrl(value){
 if(typeof value!=='string'||value.length>2048)throw fault('INVALID_CHECKOUT_RESPONSE',502);
 let u;try{u=new URL(value);}catch{throw fault('INVALID_CHECKOUT_RESPONSE',502);}
 if(u.protocol!=='https:'||!['checkout.paystack.com','paystack.com'].includes(u.hostname)||u.username||u.password||u.port||u.hash||/[\\\s]/.test(value))throw fault('INVALID_CHECKOUT_RESPONSE',502);
 return u.toString();
}
export function createHostedTestCommerce({rpc,gateway,authenticate,signingSecrets=[],distributionChannel=process.env.STUDENT_CREATORS_DISTRIBUTION_CHANNEL}={}){
 if(typeof rpc!=='function'||gateway?.environment!=='test'||typeof gateway.verify!=='function'||typeof gateway.initialize!=='function')throw fault('HOSTED_TEST_PAYMENT_CONFIGURATION');
 async function actor(token){
  if(typeof authenticate!=='function')throw fault('HOSTED_AUTH_POLICIES_UNAVAILABLE');
  const a=await authenticate(token);
  if(!uuid.test(a?.userId||'')||typeof a.email!=='string'||a.emailConfirmed!==true||a.currentSession!==true||a.eligible!==true)throw fault('AUTH_REQUIRED',401);
  return a;
 }
 async function snapshot(token,reference){
  const a=await actor(token);
  if(!ref.test(reference||''))throw fault('ORDER_NOT_FOUND',404);
  const o=await rpc('lookup',{p_buyer:a.userId,p_ref:reference});
  validateSnapshot(o);
  if(o.reference!==reference)throw fault('INVALID_ORDER_SNAPSHOT');
  return o;
 }
 async function verifyAndApply(o,expectedTransaction=null){
  const trusted=validateSnapshot(o);
  const charge=await gateway.verify(trusted);
  // Even the normalized adapter response must match the snapshot and lease.
  if(charge?.reference!==trusted.reference||charge.amountKobo!==trusted.amountKobo||
   charge.currency!=='NGN'||charge.domain!=='test'||!tx.test(charge.providerTransactionId||'')||
   !Number.isSafeInteger(charge.providerFeeKobo)||charge.providerFeeKobo<0||charge.providerFeeKobo>charge.amountKobo||
   (expectedTransaction!==null&&charge.providerTransactionId!==expectedTransaction))throw fault('PAYMENT_VERIFICATION_FAILED',409);
  return rpc('apply',{p_ref:trusted.reference,p_tx:charge.providerTransactionId,p_amount:charge.amountKobo,
   p_currency:'NGN',p_domain:'test',p_email:trusted.buyerEmail,p_fee:charge.providerFeeKobo});
 }
 return Object.freeze({
  async createOrder(token,{contentId,requestKey}={}){
   const a=await actor(token);
   if(!uuid.test(contentId||'')||typeof requestKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(requestKey))throw fault('INVALID_ORDER_REQUEST',422);
   const o=await rpc('create',{p_buyer:a.userId,p_email:a.email,p_content:contentId,p_key:requestKey});
   if(!uuid.test(o?.order_id||'')||!ref.test(o.reference||'')||o.currency!=='NGN'||!Number.isSafeInteger(o.amount_kobo)||o.amount_kobo<20000)throw fault('INVALID_ORDER_SNAPSHOT');
   return {orderId:o.order_id,reference:o.reference,amountKobo:o.amount_kobo,currency:'NGN',status:o.status,replayed:o.replayed===true};
  },
  async getOrder(token,reference){return publicOrder(await snapshot(token,reference));},
  // Durable claim is committed before provider I/O. Uncertainty never retries
  // initialization automatically. Cached URLs get the same strict validation.
  async initializeOrder(token,reference){
   if(distributionChannel!=='independent_web')throw fault('CHECKOUT_DISTRIBUTION_DISABLED',403);
   const a=await actor(token);
   if(!ref.test(reference||''))throw fault('ORDER_NOT_FOUND',404);
   const c=await rpc('beginCheckout',{p_buyer:a.userId,p_ref:reference});
   if(c?.reference!==reference)throw fault('INVALID_ORDER_SNAPSHOT');
   if(c.state==='uncertain')throw fault('CHECKOUT_INITIALIZATION_UNCERTAIN',409);
   if(c.state==='ready')return {reference,authorizationUrl:checkoutUrl(c.authorizationUrl)};
   if(c.state!=='claimed'||!uuid.test(c.claim||'')||c.checkoutAllowed!==true)throw fault('INVALID_CHECKOUT_CLAIM');
   let url;
   try{
    const checkout=await gateway.initialize(validateSnapshot(c));
    if(checkout?.reference!==reference)throw fault('INVALID_CHECKOUT_RESPONSE',502);
    url=checkoutUrl(checkout.authorizationUrl);
   }catch(e){
    // If the update itself fails, the started claim still blocks another attempt.
    await rpc('finishCheckout',{p_ref:reference,p_claim:c.claim,p_url:null});
    throw fault(errorCode(e),e?.status===403?403:503);
   }
   const done=await rpc('finishCheckout',{p_ref:reference,p_claim:c.claim,p_url:url});
   if(done?.owned!==true||done.state!=='ready')throw fault('CHECKOUT_INITIALIZATION_UNCERTAIN',409);
   const current=await snapshot(token,reference);
   if(current.checkoutAllowed!==true)throw fault('CHECKOUT_UNAVAILABLE',409);
   return {reference,authorizationUrl:url};
  },
  async confirmOrder(token,reference){return verifyAndApply(await snapshot(token,reference));},
  async receiveWebhook(raw,signature){
   const event=decodeVerifiedPaystackWebhookV1(raw,signature,signingSecrets);
   if(event.event!=='charge.success')return {ignored:true};
   const {id,reference,domain}=event.data;
   const validId=(typeof id==='string'&&tx.test(id))||(Number.isSafeInteger(id)&&id>0);
   if(domain!=='test'||!validId||!ref.test(reference||''))throw fault('INVALID_EVENT',422);
   return rpc('enqueue',{p_ref:reference,p_tx:String(id),p_digest:createHash('sha256').update(raw).digest('hex')});
  },
  async drainOne(){
   const claim=await rpc('claim');
   if(claim===null)return {state:'idle'};
   if(!uuid.test(claim?.lease||'')||!tx.test(claim?.transactionId||''))throw fault('INVALID_PAYMENT_LEASE');
   let failure=null;
   try{await verifyAndApply(claim,claim.transactionId);}
   catch(e){failure=errorCode(e);}
   // Separate transactions are intentional: if the process dies after applying
   // a charge, the next lease re-verifies and replays the atomic receipt.
   const result=await rpc('finish',{p_tx:claim.transactionId,p_lease:claim.lease,p_error:failure});
   if(result?.owned!==true)return {state:'superseded'};
   if(!['processed','failed','dead_letter'].includes(result.state))throw fault('INVALID_PAYMENT_LEASE');
   return {state:result.state,...(failure?{code:failure}:{})};
  }
 });
}
export function createConfiguredHostedRecovery(env=process.env,{fetchImpl=fetch}={}){
 if(env.STUDENT_CREATORS_WEEK05_RECOVERY_ENABLED!=='1')throw fault('HOSTED_RECOVERY_DISABLED');
 const c=resolveWeek1ProviderEnvironment(env);
 if(!c.paystack.testKey)throw fault('PAYSTACK_TEST_KEY_REQUIRED');
 const rpc=createHostedPaymentRpc({url:new URL(c.supabase.url).origin,projectRef:env.STUDENT_CREATORS_PROJECT_REF,serverKey:c.supabase.secretKey,fetchImpl});
 const gateway=createPaystackClient({secretKey:c.paystack.testKey,environment:'test',fetchImpl});
 return createHostedTestCommerce({rpc,gateway});
}
