import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';

function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'campus-community-')),path=join(dir,'store.sqlite');
  const store=openLocalStore(path);
  store.bootstrapAdmin('admin@local.test','Strong Admin Password 1111');
  async function request(route,method='GET',data,token,origin='http://localhost:3000'){
    const url=`http://localhost:3000/api/local/${route}`;
    const r=new Request(url,{method,headers:{...(data!==undefined?{'content-type':'application/json'}:{}),...(token?{cookie:`campus_local_session=${token}`}:{}),...(method==='POST'?{origin}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})});
    const res=await createLocalHandler(store)(r,route.split('?')[0].split('/'));
    return {status:res.status,data:await res.json(),token:res.headers.get('set-cookie')?.match(/campus_local_session=([^;]+)/)?.[1]};
  }
  async function login(email,password){const r=await request('auth/login','POST',{email,password});assert.equal(r.status,200);return r.token;}
  async function student(email,school){const password='Strong Student Password 2222';const row=await request('auth/register','POST',{email,password,institutionId:school});assert.equal(row.status,201);const session=await login(email,password);return{id:row.data.user.id,token:session};}
  async function bootstrap(){
    const admin=await login('admin@local.test','Strong Admin Password 1111');
    const school=(await request('admin/institutions','POST',{name:'Alpha University'},admin)).data.institution.id;
    const otherSchool=(await request('admin/institutions','POST',{name:'Beta University'},admin)).data.institution.id;
    const course=(await request('admin/courses','POST',{institutionId:school,code:'MTH 101',title:'Calculus I'},admin)).data.course.id;
    const otherCourse=(await request('admin/courses','POST',{institutionId:otherSchool,code:'MTH 101',title:'Calculus at Beta'},admin)).data.course.id;
    const topic=(await request('admin/topics','POST',{courseId:course,name:'Differentiation'},admin)).data.topic.id;
    const otherTopic=(await request('admin/topics','POST',{courseId:otherCourse,name:'Integration'},admin)).data.topic.id;
    const alice=await student('alice@alpha.test',school);
    const bob=await student('bob@alpha.test',school);
    const mallory=await student('mallory@beta.test',otherSchool);
    for(const person of [alice,bob,mallory])assert.equal((await request('admin/verify','POST',{userId:person.id},admin)).status,200);
    return {admin,school,otherSchool,course,otherCourse,topic,otherTopic,alice,bob,mallory};
  }
  return{request,login,bootstrap,store,path,close:()=>{store.close();rmSync(dir,{recursive:true,force:true});}};
}
const key=n=>`post-request-key-${String(n).padStart(10,'0')}`;
const body=(n,extra={})=>({text:`What is the meaning of differential calculus example ${n}?`,creationKey:key(n),...extra});

test('verified campus join: private access, safe replay, leave/rejoin and cross-campus denial',async()=>{
  const x=fixture();try{
    const d=await x.bootstrap();
    assert.equal((await x.request(`courses/${d.course}/community`)).status,401);
    assert.equal((await x.request(`courses/${d.course}/community`, 'GET',undefined,d.alice.token)).data.status.joined,false);
    assert.equal((await x.request(`courses/${d.course}/posts`,'POST',body(1),d.alice.token)).status,403);
    assert.equal((await x.request(`courses/${d.course}/join`,'POST',{},d.mallory.token)).status,404);
    assert.equal((await x.request(`courses/${d.course}/community`,'GET',undefined,d.mallory.token)).status,404);
    const pending=await x.request('auth/register','POST',{email:'pending@alpha.test',password:'Unverified Student Password 1234',institutionId:d.school});
    assert.equal(pending.status,201);
    const pendingToken=await x.login('pending@alpha.test','Unverified Student Password 1234');
    assert.equal((await x.request(`courses/${d.course}/join`,'POST',{},pendingToken)).status,403);
    assert.equal((await x.request(`courses/${d.course}/join`,'POST',{},undefined)).status,401);
    const j=await x.request(`courses/${d.course}/join`,'POST',{},d.alice.token);assert.equal(j.status,200);assert.equal(j.data.membership.replayed,false);
    const replay=await x.request(`courses/${d.course}/join`,'POST',{},d.alice.token);assert.equal(replay.data.membership.replayed,true);
    assert.equal((await x.request(`courses/${d.course}/community`,'GET',undefined,d.alice.token)).data.status.memberCount,1);
    assert.equal((await x.request(`courses/${d.course}/leave`,'POST',{},d.alice.token)).data.membership.joined,false);
    assert.equal((await x.request(`courses/${d.course}/leave`,'POST',{},d.alice.token)).status,200);
    assert.equal((await x.request(`courses/${d.course}/community`,'GET',undefined,d.alice.token)).data.posts.length,0);
    assert.equal((await x.request(`courses/${d.course}/join`,'POST',{fake:'field'},d.alice.token)).status,400);
  }finally{x.close();}
});

