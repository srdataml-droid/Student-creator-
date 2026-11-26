import {readLivePaymentConfiguration} from './live-payment-preflight.mjs';
import {supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';
import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';
const error=()=>new Error('SETTLEMENT_AUDIT_UNAVAILABLE');
const states=['matched','unrecorded','ambiguous','mismatch','reversed','review'];
const int=x=>Number.isSafeInteger(x)&&x>=0;
function id(x){const s=typeof x==='number'&&Number.isSafeInteger(x)?String(x):x;if(typeof s!=='string'||! /^[1-9][0-9]{0,19}$/.test(s)||BigInt(s)>18446744073709551615n)throw error();return s;}
function date(s){if(typeof s!=='string'||! /^\d{4}-\d{2}-\d{2}$/.test(s))throw error();const t=Date.parse(s+'T00:00:00Z');if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==s)throw error();return t;}
async function readJson(response,max){if(!response.ok)throw error();return JSON.parse(await readBoundedGatewayResponse(response,max,error));}
export async function auditPaystackSettlement({settlementId,from,to,env=process.env,fetcher=fetch}={}){
 try{
  const target=id(settlementId),start=date(from),end=date(to);
  if(end<start||end-start>31*86400000)throw error();
  const {key,config}=readLivePaymentConfiguration(env);
  async function pages(path,extra={}){
   const result=[],seen=new Set();let expected;
   for(let page=1;page<=20;page++){
    const url=new URL(path,'https://api.paystack.co');url.search=new URLSearchParams({...extra,perPage:'50',page:String(page)});
    const body=await readJson(await fetcher(url,{method:'GET',headers:{Authorization:'Bearer '+key,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)}),2097152);
    const m=body?.meta;
    if(body?.status!==true||!Array.isArray(body.data)||body.data.length>50||!m||!int(m.total)||m.total>1000||m.page!==page||m.perPage!==50||!int(m.pageCount)||m.pageCount!==Math.max(1,Math.ceil(m.total/50))&&!(m.total===0&&m.pageCount===0))throw error();
    if(expected===undefined)expected=m.total;if(m.total!==expected)throw error();
    for(const item of body.data){const x=id(item?.id);if(seen.has(x))throw error();seen.add(x);result.push(item);}
    if(page>=m.pageCount){if(result.length!==expected)throw error();return result;}
    if(body.data.length!==50)throw error();
   }
   throw error();
  }
  const settlements=await pages('/settlement',{status:'success',subaccount:'none',from,to});
  const settlement=settlements.find(x=>id(x.id)===target);
  if(!settlement||settlement.domain!=='live'||settlement.currency!=='NGN'||settlement.status!=='success'||!int(settlement.total_processed)||!int(settlement.total_fees)||!int(settlement.effective_amount))throw error();
  const transactions=await pages('/settlement/'+target+'/transactions');
  const items=transactions.map(x=>{if(x.domain!=='live'||x.currency!=='NGN'||x.status!=='success'||typeof x.reference!=='string'||! /^[A-Za-z0-9._-]{1,128}$/.test(x.reference)||!int(x.amount)||x.amount===0||!int(x.fees)||x.fees>x.amount)throw error();return {transactionId:id(x.id),reference:x.reference,amountKobo:String(x.amount),feeKobo:String(x.fees)};});
  const counts=Object.fromEntries(states.map(s=>[s,0]));
  for(let i=0;i<items.length;i+=50){
   const batch=items.slice(i,i+50);
   const response=await fetcher(new URL('/rest/v1/rpc/audit_live_settlement_receipts',config.url),{method:'POST',headers:{...supabaseServerHeaders(config.serverKey),'content-type':'application/json'},body:JSON.stringify({_items:batch}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
   const result=await readJson(response,32768);
   if(states.some(s=>!int(result?.[s]))||states.reduce((n,s)=>n+result[s],0)!==batch.length||result.bankCreditVerified!==false||result.withdrawalEnabled!==false)throw error();
   for(const state of states)counts[state]+=result[state];
  }
  const gross=items.reduce((n,x)=>n+BigInt(x.amountKobo),0n),fees=items.reduce((n,x)=>n+BigInt(x.feeKobo),0n);
  return {providerReportedSuccess:true,transactionCount:items.length,counts,providerTotalsMatch:gross===BigInt(settlement.total_processed)&&fees===BigInt(settlement.total_fees),bankCreditVerified:false,withdrawalEnabled:false};
 }catch{throw error();}
}
