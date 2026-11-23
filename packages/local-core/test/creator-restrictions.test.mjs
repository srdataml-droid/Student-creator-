import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';

const mp4=Buffer.from(readFileSync(fileURLToPath(new URL('./fixtures/synthetic-1s.mp4.base64',import.meta.url)),'utf8'),'base64');
const lessonText='An original teaching walkthrough showing how to check assumptions, compare two approaches, derive a conclusion and apply the idea to a new independent exercise. It has no purchased or private student information.';
test('creator-owned view/comment/message settings persist and independently block comment and DM APIs',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'creator-permission-')),file=join(dir,'campus.sqlite');
  let store=openLocalStore(file);
  async function req(path,method='GET',body,token,headers={}){
    const request=new Request('http://localhost:3000/api/local/'+path,{
      method,headers:{...(token?{cookie:'campus_local_session='+token}:{}),
        ...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{}),...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const response=await createLocalHandler(store)(request,path.split('/'));
    const type=response.headers.get('content-type')||'';
    const data=type.includes('application/json')?await response.json():(method==='HEAD'?null:await response.arrayBuffer());
    return {status:response.status,data,headers:response.headers,
      token:response.headers.get('set-cookie')?.match(/campus_local_session=([^;]+)/)?.[1]};
  }
  try{
    store.bootstrapAdmin('admin@creator-restrictions.test','An Administrator Password 2026');
    const admin=(await req('auth/login','POST',{email:'admin@creator-restrictions.test',password:'An Administrator Password 2026'})).token;
    const school=(await req('admin/institutions','POST',{name:'Synthetic Creator College'},admin)).data.institution.id;
    const otherSchool=(await req('admin/institutions','POST',{name:'Another Synthetic Campus'},admin)).data.institution.id;
    const course=(await req('admin/courses','POST',{institutionId:school,code:'SAFE101',title:'Original Teaching'},admin)).data.course.id;
    async function student(name,institutionId,verified=true){
      const email=name+'@creator-restrictions.test',password='Synthetic Student Password 2026';
      const id=(await req('auth/register','POST',{email,password,institutionId})).data.user.id;
      if(verified)assert.equal((await req('admin/verify','POST',{userId:id},admin)).status,200);
      return {id,token:(await req('auth/login','POST',{email,password})).token};
    }
    const creator=await student('creator',school);
    const viewer=await student('viewer',school);
    const outsider=await student('outsider',otherSchool);
    const pending=await student('pending',school,false);
    const draft=(await req('lessons/drafts','POST',{courseId:course,title:'Protecting original tutorials',
      description:'Free synthetic tutorial',previewText:'Public excerpt',lessonText,rightsAttested:true,
      creationKey:'permission-test-draft-0001'},creator.token)).data.lesson.id;
    const up=new Request('http://localhost:3000/api/local/lessons/'+draft+'/video',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'video/mp4',cookie:'campus_local_session='+creator.token},body:mp4});
    assert.equal((await createLocalHandler(store)(up,['lessons',draft,'video'])).status,201);
    await req('lessons/'+draft+'/submit','POST',{},creator.token);
    assert.equal((await req('lessons/'+draft+'/review','POST',{decision:'approve',reason:'Independent approval'},admin)).status,200);
    assert.equal((await req('messages/preference','POST',{allowMessages:true},creator.token)).status,200);
    const route='creators/'+creator.id+'/restrictions/'+viewer.id;
    for(const path of ['lessons/'+draft,'lessons/'+draft+'/notes','lessons/'+draft+'/video','lessons/'+draft+'/comments'])assert.equal((await req(path)).status,401,path);
    assert.equal((await req('lessons/'+draft+'/video','HEAD')).status,401);
    assert.equal((await req('lessons/'+draft,'GET',undefined,pending.token)).status,403);
    assert.equal((await req('lessons/'+draft,'GET',undefined,viewer.token)).status,200);
    assert.equal((await req('lessons/'+draft+'/video','GET',undefined,viewer.token)).status,403);
    const grant=(await req('lessons/'+draft+'/playback-grant','POST',{},viewer.token)).headers.get('set-cookie').split(';')[0];
    const secured={cookie:'campus_local_session='+viewer.token+'; '+grant};
    const video=await req('lessons/'+draft+'/video','GET',undefined,viewer.token,secured);
    assert.equal(video.status,200);assert.equal(video.data.byteLength,mp4.length);
    assert.equal((await req('lessons/'+draft+'/notes','GET',undefined,viewer.token)).status,200);
    assert.equal((await req('creators/'+creator.id+'/restrictions')).status,401);
    assert.equal((await req('creators/'+creator.id+'/restrictions','GET',undefined,viewer.token)).status,403);
    assert.equal((await req('creators/'+creator.id+'/restrictions','GET',undefined,pending.token)).status,403);
    assert.equal((await req(route,'POST',{view:true,comment:true,message:true},viewer.token)).status,403);
    assert.equal((await req(route,'POST',{view:true,comment:true,message:true},pending.token)).status,403);
    assert.equal((await req('creators/'+creator.id+'/restrictions/'+creator.id,'POST',{view:true,comment:false,message:false},creator.token)).status,422);
    assert.equal((await req(route,'POST',{view:true,comment:false},creator.token)).status,422);
    assert.equal((await req(route,'POST',{view:false,comment:true,message:false,role:'admin'},creator.token)).status,422);

    assert.equal((await req(route,'POST',{view:false,comment:true,message:false},creator.token)).status,200);
    const own=await req('creators/'+creator.id+'/restrictions','GET',undefined,creator.token);
    assert.deepEqual(own.data.restrictions.map(x=>[x.viewerId,x.view,x.comment,x.message]),[[viewer.id,false,true,false]]);
    assert.equal(JSON.stringify(own.data).includes('@creator-restrictions.test'),false);
    assert.equal((await req('lessons/'+draft+'/comments','POST',{text:'A rejected comment',creationKey:'creator-perms-comment-01'},viewer.token)).status,403);
    assert.equal((await req('messages/'+creator.id,'POST',{text:'A permitted tutoring question'},viewer.token)).status,201);
    assert.equal((await req('lessons/'+draft+'/comments','POST',{text:'An independent comment',creationKey:'creator-perms-comment-02'},outsider.token)).status,201);

    assert.equal((await req(route,'POST',{view:false,comment:false,message:true},creator.token)).status,200);
    assert.equal((await req('lessons/'+draft+'/comments','POST',{text:'A now permitted comment',creationKey:'creator-perms-comment-03'},viewer.token)).status,201);
    assert.equal((await req('messages/'+creator.id,'POST',{text:'Blocked by creator'},viewer.token)).status,403);
    store.close();store=openLocalStore(file);
    assert.equal((await req('messages/'+creator.id,'POST',{text:'Still blocked after restart'},viewer.token)).status,403);
    assert.equal((await req(route,'POST',{view:false,comment:false,message:true},creator.token)).data.restriction.replayed,true);
    assert.equal((await req(route,'POST',{view:false,comment:false,message:false},creator.token)).status,200);
    assert.equal((await req('creators/'+creator.id+'/restrictions','GET',undefined,creator.token)).data.restrictions.length,0);
    assert.equal((await req('messages/'+creator.id,'POST',{text:'Allowed after lifting restriction'},viewer.token)).status,201);
    assert.equal((await req(route,'POST',{view:true,comment:false,message:false},creator.token)).status,200);
    for(const path of ['lessons/'+draft,'lessons/'+draft+'/notes','lessons/'+draft+'/video','lessons/'+draft+'/comments'])assert.equal((await req(path,'GET',undefined,viewer.token)).status,403,path);
    assert.equal((await req('lessons/'+draft+'/video','HEAD',undefined,viewer.token)).status,403);
    assert.equal((await req('lessons/'+draft+'/comments','POST',{text:'Denied even without a comment-only ban',creationKey:'viewer-blocked-comment-004'},viewer.token)).status,403);
    assert.equal((await req('messages/'+creator.id,'POST',{text:'Direct messaging remains allowed'},viewer.token)).status,201);
    assert.equal((await req('lessons/'+draft,'GET',undefined,outsider.token)).status,200);
    assert.equal((await req(route,'POST',{view:false,comment:false,message:false},creator.token)).status,200);
    assert.equal((await req('lessons/'+draft,'GET',undefined,viewer.token)).status,200);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
