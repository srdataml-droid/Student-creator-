import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';
const sample='A derivative measures the rate of change of a function. For f(x)=x², start from the limit definition using f(x+h) minus f(x) divided by h. Expand the square, cancel terms, and take the limit as h approaches zero. The final derivative is 2x. This is an original explanation, not a completed student assignment.';
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'campus-local-')),path=join(dir,'data.sqlite');
 let store=openLocalStore(path);store.bootstrapAdmin('owner@local.test','Correct Horse Battery Staple 42');
 const request=async(name,method='GET',body,token,origin='http://localhost:3000')=>{
  const r=new Request(`http://localhost:3000/api/local/${name}`,{method,headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(token?{cookie:`campus_local_session=${token}`}:{}) ,...(method==='POST'?{origin}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const response=await createLocalHandler(store)(r,new URL(r.url).pathname.replace('/api/local/','').split('/'));
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.match(/campus_local_session=([^;]+)/)?.[1]};
 };
 const close=()=>{store?.close();rmSync(dir,{recursive:true,force:true});};
 return {get store(){return store},request,path,close,dir};
}
async function login(x,email,password){const a=await x.request('auth/login','POST',{email,password});assert.equal(a.status,200);assert.ok(a.cookie);return a.cookie;}
async function begin(x){
 const owner=await login(x,'owner@local.test','Correct Horse Battery Staple 42');
 const institution=(await x.request('admin/institutions','POST',{name:'Example Campus'},owner)).data.institution.id;
 const course=(await x.request('admin/courses','POST',{institutionId:institution,code:'MTH 101',title:'Calculus I'},owner)).data.course.id;
 const user=(await x.request('auth/register','POST',{email:'student@campus.test',password:'Student Password Strong 123',institutionId:institution})).data.user.id;
 const student=await login(x,'student@campus.test','Student Password Strong 123');
 return {owner,institution,course,user,student};
}
function lessonBody(course){return{courseId:course,title:'Understanding derivatives',description:'Original tutorial on the basics of calculus',previewText:'An example of basic differentiation',lessonText:sample,rightsAttested:true,creationKey:'lesson-create-unique-12345'};}
test('persistent campus journey: register, verify, draft, review, publish and reopen',async()=>{
 const x=setup();let closed=false;try{
  const s=await begin(x);
  assert.equal((await x.request('lessons/drafts','POST',lessonBody(s.course),s.student)).status,403);
  assert.equal((await x.request('admin/verify','POST',{userId:s.user},s.owner)).status,200);
  const d=await x.request('lessons/drafts','POST',lessonBody(s.course),s.student);assert.equal(d.status,201);
  const id=d.data.lesson.id;
  const replay=await x.request('lessons/drafts','POST',lessonBody(s.course),s.student);assert.equal(replay.status,200);assert.equal(replay.data.lesson.id,id);
  assert.equal((await x.request('courses/'+s.course)).data.lessons.length,0);
  assert.equal((await x.request(`lessons/${id}/submit`,'POST',{},s.student)).status,200);
  assert.equal((await x.request(`lessons/${id}/review`,'POST',{decision:'approve',reason:'Original student tutorial'},s.owner)).status,200);
  assert.equal((await x.request('courses/'+s.course)).data.lessons.length,1);
  assert.equal((await x.request('lessons/'+id,'GET',undefined,s.student)).data.lesson.lessonText,sample);
  assert.equal((await x.request(`lessons/${id}/review`,'POST',{decision:'approve',reason:'Repeated approval'},s.owner)).status,409);
  x.store.close();closed=true;
  const reopened=openLocalStore(x.path);assert.equal(reopened.publicLesson(id).lessonText,sample);assert.ok(reopened.auditCount()>=6);reopened.close();
 }finally{if(!closed)x.store.close();rmSync(x.dir,{recursive:true,force:true});}
});
test('cross-account access, cross-campus access and duplicate key changes rejected',async()=>{
 const x=setup();try{
  const s=await begin(x);
  const otherInst=(await x.request('admin/institutions','POST',{name:'Other Campus'},s.owner)).data.institution.id;
  const otherId=(await x.request('auth/register','POST',{email:'other@campus.test',password:'Another Student Password 123',institutionId:otherInst})).data.user.id;
  const other=await login(x,'other@campus.test','Another Student Password 123');
  assert.equal((await x.request('admin/verify','POST',{userId:s.user},s.owner)).status,200);
  assert.equal((await x.request('admin/verify','POST',{userId:otherId},s.owner)).status,200);
  assert.equal((await x.request('lessons/drafts','POST',lessonBody(s.course),other)).status,403);
  const created=(await x.request('lessons/drafts','POST',lessonBody(s.course),s.student)).data.lesson.id;
  assert.equal((await x.request('lessons/drafts','POST',{...lessonBody(s.course),title:'Different title'},s.student)).status,409);
  assert.equal((await x.request(`lessons/${created}/submit`,'POST',{},other)).status,403);
  assert.equal((await x.request(`lessons/${created}`)).status,404);
  assert.equal((await x.request('admin/review-queue','GET',undefined,s.student)).status,403);
  assert.equal((await x.request(`lessons/${created}/review`,'POST',{decision:'approve',reason:'Student self moderation'},s.student)).status,403);
 }finally{x.close();}
});
test('origin, payload-size, logout and invalid credentials checks',async()=>{
 const x=setup();try{
  const owner=await login(x,'owner@local.test','Correct Horse Battery Staple 42');
  assert.equal((await x.request('admin/institutions','POST',{name:'Invalid origin'},owner,'https://evil.test')).status,403);
  assert.equal((await x.request('admin/institutions','POST',{name:'A'.repeat(40000)},owner)).status,413);
  assert.equal((await x.request('admin/institutions','POST',{name:'Unauthenticated'})).status,401);
  assert.equal((await x.request('auth/login','POST',{email:'owner@local.test',password:'Wrong secret password'})).status,401);
  assert.equal((await x.request('me','GET',undefined,owner)).status,200);
  assert.equal((await x.request('auth/logout','POST',{},owner)).status,200);
  assert.equal((await x.request('me','GET',undefined,owner)).status,401);
 }finally{x.close();}
});
test('rejected lessons cannot be discovered; creator can resubmit',async()=>{
 const x=setup();try{
  const s=await begin(x);await x.request('admin/verify','POST',{userId:s.user},s.owner);
  const id=(await x.request('lessons/drafts','POST',lessonBody(s.course),s.student)).data.lesson.id;
  assert.equal((await x.request(`lessons/${id}/submit`,'POST',{},s.student)).data.lesson.status,'in_review');
  assert.equal((await x.request(`lessons/${id}/submit`,'POST',{},s.student)).data.lesson.status,'in_review');
  assert.equal((await x.request(`lessons/${id}/review`,'POST',{decision:'reject',reason:'Improve your original explanation'},s.owner)).data.lesson.status,'rejected');
  assert.equal((await x.request(`lessons/${id}`)).status,404);
  assert.equal((await x.request(`lessons/${id}/submit`,'POST',{},s.student)).data.lesson.status,'in_review');
 }finally{x.close();}
});
test('creator can correct rejected lesson, but cannot edit a submitted or published lesson',async()=>{
 const x=setup();try{
  const s=await begin(x);await x.request('admin/verify','POST',{userId:s.user},s.owner);
  const id=(await x.request('lessons/drafts','POST',lessonBody(s.course),s.student)).data.lesson.id;
  await x.request(`lessons/${id}/submit`,'POST',{},s.student);
  assert.equal((await x.request(`lessons/${id}/edit`,'POST',lessonBody(s.course),s.student)).status,409);
  await x.request(`lessons/${id}/review`,'POST',{decision:'reject',reason:'Please add a clearer example'},s.owner);
  const changed=await x.request(`lessons/${id}/edit`,'POST',{...lessonBody(s.course),title:'A clearer derivatives explanation'},s.student);
  assert.equal(changed.status,200);assert.equal(changed.data.lesson.title,'A clearer derivatives explanation');assert.equal(changed.data.lesson.status,'draft');
  await x.request(`lessons/${id}/submit`,'POST',{},s.student);
  await x.request(`lessons/${id}/review`,'POST',{decision:'approve',reason:'Revised explanation now accepted'},s.owner);
  assert.equal((await x.request(`lessons/${id}/edit`,'POST',lessonBody(s.course),s.student)).status,409);
 }finally{x.close();}
});
test('topics belong to one course and filter only its published lessons',async()=>{
 const x=setup();try{
  const s=await begin(x);
  const other=(await x.request('admin/courses','POST',{institutionId:s.institution,code:'MTH 102',title:'Advanced Calculus'},s.owner)).data.course.id;
  const topic=(await x.request('admin/topics','POST',{courseId:s.course,name:'Differentiation'},s.owner)).data.topic;
  const otherTopic=(await x.request('admin/topics','POST',{courseId:other,name:'Integration'},s.owner)).data.topic;
  const listing=await x.request(`courses/${s.course}/topics`);assert.equal(listing.status,200);assert.equal(listing.data.topics[0].id,topic.id);
  assert.equal((await x.request('admin/topics','POST',{courseId:s.course,name:'Differentiation'},s.owner)).status,409);
  await x.request('admin/verify','POST',{userId:s.user},s.owner);
  assert.equal((await x.request('lessons/drafts','POST',{...lessonBody(s.course),topicId:otherTopic.id},s.student)).status,422);
  const id=(await x.request('lessons/drafts','POST',{...lessonBody(s.course),topicId:topic.id},s.student)).data.lesson.id;
  await x.request(`lessons/${id}/submit`,'POST',{},s.student);
  await x.request(`lessons/${id}/review`,'POST',{decision:'approve',reason:'Appropriate peer explanation'},s.owner);
  const filtered=await x.request(`courses/${s.course}?topicId=${topic.id}`);assert.equal(filtered.status,200);assert.equal(filtered.data.lessons.length,1);
  assert.equal((await x.request(`courses/${s.course}?topicId=${otherTopic.id}`)).status,422);
  assert.equal(x.store.publicLessons(s.course,topic.id).length,1);
  assert.equal(x.store.publicLessons(s.course,otherTopic.id).length,0);
 }finally{x.close();}
});
test('opt-in creator messaging, private replies, block/report and anonymous denial',async()=>{
 const x=setup();try{
  const s=await begin(x);await x.request('admin/verify','POST',{userId:s.user},s.owner);
  const lid=(await x.request('lessons/drafts','POST',lessonBody(s.course),s.student)).data.lesson.id;
  await x.request(`lessons/${lid}/submit`,'POST',{},s.student);
  await x.request(`lessons/${lid}/review`,'POST',{decision:'approve',reason:'Original work accepted'},s.owner);
  const otherId=(await x.request('auth/register','POST',{email:'reader@campus.test',password:'Strong Reader Password 1234',institutionId:s.institution})).data.user.id;
  await x.request('admin/verify','POST',{userId:otherId},s.owner);
  const reader=await login(x,'reader@campus.test','Strong Reader Password 1234');
  assert.equal((await x.request(`messages/${s.user}`,'POST',{text:'Can you explain line two?'},reader)).status,403,'opt-out creator cannot receive unsolicited message');
  assert.equal((await x.request('messages/preference','POST',{allowMessages:true},s.student)).status,200);
  assert.equal((await x.request(`creators/${s.user}`)).data.creator.allowMessages,true);
  const sent=await x.request(`messages/${s.user}`,'POST',{text:'Can you explain line two?'},reader);assert.equal(sent.status,201);
  const messageId=sent.data.message.id;
  assert.equal((await x.request(`messages/${s.user}`)).status,401,'anonymous may not retrieve threads');
  const inbox=await x.request('messages/inbox','GET',undefined,s.student);assert.equal(inbox.data.inbox[0].peerId,otherId);
  const thread=await x.request(`messages/${otherId}`,'GET',undefined,s.student);assert.equal(thread.data.messages[0].body,'Can you explain line two?');
  assert.equal((await x.request(`messages/${otherId}`,'POST',{text:'Certainly: the numerator is expanded first.'},s.student)).status,201,'creator can reply to conversation request');
  assert.equal((await x.request('messages/report','POST',{messageId,reason:'Harassing content in direct message'},s.student)).status,201);
  assert.equal((await x.request('messages/report','POST',{messageId,reason:'Another report attempt'},reader)).status,404,'sender cannot report own outbound message');
  assert.equal((await x.request(`messages/${otherId}/block`,'POST',{},s.student)).status,200);
  assert.equal((await x.request(`messages/${s.user}`,'POST',{text:'One more question'},reader)).status,403);
 }finally{x.close();}
});
test('messaging enforces verified status, content length and recipient constraints',async()=>{
 const x=setup();try{
  const s=await begin(x);
  assert.equal((await x.request('messages/preference','POST',{allowMessages:true},s.student)).status,403);
  await x.request('admin/verify','POST',{userId:s.user},s.owner);
  assert.equal((await x.request(`messages/${s.user}`,'POST',{text:'self'},s.student)).status,422);
  assert.equal((await x.request(`messages/${s.user}`,'POST',{text:'A'.repeat(3000)},s.student)).status,422);
  assert.equal((await x.request('messages/preference','POST',{allowMessages:'yes'},s.student)).status,422);
  assert.equal((await x.request('messages/report','POST',{messageId:'not-real',reason:'Invalid message reference'},s.student)).status,404);
 }finally{x.close();}
});
test('reported messages are visible only to admin and can be resolved with an audit record',async()=>{
 const x=setup();try{
  const s=await begin(x);await x.request('admin/verify','POST',{userId:s.user},s.owner);
  const lid=(await x.request('lessons/drafts','POST',lessonBody(s.course),s.student)).data.lesson.id;
  await x.request(`lessons/${lid}/submit`,'POST',{},s.student);
  await x.request(`lessons/${lid}/review`,'POST',{decision:'approve',reason:'Original student lesson'},s.owner);
  await x.request('messages/preference','POST',{allowMessages:true},s.student);
  const readerId=(await x.request('auth/register','POST',{email:'reporter@campus.test',password:'Yet Another Strong Password 123',institutionId:s.institution})).data.user.id;
  await x.request('admin/verify','POST',{userId:readerId},s.owner);
  const reader=await login(x,'reporter@campus.test','Yet Another Strong Password 123');
  const incoming=(await x.request(`messages/${s.user}`,'POST',{text:'I have a question about your lesson'},reader)).data.message.id;
  const reported=await x.request('messages/report','POST',{messageId:incoming,reason:'Unwanted repeated message'},s.student);
  assert.equal(reported.status,201);
  assert.equal((await x.request('admin/reports','GET',undefined,s.student)).status,403);
  const queue=await x.request('admin/reports','GET',undefined,s.owner);assert.equal(queue.data.reports.length,1);
  const id=queue.data.reports[0].id;
  assert.equal((await x.request(`admin/reports/${id}`,'POST',{resolution:'Reviewed locally, no action required'},s.owner)).status,200);
  assert.equal((await x.request(`admin/reports/${id}`,'POST',{resolution:'Duplicate resolution'},s.owner)).status,409);
  assert.equal((await x.request('admin/reports','GET',undefined,s.owner)).data.reports.length,0);
  assert.equal((await x.request(`messages/${readerId}/block`,'POST',{},s.student)).status,200);
  assert.equal((await x.request(`messages/${readerId}/unblock`,'POST',{},s.student)).status,200);
  assert.equal((await x.request(`messages/${readerId}`,'GET',undefined,s.student)).data.blocked,false);
 }finally{x.close();}
});

test('DM unread state is recipient-only, atomic, replay-safe and private',async()=>{
 const x=setup();try{
  const s=await begin(x);await x.request('admin/verify','POST',{userId:s.user},s.owner);
  const lid=(await x.request('lessons/drafts','POST',lessonBody(s.course),s.student)).data.lesson.id;
  await x.request(`lessons/${lid}/submit`,'POST',{},s.student);
  assert.equal((await x.request(`lessons/${lid}/review`,'POST',{decision:'approve',reason:'Original work accepted'},s.owner)).status,200);
  assert.equal((await x.request('messages/preference','POST',{allowMessages:true},s.student)).status,200);
  async function reader(name){
   const email=name+'@campus.test',password='Strong Reader Password 1234';
   const id=(await x.request('auth/register','POST',{email,password,institutionId:s.institution})).data.user.id;
   await x.request('admin/verify','POST',{userId:id},s.owner);
   return {id,token:await login(x,email,password)};
  }
  const a=await reader('unread-a'),b=await reader('unread-b');
  const send=async(t,text)=>(await x.request(`messages/${s.user}`,'POST',{text},t)).data.message.id;
  const one=await send(a.token,'First private question'),two=await send(a.token,'Second private question'),foreign=await send(b.token,'Another conversation');
  const count=async(t,peer)=>(await x.request('messages/inbox','GET',undefined,t)).data.inbox.find(v=>v.peerId===peer)?.unreadCount;
  const mark=(peer,ids,t,origin)=>x.request(`messages/${peer}/read`,'POST',{messageIds:ids},t,origin);
  assert.equal(await count(s.student,a.id),2);assert.equal(await count(s.student,b.id),1);
  const page=await x.request('messages/inbox?limit=1','GET',undefined,s.student);
  assert.equal(page.status,200);assert.equal(page.data.inbox.length,1);
  assert.equal(page.data.nextBefore,page.data.inbox[0].peerId);
  const next=await x.request('messages/inbox?limit=1&before='+page.data.nextBefore,'GET',undefined,s.student);
  assert.equal(next.status,200);assert.equal(next.data.inbox.length,1);assert.equal(next.data.nextBefore,null);
  assert.notEqual(next.data.inbox[0].peerId,page.data.inbox[0].peerId);
  assert.equal((await x.request('messages/inbox?before='+a.id,'GET',undefined,b.token)).status,404);
  assert.equal((await x.request('messages/inbox?limit=51','GET',undefined,s.student)).status,422);
  assert.equal(await count(a.token,s.user),0);
  const history=await x.request(`messages/${a.id}`,'GET',undefined,s.student);
  assert.equal(history.data.messages.length,2);
  const latest=await x.request(`messages/${a.id}?limit=1`,'GET',undefined,s.student);
  assert.equal(latest.status,200);assert.equal(latest.data.messages.length,1);
  assert.equal(latest.data.nextBefore,latest.data.messages[0].id);
  const earlier=await x.request(`messages/${a.id}?limit=1&before=${latest.data.nextBefore}`,'GET',undefined,s.student);
  assert.equal(earlier.status,200);assert.equal(earlier.data.messages.length,1);assert.equal(earlier.data.nextBefore,null);
  assert.deepEqual([...earlier.data.messages,...latest.data.messages],history.data.messages);
  assert.equal((await x.request(`messages/${a.id}?before=${foreign}`,'GET',undefined,s.student)).status,404);
  assert.equal((await x.request(`messages/${s.user}?before=${one}`,'GET',undefined,b.token)).status,404);
  for(const q of ['limit=0','limit=101','limit=1.5','limit=1&limit=2','before=bad','before=']){
   assert.equal((await x.request(`messages/${a.id}?${q}`,'GET',undefined,s.student)).status,422);
  }
  assert.equal(await count(s.student,a.id),2,'GET does not mutate read state');
  assert.equal((await x.request(`messages/${a.id}`,'GET',undefined,b.token)).data.messages.length,0);
  assert.equal((await mark(a.id,[one],undefined)).status,401);
  assert.equal((await mark(s.user,[one],a.token)).status,404,'sender cannot mark its outbound message');
  assert.equal((await mark(a.id,[one],b.token)).status,404,'third party cannot mutate read state');
  assert.equal((await mark(a.id,[one,foreign],s.student)).status,404,'mixed peers rejected atomically');
  assert.equal(await count(s.student,a.id),2);
  assert.equal((await mark(a.id,[one,one],s.student)).status,422);
  assert.equal((await mark(a.id,[one],s.student,'https://foreign.invalid')).status,403);
  assert.equal((await mark(a.id,[one],s.student)).data.marked,1);
  assert.equal((await mark(a.id,[one],s.student)).data.marked,0);
  assert.equal(await count(s.student,a.id),1);
  assert.equal((await mark(a.id,[two],s.student)).data.marked,1);
  assert.equal(await count(s.student,a.id),0);
  assert.equal(await count(s.student,b.id),1);
  const outbound=await x.request(`messages/${s.user}`,'GET',undefined,a.token);
  assert.ok(outbound.data.messages.every(m=>!Object.hasOwn(m,'readAt')));
 }finally{x.close();}
});

test('in-app notifications are recipient-private, preference-aware, read-idempotent and contain no message body',async()=>{
 const x=setup();try{
  const s=await begin(x);await x.request('admin/verify','POST',{userId:s.user},s.owner);
  const lid=(await x.request('lessons/drafts','POST',lessonBody(s.course),s.student)).data.lesson.id;
  await x.request(`lessons/${lid}/submit`,'POST',{},s.student);
  await x.request(`lessons/${lid}/review`,'POST',{decision:'approve',reason:'Original work accepted'},s.owner);
  await x.request('messages/preference','POST',{allowMessages:true},s.student);
  const email='notification-reader@campus.test',password='Strong Reader Password 1234';
  const readerId=(await x.request('auth/register','POST',{email,password,institutionId:s.institution})).data.user.id;
  await x.request('admin/verify','POST',{userId:readerId},s.owner);
  const reader=await login(x,email,password);
  const list=async(token)=>(await x.request('notifications','GET',undefined,token)).data.notifications;
  assert.equal((await x.request('notifications')).status,401);
  assert.equal((await x.request('notifications','GET',undefined,s.owner)).status,403);
  assert.deepEqual((await x.request('notifications/preferences','GET',undefined,s.student)).data.preferences,{messages:true,social:true,community:true});
  assert.equal((await x.request(`messages/${s.user}`,'POST',{text:'Private text not in notifications'},reader)).status,201);
  assert.equal((await x.request(`creators/${s.user}/follow`,'POST',{},reader)).status,200);
  assert.equal((await x.request(`creators/${s.user}/follow`,'POST',{},reader)).status,200);
  const entries=await list(s.student);assert.equal(entries.length,2);
  assert.equal(JSON.stringify(entries).includes('Private text not in notifications'),false);
  assert.equal((await list(reader)).length,0);
  const id=entries.find(n=>n.kind==='message').id;
  assert.equal((await x.request(`notifications/${id}/read`,'POST',{},reader)).status,404);
  assert.equal((await x.request(`notifications/${id}/read`,'POST',{},s.student)).data.marked,1);
  assert.equal((await x.request(`notifications/${id}/read`,'POST',{},s.student)).data.marked,0);
  assert.ok((await list(s.student)).find(n=>n.id===id).readAt);
  assert.equal((await x.request('notifications/preferences','POST',{messages:false,social:false,community:true,userId:readerId},s.student)).status,422);
  assert.equal((await x.request('notifications/preferences','POST',{messages:false,social:false,community:true},s.student)).status,200);
  assert.equal((await x.request(`messages/${s.user}`,'POST',{text:'Still delivered, not notified'},reader)).status,201);
  assert.equal((await x.request(`lessons/${lid}/like`,'POST',{},reader)).status,201);
  assert.equal((await list(s.student)).length,2);
  assert.equal((await x.request(`messages/${readerId}`,'GET',undefined,s.student)).data.messages.length,2);
 }finally{x.close();}
});

test('account reports require an established contact or public profile and independent admin review',async()=>{
 const x=setup();try{
  const s=await begin(x);await x.request('admin/verify','POST',{userId:s.user},s.owner);
  const email='account-reporter@campus.test',password='Strong Reader Password 1234';
  const rid=(await x.request('auth/register','POST',{email,password,institutionId:s.institution})).data.user.id;
  await x.request('admin/verify','POST',{userId:rid},s.owner);
  const reader=await login(x,email,password);
  const path='users/'+s.user+'/report',body={category:'harassment',reason:'Repeated unwanted contact for review'};
  assert.equal((await x.request(path,'POST',body)).status,401);
  assert.equal((await x.request(path,'POST',body,reader)).status,404);
  assert.equal((await x.request('users/'+rid+'/report','POST',body,reader)).status,403);
  const lid=(await x.request('lessons/drafts','POST',lessonBody(s.course),s.student)).data.lesson.id;
  await x.request('lessons/'+lid+'/submit','POST',{},s.student);
  await x.request('lessons/'+lid+'/review','POST',{decision:'approve',reason:'Original work accepted'},s.owner);
  assert.equal((await x.request(path,'POST',{...body,targetId:rid},reader)).status,422);
  const made=await x.request(path,'POST',body,reader);assert.equal(made.status,201);
  assert.equal((await x.request(path,'POST',body,reader)).status,409);
  assert.equal((await x.request('admin/user-reports','GET',undefined,reader)).status,403);
  const queue=(await x.request('admin/user-reports','GET',undefined,s.owner)).data.reports;
  assert.equal(queue[0].targetId,s.user);assert.equal(queue[0].reporterId,rid);
  const resolve='admin/user-reports/'+made.data.report.id;
  assert.equal((await x.request(resolve,'POST',{resolution:'Reviewed report details'},reader)).status,403);
  assert.equal((await x.request(resolve,'POST',{resolution:'Reviewed report details'},s.owner)).status,200);
  assert.equal((await x.request(resolve,'POST',{resolution:'Repeated review'},s.owner)).status,409);
  assert.equal((await x.request('admin/user-reports','GET',undefined,s.owner)).data.reports.length,0);
  assert.equal((await x.request('me','GET',undefined,s.student)).status,200);
 }finally{x.close();}
});

test('text messaging rejects spoofed sender fields, unrelated account blocks and spam bursts',async()=>{
 const x=setup();try{
  const s=await begin(x);await x.request('admin/verify','POST',{userId:s.user},s.owner);
  const lid=(await x.request('lessons/drafts','POST',lessonBody(s.course),s.student)).data.lesson.id;
  await x.request('lessons/'+lid+'/submit','POST',{},s.student);
  await x.request('lessons/'+lid+'/review','POST',{decision:'approve',reason:'Original work accepted'},s.owner);
  await x.request('messages/preference','POST',{allowMessages:true},s.student);
  const email='spam-reader@campus.test',password='Strong Reader Password 1234';
  const rid=(await x.request('auth/register','POST',{email,password,institutionId:s.institution})).data.user.id;
  await x.request('admin/verify','POST',{userId:rid},s.owner);
  const reader=await login(x,email,password);
  assert.equal((await x.request('messages/'+rid+'/block','POST',{},s.student)).status,422);
  const path='messages/'+s.user;
  assert.equal((await x.request(path,'POST',{text:'Spoofed sender',senderId:s.user},reader)).status,400);
  assert.equal((await x.request(path,'POST',{text:'bad'+String.fromCharCode(0)+'text'},reader)).status,422);
  for(let i=0;i<30;i++)assert.equal((await x.request(path,'POST',{text:'Synthetic message '+i},reader)).status,201);
  assert.equal((await x.request(path,'POST',{text:'Above the rate limit'},reader)).status,429);
  assert.equal((await x.request('messages/inbox','GET',undefined,s.student)).data.inbox[0].unreadCount,30);
  assert.equal((await x.request('messages/'+rid+'/block','POST',{},s.student)).status,200);
  assert.equal((await x.request(path,'POST',{text:'Blocked now'},reader)).status,403);
 }finally{x.close();}
});
