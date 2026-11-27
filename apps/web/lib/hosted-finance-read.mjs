import {readSupabaseRuntimeConfig} from '../../../packages/content-core/src/supabase-runtime-config.mjs';
const REF='jnkqmlbkkvccnxrgkpno';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(status,code)=>Object.assign(Error(code),{status});
const response=(status,body)=>Response.json(body,{status,headers:{'cache-control':'private, no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});
export function financeReadConfig(env){
 if(env.APP_DATA_MODE!=='hosted'||(env.STUDENT_CREATORS_STAGING_APPROVED!=='true'&&env.STUDENT_CREATORS_ENVIRONMENT!=='production')||env.STUDENT_CREATORS_PROJECT_REF!==REF||env.STUDENT_CREATORS_PUBLIC_REGISTRATION!=='false')throw fail(503,'FINANCE_UNAVAILABLE');
 const c=readSupabaseRuntimeConfig(env);
 if(!c||c.url!=='https://'+REF+'.supabase.co')throw fail(503,'FINANCE_UNAVAILABLE');
 const key=c.publishableKey;
 if(/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(key))return c;
 try{if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)||key.length>4096)throw Error();const p=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8'));if(p.role==='anon'&&p.ref===REF)return c;}catch{}
 throw fail(503,'FINANCE_UNAVAILABLE');
}
export function createFinanceReadHandler({env=process.env,fetcher=fetch,config=()=>financeReadConfig(env),lessonId=null}={}){
 return async function GET(request){
  try{
   if(request.method!=='GET')return response(405,{error:'METHOD_NOT_ALLOWED'});
   if(new URL(request.url).search)return response(400,{error:'UNEXPECTED_QUERY'});
   const token=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.get('authorization')||'')?.[1];
   if(!token||token.length>8192)return response(401,{error:'AUTH_REQUIRED'});
   const c=config();const headers={apikey:c.publishableKey,authorization:'Bearer '+token,accept:'application/json'};
   async function read(path,params={},body=null){
    const url=new URL(path,c.url);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
    const r=await fetcher(url,{headers:{...headers,...(body?{'content-type':'application/json'}:{})},method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(r.status===401||r.status===403)throw fail(401,'AUTH_REQUIRED');
    if(!r.ok)throw fail(503,'FINANCE_UNAVAILABLE');
    return r.json();
   }
   const user=await read('/auth/v1/user');
   if(!UUID.test(user?.id??'')||user.is_anonymous===true||!user.email_confirmed_at)return response(401,{error:'AUTH_REQUIRED'});
   // Existing restrictive session RLS on the own-profile read denies a revoked session.
   const profile=await read('/rest/v1/student_profiles',{select:'user_id,suspended',user_id:'eq.'+user.id,limit:'1'});
   if(!Array.isArray(profile)||profile.length!==1||profile[0].user_id!==user.id||profile[0].suspended!==false)return response(403,{error:'ACCOUNT_UNAVAILABLE'});
   if(lessonId!==null){if(!UUID.test(lessonId))return response(404,{error:'CONTENT_UNAVAILABLE'});const rows=await read('/rest/v1/listings',{select:'content_id,price_kobo,currency,state',content_id:'eq.'+lessonId,state:'eq.active',limit:'2'});if(Array.isArray(rows)&&rows.length===0){const access=await read('/rest/v1/rpc/can_view_published_content',{}, {_content_id:lessonId});if(access===true)return response(200,{priceKobo:null,currency:'NGN',accessAvailable:true});return response(404,{error:'CONTENT_UNAVAILABLE'});}if(!Array.isArray(rows)||rows.length!==1||rows[0].content_id!==lessonId||rows[0].state!=='active'||rows[0].currency!=='NGN'||!Number.isSafeInteger(rows[0].price_kobo)||rows[0].price_kobo<20000)return response(404,{error:'CONTENT_UNAVAILABLE'});const access=await read('/rest/v1/rpc/can_view_published_content',{}, {_content_id:lessonId});if(typeof access!=='boolean')throw fail(503,'FINANCE_UNAVAILABLE');return response(200,{priceKobo:access?null:rows[0].price_kobo,currency:'NGN',accessAvailable:access});}
   const [orders,entitlements]=await Promise.all([
    read('/rest/v1/orders',{select:'id,buyer_id,content_id,amount_kobo,currency,environment,status,created_at',buyer_id:'eq.'+user.id,order:'created_at.desc,id.desc',limit:'101'}),
    read('/rest/v1/entitlements',{select:'id,buyer_id,content_id,order_id,state,expires_at',buyer_id:'eq.'+user.id,limit:'1001'})
   ]);
   if(!Array.isArray(orders)||orders.length>101||!Array.isArray(entitlements)||entitlements.length>1000)throw fail(503,'FINANCE_UNAVAILABLE');
   if(orders.some(o=>o.buyer_id!==user.id||!UUID.test(o.id??'')||!UUID.test(o.content_id??'')||o.currency!=='NGN'||!Number.isSafeInteger(o.amount_kobo)||o.amount_kobo<0||!['test','live'].includes(o.environment)||!Number.isFinite(Date.parse(o.created_at))||typeof o.status!=='string')||entitlements.some(e=>e.buyer_id!==user.id||!UUID.test(e.order_id??'')||!UUID.test(e.content_id??'')))throw fail(503,'FINANCE_UNAVAILABLE');
   const own=orders.slice(0,100).map(o=>({id:o.id,contentId:o.content_id,amountKobo:o.amount_kobo,currency:o.currency,environment:o.environment,status:o.status,createdAt:o.created_at,accessRecorded:entitlements.some(e=>e.order_id===o.id&&e.content_id===o.content_id&&e.state==='active'&&(!e.expires_at||Date.parse(e.expires_at)>Date.now()))}));
   return response(200,{orders:own,truncated:orders.length>100});
  }catch(e){const status=[401,403].includes(e.status)?e.status:503;return response(status,{error:status===401?'AUTH_REQUIRED':status===403?'ACCOUNT_UNAVAILABLE':'FINANCE_UNAVAILABLE'});}
 };
}