test('community posts: scoped topics, verified members, idempotency, replies and rate limit',async()=>{
  const x=fixture();try{
    const d=await x.bootstrap();
    await x.request(`courses/${d.course}/join`,'POST',{},d.alice.token);
    await x.request(`courses/${d.course}/join`,'POST',{},d.bob.token);
    const created=await x.request(`courses/${d.course}/posts`,'POST',body(1,{topicId:d.topic}),d.alice.token);
    assert.equal(created.status,201);const pid=created.data.post.id;
    assert.equal((await x.request(`courses/${d.course}/posts`,'POST',body(1,{topicId:d.topic}),d.alice.token)).data.replayed,true);
    assert.equal((await x.request(`courses/${d.course}/posts`,'POST',body(1,{topicId:d.topic,text:'A modified duplicate!'}),d.alice.token)).status,409);
    assert.equal((await x.request(`courses/${d.course}/posts`,'POST',body(2,{topicId:d.otherTopic}),d.alice.token)).status,422);
    assert.equal((await x.request(`courses/${d.course}/posts`,'POST',body(2,{replyTo:'fake'}),d.bob.token)).status,422);
    const reply=await x.request(`courses/${d.course}/posts`,'POST',body(2,{replyTo:pid}),d.bob.token);assert.equal(reply.status,201);
    assert.equal((await x.request(`courses/${d.course}/posts`,'POST',body(3,{replyTo:reply.data.post.id}),d.alice.token)).status,422);
    assert.equal((await x.request(`courses/${d.course}/posts`,'POST',{...body(3),text:'ok'},d.alice.token)).status,422);
    assert.equal((await x.request(`courses/${d.course}/posts`,'POST',{...body(3),creationKey:'short'},d.alice.token)).status,422);
    const feed=await x.request(`courses/${d.course}/community`,'GET',undefined,d.bob.token);
    assert.equal(feed.data.posts.length,2);assert.equal(feed.data.posts[1].parentId,pid);
    for(let n=4;n<=17;n++)assert.equal((await x.request(`courses/${d.course}/posts`,'POST',body(n),d.alice.token)).status,201);
    assert.equal((await x.request(`courses/${d.course}/posts`,'POST',body(18),d.alice.token)).status,429);
    assert.equal((await x.request(`courses/${d.course}/posts`,'POST',body(2,{replyTo:pid}),d.bob.token)).status,200,'same request key safely replays');
    assert.equal((await x.request(`courses/${d.otherCourse}/community`,'GET',undefined,d.alice.token)).status,404);
  }finally{x.close();}
});

test('reported course posts are admin-only; hide removes parent and replies without data destruction',async()=>{
  const x=fixture();try{
    const d=await x.bootstrap();
    await x.request(`courses/${d.course}/join`,'POST',{},d.alice.token);
    await x.request(`courses/${d.course}/join`,'POST',{},d.bob.token);
    const original=(await x.request(`courses/${d.course}/posts`,'POST',body(1),d.alice.token)).data.post;
    await x.request(`courses/${d.course}/posts`,'POST',body(2,{replyTo:original.id}),d.bob.token);
    assert.equal((await x.request('community/posts/report','POST',{postId:original.id,reason:'Student submitted leaked course solution'},d.alice.token)).status,403);
    assert.equal((await x.request('community/posts/report','POST',{postId:original.id,reason:'Unclear potentially prohibited content'},d.mallory.token)).status,404);
    const report=await x.request('community/posts/report','POST',{postId:original.id,reason:'Unclear potentially prohibited content'},d.bob.token);assert.equal(report.status,201);
    assert.equal((await x.request('community/posts/report','POST',{postId:original.id,reason:'Another report on same post'},d.bob.token)).status,409);
    assert.equal((await x.request('admin/community-reports','GET',undefined,d.bob.token)).status,403);
    const queue=await x.request('admin/community-reports','GET',undefined,d.admin);assert.equal(queue.data.reports.length,1);
    const reportId=report.data.report.id;
    assert.equal((await x.request(`admin/community-reports/${reportId}`,'POST',{decision:'hide',reason:'Prohibited assessment content'},d.bob.token)).status,403);
    assert.equal((await x.request(`admin/community-reports/${reportId}`,'POST',{decision:'hide',reason:'Prohibited assessment content'},d.admin)).status,200);
    assert.equal((await x.request(`courses/${d.course}/community`,'GET',undefined,d.bob.token)).data.posts.length,0);
    assert.equal((await x.request(`admin/community-reports/${reportId}`,'POST',{decision:'hide',reason:'Repeat attempt'},d.admin)).status,409);
    assert.equal((await x.request('community/posts/report','POST',{postId:original.id,reason:'Already hidden post'},d.bob.token)).status,404);
    assert.equal((await x.request('admin/community-reports','GET',undefined,d.admin)).data.reports.length,0);
    assert.ok(x.store.auditCount()>10);
  }finally{x.close();}
});

