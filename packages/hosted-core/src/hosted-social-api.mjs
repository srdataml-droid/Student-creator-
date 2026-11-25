/**
 * Server-only hosted social adapter. Uses the student's own verified bearer
 * for every PostgREST call; never a service key. Week 1/2 must supply live
 * session and current-student checks. This factory is not a deployed route.
 */
import {verifyCurrentStudentBearer} from './supabase-student-auth.mjs';
import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';
const fault=(code,status)=>Object.assign(Error(code),{code,status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=v=>{if(typeof v!=='string'||!uuid.test(v))throw fault('INVALID_ID',422);return v;};
const optionalId=v=>v==null?null:id(v);
const integer=(v,max,def)=>{if(v==null)return def;if(!Number.isInteger(v)||v<1||v>max)throw fault('INVALID_LIMIT',422);return v;};
const string=(v,min,max)=>{if(typeof v!=='string'||v.trim().length<min||v.trim().length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v))throw fault('INVALID_INPUT',422);return v.trim();};
const bool=v=>{if(typeof v!=='boolean')throw fault('INVALID_INPUT',422);return v;};
const choice=(v,options)=>{if(!options.includes(v))throw fault('INVALID_INPUT',422);return v;};
const shape=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw fault('INVALID_INPUT',422);return v;};
const key=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(v))throw fault('INVALID_CREATION_KEY',422);return v;};
const rpc=(name,args)=>({path:'rpc/'+name,method:'POST',body:args});
const select=(name,fields,filters={})=>({path:name+'?'+new URLSearchParams({select:fields,...filters}),method:'GET'});
const readIds=v=>{if(!Array.isArray(v)||v.length<1||v.length>100||new Set(v).size!==v.length)throw fault('INVALID_INPUT',422);return v.map(id);};
const rateMessages=new Set(['MESSAGE_RATE_LIMIT','POST_RATE_LIMIT','COMMENT_RATE_LIMIT','FOLLOW_RATE_LIMIT','REPORT_RATE_LIMIT']);
function mapError(status,data){
 if(status===401)return fault('AUTH_REQUIRED',401);
 if(status===403||data?.code==='42501')return fault('SOCIAL_ACCESS_DENIED',403);
 if(data?.code==='P0002')return fault('SOCIAL_NOT_FOUND',404);
 if(status===409||data?.code==='23505')return fault('SOCIAL_CONFLICT',409);
 if(['22023','22P02','23514'].includes(data?.code))return fault('INVALID_INPUT',422);
 if(status===429||data?.code==='P0001'&&rateMessages.has(data.message))return fault('SOCIAL_RATE_LIMIT',429);
 return fault('HOSTED_SOCIAL_UNAVAILABLE',503);
}
function operation(name,input,actor){
 switch(name){
 case 'feed':case 'search':case 'creators':{
  const b=shape(input,['mode','q','institutionId','courseId','topicId','limit']);
  return rpc('social_discover',{_mode:name==='creators'?'creators':choice(b.mode??'all',['all','following']),_q:string(b.q??'',0,80),_institution:optionalId(b.institutionId),_course:optionalId(b.courseId),_topic:optionalId(b.topicId),_limit:integer(b.limit,100,60)});
 }
 case 'follow':case 'unfollow':{
  const b=shape(input,['creatorId']);return rpc('social_follow_action',{_creator:id(b.creatorId),_enabled:name==='follow'});
 }
 case 'inbox':{
  const b=shape(input,['before','limit']);return rpc('social_inbox_page',{_before:optionalId(b.before),_limit:integer(b.limit,50,50)});
 }
 case 'thread':{
  const b=shape(input,['peerId','before','limit']);return rpc('social_thread_page',{_peer:id(b.peerId),_before:optionalId(b.before),_limit:integer(b.limit,100,100)});
 }
 case 'send':{
  const b=shape(input,['peerId','text']);return rpc('social_message_action',{_action:'send',_peer:id(b.peerId),_body:string(b.text,1,2000)});
 }
 case 'readMessages':{
  const b=shape(input,['peerId','messageIds']);return rpc('social_message_action',{_action:'read',_peer:id(b.peerId),_ids:readIds(b.messageIds)});
 }
 case 'block':case 'unblock':{
  const b=shape(input,['peerId']);return rpc('social_message_action',{_action:name,_peer:id(b.peerId)});
 }
 case 'messagePreference':{
  const b=shape(input,['allowMessages']);return rpc('social_message_action',{_action:'preference',_enabled:bool(b.allowMessages)});
 }
 case 'getMessagePreference':shape(input,[]);return select('social_message_preferences','allow_messages',{user_id:'eq.'+actor,limit:'1'});
 case 'communityStatus':case 'joinCommunity':case 'leaveCommunity':{
  const b=shape(input,['courseId']);return rpc('social_community_action',{_action:{communityStatus:'status',joinCommunity:'join',leaveCommunity:'leave'}[name],_course:id(b.courseId),_input:{}});
 }
 case 'communityPosts':{
  const b=shape(input,['courseId','limit']);return select('social_community_posts','id,course_id,author_id,topic_id,parent_id,body,created_at',{course_id:'eq.'+id(b.courseId),order:'created_at.desc,id.desc',limit:String(integer(b.limit,100,100))});
 }
 case 'communityPost':{
  const b=shape(input,['courseId','text','creationKey','replyTo','topicId']);return rpc('social_community_action',{_action:'post',_course:id(b.courseId),_input:{text:string(b.text,3,2000),creationKey:key(b.creationKey),replyTo:optionalId(b.replyTo),topicId:optionalId(b.topicId)}});
 }
 case 'communityHide':case 'communityReport':{
  const b=shape(input,['courseId','postId','reason']);return rpc('social_community_action',{_action:name==='communityHide'?'hide':'report',_course:id(b.courseId),_input:{postId:id(b.postId),reason:string(b.reason,name==='communityHide'?5:10,1000)}});
 }
 case 'comments':{
  const b=shape(input,['contentId','limit']);return select('content_comments','id,content_id,author_id,parent_id,body,created_at',{content_id:'eq.'+id(b.contentId),order:'created_at.desc,id.desc',limit:String(integer(b.limit,50,50))});
 }
 case 'comment':{
  const b=shape(input,['contentId','text','creationKey','replyTo']);return rpc('social_comment_action',{_action:'post',_content:id(b.contentId),_input:{text:string(b.text,3,800),creationKey:key(b.creationKey),replyTo:optionalId(b.replyTo)}});
 }
 case 'removeComment':case 'reportComment':{
  const b=shape(input,name==='removeComment'?['contentId','commentId']:['contentId','commentId','reason']);
  return rpc('social_comment_action',{_action:name==='removeComment'?'remove':'report',_content:id(b.contentId),_input:{commentId:id(b.commentId),...(name==='reportComment'?{reason:string(b.reason,10,1000)}:{})}});
 }
 case 'like':case 'unlike':{
  const b=shape(input,['contentId']),contentId=id(b.contentId);
  // RLS is still evaluated for the user's own signed token.
  return name==='like'?{path:'content_likes?on_conflict=user_id,content_id',method:'POST',body:{user_id:actor,content_id:contentId},prefer:'resolution=ignore-duplicates,return=minimal'}:{path:'content_likes?'+new URLSearchParams({user_id:'eq.'+actor,content_id:'eq.'+contentId}),method:'DELETE',prefer:'return=minimal'};
 }
 case 'notifications':{
  const b=shape(input,['limit']);return select('social_notifications','id,kind,target_id,created_at,read_at',{order:'created_at.desc,id.desc',limit:String(integer(b.limit,100,100))});
 }
 case 'notificationPreferences':shape(input,[]);return rpc('social_notification_action',{_action:'preferences',_input:{}});
 case 'updateNotificationPreferences':{
  const b=shape(input,['messages','social','community']);return rpc('social_notification_action',{_action:'preferences',_input:{messages:bool(b.messages),social:bool(b.social),community:bool(b.community)}});
 }
 case 'readNotification':{
  const b=shape(input,['id']);return rpc('social_notification_action',{_action:'read',_input:{id:id(b.id)}});
 }
 case 'reportAccount':case 'reportMessage':{
  const b=shape(input,['targetId','category','reason']);return rpc('social_abuse_report',{_kind:name==='reportAccount'?'account':'message',_target:id(b.targetId),_category:choice(b.category,['harassment','impersonation','spam','other']),_reason:string(b.reason,10,1000)});
 }
 default:throw fault('SOCIAL_OPERATION_NOT_FOUND',404);
 }
}
export function createHostedSocialClient({projectRef,publishableKey,isCurrentSession,authorizeStudent,fetchImpl=globalThis.fetch}={}){
 return Object.freeze({
  async execute({accessToken,operation:name,input={}}={}){
   const verified=await verifyCurrentStudentBearer({accessToken,projectRef,publishableKey,isCurrentSession,authorizeStudent,fetchImpl});
   const request=operation(name,input,verified.userId);
   const headers={apikey:publishableKey,Authorization:'Bearer '+accessToken,Accept:'application/json',...(request.body!==undefined?{'Content-Type':'application/json'}:{}),...(request.prefer?{Prefer:request.prefer}:{})};
   let response;
   try{response=await fetchImpl('https://'+projectRef+'.supabase.co/rest/v1/'+request.path,{method:request.method,headers,...(request.body!==undefined?{body:JSON.stringify(request.body)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});}
   catch{throw fault('HOSTED_SOCIAL_UNAVAILABLE',503);}
   if(response?.status===204)return {ok:true};
   let payload;
   try{const raw=await readBoundedGatewayResponse(response,1048576,()=>fault('HOSTED_SOCIAL_UNAVAILABLE',503));payload=raw?JSON.parse(raw):null;}
   catch{throw fault('HOSTED_SOCIAL_UNAVAILABLE',503);}
   if(response.status<200||response.status>=300)throw mapError(response.status,payload);
   return payload??{ok:true};
  }
 });
}
