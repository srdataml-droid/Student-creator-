import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';
import {readLivePaymentConfiguration} from './live-payment-preflight.mjs';

const failure=()=>Object.assign(new Error('PAYOUT_BANK_PROVIDER_UNAVAILABLE'),{code:'PAYOUT_BANK_PROVIDER_UNAVAILABLE'});
const invalid=()=>Object.assign(new Error('INVALID_PAYOUT_BANK_INPUT'),{code:'INVALID_PAYOUT_BANK_INPUT'});
const codeOk=v=>typeof v==='string'&&/^\d{3,6}$/.test(v);
const accountOk=v=>typeof v==='string'&&/^\d{10}$/.test(v);
const recipientOk=v=>typeof v==='string'&&/^RCP_[A-Za-z0-9]{8,80}$/.test(v);
const nameOk=v=>typeof v==='string'&&v.trim().length>0&&v.length<=180&&!/[\x00-\x1f\x7f]/.test(v);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);

// Server-only provider adapter. Recipient creation is separately gated.
// This module never moves funds, attests ownership or writes the database.
export function createPayoutBankProvider({key,environment='live',allowRecipientCreation=false,fetcher=fetch}={}){
 if(!['live','test'].includes(environment)||typeof key!=='string'||!new RegExp('^sk_'+environment+'_[A-Za-z0-9]+$').test(key))throw failure();
 async function call(path,params={},payload){
  try{
   const url=new URL(path,'https://api.paystack.co');
   url.search=new URLSearchParams(params).toString();
   const response=await fetcher(url,{method:payload===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,Accept:'application/json',...(payload===undefined?{}:{'content-type':'application/json'})},...(payload===undefined?{}:{body:JSON.stringify(payload)}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
   if(!response.ok)throw failure();
   const body=JSON.parse(await readBoundedGatewayResponse(response,262144,failure));
   if(!object(body)||body.status!==true)throw failure();
   return body;
  }catch{throw failure();}
 }
 const get=(path,params)=>call(path,params);
 const sameName=(a,b)=>a.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en')===b.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
 const provider={
  // Use cursor pagination instead of silently truncating the bank catalog.
  async listBanks(){
   const banks=new Map(),seen=new Set();
   let cursor=null;
   for(let page=0;page<20;page++){
    const body=await get('/bank',{country:'nigeria',currency:'NGN',type:'nuban',use_cursor:'true',perPage:'100',...(cursor?{next:cursor}:{})});
    if(!Array.isArray(body.data)||body.data.length>100||!object(body.meta)||!Object.hasOwn(body.meta,'next'))throw failure();
    for(const row of body.data){
     if(!object(row))throw failure();
     if(row.active!==true||row.is_deleted===true||row.currency!=='NGN'||row.type!=='nuban'||typeof row.country!=='string'||row.country.toLowerCase()!=='nigeria')continue;
     if(!codeOk(row.code)||!nameOk(row.name))throw failure();
     const bank={code:row.code,name:row.name.trim()};
     if(banks.has(bank.code)&&banks.get(bank.code).name!==bank.name)throw failure();
     banks.set(bank.code,bank);
    }
    const next=body.meta.next;
    if(next===null){if(!banks.size)throw failure();return [...banks.values()].sort((a,b)=>a.name.localeCompare(b.name,'en')||a.code.localeCompare(b.code));}
    if(typeof next!=='string'||!/^[-_A-Za-z0-9+/=]{1,512}$/.test(next)||seen.has(next))throw failure();
    seen.add(next);cursor=next;
   }
   throw failure();
  },
  // Resolving an account name is not proof the student owns that account.
  async resolveAccount({bankCode,accountNumber}={}){
   if(!codeOk(bankCode)||!accountOk(accountNumber))throw invalid();
   const {data}=await get('/bank/resolve',{account_number:accountNumber,bank_code:bankCode});
   if(!object(data)||data.account_number!==accountNumber||!nameOk(data.account_name))throw failure();
   return {bankCode,accountLast4:accountNumber.slice(-4),accountName:data.account_name.trim()};
  },
  // Only an independently approved, durable server workflow may call this.
  // approvedAccountName is verified evidence from that workflow, not browser input.
  async createRecipient({bankCode,accountNumber,approvedAccountName}={}){
   if(allowRecipientCreation!==true)throw failure();
   if(!codeOk(bankCode)||!accountOk(accountNumber)||!nameOk(approvedAccountName))throw invalid();
   const resolved=await provider.resolveAccount({bankCode,accountNumber});
   if(!sameName(resolved.accountName,approvedAccountName))throw failure();
   // A duplicate may return an existing record; always verify it independently.
   // A failed/uncertain response must be investigated by the durable caller,
   // not retried automatically or treated as authorization to transfer funds.
   const {data}=await call('/transferrecipient',{}, {type:'nuban',name:resolved.accountName,account_number:accountNumber,bank_code:bankCode,currency:'NGN'});
   if(!object(data)||!recipientOk(data.recipient_code)||data.domain!==environment||data.currency!=='NGN'||data.type!=='nuban'||data.active!==true||data.is_deleted===true||!object(data.details)||data.details.account_number!==accountNumber||data.details.bank_code!==bankCode)throw failure();
   return provider.verifyRecipient({recipientCode:data.recipient_code,bankCode,accountNumber});
  },
  // Only a trusted reviewer/server workflow may supply the expected account.
  // Never use a browser-supplied recipient code as verified payout evidence.
  async verifyRecipient({recipientCode,bankCode,accountNumber}={}){
   if(!recipientOk(recipientCode)||!codeOk(bankCode)||!accountOk(accountNumber))throw invalid();
   const {data}=await get('/transferrecipient/'+recipientCode);
   if(!object(data)||data.recipient_code!==recipientCode||data.domain!==environment||data.currency!=='NGN'||data.type!=='nuban'||data.active!==true||data.is_deleted===true||!object(data.details)||data.details.account_number!==accountNumber||data.details.bank_code!==bankCode)throw failure();
   return {recipientCode,bankCode,accountLast4:accountNumber.slice(-4),providerVerified:true};
  }
 };
 return Object.freeze(provider);
}

export function buildLivePayoutBankProvider({env=process.env,fetcher=fetch}={}){
 if(env.STUDENT_CREATORS_PAYOUT_BANK_ONBOARDING_ENABLED!=='true')throw failure();
 const {key}=readLivePaymentConfiguration(env);
 return createPayoutBankProvider({key,environment:'live',fetcher});
}
