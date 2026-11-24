/** Local-only HTTP API used by Next.js route and direct integration tests. */
import {getLocalStore,SESSION_COOKIE} from './store.mjs';
import {readMp4Body,parseVideoRange} from './video.mjs';
import {publicLessonNotesResponse} from './notes.mjs';
import {MAX_CAPTION_BYTES} from './captions.mjs';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {createPaystackClient,PaystackGatewayError} from '../../payment-core/src/paystack-client.mjs';
const MAX_BODY=32768;
const RESTRICTED=Symbol('restricted');
const responses=(data,status=200,headers={})=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',...headers}});
const fail=(code,status)=>responses({error:code},status);
function parseCookies(cookie){const record={};for(const part of (cookie??'').split(';')){const eq=part.indexOf('=');if(eq<0)continue;record[part.slice(0,eq).trim()]=part.slice(eq+1).trim();}return record;}
async function jsonBody(request){
  if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type')??''))throw Object.assign(Error('JSON_REQUIRED'),{status:415});
  if(Number(request.headers.get('content-length')||0)>MAX_BODY)throw Object.assign(Error('BODY_TOO_LARGE'),{status:413});
  const reader=request.body?.getReader();if(!reader)throw Object.assign(Error('INVALID_JSON'),{status:400});
  let chunks=[],size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();throw Object.assign(Error('BODY_TOO_LARGE'),{status:413});}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  let x;try{x=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Object.assign(Error('INVALID_JSON'),{status:400});}
  if(!x||typeof x!=='object'||Array.isArray(x))throw Object.assign(Error('INVALID_JSON'),{status:400});return x;
}

async function readCaptionBody(request){
  if(!/^text\/vtt(?:\s*;|\s*$)/i.test(request.headers.get('content-type')??''))throw Object.assign(Error('CAPTIONS_VTT_REQUIRED'),{code:'CAPTIONS_VTT_REQUIRED',status:415});
  if(Number(request.headers.get('content-length')||0)>MAX_CAPTION_BYTES)throw Object.assign(Error('CAPTIONS_TOO_LARGE'),{code:'CAPTIONS_TOO_LARGE',status:413});
  const reader=request.body?.getReader();if(!reader)throw Object.assign(Error('INVALID_CAPTIONS'),{code:'INVALID_CAPTIONS',status:422});
  let size=0;const chunks=[];
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>MAX_CAPTION_BYTES){await reader.cancel();throw Object.assign(Error('CAPTIONS_TOO_LARGE'),{code:'CAPTIONS_TOO_LARGE',status:413});}
      chunks.push(Buffer.from(value));
    }
  }finally{reader.releaseLock();}
  try{return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}
  catch{throw Object.assign(Error('INVALID_CAPTIONS'),{code:'INVALID_CAPTIONS',status:422});}
}

function checkOrigin(request){
  const origin=request.headers.get('origin');
  const url=new URL(request.url);
  if(origin && origin!==url.origin)return false;
  const site=request.headers.get('sec-fetch-site');
  return !site||['same-origin','none'].includes(site);
}
const unauthorized=()=>{throw Object.assign(Error('AUTH_REQUIRED'),{status:401});};
const allowed=(s)=>s&&typeof s==='string'&&s.length<100;
/**
 * Only standalone localhost use. No payment provider, no staging credentials.
 * @param {object} store - an open local SQLite store
 */
