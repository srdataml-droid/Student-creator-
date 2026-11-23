/** Local-only HTTP API used by Next.js route and direct integration tests. */
import {getLocalStore,SESSION_COOKIE} from './store.mjs';
import {readMp4Body,parseVideoRange} from './video.mjs';
import {publicLessonNotesResponse} from './notes.mjs';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
const MAX_BODY=32768;
const RESTRICTED=Symbol('restricted');
const responses=(data,status=200,headers={})=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
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
export function createLocalHandler(store){
  return async function handle(request,segments=[]){
    try{
      const method=request.method.toUpperCase(),path=segments.join('/');
      if(!['GET','POST','HEAD'].includes(method))return fail('METHOD_NOT_ALLOWED',405);
      if(method==='POST'&&!checkOrigin(request))return fail('ORIGIN_REJECTED',403);
      const cookie=parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
      const actor=store.getSession(cookie);
      if(segments.length===3&&segments[0]==='lessons'&&segments[2]==='video'){
        const id=segments[1];
        if(method==='POST'){
          if(!actor)return unauthorized();
          store.canUploadVideo(actor,id);
          const bytes=await readMp4Body(request);
          const result=store.saveVideo(actor,id,bytes);
          return responses({video:result},result.replayed?200:201);
        }
        const {file,sizeBytes}=store.getVideoFile(actor,id);
        const range=parseVideoRange(request.headers.get('range'),sizeBytes);
        if(!range)return new Response(null,{status:416,headers:{'content-range':`bytes */${sizeBytes}`,'cache-control':'no-store','x-content-type-options':'nosniff'}});
        const headers={'content-type':'video/mp4','content-length':String(range.end-range.start+1),
          'accept-ranges':'bytes','cache-control':'private, no-store','x-content-type-options':'nosniff',
          'cross-origin-resource-policy':'same-origin','content-disposition':'inline; filename="lesson-video.mp4"'};
        if(range.status===206)headers['content-range']=`bytes ${range.start}-${range.end}/${sizeBytes}`;
        if(method==='HEAD')return new Response(null,{status:range.status,headers});
        return new Response(Readable.toWeb(createReadStream(file,{start:range.start,end:range.end})),{status:range.status,headers});
      }
      if(method==='HEAD')return fail('METHOD_NOT_ALLOWED',405);
      if(method==='GET'){
        if(path==='health')return responses({state:'local',database:'sqlite',providerPayments:false});
        if(path==='me')return actor?responses({user:actor}):fail('AUTH_REQUIRED',401);
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
        if(segments.length===3&&segments[0]==='lessons'&&segments[2]==='comments')
          return responses({comments:store.lessonComments(segments[1])});
        if(path==='admin/comment-reports'){
          if(!actor)return unauthorized();
          return responses({reports:store.lessonCommentReportQueue(actor)});
        }
        if(segments.length===3&&segments[0]==='lessons'&&segments[2]==='notes'){
          // Public/free notes only; do not use this route for future paid assets.
          const lesson=store.publicLesson(segments[1]);
          if(!lesson||!store.getCourse(lesson.courseId)?.active)return fail('LESSON_NOT_FOUND',404);
          return publicLessonNotesResponse(lesson);
        }
        if(segments.length===2&&segments[0]==='lessons'){
          const item=store.publicLesson(segments[1]);return item?responses({lesson:item}):fail('LESSON_NOT_FOUND',404);
        }
        if(path==='my/creator-profile'){if(!actor)return unauthorized();return responses({profile:store.getOwnPublicProfile(actor)});}
        if(path==='my/lessons'){if(!actor)return unauthorized();return responses({lessons:store.myLessons(actor)});}
        if(path==='my/bookmarks'){if(!actor)return unauthorized();return responses({lessons:store.myBookmarks(actor)});}
        if(path==='my/likes'){if(!actor)return unauthorized();return responses({likes:store.myLikes(actor)});}
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
        if(segments.length===2&&segments[0]==='messages'&&segments[1]!=='inbox'){if(!actor)return unauthorized();return responses({messages:store.thread(actor,segments[1]),blocked:store.isContactBlocked(actor,segments[1])});}
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
      if(path==='auth/register')return responses({user:store.register(body)},201);
      if(path==='auth/login'){
        const result=store.login(body.email,body.password);
        if(!result)return fail('INVALID_CREDENTIALS',401);
        const secure=new URL(request.url).protocol==='https:'?'; Secure':'';
        return responses({user:result.user},200,{'set-cookie':`${SESSION_COOKIE}=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`});
      }
      if(!actor)return unauthorized();
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
      return fail('LOCAL_SERVICE_UNAVAILABLE',503);
    }
  };
}
export async function handleLocalRequest(request,segments=[]){
  try{return await createLocalHandler(getLocalStore())(request,segments);}
  catch{return fail('LOCAL_MODE_UNAVAILABLE',503);}
}
