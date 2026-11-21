import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';

function setup(){
  const dir=mkdtempSync(join(tmpdir(),'campus-study-')),path=join(dir,'data.sqlite');
  let store=openLocalStore(path);
  store.bootstrapAdmin('owner@study.test','Correct Horse Battery Staple 42');
  async function request(route,method='GET',body,cookie){
    const url='http://localhost:3000/api/local/'+route;
    const r=new Request(url,{method,headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(cookie?{cookie:'campus_local_session='+cookie}:{}),...(method==='POST'?{origin:'http://localhost:3000'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const x=await createLocalHandler(store)(r,route.split('/'));
    return {status:x.status,data:await x.json(),cookie:x.headers.get('set-cookie')?.match(/campus_local_session=([^;]+)/)?.[1]};
  }
  async function login(email,password){const r=await request('auth/login','POST',{email,password});assert.equal(r.status,200);return r.cookie;}
  async function begin(){
    const admin=await login('owner@study.test','Correct Horse Battery Staple 42');
    const school=(await request('admin/institutions','POST',{name:'Example Campus'},admin)).data.institution.id;
    const other=(await request('admin/institutions','POST',{name:'Other Campus'},admin)).data.institution.id;
    const course=(await request('admin/courses','POST',{institutionId:school,code:'MTH101',title:'Calculus'},admin)).data.course.id;
    const topic=(await request('admin/topics','POST',{courseId:course,name:'Derivatives'},admin)).data.topic.id;
    const people={};
    for(const [name,institutionId] of [['alice',school],['bob',school],['charlie',school],['other',other]]){
      const email=name+'@example.test',password='Student Password Strong 123';
      const user=(await request('auth/register','POST',{email,password,institutionId})).data.user.id;
      people[name]={id:user,cookie:await login(email,password)};
      assert.equal((await request('admin/verify','POST',{userId:user},admin)).status,200);
    }
    return {admin,course,topic,...people};
  }
  return {begin,request,close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
const when=hours=>new Date(Date.now()+hours*3600000).toISOString();
const data=(key,extra={})=>({creationKey:'study-session-unique-'+key,title:'Calculus revision session',description:'Examples and questions',startsAt:when(2),endsAt:when(3),capacity:2,...extra});

test('server-side SQLite course study rounds are membership-scoped, persistent and replay-safe',async()=>{
  const x=setup();try{
    const a=await x.begin(),route='courses/'+a.course+'/study-sessions';
    assert.equal((await x.request(route,'GET',undefined,a.alice.cookie)).status,403);
    assert.equal((await x.request('courses/'+a.course+'/join','POST',{},a.alice.cookie)).status,200);
    assert.equal((await x.request('courses/'+a.course+'/join','POST',{},a.bob.cookie)).status,200);
    assert.equal((await x.request(route,'GET',undefined,a.other.cookie)).status,404);
    const item=data('first',{topicId:a.topic});
    const first=await x.request(route,'POST',item,a.alice.cookie);
    assert.equal(first.status,201);const id=first.data.session.id;
    const replay=await x.request(route,'POST',item,a.alice.cookie);
    assert.equal(replay.status,200);assert.equal(replay.data.session.id,id);
    assert.equal((await x.request(route,'POST',{...item,title:'Changed content'},a.alice.cookie)).status,409);
    const listed=await x.request(route,'GET',undefined,a.bob.cookie);
    assert.equal(listed.data.sessions.length,1);assert.equal(listed.data.sessions[0].topicId,a.topic);
    assert.equal((await x.request('study-sessions/'+id+'/rsvp','POST',{},a.bob.cookie)).status,200);
    assert.equal((await x.request('study-sessions/'+id+'/rsvp','POST',{},a.bob.cookie)).data.attendance.replayed,true);
  }finally{x.close();}
});

test('session capacity, authorization, cancellation and retry safety',async()=>{
  const x=setup();try{
    const a=await x.begin(),route='courses/'+a.course+'/study-sessions';
    for(const user of [a.alice,a.bob,a.charlie])await x.request('courses/'+a.course+'/join','POST',{},user.cookie);
    const session=(await x.request(route,'POST',data('second'),a.alice.cookie)).data.session.id;
    assert.equal((await x.request('study-sessions/'+session+'/rsvp','POST',{},a.bob.cookie)).status,200);
    assert.equal((await x.request('study-sessions/'+session+'/rsvp','POST',{},a.charlie.cookie)).status,409);
    assert.equal((await x.request('study-sessions/'+session+'/withdraw','POST',{},a.alice.cookie)).status,409);
    assert.equal((await x.request('study-sessions/'+session+'/withdraw','POST',{},a.bob.cookie)).status,200);
    assert.equal((await x.request('study-sessions/'+session+'/rsvp','POST',{},a.charlie.cookie)).status,200);
    assert.equal((await x.request('study-sessions/'+session+'/cancel','POST',{reason:'Host unavailable'},a.bob.cookie)).status,403);
    assert.equal((await x.request('study-sessions/'+session+'/cancel','POST',{reason:'Host unavailable'},a.alice.cookie)).data.session.status,'cancelled');
    assert.equal((await x.request('study-sessions/'+session+'/cancel','POST',{reason:'Host unavailable'},a.alice.cookie)).data.session.replayed,true);
    assert.equal((await x.request('study-sessions/'+session+'/rsvp','POST',{},a.bob.cookie)).status,409);
  }finally{x.close();}
});

test('invalid schedules, capacities and keys cannot create study rounds',async()=>{
  const x=setup();try{
    const a=await x.begin(),route='courses/'+a.course+'/study-sessions';
    await x.request('courses/'+a.course+'/join','POST',{},a.alice.cookie);
    for(const item of [data('bad',{capacity:1}),data('bad',{creationKey:'short'}),data('bad',{startsAt:when(0.01)}),data('bad',{endsAt:when(7)})]){
      assert.equal((await x.request(route,'POST',item,a.alice.cookie)).status,422);
    }
    assert.equal((await x.request(route,'POST',data('valid'),a.bob.cookie)).status,403);
    assert.equal((await x.request(route,'GET')).status,401);
  }finally{x.close();}
});