export function createLocalHandler(store,{sandboxGateway,payments=null,emailDelivery=null}={}){
  // Explicit synthetic transport only. No real email or local debug token endpoint.
  const mail=process.env.NODE_ENV!=='production'&&emailDelivery?.environment==='synthetic'&&typeof emailDelivery.send==='function'?emailDelivery:null;
  async function sendChallenge(challenge){
    // Do not surface recipient or provider failures to a public recovery request.
    // A future hosted transport must use asynchronous delivery and abuse controls.
    if(challenge&&mail){try{await mail.send(challenge);}catch{store.cancelEmailChallenge(challenge.token);}}
  }
  // No live mode. Production builds keep all financial actions disabled.
  const gateway=process.env.NODE_ENV==='production'?null:(payments?.gateway??(sandboxGateway===undefined?(process.env.PAYSTACK_TEST_SECRET_KEY?createPaystackClient({secretKey:process.env.PAYSTACK_TEST_SECRET_KEY,environment:'test'}):null):sandboxGateway));
  const signingSecrets=payments?.signingSecrets??(process.env.PAYSTACK_WEBHOOK_KEY_ID&&process.env.PAYSTACK_WEBHOOK_SIGNING_SECRET?[{id:process.env.PAYSTACK_WEBHOOK_KEY_ID,secret:process.env.PAYSTACK_WEBHOOK_SIGNING_SECRET}]:[]);
  return async function handle(request,segments=[]){
    try{
      const method=request.method.toUpperCase(),path=segments.join('/');
      if(!['GET','POST','HEAD'].includes(method))return fail('METHOD_NOT_ALLOWED',405);
      if(path==='payments/webhook'&&method==='POST'){
        if(gateway?.environment!=='test'||process.env.NODE_ENV==='production')return fail('SANDBOX_PAYMENTS_UNAVAILABLE',503);
        const reader=request.body?.getReader();if(!reader)return fail('INVALID_EVENT',400);
        const chunks=[];let size=0;
        try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576){await reader.cancel();return fail('BODY_TOO_LARGE',413);}chunks.push(Buffer.from(value));}}
        finally{reader.releaseLock();}
        try{store.receivePaymentWebhook(Buffer.concat(chunks),request.headers.get('paystack-signature'),signingSecrets);}
        catch(e){if(e.code==='INVALID_SIGNATURE')return fail('INVALID_SIGNATURE',401);if(['BAD_JSON','INVALID_EVENT'].includes(e.code))return fail(e.code,400);throw e;}
        // ACK only after durable inbox commit. Worker drains independently and retries.
        return responses({received:true});
      }
      if(method==='POST'&&!checkOrigin(request))return fail('ORIGIN_REJECTED',403);
      const cookies=parseCookies(request.headers.get('cookie'));
      const cookie=cookies[SESSION_COOKIE];
      const actor=store.getSession(cookie);
      if(segments.length===4&&segments[0]==='lessons'&&segments[2]==='video'&&segments[3]==='captions'){
        const id=segments[1];
        if(method==='POST'){
          if(!actor)return unauthorized();
          const vtt=await readCaptionBody(request);
          const result=store.saveCaptions(actor,id,vtt);
          return responses({captions:result},result.replayed?200:201);
        }
        // WebVTT fetches reuse the same video-path-scoped HttpOnly grant.
        const vtt=store.getCaptions(actor,id,cookies['campus_playback_'+id],cookie);
        const headers={'content-type':'text/vtt; charset=utf-8','content-length':String(Buffer.byteLength(vtt)),
          'cache-control':'private, no-store','cross-origin-resource-policy':'same-origin',
          'x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
        return new Response(method==='HEAD'?null:vtt,{status:200,headers});
      }
      if(segments.length===3&&segments[0]==='lessons'&&segments[2]==='video'){
        const id=segments[1];
        if(method==='POST'){
          if(!actor)return unauthorized();
          store.canUploadVideo(actor,id);
          const bytes=await readMp4Body(request);
          const result=store.saveVideo(actor,id,bytes);
          return responses({video:result},result.replayed?200:201);
        }
        const {file,sizeBytes}=store.getVideoFile(actor,id,cookies['campus_playback_'+id],cookie);
        const range=parseVideoRange(request.headers.get('range'),sizeBytes);
        if(!range)return new Response(null,{status:416,headers:{'content-range':`bytes */${sizeBytes}`,'cache-control':'no-store','x-content-type-options':'nosniff'}});
        const headers={'content-type':'video/mp4','content-length':String(range.end-range.start+1),
          'referrer-policy':'no-referrer','accept-ranges':'bytes','cache-control':'private, no-store','x-content-type-options':'nosniff',
          'cross-origin-resource-policy':'same-origin','content-disposition':'inline; filename="lesson-video.mp4"'};
        if(range.status===206)headers['content-range']=`bytes ${range.start}-${range.end}/${sizeBytes}`;
        if(method==='HEAD')return new Response(null,{status:range.status,headers});
        return new Response(Readable.toWeb(createReadStream(file,{start:range.start,end:range.end})),{status:range.status,headers});
      }
      if(method==='HEAD')return fail('METHOD_NOT_ALLOWED',405);
      if(method==='GET'){
        if(path==='health')return responses({state:'local',database:'sqlite',providerPayments:false,sandboxCheckoutEnabled:Boolean(gateway),pilotInviteOnly:store.pilotInviteOnly()});
        if(path==='me')return actor?responses({user:actor}):fail('AUTH_REQUIRED',401);
        if(path==='me/email-status'){if(!actor)return unauthorized();return responses({...store.emailStatus(cookie),deliveryEnabled:Boolean(mail)});}
        if(path==='me/institution-affiliation'){if(!actor)return unauthorized();return responses({affiliation:store.institutionAffiliation(actor,actor.id)});}
        if(path==='me/verification-appeals'){if(!actor)return unauthorized();return responses({appeals:store.myVerificationAppeals(actor)});}
        if(path==='me/copyright-claims'){if(!actor)return unauthorized();return responses({claims:store.myCopyrightClaims(actor)});}
        if(path==='me/privacy-requests'){if(!actor)return unauthorized();return responses({requests:store.myPrivacyRequests(actor)});}
        if(path==='admin/copyright-claims'){if(!actor)return unauthorized();return responses({claims:store.copyrightReviewQueue(actor)});}
        if(path==='admin/privacy-requests'){if(!actor)return unauthorized();return responses({requests:store.privacyRequestQueue(actor)});}
        if(path==='admin/identity/revalidation-due'){if(!actor)return unauthorized();return responses({due:store.dueAffiliationRevalidations(actor)});}
        if(segments.length===3&&segments[0]==='admin'&&segments[1]==='institution-integrations'){
          if(!actor)return unauthorized();const integration=store.getInstitutionIntegration(actor,segments[2]);
          return integration?responses({integration}):fail('INTEGRATION_NOT_FOUND',404);
        }
        if(path==='following'){if(!actor)return unauthorized();return responses({creators:store.followingCreators(actor)});}
        if(segments.length===3&&segments[0]==='creators'&&segments[2]==='follow'){
          if(!actor)return unauthorized();
          return responses({following:store.isFollowing(actor,segments[1])});
        }
        if(segments.length===3&&segments[0]==='creators'&&segments[2]==='restrictions'){
          if(!actor)return unauthorized();
          return responses({restrictions:store.creatorRestrictions(actor,segments[1])});
        }
        if(path==='institutions')return responses({institutions:store.listInstitutions()});
        if(path==='search'){
          const query=new URL(request.url).searchParams;
          const limit=query.has('limit')?Number(query.get('limit')):25;
          const value=(key)=>query.get(key)||null;
          return responses({results:store.searchLessons({q:query.get('q'),institutionId:value('institutionId'),courseId:value('courseId'),topicId:value('topicId'),limit})});
        }
        if(path==='courses')return responses({courses:store.listCourses()});
        if(segments.length===3&&segments[0]==='courses'&&segments[2]==='topics'){const parent=store.getCourse(segments[1]);return parent?responses({topics:store.listTopics(parent.id)}):fail('COURSE_NOT_FOUND',404);}
        if(segments.length===2&&segments[0]==='courses'){
          const item=store.getCourse(segments[1]);if(!item)return fail('COURSE_NOT_FOUND',404);
          const topicId=new URL(request.url).searchParams.get('topicId');
          const topics=store.listTopics(item.id);
          if(topicId&&!topics.some(t=>t.id===topicId))return fail('INVALID_TOPIC',422);
          return responses({course:item,topics,lessons:store.publicLessons(item.id,topicId).map(l=>({id:l.id,title:l.title,topicId:l.topicId,description:l.description,previewText:l.previewText,publishedAt:l.publishedAt,hasVideo:l.hasVideo}))});
        }
        if(segments.length===3&&segments[0]==='lessons'&&segments[2]==='comments'){
          store.viewableLesson(actor,segments[1]);
          return responses({comments:store.lessonComments(segments[1])});
        }
        if(path==='admin/comment-reports'){
          if(!actor)return unauthorized();
          return responses({reports:store.lessonCommentReportQueue(actor)});
        }
        if(segments.length===3&&segments[0]==='lessons'&&segments[2]==='notes'){
          const lesson=store.viewableLesson(actor,segments[1]);
          if(!lesson)return fail('LESSON_NOT_FOUND',404);
          return publicLessonNotesResponse(lesson);
        }
        if(segments.length===2&&segments[0]==='lessons'){
          const item=store.viewableLesson(actor,segments[1]);return responses({lesson:item});
        }
        if(path==='my/creator-profile'){if(!actor)return unauthorized();return responses({profile:store.getOwnPublicProfile(actor)});}
        if(path==='my/lessons'){if(!actor)return unauthorized();return responses({lessons:store.myLessons(actor)});}
        if(path==='my/bookmarks'){if(!actor)return unauthorized();return responses({lessons:store.myBookmarks(actor)});}
        if(path==='my/likes'){if(!actor)return unauthorized();return responses({likes:store.myLikes(actor)});}
        if(path==='my/payment-disputes'){if(!actor)return unauthorized();return responses({cases:store.myPaymentDisputes(actor)});}
        if(path==='my/purchases'){if(!actor)return unauthorized();return responses({orders:store.myPurchaseOrders(actor)});}
        if(segments.length===2&&segments[0]==='orders'){if(!actor)return unauthorized();return responses({order:store.getPurchaseOrder(actor,segments[1])});}
        if(path==='my/creator-earnings'){if(!actor)return unauthorized();return responses({earnings:store.creatorEarnings(actor)});}
        if(segments.length===3&&segments[0]==='lessons'&&segments[2]==='access'){if(!actor)return unauthorized();return responses({access:store.lessonAccess(actor,segments[1])});}
        if(path==='admin/students'){if(!actor)return unauthorized();return responses({students:store.listStudentAccounts(cookie)});}
        if(path==='admin/pending-users'){if(!actor)return unauthorized();return responses({users:store.listPendingUsers(actor)});}
        if(path==='admin/review-queue'){if(!actor)return unauthorized();return responses({lessons:store.reviewQueue(actor)});}
        if(path==='admin/reports'){if(!actor)return unauthorized();return responses({reports:store.reportQueue(actor)});}
        if(segments.length===2&&segments[0]==='creators')return store.publicCreator(segments[1])?responses({creator:store.publicCreator(segments[1])}):fail('CREATOR_NOT_FOUND',404);
        if(segments.length===3&&segments[0]==='courses'&&segments[2]==='study-sessions'){
          if(!actor)return unauthorized();
          return responses({sessions:store.studySessions(actor,segments[1])});
        }
        if(path==='admin/community-reports'){if(!actor)return unauthorized();return responses({reports:store.communityReportQueue(actor)});}
        if(segments.length===3&&segments[0]==='courses'&&segments[2]==='community'){
          if(!actor)return unauthorized();const status=store.communityStatus(actor,segments[1]);return responses({status,posts:status.joined?store.communityPosts(actor,segments[1]):[]});
        }
        if(path==='messages/inbox'){if(!actor)return unauthorized();return responses({inbox:store.inbox(actor)});}
        if(segments.length===2&&segments[0]==='messages'&&segments[1]!=='inbox'){
          if(!actor)return unauthorized();
          const q=new URL(request.url).searchParams;
          if(q.getAll('before').length>1||q.getAll('limit').length>1)return fail('INVALID_MESSAGE_PAGE',422);
          const page=store.threadPage(actor,segments[1],{before:q.get('before'),limit:q.has('limit')?Number(q.get('limit')):100});
          return responses({...page,blocked:store.isContactBlocked(actor,segments[1])});
        }
        return fail('NOT_FOUND',404);
      }

      if(segments.length===3&&segments[0]==='lessons'&&['bookmark','unbookmark'].includes(segments[2])){
        if(!actor)return unauthorized();
        const body=await jsonBody(request);
        if(Object.keys(body).length)return fail('UNEXPECTED_BODY',400);
        const item=segments[2]==='bookmark'?store.saveBookmark(actor,segments[1]):store.removeBookmark(actor,segments[1]);
        return responses({bookmark:item},item.replayed?200:201);
      }
      if(segments.length===3&&segments[0]==='lessons'&&['like','unlike'].includes(segments[2])){
        if(!actor)return unauthorized();
        const body=await jsonBody(request);
        if(Object.keys(body).length)return fail('UNEXPECTED_BODY',400);
        const item=segments[2]==='like'?store.likeLesson(actor,segments[1]):store.unlikeLesson(actor,segments[1]);
        return responses({like:item},item.replayed?200:201);
      }
      if(path==='auth/logout'){
        store.logout(cookie);return responses({ok:true},200,{'set-cookie':`${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${new URL(request.url).protocol==='https:'?'; Secure':''}`});
      }
      const body=await jsonBody(request);
      if(path==='auth/logout-all'){
        if(Object.keys(body).length)return fail('UNEXPECTED_BODY',400);
        if(!actor)return unauthorized();
        const result=store.revokeAllSessions(cookie);
        return responses({ok:true,...result},200,{'set-cookie':`${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${new URL(request.url).protocol==='https:'?'; Secure':''}`});
      }
      if(path==='auth/email/verify/request'){
        if(!actor)return unauthorized();
        if(Object.keys(body).length)return fail('UNEXPECTED_BODY',400);
        if(!mail)return fail('EMAIL_DELIVERY_UNAVAILABLE',503);
        await sendChallenge(store.requestEmailVerification(cookie));
        return responses({accepted:true},202);
      }
      if(path==='auth/email/verify/confirm'){
        if(!actor)return unauthorized();
        if(Object.keys(body).some(k=>k!=='token'))return fail('UNEXPECTED_BODY',400);
        return responses(store.confirmEmailVerification(cookie,body.token));
      }
      if(path==='auth/password/recover'){
        if(Object.keys(body).some(k=>k!=='email'))return fail('UNEXPECTED_BODY',400);
        if(!mail)return fail('EMAIL_DELIVERY_UNAVAILABLE',503);
        await sendChallenge(store.requestPasswordRecovery(body.email));
        return responses({accepted:true},202);
      }
      if(path==='auth/password/reset'){
        if(Object.keys(body).some(k=>!['token','password'].includes(k)))return fail('UNEXPECTED_BODY',400);
        return responses(store.resetPassword(body.token,body.password));
      }
      if(path==='auth/register')return responses({user:store.register(body)},201);
      if(path==='auth/login'){
        const result=store.login(body.email,body.password);
        if(!result)return fail('INVALID_CREDENTIALS',401);
        const secure=new URL(request.url).protocol==='https:'?'; Secure':'';
        return responses({user:result.user},200,{'set-cookie':`${SESSION_COOKIE}=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`});
      }
      if(!actor)return unauthorized();
      if(segments.length===4&&segments[0]==='admin'&&segments[1]==='students'&&segments[3]==='suspension'){
        if(Object.keys(body).some(k=>!['suspended','reason'].includes(k)))return fail('UNEXPECTED_BODY',400);
        return responses({student:store.setStudentSuspension(cookie,segments[2],body)});
      }
      if(path==='me/copyright-claims'){
         if(Object.keys(body).some(k=>!['lessonId','reason'].includes(k)))return fail('UNEXPECTED_BODY',400);
         const claim=store.submitCopyrightClaim(actor,body.lessonId,body.reason);
         return responses({claim},claim.replayed?200:201);
       }
       if(path==='me/privacy-requests'){
         if(Object.keys(body).some(k=>k!=='kind'))return fail('UNEXPECTED_BODY',400);
         const result=store.requestPrivacyAction(actor,body.kind);
         return responses({request:result},result.replayed?200:201);
       }
       if(segments.length===3&&segments[0]==='copyright-claims'&&segments[2]==='appeal'){
         if(Object.keys(body).some(k=>k!=='reason'))return fail('UNEXPECTED_BODY',400);
         const claim=store.appealCopyrightTakedown(actor,segments[1],body.reason);
         return responses({claim},claim.replayed?200:201);
       }
       if(segments.length===4&&segments[0]==='admin'&&segments[1]==='copyright-claims'&&segments[3]==='resolve'){
         if(Object.keys(body).some(k=>!['decision','note'].includes(k)))return fail('UNEXPECTED_BODY',400);
         return responses({result:store.resolveCopyrightClaim(actor,segments[2],body)});
       }
       if(path==='me/verification-appeals'){
         if(Object.keys(body).some(k=>k!=='reason'))return fail('UNEXPECTED_BODY',400);
         const appeal=store.submitVerificationAppeal(actor,body.reason);
         return responses({appeal},appeal.replayed?200:201);
       }
       if(path==='admin/institution-integrations'){
         if(Object.keys(body).some(k=>!['institutionId','providerId','kind','issuer','audience','endpoint'].includes(k)))return fail('UNEXPECTED_BODY',400);
         return responses({integration:store.addInstitutionIntegration(actor,body)},201);
       }
       if(segments.length===4&&segments[0]==='admin'&&segments[1]==='institution-integrations'&&['enable-synthetic','disable'].includes(segments[3])){
         if(Object.keys(body).length)return fail('UNEXPECTED_BODY',400);
         const integration=segments[3]==='enable-synthetic'?store.enableSyntheticInstitution(actor,segments[2]):store.disableInstitutionIntegration(actor,segments[2]);
         return responses({integration});
       }
       if(segments.length===3&&segments[0]==='admin'&&segments[1]==='verification-appeals'){
         if(Object.keys(body).some(k=>!['decision','note'].includes(k)))return fail('UNEXPECTED_BODY',400);
         return responses({appeal:store.reviewVerificationAppeal(actor,segments[2],body)});
       }
       if(segments.length===3&&segments[0]==='orders'&&['checkout','confirm'].includes(segments[2])){
         if(Object.keys(body).length)return fail('UNEXPECTED_BODY',400);
         if(!gateway){store.getPurchaseOrder(actor,segments[1]);return fail('SANDBOX_PAYMENTS_UNAVAILABLE',503);}
         if(segments[2]==='checkout')return responses({checkout:await store.sandboxCheckout(actor,segments[1],gateway)});
         return responses({order:await store.confirmSandboxOrder(actor,segments[1],gateway)});
       }
      if(segments.length===3&&segments[0]==='admin'&&segments[1]==='payment-disputes')return responses({result:store.resolvePaymentDispute(actor,segments[2],body.resolution)});
      if(segments.length===3&&segments[0]==='lessons'&&segments[2]==='price'){
         if(Object.keys(body).some(k=>k!=='amountKobo'))return fail('UNEXPECTED_BODY',400);
         return responses({price:store.setLessonPrice(actor,segments[1],body.amountKobo)});
       }
       if(segments.length===3&&segments[0]==='lessons'&&segments[2]==='orders'){
         if(Object.keys(body).some(k=>k!=='requestKey'))return fail('UNEXPECTED_BODY',400);
         const order=store.createPurchaseOrder(actor,segments[1],body.requestKey);
         return responses({order},order.replayed?200:201);
       }
       if(segments.length===3&&segments[0]==='lessons'&&segments[2]==='playback-grant'){
        if(Object.keys(body).length!==0)return fail('UNEXPECTED_BODY',400);
        const id=segments[1],grant=store.issuePlaybackGrant(actor,id,cookie);
        const secure=new URL(request.url).protocol==='https:'?'; Secure':'';
        const mediaCookie=`campus_playback_${id}=${grant.token}; Path=/api/local/lessons/${id}/video; HttpOnly; SameSite=Strict; Max-Age=300${secure}`;
        return responses({expiresAt:grant.expiresAt,watermark:grant.watermark},200,{'set-cookie':mediaCookie});
      }
      if(path==='my/creator-profile'){const result=store.updatePublicProfile(actor,body);return responses(result,result.replayed?200:201);}
      if(segments.length===4&&segments[0]==='creators'&&segments[2]==='restrictions'){
        const result=store.setCreatorRestrictions(actor,segments[1],segments[3],body);
        return responses({restriction:result});
      }
      if(segments.length===3&&segments[0]==='creators'&&['follow','unfollow'].includes(segments[2])){
        if(Object.keys(body).length)return fail('UNEXPECTED_BODY',400);
        const result=segments[2]==='follow'?store.followCreator(actor,segments[1]):store.unfollowCreator(actor,segments[1]);
        return responses({follow:result});
      }
      if(segments.length===3&&segments[0]==='lessons'&&segments[2]==='comments'){
        const result=store.createLessonComment(actor,segments[1],body);
        return responses(result,result.replayed?200:201);
      }
      if(segments.length===3&&segments[0]==='lesson-comments'&&segments[2]==='report')
        return responses({report:store.reportLessonComment(actor,segments[1],body.reason)},201);
      if(segments.length===3&&segments[0]==='lesson-comments'&&segments[2]==='remove'){
        if(Object.keys(body).length)return fail('UNEXPECTED_BODY',400);
        const result=store.removeLessonComment(actor,segments[1]);
        return responses({result},result.replayed?200:201);
      }
      if(segments.length===3&&segments[0]==='admin'&&segments[1]==='comment-reports')
        return responses({result:store.resolveLessonCommentReport(actor,segments[2],body)});
      if(path==='admin/institutions')return responses({institution:store.createInstitution(actor,body.name)},201);
      if(path==='admin/courses')return responses({course:store.createCourse(actor,body)},201);
      if(path==='admin/topics')return responses({topic:store.createTopic(actor,body)},201);
      if(path==='admin/verify')return responses({user:store.verifyStudent(actor,body.userId)});
      if(segments.length===3&&segments[0]==='courses'&&segments[2]==='study-sessions'){
        const result=store.scheduleStudySession(actor,segments[1],body);
        return responses({session:result},result.replayed?200:201);
      }
      if(segments.length===3&&segments[0]==='study-sessions'&&segments[2]==='rsvp'){
        if(Object.keys(body).length)return fail('UNEXPECTED_BODY',400);
        return responses({attendance:store.rsvpStudySession(actor,segments[1])});
      }
      if(segments.length===3&&segments[0]==='study-sessions'&&segments[2]==='withdraw'){
        if(Object.keys(body).length)return fail('UNEXPECTED_BODY',400);
        return responses({attendance:store.leaveStudySession(actor,segments[1])});
      }
      if(segments.length===3&&segments[0]==='study-sessions'&&segments[2]==='cancel')
        return responses({session:store.cancelStudySession(actor,segments[1],body.reason)});
      if(segments.length===3&&segments[0]==='study-sessions'&&segments[2]==='complete'){
        if(Object.keys(body).length)return fail('UNEXPECTED_BODY',400);
        return responses({session:store.completeStudySession(actor,segments[1])});
      }
      if(segments.length===3&&segments[0]==='courses'&&segments[2]==='join'){
        if(Object.keys(body).length)return fail('UNEXPECTED_BODY',400);
        return responses({membership:store.joinCommunity(actor,segments[1])});
      }
      if(segments.length===3&&segments[0]==='courses'&&segments[2]==='leave'){
        if(Object.keys(body).length)return fail('UNEXPECTED_BODY',400);
        return responses({membership:store.leaveCommunity(actor,segments[1])});
      }
      if(segments.length===3&&segments[0]==='courses'&&segments[2]==='posts'){
        const result=store.createCommunityPost(actor,segments[1],body);
        return responses(result,result.replayed?200:201);
      }
      if(segments.length===3&&segments[0]==='community'&&segments[1]==='posts'&&segments[2]==='report'){
        return responses({report:store.reportCommunityPost(actor,body.postId,body.reason)},201);
      }
      if(segments.length===3&&segments[0]==='admin'&&segments[1]==='community-reports'){
        return responses({result:store.resolveCommunityReport(actor,segments[2],body)});
      }
      if(segments.length===3&&segments[0]==='messages'&&segments[2]==='read'){
        if(Object.keys(body).length!==1||!Object.hasOwn(body,'messageIds'))return fail('UNEXPECTED_BODY',400);
        return responses(store.markMessagesRead(actor,segments[1],body.messageIds));
      }
      if(path==='messages/preference')return responses({preference:store.setMessagePreference(actor,body.allowMessages)});
      if(segments.length===2&&segments[0]==='messages'&&!['preference','report','inbox'].includes(segments[1]))return responses({message:store.sendMessage(actor,segments[1],body.text)},201);
      if(segments.length===3&&segments[0]==='messages'&&segments[2]==='block')return responses({result:store.blockContact(actor,segments[1])});
      if(segments.length===3&&segments[0]==='messages'&&segments[2]==='unblock')return responses({result:store.unblockContact(actor,segments[1])});
      if(segments.length===3&&segments[0]==='admin'&&segments[1]==='reports')return responses({result:store.resolveReport(actor,segments[2],body.resolution)});
      if(path==='messages/report')return responses({result:store.reportMessage(actor,body.messageId,body.reason)},201);
      if(path==='lessons/drafts'){
        const result=store.createDraft(actor,body);
        return responses({lesson:result.lesson,replayed:result.replayed},result.replayed?200:201);
      }
      if(segments.length===3&&segments[0]==='lessons'&&segments[2]==='edit')return responses({lesson:store.updateDraft(actor,segments[1],body)});
      if(segments.length===3&&segments[0]==='lessons'&&segments[2]==='submit'){
        if(Object.keys(body).length!==0)return fail('UNEXPECTED_BODY',400);
        return responses({lesson:store.submit(actor,segments[1])});
      }
      if(segments.length===3&&segments[0]==='lessons'&&segments[2]==='review')return responses({lesson:store.review(actor,segments[1],body)});
      return fail('NOT_FOUND',404);
    }catch(e){
      if(e?.code==='SQLITE_CONSTRAINT_UNIQUE'||(e?.code==='ERR_SQLITE_ERROR'&&e?.errcode===2067))return fail('ALREADY_EXISTS',409);
      if(e?.status>=400&&e?.status<500)return fail(e.code??e.message,e.status);
      if(e instanceof PaystackGatewayError){
        if(e.code==='NOT_PAID')return fail('PAYMENT_NOT_CONFIRMED',409);
        if(['AMOUNT_MISMATCH','CURRENCY_MISMATCH','ENVIRONMENT_MISMATCH','BUYER_MISMATCH','REFERENCE_MISMATCH'].includes(e.code))return fail('PAYMENT_VERIFICATION_FAILED',409);
        return fail('SANDBOX_GATEWAY_UNAVAILABLE',503);
      }
      return fail('LOCAL_SERVICE_UNAVAILABLE',503);
    }
  };
}
export async function handleLocalRequest(request,segments=[]){
  try{return await createLocalHandler(getLocalStore())(request,segments);}
  catch{return fail('LOCAL_MODE_UNAVAILABLE',503);}
}
