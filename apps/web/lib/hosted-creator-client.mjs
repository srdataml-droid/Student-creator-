const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=v=>{if(typeof v!=='string'||!UUID.test(v))throw Error('INVALID_ID');return v;};
const fail=(code,status)=>Object.assign(Error(code),{status});
export function validateIdentityFile(file){
 if(!file||!['image/jpeg','image/png','application/pdf'].includes(file.type)||file.size<8||file.size>4194304)throw Error('INVALID_IDENTITY_FILE');
 return file;
}
export function validateVideoFile(file){
 if(!file||file.type!=='video/mp4'||!Number.isSafeInteger(file.size)||file.size<1||file.size>100*1024*1024)throw Error('INVALID_VIDEO_FILE');
 return file;
}
export function validateUploadDestination(value){
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!u.search||!(u.hostname==='storage.googleapis.com'||u.hostname.endsWith('.storage.googleapis.com')||u.hostname.endsWith('.mux.com')||u.hostname.endsWith('.amazonaws.com')))throw Error('INVALID_UPLOAD_DESTINATION');
 return u.href;
}
export function hostedCreatorRequest(operation,input={}){
 const json=(path,body,extra={})=>({path,method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json',...extra}});
 switch(operation){
 case 'draft':{
  const {courseId,title,description,previewText,rightsAttested,creationKey}=input;
  if(typeof creationKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(creationKey))throw Error('INVALID_DRAFT_KEY');
  if(typeof title!=='string'||title.trim().length<3||title.length>160||typeof description!=='string'||description.length>2500||typeof previewText!=='string'||previewText.length>800||rightsAttested!==true)throw Error('INVALID_DRAFT');
  return json('/api/lessons/drafts',{courseId:id(courseId),title:title.trim(),description:description.trim(),previewText:previewText.trim(),rightsAttested:true},{'idempotency-key':creationKey});
 }
 case 'identity':{const file=validateIdentityFile(input.file);return {path:'/api/identity/evidence/'+id(input.requestId),method:'POST',body:file,headers:{'content-type':file.type}};}
 case 'restrictions':return json('/api/social/creatorRestrictions',{});
 case 'setRestrictions':{
  if(['view','comment','message'].some(k=>typeof input[k]!=='boolean'))throw Error('INVALID_RESTRICTIONS');
  return json('/api/social/setCreatorRestrictions',{viewerId:id(input.viewerId),view:input.view,comment:input.comment,message:input.message});
 }
 case 'messagePreference':return json('/api/social/getMessagePreference',{});
 case 'setMessagePreference':{
  if(typeof input.allowMessages!=='boolean')throw Error('INVALID_PREFERENCE');
  return json('/api/social/messagePreference',{allowMessages:input.allowMessages});
 }
 case 'muxStatus':return {path:'/api/lessons/'+id(input.lessonId)+'/mux-upload',method:'GET',headers:{}};
 case 'muxReserve':return {path:'/api/lessons/'+id(input.lessonId)+'/mux-upload',method:'POST',headers:{}};
 case 'submitReview':return {path:'/api/lessons/'+id(input.lessonId)+'/submit',method:'POST',headers:{}};
 case 'moderate':return json('/api/lessons/'+id(input.lessonId)+'/moderate',{decision:choice(input.decision,['approve','reject']),reason:bounded(input.reason,5,1000)});
 case 'thumbnail':return {path:'/api/lessons/'+id(input.lessonId)+'/mux-thumbnail',method:'GET',headers:{}};
 case 'playback':return {path:'/api/lessons/'+id(input.lessonId)+'/mux-playback',method:'GET',headers:{}};
 case 'feed':{const q=bounded(input.q??'',0,80);if(q.length===1)throw Error('INVALID_TEXT');return json('/api/social/feed',{mode:choice(input.mode??'all',['all','following']),q,limit:60,...(input.institutionId?{institutionId:id(input.institutionId)}:{}),...(input.courseId?{courseId:id(input.courseId)}:{})});}
 case 'follow':case 'unfollow':return json('/api/social/'+operation,{creatorId:id(input.creatorId)});
 case 'myLikes':return json('/api/social/myLikes',{});
 case 'like':case 'unlike':return json('/api/social/'+operation,{contentId:id(input.contentId)});
 case 'comments':return json('/api/social/comments',{contentId:id(input.contentId),limit:50});
 case 'comment':return json('/api/social/comment',{contentId:id(input.contentId),text:bounded(input.text,3,800),creationKey:key(input.creationKey),replyTo:input.replyTo?id(input.replyTo):null});
 case 'inbox':return json('/api/social/inbox',{before:input.before?id(input.before):null,limit:50});
 case 'thread':return json('/api/social/thread',{peerId:id(input.peerId),before:input.before?id(input.before):null,limit:100});
 case 'send':return json('/api/social/send',{peerId:id(input.peerId),text:bounded(input.text,1,2000)});
 case 'readMessages':{if(!Array.isArray(input.messageIds)||input.messageIds.length<1||input.messageIds.length>100||new Set(input.messageIds).size!==input.messageIds.length)throw Error('INVALID_IDS');return json('/api/social/readMessages',{peerId:id(input.peerId),messageIds:input.messageIds.map(id)});}
 case 'block':case 'unblock':return json('/api/social/'+operation,{peerId:id(input.peerId)});
 case 'notifications':return json('/api/social/notifications',{limit:100});
 case 'readNotification':return json('/api/social/readNotification',{id:id(input.id)});
 case 'reportMessage':return json('/api/social/reportMessage',{targetId:id(input.targetId),category:choice(input.category,['harassment','impersonation','spam','other']),reason:bounded(input.reason,10,1000)});
 case 'communityStatus':case 'joinCommunity':case 'leaveCommunity':return json('/api/social/'+operation,{courseId:id(input.courseId)});
 case 'communityPosts':return json('/api/social/communityPosts',{courseId:id(input.courseId),limit:100});
 case 'communityPost':return json('/api/social/communityPost',{courseId:id(input.courseId),text:bounded(input.text,3,2000),creationKey:key(input.creationKey),replyTo:input.replyTo?id(input.replyTo):null,topicId:null});
 case 'communityReport':return json('/api/social/communityReport',{courseId:id(input.courseId),postId:id(input.postId),reason:bounded(input.reason,10,1000)});
 case 'classGrant':return {path:'/api/classes/'+id(input.classId)+'/hosted-room-token',method:'POST',headers:{}};
 case 'checkout':return {path:'/api/lessons/'+id(input.lessonId)+'/hosted-checkout',method:'POST',headers:{'idempotency-key':key(input.creationKey)}};
 case 'liveCheckout':{if(!/^[A-Za-z0-9._-]{3,128}$/.test(input.termsVersion||''))throw Error('INVALID_TERMS_VERSION');return {path:'/api/lessons/'+id(input.lessonId)+'/live-checkout',method:'POST',headers:{'idempotency-key':key(input.creationKey),'x-student-creators-terms-version':input.termsVersion}};}
 case 'checkoutQuote':return {path:'/api/account/checkout-quote/'+id(input.lessonId),method:'GET',headers:{}};
 case 'purchaseHistory':return {path:'/api/account/purchases',method:'GET',headers:{}};
 case 'isBookmarked':return json('/api/social/isBookmarked',{contentId:id(input.contentId)});
 case 'bookmarks':return json('/api/social/bookmarks',{limit:100});
 case 'bookmark':case 'unbookmark':return json('/api/social/'+operation,{contentId:id(input.contentId)});
 case 'myPayouts':return json('/api/social/myPayouts',{});
 case 'requestPayout':{if(!Number.isSafeInteger(input.amountKobo)||input.amountKobo<1)throw Error('INVALID_AMOUNT');return json('/api/social/requestPayout',{amountKobo:input.amountKobo,requestKey:key(input.requestKey)});}
 case 'cancelPayout':return json('/api/social/cancelPayout',{requestId:id(input.requestId)});
 case 'myCommunities':return json('/api/social/myCommunities',{});
 case 'availableClasses':return json('/api/social/availableClasses',{limit:100,...(input.classId?{classId:id(input.classId)}:{})});
 case 'classes':return json('/api/social/classes',{limit:100});
 case 'createClass':{const {startsAt,endsAt,capacity}=input;if(!Number.isFinite(Date.parse(startsAt))||Date.parse(endsAt)<=Date.parse(startsAt)||!Number.isInteger(capacity)||capacity<1||capacity>50)throw Error('INVALID_CLASS');if(input.priceKobo!==undefined&&(!Number.isSafeInteger(input.priceKobo)||input.priceKobo<20000||input.priceKobo>1000000000))throw Error('INVALID_PRICE');return json('/api/social/createClass',{courseId:id(input.courseId),title:bounded(input.title,5,120),description:bounded(input.description??'',0,1200),startsAt,endsAt,capacity,creationKey:key(input.creationKey),...(input.priceKobo===undefined?{}:{priceKobo:input.priceKobo})});}
 case 'enrollClass':case 'withdrawClass':case 'openClass':case 'completeClass':return json('/api/social/'+operation,{classId:id(input.classId)});
 case 'cancelClass':return json('/api/social/cancelClass',{classId:id(input.classId),reason:bounded(input.reason,8,500)});
 case 'mediaSourceStatus':return {path:'/api/lessons/'+id(input.lessonId)+'/media-source',method:'GET',headers:{}};
 case 'mediaSourceReserve':{if(!['video/mp4','video/webm'].includes(input.mime)||!Number.isSafeInteger(input.bytes)||input.bytes<12||input.bytes>104857600||! /^[a-f0-9]{64}$/.test(input.digest))throw Error('INVALID_MEDIA');return json('/api/lessons/'+id(input.lessonId)+'/media-source',{action:'reserve',mime:input.mime,bytes:input.bytes,digest:input.digest});}
 case 'mediaSourceComplete':return json('/api/lessons/'+id(input.lessonId)+'/media-source',{action:'complete',id:id(input.sourceId)});
 case 'accountState':return {path:'/api/account/state',method:'GET',headers:{}};
 case 'draftFormat':return json('/api/social/draftFormat',{contentId:id(input.contentId)});
 case 'setDraftFormat':return json('/api/social/setDraftFormat',{contentId:id(input.contentId),format:choice(input.format,['video','short'])});
 case 'isLiked':return json('/api/social/isLiked',{contentId:id(input.contentId)});
 case 'draftPrice':return json('/api/social/draftPrice',{contentId:id(input.contentId)});
 case 'setDraftPrice':{if(!Number.isSafeInteger(input.amountKobo)||input.amountKobo<0||input.amountKobo>1000000000||(input.amountKobo>0&&input.amountKobo<20000))throw Error('INVALID_PRICE');return json('/api/social/setDraftPrice',{contentId:id(input.contentId),amountKobo:input.amountKobo});}
 case 'liveClassCheckout':{if(!/^[A-Za-z0-9._-]{3,128}$/.test(input.termsVersion||''))throw Error('INVALID_TERMS_VERSION');return {path:'/api/classes/'+id(input.classId)+'/live-checkout',method:'POST',headers:{'idempotency-key':key(input.creationKey),'x-student-creators-terms-version':input.termsVersion}};}
 case 'classEnrollments':return json('/api/social/classEnrollments',{classId:id(input.classId),limit:100});
 case 'removeClassParticipant':return json('/api/social/removeClassParticipant',{classId:id(input.classId),studentId:id(input.studentId),reason:bounded(input.reason,8,500)});
 case 'saveCreatorProfile':return json('/api/social/saveCreatorProfile',{handle:bounded(input.handle,3,24),displayName:bounded(input.displayName,3,60),bio:bounded(input.bio??'',0,280)});
 case 'editDraft':{if(input.rightsAttested!==true)throw Error('INVALID_DRAFT');return json('/api/social/editDraft',{contentId:id(input.contentId),title:bounded(input.title,3,160),description:bounded(input.description??'',0,2500),previewText:bounded(input.previewText??'',0,800),rightsAttested:true});}
 case 'institutionAppeals':case 'privacyRequests':return json('/api/social/'+operation,{});
 case 'submitInstitutionAppeal':return json('/api/social/submitInstitutionAppeal',{reason:bounded(input.reason,20,800)});
 case 'submitPrivacyRequest':return json('/api/social/submitPrivacyRequest',{kind:choice(input.kind,['access','correction','erasure','restriction','portability']),reason:bounded(input.reason,20,1000)});
 case 'isFollowing':return json('/api/social/isFollowing',{creatorId:id(input.creatorId)});
 default:throw Error('UNKNOWN_CREATOR_OPERATION');
 }
}
export async function putMuxVideo({url,file,fetcher=fetch,signal}){
 const destination=validateUploadDestination(url);validateVideoFile(file);
 const response=await fetcher(destination,{method:'PUT',body:file,headers:{'content-type':'video/mp4'},credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',signal});
 if(!response.ok)throw fail('VIDEO_TRANSFER_UNCONFIRMED',response.status);
 return true;
}
export function readMuxStatus(data){
 const row=data?.upload;
 if(!row||!UUID.test(row.id||'')||!['initializing','waiting','processing','ready','errored','cancelled','timed_out','deleted','unsafe'].includes(row.state))throw Error('INVALID_UPLOAD_RESPONSE');
 return {id:row.id,state:row.state,...(row.state==='waiting'&&row.uploadUrl?{uploadUrl:validateUploadDestination(row.uploadUrl)}:{})};
}

function bounded(v,min,max){if(typeof v!=='string'||v.trim().length<min||v.trim().length>max)throw Error('INVALID_TEXT');return v.trim();}
function choice(v,values){if(!values.includes(v))throw Error('INVALID_CHOICE');return v;}
function key(v){if(typeof v!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(v))throw Error('INVALID_KEY');return v;}
export function validatePlaybackGrant(data,now=Math.floor(Date.now()/1000)){
 const u=new URL(data?.url);
 if(u.origin!=='https://stream.mux.com'||u.username||u.password||u.hash||!/^\/[A-Za-z0-9_-]{6,128}\.m3u8$/.test(u.pathname)||[...u.searchParams.keys()].length!==1||! /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(u.searchParams.get('token')||'')||!Number.isSafeInteger(data.expiresAt)||data.expiresAt<=now||data.expiresAt>now+900)throw Error('INVALID_PLAYBACK_GRANT');
 return {url:u.href,expiresAt:data.expiresAt};
}
export function mergePrivateMessages(previous,incoming,actor,peer){
 if(!Array.isArray(incoming))throw Error('INVALID_THREAD');
 const map=new Map();
 for(const row of [...previous,...incoming]){
 if(!UUID.test(row?.id||'')||!((row.senderId===actor&&row.recipientId===peer)||(row.senderId===peer&&row.recipientId===actor))||typeof row.body!=='string'||!Number.isFinite(Date.parse(row.createdAt)))throw Error('INVALID_THREAD');
 map.set(row.id,row);
 }
 return [...map.values()].sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.id.localeCompare(b.id));
}

export function readCheckoutResult(data){
 if(!UUID.test(data?.orderId??''))throw Error('INVALID_CHECKOUT_RESPONSE');
 if(data.authorizationUrl!==undefined){
  const raw=data.authorizationUrl;
  if(typeof raw!=='string'||raw.length>2048||/[\\\s]/.test(raw))throw Error('INVALID_CHECKOUT_URL');
  const u=new URL(raw);
  if(u.protocol!=='https:'||!['checkout.paystack.com','paystack.com'].includes(u.hostname)||u.username||u.password||u.port||u.hash)throw Error('INVALID_CHECKOUT_URL');
  return {orderId:data.orderId,authorizationUrl:u.href};
 }
 if(typeof data.status!=='string'||!/^[a-z_]{2,40}$/.test(data.status))throw Error('INVALID_CHECKOUT_RESPONSE');
 return {orderId:data.orderId,status:data.status};
}
export function readClassGrant(data,classId,now=Math.floor(Date.now()/1000)){
 if(data?.classId!==id(classId)||!['host','participant'].includes(data.role)||typeof data.token!=='string'||data.token.length>8192||! /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data.token)||typeof data.expiresAt!=='string')throw Error('INVALID_CLASS_GRANT');
 const expiry=Date.parse(data.expiresAt)/1000;if(!Number.isSafeInteger(expiry)||expiry<=now||expiry>now+900)throw Error('INVALID_CLASS_GRANT');
 const u=new URL(data.url);
 if(u.protocol!=='wss:'||!u.hostname.endsWith('.livekit.cloud')||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash)throw Error('INVALID_CLASS_URL');
 return {url:u.origin,token:data.token,role:data.role,expiresAt:expiry};
}
export function readCommunityPosts(rows,courseId){
 if(!Array.isArray(rows)||rows.length>100)throw Error('INVALID_COMMUNITY_RESPONSE');
 return rows.map(r=>{if(!UUID.test(r?.id??'')||r.course_id!==id(courseId)||typeof r.body!=='string'||!Number.isFinite(Date.parse(r.created_at))||(r.parent_id!==null&&!UUID.test(r.parent_id??'')))throw Error('INVALID_COMMUNITY_RESPONSE');return {id:r.id,body:r.body,createdAt:r.created_at,parentId:r.parent_id};});
}
