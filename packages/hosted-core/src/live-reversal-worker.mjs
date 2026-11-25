import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';
const fail=()=>new Error('REVERSAL_PROVIDER_UNAVAILABLE');
export const reversalEvents=new Set(['refund.processed','charge.dispute.create','charge.dispute.remind','charge.dispute.resolve']);
export function providerId(value){
 const s=typeof value==='number'&&Number.isSafeInteger(value)?String(value):typeof value==='string'?value:'';
 return /^[1-9][0-9]{0,19}$/.test(s)?s:null;
}
const referenceId=/^(lc_[0-9a-f]{32}):[0-9a-f]{64}$/;
export function validReversalId(event,id){return providerId(id)===id||(event==='refund.processed'&&typeof id==='string'&&referenceId.test(id));}
export function createLiveReversalProvider({key,fetcher=fetch}={}){
 if(!/^sk_live_[A-Za-z0-9]+$/.test(key??''))throw fail();
 async function read(path){
  const r=await fetcher('https://api.paystack.co/'+path,{method:'GET',headers:{Authorization:'Bearer '+key,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw fail();
  const b=JSON.parse(await readBoundedGatewayResponse(r,262144,fail));
  if(b?.status!==true||!b.data)throw fail();
  return b.data;
 }
 return async(event,id)=>{
  if(event==='refund.processed'&&referenceId.test(id)){
   const reference=id.split(':')[0];
   const charge=await read('transaction/verify/'+reference);
   const tx=providerId(charge.id);
   if(!tx||charge.reference!==reference||charge.domain!=='live'||charge.currency!=='NGN'||!['success','reversed'].includes(charge.status)||!Number.isSafeInteger(charge.amount)||charge.amount<=0)throw fail();
   const rows=await read('refund?transaction='+tx+'&currency=NGN&perPage=100&page=1');
   if(!Array.isArray(rows)||rows.length>=100)throw fail();
   let total=0;const seen=new Set();
   for(const row of rows){
    const rid=providerId(row.id);
    if(!rid||seen.has(rid)||providerId(typeof row.transaction==='object'?row.transaction?.id:row.transaction)!==tx||row.domain!=='live'||row.currency!=='NGN'||!Number.isSafeInteger(row.amount)||row.amount<=0)throw fail();
    seen.add(rid);
    if(row.status==='processed'){total+=row.amount;if(!Number.isSafeInteger(total)||total>charge.amount)throw fail();}
   }
   if(total===0)throw fail();
   return {domain:'live',currency:'NGN',status:'processed',amount:total,transaction:tx,verifiedReference:reference,verifiedChargeAmount:charge.amount};
  }
  if(!reversalEvents.has(event)||providerId(id)!==id)throw fail();
  const path=event==='refund.processed'?'refund':'dispute';
  const r=await fetcher('https://api.paystack.co/'+path+'/'+id,{method:'GET',headers:{Authorization:'Bearer '+key,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw fail();
  const b=JSON.parse(await readBoundedGatewayResponse(r,262144,fail));
  if(b?.status!==true||!b.data||providerId(b.data.id)!==id)throw fail();
  return b.data;
 };
}
export async function processLiveReversal({store,provider}){
 const e=await store.claimReversal();if(!e)return {state:'empty'};
 if(!reversalEvents.has(e.event)||!validReversalId(e.event,e.id)||!(/^[0-9a-f-]{36}$/i).test(e.lease??''))throw fail();
 const finish=async reason=>{if(await store.finishReversal(e.event,e.id,e.lease,reason)!==true)throw fail();return {state:['PROVIDER_UNAVAILABLE','RECEIPT_NOT_FOUND'].includes(reason)?'retry':'review',reason};};
 let d;try{d=await provider(e.event,e.id);}catch{return finish('PROVIDER_UNAVAILABLE');}
 if(e.event!=='refund.processed')return finish(d.domain==='live'?'DISPUTE_REVIEW':'PROVIDER_EVIDENCE_REVIEW');
 if(d.domain!=='live'||d.status!=='processed'||d.currency!=='NGN'||!Number.isSafeInteger(d.amount)||d.amount<=0)return finish('PROVIDER_EVIDENCE_REVIEW');
 const tx=providerId(typeof d.transaction==='object'?d.transaction?.id:d.transaction);
 if(!tx)return finish('PROVIDER_EVIDENCE_REVIEW');
 const receipt=await store.reversalReceipt(tx);
 if(!receipt)return finish('RECEIPT_NOT_FOUND');
 if(receipt.domain!=='live'||receipt.transactionId!==tx||!Number.isSafeInteger(receipt.amountKobo)||!/^lc_[0-9a-f]{32}$/.test(receipt.reference??''))return finish('PROVIDER_EVIDENCE_REVIEW');
 if(referenceId.test(e.id)&&(d.verifiedReference!==receipt.reference||d.verifiedReference!==e.id.split(':')[0]||d.verifiedChargeAmount!==receipt.amountKobo))return finish('PROVIDER_EVIDENCE_REVIEW');
 if(d.amount!==receipt.amountKobo)return finish(d.amount<receipt.amountKobo?'PARTIAL_REFUND_REVIEW':'PROVIDER_EVIDENCE_REVIEW');
 try{if(await store.applyRefund(e.id,e.lease,tx,d.amount)!==true)throw fail();}catch{return finish('REVERSAL_CONFLICT');}
 return {state:'processed'};
}