test('previous local SQLite files migrate additively; community membership/posts survive restart',async()=>{
  const x=fixture();let closed=false;try{
    const d=await x.bootstrap();await x.request(`courses/${d.course}/join`,'POST',{},d.alice.token);
    const created=(await x.request(`courses/${d.course}/posts`,'POST',body(1),d.alice.token)).data.post.id;
    x.store.close();closed=true;
    const reopened=openLocalStore(x.path);
    try{assert.equal(reopened.communityPosts({id:d.alice.id,role:'student',institutionId:d.school,verifiedAt:new Date().toISOString(),suspended:false},d.course)[0].id,created);}finally{reopened.close();}
  }finally{if(!closed)x.store.close();rmSync(x.path.substring(0,x.path.lastIndexOf('/')),{recursive:true,force:true});}
});

test('course moderator role is assigned only by platform admin and lost when membership ends',async()=>{
 const x=fixture();try{
  const d=await x.bootstrap();
  const role=(course,user)=>`admin/community-moderators/${course}/${user}`;
  const grant={enabled:true,reason:'Trusted course moderator'};
  assert.equal((await x.request(role(d.course,d.alice.id),'POST',grant,d.alice.token)).status,403);
  assert.equal((await x.request(role(d.course,d.alice.id),'POST',grant,d.admin)).status,403);
  await x.request(`courses/${d.course}/join`,'POST',{},d.alice.token);
  await x.request(`courses/${d.course}/join`,'POST',{},d.bob.token);
  await x.request(`courses/${d.otherCourse}/join`,'POST',{},d.mallory.token);
  assert.equal((await x.request(role(d.course,d.mallory.id),'POST',grant,d.admin)).status,403);
  assert.equal((await x.request(role(d.course,d.alice.id),'POST',grant,d.admin)).status,200);
  assert.equal((await x.request(role(d.course,d.alice.id),'POST',grant,d.admin)).data.moderator.replayed,true);
  const feed=async(token)=>(await x.request(`courses/${d.course}/community`,'GET',undefined,token)).data;
  assert.equal((await feed(d.alice.token)).status.canModerate,true);assert.equal((await feed(d.bob.token)).status.canModerate,false);
  const parent=(await x.request(`courses/${d.course}/posts`,'POST',body(100),d.bob.token)).data.post;
  const reply=(await x.request(`courses/${d.course}/posts`,'POST',body(101,{replyTo:parent.id}),d.alice.token)).data.post;
  const foreign=(await x.request(`courses/${d.otherCourse}/posts`,'POST',body(102),d.mallory.token)).data.post;
  const hide=(course,id,token)=>x.request(`courses/${course}/posts/${id}/hide`,'POST',{reason:'Violates course rules'},token);
  assert.equal((await hide(d.course,parent.id,d.bob.token)).status,403);
  assert.equal((await hide(d.course,foreign.id,d.alice.token)).status,404);
  assert.equal((await hide(d.otherCourse,foreign.id,d.alice.token)).status,404);
  assert.equal((await hide(d.course,reply.id,d.alice.token)).status,403);
  assert.equal((await x.request('admin/community-reports','GET',undefined,d.alice.token)).status,403);
  assert.equal((await hide(d.course,parent.id,d.alice.token)).status,200);
  assert.equal((await hide(d.course,parent.id,d.alice.token)).data.post.replayed,true);
  assert.equal((await feed(d.bob.token)).posts.length,0);
  assert.equal((await x.request(`courses/${d.course}/posts`,'POST',body(100),d.bob.token)).status,404);
  assert.equal((await x.request(`courses/${d.course}/posts`,'POST',body(101,{replyTo:parent.id}),d.alice.token)).status,404);
  assert.equal((await x.request('community/posts/report','POST',{postId:reply.id,reason:'Reply is hidden with parent'},d.bob.token)).status,404);
  const notifications=await x.request('notifications','GET',undefined,d.bob.token);
  assert.equal(notifications.data.notifications.length,0,'hidden parent makes reply notification invisible');
  await x.request(`courses/${d.course}/leave`,'POST',{},d.alice.token);
  await x.request(`courses/${d.course}/join`,'POST',{},d.alice.token);
  assert.equal((await feed(d.alice.token)).status.canModerate,false);
  assert.equal((await hide(d.course,parent.id,d.alice.token)).status,403);
  await x.request(role(d.course,d.alice.id),'POST',grant,d.admin);
  assert.equal((await x.request(role(d.course,d.alice.id),'POST',{enabled:false,reason:'Role withdrawn'},d.admin)).status,200);
  assert.equal((await feed(d.alice.token)).status.canModerate,false);
 }finally{x.close();}
});
