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
  reserve:(buyer,content,idempotency,terms)=>rpc('reserve_live_paystack_checkout',{_buyer:buyer,_content:content,_key:idempotency,_terms:terms}),
  finish:(order,url)=>rpc('finish_live_paystack_checkout',{_order:order,_url:url}),
  canReturn:(buyer,reference,terms)=>rpc('live_paystack_can_return',{_buyer:buyer,_reference:reference,_terms:terms}),
  record:(reference,tx,digest)=>rpc('record_live_paystack_charge',{_reference:reference,_tx:tx,_digest:digest}),
  claim:()=>rpc('claim_live_paystack_charge',{}),snapshot:reference=>rpc('live_paystack_order_snapshot',{_reference:reference}),
  settle:(k,lease,c)=>rpc('settle_live_paystack_charge',{_key:k,_lease:lease,_tx:c.providerTransactionId,_amount:c.amountKobo,_fee:c.providerFeeKobo}),
  retry:(k,lease)=>rpc('retry_live_paystack_charge',{_key:k,_lease:lease})
 };
 return {domain:'live',checkoutEnabled,origin,auth,store,gateway,signingSecrets,legacySecrets:[key]};
}
export function buildLivePaystackRoute({webhook=false,getEnv=()=>process.env,fetcher=fetch}={}){
 return async (request,context)=>{try{const r=createLivePaystackRuntime({env:getEnv(),fetcher});return webhook?await createHostedPaystackWebhook(r)(request):await createHostedCheckoutHandler(r)(request,context);}
 catch{return Response.json({error:'LIVE_PAYMENT_UNAVAILABLE'},{status:503,headers:{'cache-control':'no-store'}});}};
}
