import {readLivePaymentConfiguration} from './live-payment-preflight.mjs';
import {createCurrentSupabaseAuth} from './supabase-current-auth.mjs';
import {createPayoutBankProvider} from './payout-bank-provider.mjs';
import {supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';
import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';
const unavailable=()=>new Error('PAYOUT_BANK_UNAVAILABLE');
const reply=(status,data)=>Response.json(data,{status,headers:{'cache-control':'private, no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});
const jwt=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function sessionId(token,actor){
 // Read claims only after the exact token was verified by Supabase Auth.
 try{const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));return claims.sub===actor&&uuid.test(claims.session_id??'')?claims.session_id:null;}catch{return null;}
}
function runtime(env,fetcher){
 if(env.STUDENT_CREATORS_PAYOUT_BANK_ONBOARDING_ENABLED!=='true'||env.STUDENT_CREATORS_PUBLIC_REGISTRATION!=='false'||env.STUDENT_CREATORS_LIVE_PROVIDER_APPROVED!=='true')throw unavailable();
 const {key,config,origin}=readLivePaymentConfiguration(env);
 const auth=createCurrentSupabaseAuth({url:config.url,publicKey:config.publishableKey,serverKey:config.serverKey,requireStudent:true,fetcher});
 const provider=createPayoutBankProvider({key,fetcher});
 return {origin,auth,provider,async admit(actor,session,kind){
  const res=await fetcher(new URL('/rest/v1/rpc/admit_creator_bank_lookup',config.url),{method:'POST',headers:{...supabaseServerHeaders(config.serverKey),'content-type':'application/json'},body:JSON.stringify({_actor:actor,_session:session,_kind:kind}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!res.ok)throw unavailable();
  const result=JSON.parse(await readBoundedGatewayResponse(res,1024,unavailable));
  if(typeof result!=='boolean')throw unavailable();
  return result;
 }};
}
export function createPayoutBankHandler({env=process.env,fetcher=fetch,buildRuntime=runtime}={}){
 return async(request,action)=>{
  if(request.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
  if(!['banks','resolve'].includes(action))return reply(404,{error:'NOT_FOUND'});
  try{
   const {origin,auth,provider,admit}=buildRuntime(env,fetcher);
   if(request.headers.get('origin')!==origin||new URL(request.url).origin!==origin)return reply(403,{error:'ORIGIN_FORBIDDEN'});
   const token=request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
   if(!token||token.length>8192||!jwt.test(token))return reply(401,{error:'AUTH_REQUIRED'});
   if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type')??''))return reply(415,{error:'JSON_REQUIRED'});
   let input;
   try{input=JSON.parse(await readBoundedGatewayResponse(request,1024,unavailable));}catch{return reply(400,{error:'INVALID_INPUT'});}
   if(!object(input)||Object.keys(input).some(k=>!(action==='banks'?[]:['bankCode','accountNumber','consent']).includes(k)))return reply(422,{error:'INVALID_INPUT'});
   if(action==='resolve'&&(input.consent!==true||typeof input.bankCode!=='string'||!/^\d{3,6}$/.test(input.bankCode)||typeof input.accountNumber!=='string'||!/^\d{10}$/.test(input.accountNumber)))return reply(422,{error:'INVALID_INPUT'});
   const user=await auth.getUser(token);
   const session=user&&sessionId(token,user.id);
   if(!session)return reply(403,{error:'STUDENT_SESSION_REQUIRED'});
   if(await admit(user.id,session,action)!==true)return reply(429,{error:'LOOKUP_NOT_AVAILABLE'});
   if(action==='banks')return reply(200,{banks:await provider.listBanks()});
   const result=await provider.resolveAccount({bankCode:input.bankCode,accountNumber:input.accountNumber});
   // No browser-supplied ownership declaration, recipient code or payout
   // evidence is accepted. This is solely a name resolution preview.
   return reply(200,{bankCode:result.bankCode,accountLast4:result.accountLast4,accountName:result.accountName,ownershipVerified:false});
  }catch{return reply(503,{error:'PAYOUT_BANK_UNAVAILABLE'});}
 };
}
