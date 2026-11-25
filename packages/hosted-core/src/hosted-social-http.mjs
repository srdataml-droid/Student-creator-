/** Server-only, bearer-authenticated social route for explicitly approved staging. */
import {createHostedSocialClient} from './hosted-social-api.mjs';
import {readSupabaseRuntimeConfig} from '../../content-core/src/supabase-runtime-config.mjs';
import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';
const err=(code,status)=>Object.assign(Error(code),{code,status});
const response=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const safeErrors=new Set(['AUTH_REQUIRED','SESSION_NOT_ACTIVE','STUDENT_NOT_ELIGIBLE','VERIFIED_STUDENT_REQUIRED','ADMIN_REQUIRED','INVALID_ID','INVALID_LIMIT','INVALID_INPUT','INVALID_CREATION_KEY','SOCIAL_OPERATION_NOT_FOUND','SOCIAL_ACCESS_DENIED','SOCIAL_NOT_FOUND','SOCIAL_CONFLICT','SOCIAL_RATE_LIMIT','HOSTED_AUTH_UNAVAILABLE','HOSTED_AUTH_CHECK_UNAVAILABLE','HOSTED_SOCIAL_UNAVAILABLE','HOSTED_SOCIAL_DISABLED','INVALID_JSON','JSON_REQUIRED','BODY_TOO_LARGE','ORIGIN_REJECTED','METHOD_NOT_ALLOWED']);
function config(env){
 if(env.APP_DATA_MODE!=='hosted'||env.STUDENT_CREATORS_STAGING_APPROVED!=='true'||env.STUDENT_CREATORS_SOCIAL_STAGING_ENABLED!=='true'||env.STUDENT_CREATORS_PUBLIC_REGISTRATION!=='false'||env.STUDENT_CREATORS_REAL_PAYMENT_ENABLED!=='false'||!/^[a-z0-9]{20}$/.test(env.STUDENT_CREATORS_PROJECT_REF||''))throw err('HOSTED_SOCIAL_DISABLED',503);
 const c=readSupabaseRuntimeConfig(env);
 if(!c||!/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(c.publishableKey))throw err('HOSTED_SOCIAL_DISABLED',503);
 return {projectRef:env.STUDENT_CREATORS_PROJECT_REF,publishableKey:c.publishableKey,url:c.url};
}
export function createHostedSocialHandler({env=process.env,fetchImpl=globalThis.fetch}={}){
 return async function handle(request,name){
  try{
   if(request.method!=='POST')throw err('METHOD_NOT_ALLOWED',405);
   const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
   if(origin&&origin!==new URL(request.url).origin||site&&!['same-origin','none'].includes(site))throw err('ORIGIN_REJECTED',403);
   const c=config(env);
   const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i)?.[1];
   if(!token||token.length>8192)throw err('AUTH_REQUIRED',401);
   if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type')||''))throw err('JSON_REQUIRED',415);
   if(Number(request.headers.get('content-length')||0)>32768)throw err('BODY_TOO_LARGE',413);
   let input;
   try{input=JSON.parse(await readBoundedGatewayResponse(request,32768,()=>err('BODY_TOO_LARGE',413)));}
   catch(e){if(e.code==='BODY_TOO_LARGE')throw e;throw err('INVALID_JSON',400);}
   if(!input||typeof input!=='object'||Array.isArray(input))throw err('INVALID_JSON',400);
   let state;
   async function getState(userId){
    if(!state){
     const result=await fetchImpl(c.url+'/rest/v1/rpc/social_session_state',{method:'POST',headers:{apikey:c.publishableKey,Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},body:'{}',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
     if(result.status===401||result.status===403)return {active:false};
     if(result.status!==200)throw err('HOSTED_AUTH_CHECK_UNAVAILABLE',503);
     state=JSON.parse(await readBoundedGatewayResponse(result,4096,()=>err('HOSTED_AUTH_CHECK_UNAVAILABLE',503)));
     if(!state||state.userId!==userId||['active','student','admin'].some(k=>typeof state[k]!=='boolean'))throw err('HOSTED_AUTH_CHECK_UNAVAILABLE',503);
    }
    return state;
   }
   const client=createHostedSocialClient({...c,fetchImpl,
    isCurrentSession:async({userId})=>(await getState(userId)).active===true,
    authorizeStudent:async({userId})=>(await getState(userId)).student===true,
    authorizeAdmin:async({userId})=>(await getState(userId)).admin===true});
   return response(await client.execute({accessToken:token,operation:name,input}));
  }catch(e){
   const code=safeErrors.has(e?.code)?e.code:'HOSTED_SOCIAL_UNAVAILABLE';
   const status=safeErrors.has(e?.code)&&Number.isInteger(e.status)&&e.status>=400&&e.status<=599?e.status:503;
   return response({error:code},status);
  }
 };
}
