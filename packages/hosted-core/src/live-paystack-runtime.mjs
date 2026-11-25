import {createLiveReversalProvider} from './live-reversal-worker.mjs';
import {readLivePaymentConfiguration} from './live-payment-preflight.mjs';
import {createHostedCheckoutHandler,createHostedPaystackWebhook,readPaystackSigningSecrets} from './hosted-paystack-bridge.mjs';
import {createCurrentSupabaseAuth} from './supabase-current-auth.mjs';
import {createPaystackClient} from '../../payment-core/src/paystack-client.mjs';
import {supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';
import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';

const unavailable=()=>new Error('LIVE_PAYMENT_UNAVAILABLE');
export function createLivePaystackRuntime({env=process.env,fetcher=fetch}={}){
 const {key,config:cfg,origin}=readLivePaymentConfiguration(env);
 // Stop new charges independently of verification/settlement of existing charges.
 const checkoutEnabled=env.STUDENT_CREATORS_REAL_PAYMENT_ENABLED==='true'&&env.PAYSTACK_LIVE_PAYMENTS_ENABLED==='1'&&
 env.STUDENT_CREATORS_LIVE_DELIVERY_APPROVED==='true'&&env.STUDENT_CREATORS_LIVE_REVERSAL_APPROVED==='true'&&env.STUDENT_CREATORS_LIVE_PROVIDER_APPROVED==='true';
 const signingSecrets=env.PAYSTACK_LIVE_WEBHOOK_SIGNING_SECRET?readPaystackSigningSecrets({
 PAYSTACK_WEBHOOK_KEY_ID:env.PAYSTACK_LIVE_WEBHOOK_KEY_ID,PAYSTACK_WEBHOOK_SIGNING_SECRET:env.PAYSTACK_LIVE_WEBHOOK_SIGNING_SECRET,
 PAYSTACK_WEBHOOK_PREVIOUS_KEY_ID:env.PAYSTACK_LIVE_WEBHOOK_PREVIOUS_KEY_ID,PAYSTACK_WEBHOOK_PREVIOUS_SIGNING_SECRET:env.PAYSTACK_LIVE_WEBHOOK_PREVIOUS_SIGNING_SECRET}):[];
 if(signingSecrets.some(x=>[env.PAYSTACK_WEBHOOK_SIGNING_SECRET,env.PAYSTACK_WEBHOOK_PREVIOUS_SIGNING_SECRET].includes(x.secret)))throw unavailable();
 const gateway=createPaystackClient({secretKey:key,environment:'live',livePaymentsApproved:checkoutEnabled,fetchImpl:fetcher});
 const auth=createCurrentSupabaseAuth({url:cfg.url,publicKey:cfg.publishableKey,serverKey:cfg.serverKey,requireStudent:true,fetcher});
 async function rpc(name,body){
  const r=await fetcher(new URL('/rest/v1/rpc/'+name,cfg.url),{method:'POST',headers:{...supabaseServerHeaders(cfg.serverKey),'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw unavailable();
  return JSON.parse(await readBoundedGatewayResponse(r,65536,unavailable));
 }
 const store={
  recordReversal:(event,id,digest)=>rpc('enqueue_live_reversal_event',{_event:event,_id:id,_digest:digest}),
  claimReversal:()=>rpc('claim_live_reversal_event',{}),
  finishReversal:(event,id,lease,reason)=>rpc('finish_live_reversal_event',{_event:event,_id:id,_lease:lease,_reason:reason}),
  reversalReceipt:tx=>rpc('live_reversal_receipt',{_tx:tx}),
  applyRefund:(id,lease,tx,amount)=>rpc('apply_live_refund_event',{_id:id,_lease:lease,_tx:tx,_amount:amount}),
  reserve:(buyer,content,idempotency,terms)=>rpc('reserve_live_paystack_checkout',{_buyer:buyer,_content:content,_key:idempotency,_terms:terms}),
  finish:(order,url)=>rpc('finish_live_paystack_checkout',{_order:order,_url:url}),
  canReturn:(buyer,reference,terms)=>rpc('live_paystack_can_return',{_buyer:buyer,_reference:reference,_terms:terms}),
  record:(reference,tx,digest)=>rpc(reference.startsWith('ll_')?'record_live_learning_charge':'record_live_paystack_charge',{_reference:reference,_tx:tx,_digest:digest}),
  claim:async()=>await rpc('claim_live_paystack_charge',{})??await rpc('claim_live_learning_charge',{}),snapshot:reference=>rpc(reference.startsWith('ll_')?'live_learning_order_snapshot':'live_paystack_order_snapshot',{_reference:reference}),
  settle:(k,lease,c)=>k.startsWith('ll:')?(k.slice(3)===c.providerTransactionId?rpc('settle_live_learning_charge',{_tx:c.providerTransactionId,_lease:lease,_amount:c.amountKobo,_fee:c.providerFeeKobo}):Promise.resolve(false)):rpc('settle_live_paystack_charge',{_key:k,_lease:lease,_tx:c.providerTransactionId,_amount:c.amountKobo,_fee:c.providerFeeKobo}),
  retry:(k,lease)=>k.startsWith('ll:')?rpc('retry_live_learning_charge',{_tx:k.slice(3),_lease:lease}):rpc('retry_live_paystack_charge',{_key:k,_lease:lease})
 };
 const learningStore=kind=>({reserve:(buyer,resource,idempotency,terms)=>rpc('reserve_live_learning_checkout',{_buyer:buyer,_kind:kind,_resource:resource,_key:idempotency,_terms:terms}),finish:(order,url)=>rpc('finish_live_learning_checkout',{_order:order,_url:url}),canReturn:(buyer,reference,terms)=>rpc('live_learning_can_return',{_buyer:buyer,_reference:reference,_terms:terms})});
 return {domain:'live',checkoutEnabled,learningCheckoutEnabled:checkoutEnabled&&env.STUDENT_CREATORS_LIVE_LEARNING_PAYMENT_ENABLED==='true',learningStore,origin,auth,store,gateway,signingSecrets,legacySecrets:[key],provider:createLiveReversalProvider({key,fetcher})};
}
export function buildLivePaystackRoute({webhook=false,getEnv=()=>process.env,fetcher=fetch}={}){
 return async (request,context)=>{try{const r=createLivePaystackRuntime({env:getEnv(),fetcher});return webhook?await createHostedPaystackWebhook(r)(request):await createHostedCheckoutHandler(r)(request,context);}
 catch{return Response.json({error:'LIVE_PAYMENT_UNAVAILABLE'},{status:503,headers:{'cache-control':'no-store'}});}};
}

export function buildLiveLearningCheckoutRoute({kind,getEnv=()=>process.env,fetcher=fetch}={}){return async(request,{resourceId}={})=>{try{if(!['class','service'].includes(kind))throw unavailable();const r=createLivePaystackRuntime({env:getEnv(),fetcher});return await createHostedCheckoutHandler({...r,store:r.learningStore(kind),checkoutEnabled:r.learningCheckoutEnabled})(request,{lessonId:resourceId});}catch{return Response.json({error:'LIVE_LEARNING_PAYMENT_UNAVAILABLE'},{status:503,headers:{'cache-control':'no-store'}});}};}
