import {supabaseServerHeaders} from './supabase-runtime-config.mjs';
import {prepareReviewSubmission,ContentRuleError} from './content.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const json=(status,payload)=>Response.json(payload,{status,headers:{'cache-control':'no-store'}});
/** POST /api/lessons/:id/submit. This operation takes no client-supplied state. */
export function createReviewSubmissionHandler({auth,store,audit=()=>{}}){
  if(!auth?.getUser||!store?.getProfile||!store?.getContent||!store?.getAssets||!store?.submitIfReady)throw new TypeError('Missing submission dependencies');
  return async (request,{lessonId}={})=>{
    if(request.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
    if(!UUID.test(lessonId??''))return json(400,{error:'INVALID_LESSON'});
    if(Number(request.headers.get('content-length')??0)>0)return json(400,{error:'UNEXPECTED_BODY'});
    // A client can stream without Content-Length; fail if an unexpected body exists.
    if(request.body){let reader=request.body.getReader();try{const {value,done}=await reader.read();if(!done||value?.length)return json(400,{error:'UNEXPECTED_BODY'});}catch{return json(400,{error:'UNEXPECTED_BODY'});}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
    const token=/^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization')??'')?.[1];
    if(!token)return json(401,{error:'AUTH_REQUIRED'});
    const correlationId=crypto.randomUUID();
    try{
      const user=await auth.getUser(token);
      if(!UUID.test(user?.id??''))return json(401,{error:'AUTH_REQUIRED'});
      const profile=await store.getProfile(user.id);
      if(!profile?.verifiedAt||profile.suspended||!UUID.test(profile.institutionId??''))return json(403,{error:'CAMPUS_VERIFICATION_REQUIRED'});
      const item=await store.getContent(lessonId);
      if(!item)return json(404,{error:'LESSON_NOT_FOUND'});
      if(item.creatorId!==user.id||item.institutionId!==profile.institutionId)return json(403,{error:'FORBIDDEN'});
      if(item.status==='in_review')return json(200,{lesson:{id:lessonId,status:'in_review'},replayed:true});
      if(!['draft','rejected'].includes(item.status))return json(409,{error:'INVALID_STATE'});
      const assets=await store.getAssets(lessonId);
      try{prepareReviewSubmission({actor:{id:user.id,institutionId:profile.institutionId,verifiedAt:profile.verifiedAt,suspended:false},item,assets});}
      catch(e){if(e instanceof ContentRuleError){const status=e.code==='ASSET_NOT_READY'?422:e.code==='FORBIDDEN'?403:409;return json(status,{error:e.code});}throw e;}
      // RPC enforces the ready-assets predicate again inside the UPDATE.
      const updated=await store.submitIfReady({lessonId,creatorId:user.id,expectedStatus:item.status});
      if(!updated)return json(409,{error:'SUBMISSION_CONFLICT'});
      try{audit({event:'lesson.review.submitted',contentId:lessonId,creatorId:user.id,correlationId});}catch{}
      return json(200,{lesson:{id:lessonId,status:'in_review'},replayed:false});
    }catch{
      try{audit({event:'lesson.review.error',correlationId});}catch{}
      return json(503,{error:'SERVICE_UNAVAILABLE',correlationId});
    }
  };
}

/** Server-only Supabase REST adapter. Requires staged submit_content_for_review RPC. */
export function createSupabaseSubmissionDependencies({url,publicKey,serverKey,fetcher=fetch,authFactory}){
 if(!url||!publicKey||!serverKey||typeof fetcher!=='function')throw Error('Missing Supabase configuration');
 if(typeof authFactory!=='function')throw new TypeError('Missing auth adapter');
 const base=new URL(url);
 if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))throw Error('Supabase must use HTTPS');
 const db=async(table,params={})=>{
  const u=new URL(`/rest/v1/${table}`,base);
  for(const [k,v]of Object.entries(params))u.searchParams.set(k,v);
  const r=await fetcher(u,{headers:{...supabaseServerHeaders(serverKey)},redirect:'error'});
  if(!r.ok)throw Error('Database unavailable');return r.json();
 };
 return {
  auth:authFactory({url,publicKey,serverKey,fetcher,requireStudent:true}),
  store:{
   async getProfile(id){const r=(await db('student_profiles',{user_id:`eq.${id}`,select:'institution_id,verified_at,suspended',limit:'1'}))[0];return r?{institutionId:r.institution_id,verifiedAt:r.verified_at,suspended:r.suspended}:null;},
   async getContent(id){const r=(await db('content_items',{id:`eq.${id}`,select:'id,creator_id,institution_id,status',limit:'1'}))[0];return r?{id:r.id,creatorId:r.creator_id,institutionId:r.institution_id,status:r.status}:null;},
   async getAssets(contentId){const rows=await db('content_assets',{content_id:`eq.${contentId}`,select:'content_id,private_object_key,processing_status,scan_verdict',limit:'13'});return rows.map(r=>({contentId:r.content_id,privateObjectKey:r.private_object_key,processingStatus:r.processing_status,scanVerdict:r.scan_verdict}));},
   async submitIfReady({lessonId,creatorId,expectedStatus}){
    const u=new URL('/rest/v1/rpc/submit_content_for_review',base);
    const r=await fetcher(u,{method:'POST',headers:{...supabaseServerHeaders(serverKey),'content-type':'application/json'},body:JSON.stringify({_content_id:lessonId,_creator_id:creatorId,_expected_status:expectedStatus}),redirect:'error'});
    if(!r.ok)throw Error('Submission RPC unavailable');
    return (await r.json())===true;
   }
  }
 };
}
