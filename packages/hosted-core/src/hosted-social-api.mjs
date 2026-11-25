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
const adminOperations=new Set(['setCommunityModerator','reportQueue','reviewReport']);
const rateMessages=new Set(['MESSAGE_RATE_LIMIT','POST_RATE_LIMIT','COMMENT_RATE_LIMIT','FOLLOW_RATE_LIMIT','REPORT_RATE_LIMIT','RESTRICTION_RATE_LIMIT','LIKE_RATE_LIMIT']);
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
 case 'creatorRestrictions':shape(input,[]);return select('creator_restrictions','viewer_id,deny_view,deny_comment,deny_message,updated_at',{creator_id:'eq.'+actor,order:'updated_at.desc',limit:'250'});
 case 'setCreatorRestrictions':{
  const b=shape(input,['viewerId','view','comment','message']);return rpc('social_set_creator_restriction',{_viewer:id(b.viewerId),_view:bool(b.view),_comment:bool(b.comment),_message:bool(b.message)});
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
 case 'myLikes':shape(input,[]);return select('content_likes','content_id,created_at',{user_id:'eq.'+actor,order:'created_at.desc',limit:'250'});
 case 'isFollowing':{
  const b=shape(input,['creatorId']);return select('social_creator_follows','creator_id',{follower_id:'eq.'+actor,creator_id:'eq.'+id(b.creatorId),limit:'1'});
 }
 case 'following':shape(input,[]);return select('social_creator_follows','creator_id',{follower_id:'eq.'+actor,order:'created_at.desc',limit:'250'});
 case 'like':case 'unlike':{
  const b=shape(input,['contentId']);return rpc('social_like_action',{_content:id(b.contentId),_enabled:name==='like'});
 }
 case 'bookmarks':{const b=shape(input,['limit']);return select('content_bookmarks','content_id,created_at',{order:'created_at.desc,content_id.desc',limit:String(integer(b.limit,100,50))});}
 case 'bookmark':case 'unbookmark':{const b=shape(input,['contentId']);return rpc('social_bookmark_action',{_content:id(b.contentId),_enabled:name==='bookmark'});}
 case 'classes':{
  const b=shape(input,['courseId','limit']);return select('interactive_classes','id,institution_id,course_id,host_id,title,description,starts_at,ends_at,capacity,price_kobo,currency,status',{...(b.courseId?{course_id:'eq.'+id(b.courseId)}:{}),order:'starts_at.asc,id.asc',limit:String(integer(b.limit,100,50))});
 }
 case 'createClass':{
  const b=shape(input,['courseId','startsAt','endsAt','capacity','title','description','creationKey','priceKobo']);
  if(b.priceKobo!==undefined&&b.priceKobo!==0)throw fault('INVALID_INPUT',422);
  return rpc('hosted_learning_action',{_action:'create_class',_input:{courseId:id(b.courseId),startsAt:string(b.startsAt,20,35),endsAt:string(b.endsAt,20,35),capacity:integer(b.capacity,50,12),title:string(b.title,5,120),description:string(b.description??'',0,1200),creationKey:key(b.creationKey),priceKobo:0}});
 }
 case 'enrollClass':case 'withdrawClass':case 'openClass':case 'completeClass':{
  const b=shape(input,['classId']);return rpc('hosted_learning_action',{_action:{enrollClass:'enroll',withdrawClass:'withdraw',openClass:'open',completeClass:'complete'}[name],_input:{classId:id(b.classId)}});
 }
 case 'cancelClass':case 'removeClassParticipant':{
  const b=shape(input,name==='cancelClass'?['classId','reason']:['classId','studentId','reason']);
  return rpc('hosted_learning_action',{_action:name==='cancelClass'?'cancel':'remove_participant',_input:{classId:id(b.classId),reason:string(b.reason,8,500),...(name==='removeClassParticipant'?{studentId:id(b.studentId)}:{})}});
 }
 case 'classEnrollments':case 'classAttendance':{
  const b=shape(input,['classId','limit']);return select(name==='classEnrollments'?'interactive_class_enrollments':'interactive_class_presence',name==='classEnrollments'?'class_id,student_id,state,created_at,updated_at':'class_id,user_id,kind,created_at',{class_id:'eq.'+id(b.classId),order:'created_at.desc',limit:String(integer(b.limit,100,50))});
 }
 case 'learningRequests':{
  const b=shape(input,['limit']);return select('personal_learning_requests','id,institution_id,student_id,creator_id,kind,description,budget_kobo,quote_kobo,state,created_at,updated_at',{order:'created_at.desc,id.desc',limit:String(integer(b.limit,100,50))});
 }
 case 'requestHelp':{
  const b=shape(input,['creatorId','kind','description','budgetKobo','creationKey']);if(b.budgetKobo!==undefined&&(!Number.isSafeInteger(b.budgetKobo)||b.budgetKobo<0||b.budgetKobo>1000000000))throw fault('INVALID_INPUT',422);
  return rpc('hosted_learning_action',{_action:'request_help',_input:{creatorId:id(b.creatorId),kind:choice(b.kind,['tutoring','assignment_explanation','project_guidance']),description:string(b.description,20,2000),budgetKobo:b.budgetKobo??0,creationKey:key(b.creationKey)}});
 }
 case 'quoteHelp':case 'acceptHelp':{
  const b=shape(input,['requestId','quoteKobo']);if(!Number.isSafeInteger(b.quoteKobo)||b.quoteKobo<0||b.quoteKobo>1000000000)throw fault('INVALID_INPUT',422);
  return rpc('hosted_learning_action',{_action:name==='quoteHelp'?'quote_help':'accept_help',_input:{requestId:id(b.requestId),quoteKobo:b.quoteKobo}});
 }
 case 'startHelp':case 'submitHelp':case 'completeHelp':case 'cancelHelp':case 'disputeHelp':{
  const b=shape(input,name==='disputeHelp'?['requestId','reason']:['requestId']);return rpc('hosted_learning_action',{_action:{startHelp:'start_help',submitHelp:'submit_help',completeHelp:'complete_help',cancelHelp:'cancel_help',disputeHelp:'dispute_help'}[name],_input:{requestId:id(b.requestId),...(name==='disputeHelp'?{reason:string(b.reason,10,1000)}:{})}});
 }
 case 'learningNotifications':{const b=shape(input,['limit']);return select('learning_notifications','id,kind,resource_id,body,created_at,seen_at',{order:'created_at.desc,id.desc',limit:String(integer(b.limit,100,50))});}
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
 case 'setCommunityModerator':{
  const b=shape(input,['courseId','userId','enabled','reason']);return rpc('social_community_action',{_action:'role',_course:id(b.courseId),_input:{userId:id(b.userId),enabled:bool(b.enabled),reason:string(b.reason,5,1000)}});
 }
 case 'reportQueue':{
  const b=shape(input,['kind','limit']);return rpc('social_report_queue',{_kind:choice(b.kind,['message','account','comment','community']),_limit:integer(b.limit,100,100)});
 }
 case 'reviewReport':{
  const b=shape(input,['kind','id','decision','reason']),kind=choice(b.kind,['message','account','comment','community']);
  return rpc('social_review_report',{_kind:kind,_id:id(b.id),_decision:choice(b.decision,['account','message'].includes(kind)?['review']:['hide','dismiss']),_reason:string(b.reason,5,1000)});
 }
 default:throw fault('SOCIAL_OPERATION_NOT_FOUND',404);
 }
}
export function createHostedSocialClient({projectRef,publishableKey,isCurrentSession,authorizeStudent,authorizeAdmin,fetchImpl=globalThis.fetch}={}){
 return Object.freeze({
  async execute({accessToken,operation:name,input={}}={}){
   const staff=adminOperations.has(name);
   // The shared verifier checks identity/session and a trusted authorization predicate.
   // Staff are not required to be enrolled students: use the independent admin predicate.
   let verified;
   try{verified=await verifyCurrentStudentBearer({accessToken,projectRef,publishableKey,isCurrentSession,authorizeStudent:staff?authorizeAdmin:authorizeStudent,fetchImpl});}
   catch(e){if(staff&&e.code==='STUDENT_NOT_ELIGIBLE')throw fault('ADMIN_REQUIRED',403);throw e;}
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
