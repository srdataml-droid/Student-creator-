import {readLivePaymentConfiguration} from './live-payment-preflight.mjs';
import {supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';
import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';
const unavailable=()=>new Error('PAYOUT_TRANSFER_UNAVAILABLE');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reference=/^pt_[a-f0-9]{32}$/;
const recipient=/^RCP_[A-Za-z0-9]{8,80}$/;
const providerCode=/^TRF_[A-Za-z0-9]{8,80}$/;
const statuses=new Set(['pending','otp','success','failed','reversed']);
const amount=x=>Number.isSafeInteger(x)&&x>0;
const jobValid=j=>j&&uuid.test(j.id??'')&&uuid.test(j.lease??'')&&reference.test(j.reference??'')&&recipient.test(j.recipientCode??'')&&amount(j.amountKobo)&&typeof j.dispatch==='boolean';
export function createPaystackTransferProvider({key,fetcher=fetch}={}){
 if(typeof key!=='string'||!/^sk_live_[A-Za-z0-9]+$/.test(key))throw unavailable();
 async function call(path,body){
  const res=await fetcher(new URL(path,'https://api.paystack.co'),{method:body?'POST':'GET',headers:{authorization:'Bearer '+key,accept:'application/json',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!res.ok)throw unavailable();
  const json=JSON.parse(await readBoundedGatewayResponse(res,262144,unavailable));
  if(json?.status!==true||!json.data||typeof json.data!=='object'||Array.isArray(json.data))throw unavailable();return json.data;
 }
 return {
  async initiate(j){
   if(!jobValid(j)||j.dispatch!==true)throw unavailable();
   // POST acknowledgment is not evidence of payment; only GET verification
   // can produce a status observation, and bank reconciliation is separate.
   await call('/transfer',{source:'balance',currency:'NGN',amount:j.amountKobo,recipient:j.recipientCode,reference:j.reference,reason:'Creator earnings payout'});
  },
  async verify(j){
   if(!jobValid(j))throw unavailable();
   const d=await call('/transfer/verify/'+j.reference);
   if(d.reference!==j.reference||d.domain!=='live'||d.currency!=='NGN'||d.source!=='balance'||d.amount!==j.amountKobo||d.recipient?.recipient_code!==j.recipientCode||d.recipient?.domain!=='live'||d.recipient?.currency!=='NGN'||!providerCode.test(d.transfer_code??'')||!statuses.has(d.status))throw unavailable();
   const fee=d.fee_charged??null;
   if(fee!==null&&(!Number.isSafeInteger(fee)||fee<0)||d.status==='success'&&fee===null)throw unavailable();
   return {status:d.status,code:d.transfer_code,fee};
  }
 };
}
export async function processPayoutTransfer({store,provider,allowDispatch=false}={}){
 const j=await store.claim(allowDispatch===true);
 if(j===null)return {state:'empty'};
 if(!jobValid(j)||j.dispatch&&allowDispatch!==true)throw unavailable();
 if(j.dispatch){try{await provider.initiate(j);}catch{/* A possibly accepted POST is never retried. */}}
 let observation={status:'unknown',code:null,fee:null};
 try{observation=await provider.verify(j);}catch{/* Keep reservation; retry only verification. */}
 if(await store.record(j,observation)!==true)throw unavailable();
 return {state:observation.status==='unknown'||observation.status==='pending'?'retry':observation.status==='success'?'processed':'review'};
}
export function buildPayoutTransferWorker({env=process.env,fetcher=fetch}={}){
 if(env.STUDENT_CREATORS_PAYOUT_TRANSFER_WORKER_ENABLED!=='true')throw unavailable();
 const {key,config}=readLivePaymentConfiguration(env);
 const allowDispatch=env.STUDENT_CREATORS_PAYOUT_TRANSFER_APPROVED==='true'&&env.STUDENT_CREATORS_LIVE_PROVIDER_APPROVED==='true';
 async function rpc(name,body){
  const res=await fetcher(new URL('/rest/v1/rpc/'+name,config.url),{method:'POST',headers:{...supabaseServerHeaders(config.serverKey),'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!res.ok)throw unavailable();return JSON.parse(await readBoundedGatewayResponse(res,65536,unavailable));
 }
 const store={claim:allow=>rpc('claim_payout_transfer',{_allow_dispatch:allow}),record:(j,o)=>rpc('record_payout_transfer_observation',{_id:j.id,_lease:j.lease,_status:o.status,_code:o.code,_fee:o.fee})};
 const provider=createPaystackTransferProvider({key,fetcher});
 return ()=>processPayoutTransfer({store,provider,allowDispatch});
}
