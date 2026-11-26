import {readDedicatedSupabaseRuntimeConfig} from '../../../packages/content-core/src/supabase-runtime-config.mjs';
import {createCurrentSupabaseAuth} from '../../../packages/hosted-core/src/supabase-current-auth.mjs';
import {readBoundedGatewayResponse} from '../../../packages/payment-core/src/bounded-response.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(status,body)=>Response.json(body,{status,headers:{'cache-control':'private, no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});
export function createAccountStateHandler({env=process.env,fetcher=fetch,getConfig=()=>readDedicatedSupabaseRuntimeConfig(env,{server:true}),getAuth=cfg=>createCurrentSupabaseAuth({url:cfg.url,publicKey:cfg.publishableKey,serverKey:cfg.serverKey,fetcher})}={}){
 return async function GET(request){
  try{
   if(request.method!=='GET')return reply(405,{error:'METHOD_NOT_ALLOWED'});
   if(new URL(request.url).search)return reply(400,{error:'UNEXPECTED_QUERY'});
   const token=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.get('authorization')||'')?.[1];
   if(!token||token.length>8192)return reply(401,{error:'AUTH_REQUIRED'});
   const cfg=getConfig();if(!cfg)return reply(503,{error:'ACCOUNT_UNAVAILABLE'});
   const actor=await getAuth(cfg).getUser(token);if(!UUID.test(actor?.id??''))return reply(401,{error:'AUTH_REQUIRED'});
   async function read(path,params={},rpc=false){
    const url=new URL('/rest/v1/'+path,cfg.url);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
    const r=await fetcher(url,{method:rpc?'POST':'GET',headers:{apikey:cfg.publishableKey,authorization:'Bearer '+token,accept:'application/json',...(rpc?{'content-type':'application/json'}:{})},...(rpc?{body:'{}'}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw Error('ACCOUNT_UNAVAILABLE');return JSON.parse(await readBoundedGatewayResponse(r,262144,()=>Error('ACCOUNT_UNAVAILABLE')));
   }
   const state=await read('rpc/social_session_state',{},true);
   if(state?.userId!==actor.id||['active','student','admin'].some(k=>typeof state[k]!=='boolean'))throw Error('INVALID_STATE');
   if(!state.active)return reply(401,{error:'AUTH_REQUIRED'});
   const [profile,requests,drafts,creatorProfile]=await Promise.all([
    read('student_profiles',{select:'user_id,display_name,institution_id,verified_at,suspended',user_id:'eq.'+actor.id,limit:1}),
    read('verification_requests',{select:'id,user_id,method,status,expires_at,created_at',user_id:'eq.'+actor.id,order:'created_at.desc',limit:20}),
    read('content_items',{select:'id,creator_id,title,description,preview_text,status,course_id,created_at',creator_id:'eq.'+actor.id,order:'created_at.desc',limit:100}),
    read('creator_public_profiles',{select:'user_id,handle,display_name,bio',user_id:'eq.'+actor.id,limit:1})
   ]);
   if(!Array.isArray(creatorProfile)||creatorProfile.length>1||creatorProfile.some(x=>x.user_id!==actor.id)||!Array.isArray(profile)||profile.length>1||!Array.isArray(requests)||requests.length>20||!Array.isArray(drafts)||drafts.length>100||profile.some(x=>x.user_id!==actor.id)||requests.some(x=>x.user_id!==actor.id||!UUID.test(x.id??''))||drafts.some(x=>x.creator_id!==actor.id||!UUID.test(x.id??'')))throw Error('INVALID_ACCOUNT');
   const p=profile[0];return reply(200,{userId:actor.id,student:state.student,admin:state.admin,profile:p?{displayName:p.display_name,institutionId:p.institution_id,verifiedAt:p.verified_at,suspended:p.suspended}:null,creatorProfile:creatorProfile[0]?{handle:creatorProfile[0].handle,displayName:creatorProfile[0].display_name,bio:creatorProfile[0].bio}:null,requests:requests.map(x=>({id:x.id,method:x.method,status:x.status,expiresAt:x.expires_at,createdAt:x.created_at})),drafts:drafts.map(x=>({id:x.id,title:x.title,description:x.description,previewText:x.preview_text,status:x.status,courseId:x.course_id,createdAt:x.created_at}))});
  }catch{return reply(503,{error:'ACCOUNT_UNAVAILABLE'});}
 };
}
