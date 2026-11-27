import {randomUUID} from 'node:crypto';
import {readLivePaymentConfiguration} from './live-payment-preflight.mjs';
import {createCurrentSupabaseAuth} from './supabase-current-auth.mjs';
import {createPayoutBankProvider} from './payout-bank-provider.mjs';
import {sealPayoutBank,openPayoutBank} from './payout-bank-crypto.mjs';
import {supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';
import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';

const fault=(status,code)=>Object.assign(Error(code),{status,code});
const unavailable=()=>fault(503,'PAYOUT_BANK_UNAVAILABLE');
const reply=(status,data)=>Response.json(data,{status,headers:{'cache-control':'private, no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const recipient=/^RCP_[A-Za-z0-9]{8,80}$/;
const evidence=/^[A-Za-z0-9_.:-]{8,128}$/;
const jwt=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const staffActions=new Set(['queue','details','review','register','recover']);
const allowed=Object.freeze({submit:['bankCode','accountNumber','consent'],status:[],cancel:['id'],queue:[],details:['id'],review:['id','decision','evidence'],register:['id'],recover:['id','recipientCode']});
const safeErrors=new Set(['PAYOUT_BANK_UNAVAILABLE','BANK_FORBIDDEN','BANK_CONFLICT','BANK_INVALID','REGISTRATION_NOT_APPROVED']);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
function getSession(token,actor){try{const c=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));return c.sub===actor&&uuid.test(c.session_id??'')?c.session_id:null;}catch{return null;}}
function buildRuntime(env,fetcher,staff){
 if(env.STUDENT_CREATORS_PAYOUT_BANK_ONBOARDING_ENABLED!=='true'||env.STUDENT_CREATORS_PUBLIC_REGISTRATION!=='false'||env.STUDENT_CREATORS_LIVE_PROVIDER_APPROVED!=='true'||env.STUDENT_CREATORS_PAYOUT_BANK_POLICY_APPROVED!=='true')throw unavailable();
 if(staff&&env.STUDENT_CREATORS_GOVERNANCE_ENABLED!=='true')throw unavailable();
 const secret=env.STUDENT_CREATORS_PAYOUT_BANK_ENCRYPTION_KEY;
 if(typeof secret!=='string'||!/^[a-f0-9]{64}$/i.test(secret))throw unavailable();
 const {key,config,origin}=readLivePaymentConfiguration(env);
 const registrationApproved=staff&&env.STUDENT_CREATORS_PAYOUT_BANK_REGISTRATION_APPROVED==='true';
 const auth=createCurrentSupabaseAuth({url:config.url,publicKey:config.publishableKey,serverKey:config.serverKey,requireStudent:!staff,fetcher});
 const provider=createPayoutBankProvider({key,allowRecipientCreation:registrationApproved,fetcher});
 async function rpc(name,args){
  const res=await fetcher(new URL('/rest/v1/rpc/'+name,config.url),{method:'POST',headers:{...supabaseServerHeaders(config.serverKey),'content-type':'application/json'},body:JSON.stringify(args),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
  const data=JSON.parse(await readBoundedGatewayResponse(res,131072,unavailable));
  if(!res.ok){
   if(data?.code==='42501')throw fault(403,'BANK_FORBIDDEN');
   if(data?.code==='23505')throw fault(409,'BANK_CONFLICT');
   if(['22023','23514'].includes(data?.code))throw fault(422,'BANK_INVALID');
   throw unavailable();
  }
  return data;
 }
 return {origin,secret,registrationApproved,auth,provider,rpc};
}
export function createPayoutBankWorkflowHandler({env=process.env,fetcher=fetch,runtime=buildRuntime,newId=randomUUID}={}){
 return async(request,action)=>{
  if(request.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
  if(!Object.hasOwn(allowed,action))return reply(404,{error:'NOT_FOUND'});
  try{
   const r=runtime(env,fetcher,staffActions.has(action));
   if(request.headers.get('origin')!==r.origin||new URL(request.url).origin!==r.origin)return reply(403,{error:'ORIGIN_FORBIDDEN'});
   const token=request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
   if(!token||token.length>8192||!jwt.test(token))return reply(401,{error:'AUTH_REQUIRED'});
   if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type')??''))return reply(415,{error:'JSON_REQUIRED'});
   let input;try{input=JSON.parse(await readBoundedGatewayResponse(request,1024,unavailable));}catch{return reply(400,{error:'INVALID_INPUT'});}
   if(!exact(input,allowed[action])||(Object.hasOwn(input,'id')&&!uuid.test(input.id??''))||(action==='review'&&(!['approve','reject'].includes(input.decision)||typeof input.evidence!=='string'||!evidence.test(input.evidence))))return reply(422,{error:'INVALID_INPUT'});
   if(action==='submit'&&(input.consent!==true||typeof input.bankCode!=='string'||!/^\d{3,6}$/.test(input.bankCode)||typeof input.accountNumber!=='string'||!/^\d{10}$/.test(input.accountNumber)))return reply(422,{error:'INVALID_INPUT'});
   if(action==='recover'&&(typeof input.recipientCode!=='string'||!recipient.test(input.recipientCode)))return reply(422,{error:'INVALID_INPUT'});
   const user=await r.auth.getUser(token),session=user&&getSession(token,user.id);
   if(!session)return reply(403,{error:'SESSION_REQUIRED'});
   const actor=user.id,base={_actor:actor,_session:session};
   const rpc=(name,args={})=>r.rpc(name,{...base,...args});
   switch(action){
    case 'submit':{
     if(await rpc('admit_creator_bank_lookup',{_kind:'resolve'})!==true)return reply(429,{error:'LOOKUP_NOT_AVAILABLE'});
     const resolved=await r.provider.resolveAccount({bankCode:input.bankCode,accountNumber:input.accountNumber});
     if(resolved.bankCode!==input.bankCode||resolved.accountLast4!==input.accountNumber.slice(-4))throw unavailable();
     const id=newId(),envelope=sealPayoutBank({secret:r.secret,actor,id,value:{bankCode:input.bankCode,accountNumber:input.accountNumber,accountName:resolved.accountName}});
     const result=await rpc('creator_bank_submission',{_id:id,_bank:input.bankCode,_last4:resolved.accountLast4,_envelope:envelope});
     return reply(201,{id:result.id,state:result.state});
    }
    case 'status':return reply(200,await rpc('creator_bank_status'));
    case 'cancel':return await rpc('creator_bank_cancel',{_id:input.id})===true?reply(200,{cancelled:true}):reply(409,{error:'BANK_CONFLICT'});
    case 'queue':return reply(200,{requests:await rpc('staff_bank_queue')});
    case 'details':{
     const result=await rpc('staff_bank_details',{_id:input.id});
     if(result.id!==input.id||!uuid.test(result.creatorId??''))throw unavailable();
     const value=openPayoutBank({secret:r.secret,actor:result.creatorId,id:result.id,envelope:result.envelope});
     return reply(200,{id:result.id,creatorId:result.creatorId,...value});
    }
    case 'review':return await rpc('staff_bank_review',{_id:input.id,_decision:input.decision,_evidence:input.evidence})===true?reply(200,{reviewed:true}):reply(409,{error:'BANK_CONFLICT'});
    case 'register':case 'recover':{
     if(r.registrationApproved!==true)return reply(503,{error:'REGISTRATION_NOT_APPROVED'});
     const claimed=await rpc(action==='recover'?'staff_bank_recovery_claim':'staff_bank_claim',{_id:input.id});
     if(!claimed)return reply(409,{error:'BANK_CONFLICT'});
     if(claimed.id!==input.id||!uuid.test(claimed.lease??'')||!uuid.test(claimed.creatorId??''))throw unavailable();
     let code=null;
     try{
      const value=openPayoutBank({secret:r.secret,actor:claimed.creatorId,id:claimed.id,envelope:claimed.envelope});
      const result=action==='recover'?await r.provider.verifyRecipient({recipientCode:input.recipientCode,bankCode:value.bankCode,accountNumber:value.accountNumber}):await r.provider.createRecipient({bankCode:value.bankCode,accountNumber:value.accountNumber,approvedAccountName:value.accountName});
      if(result?.providerVerified===true&&result.bankCode===value.bankCode&&result.accountLast4===value.accountNumber.slice(-4)&&recipient.test(result.recipientCode??'')&&(action!=='recover'||result.recipientCode===input.recipientCode))code=result.recipientCode;
     }catch{/* uncertain provider operation: no automatic retry */}
     const done=await rpc('staff_bank_finish',{_id:claimed.id,_lease:claimed.lease,_recipient:code});
     return done===true&&code?reply(200,{registered:true}):reply(409,{error:'BANK_REGISTRATION_REVIEW_REQUIRED'});
    }
   }
  }catch(e){
   return safeErrors.has(e?.code)?reply(e.status,{error:e.code}):reply(503,{error:'PAYOUT_BANK_UNAVAILABLE'});
  }
 };
}
