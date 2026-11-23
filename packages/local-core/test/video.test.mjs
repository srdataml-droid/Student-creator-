import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {openLocalStore} from '../src/store.mjs';
import {DatabaseSync} from 'node:sqlite';
import {createLocalHandler} from '../src/http.mjs';
import {MAX_VIDEO_BYTES,parseVideoRange,validateMp4} from '../src/video.mjs';

// A synthetic, 1-second 32x32 MP4 generated for this repository, not third-party copyrighted media.
const fixture=Buffer.from(readFileSync(fileURLToPath(new URL('./fixtures/synthetic-1s.mp4.base64',import.meta.url)),'utf8'),'base64');
const explanation='This original explanation shows how the chain rule works for a composite function. Begin with the outer function, differentiate it, and multiply by the derivative of the inner expression. The included sample clip is an original synthetic placeholder, not an assignment for submission.';
function setup(){
  const dir=mkdtempSync(join(tmpdir(),'campus-video-'));
  const path=join(dir,'student.sqlite');
  let store=openLocalStore(path);
  store.bootstrapAdmin('admin@video.test','An Unusual Admin Password 2026');
  async function request(path,method='GET',payload,token,headers={}){
    const isVideo=payload instanceof Uint8Array;
    const req=new Request(`http://localhost:3000/api/local/${path}`,{
      method,headers:{...(token?{cookie:`campus_local_session=${token}`}:{}) , ...(method==='POST'?{origin:'http://localhost:3000'}:{}), ...(payload!==undefined?{'content-type':isVideo?'video/mp4':'application/json'}:{}),...headers},
      ...(payload!==undefined?{body:isVideo?payload:JSON.stringify(payload)}:{}),
    });
    const response=await createLocalHandler(store)(req,new URL(req.url).pathname.replace('/api/local/','').split('/'));
    const contentType=response.headers.get('content-type')||'';
    const body=method==='HEAD'?null:(contentType.includes('application/json')?await response.json():await response.arrayBuffer());
    return {response,body,status:response.status,cookie:response.headers.get('set-cookie')?.match(/campus_local_session=([^;]+)/)?.[1]};
  }
  async function login(email,password){const r=await request('auth/login','POST',{email,password});assert.equal(r.status,200);return r.cookie;}
  async function seed(){
    const admin=await login('admin@video.test','An Unusual Admin Password 2026');
    const school=(await request('admin/institutions','POST',{name:'Local Video Campus'},admin)).body.institution.id;
    const otherSchool=(await request('admin/institutions','POST',{name:'Another Campus'},admin)).body.institution.id;
    const course=(await request('admin/courses','POST',{institutionId:school,code:'VID101',title:'Camera Fundamentals'},admin)).body.course.id;
    const creator=(await request('auth/register','POST',{email:'creator@video.test',password:'Strong Video Student Password',institutionId:school})).body.user.id;
    const viewer=(await request('auth/register','POST',{email:'viewer@video.test',password:'Another Strong Video Password',institutionId:otherSchool})).body.user.id;
    await request('admin/verify','POST',{userId:creator},admin);
    await request('admin/verify','POST',{userId:viewer},admin);
    const student=await login('creator@video.test','Strong Video Student Password');
    const outsider=await login('viewer@video.test','Another Strong Video Password');
    const draft=await request('lessons/drafts','POST',{courseId:course,title:'Teaching a camera exposure formula',description:'A free, original visual lesson',previewText:'A short clip supporting the original text',lessonText:explanation,rightsAttested:true,creationKey:'video-draft-key-unique-0001'},student);
    assert.equal(draft.status,201);
    return {admin,school,otherSchool,course,student,outsider,lessonId:draft.body.lesson.id};
  }
  return {request,seed,path,get store(){return store;},close(){store.close();rmSync(dir,{recursive:true,force:true});},reopen(){store.close();store=openLocalStore(path);}};
}

test('MP4 validation accepts a real synthetic clip and rejects mislabeled bytes',()=>{
  assert.equal(validateMp4(fixture),true);
  assert.throws(()=>validateMp4(Buffer.from('not an mp4')),{message:'INVALID_VIDEO'});
  assert.throws(()=>validateMp4(Buffer.concat([Buffer.from(fixture.subarray(0,4)),Buffer.from('nope'),fixture.subarray(8)])),{message:'INVALID_VIDEO'});
  assert.throws(()=>validateMp4(Buffer.alloc(MAX_VIDEO_BYTES+1)),{message:'INVALID_VIDEO'});
});

test('video ranges reject multi-range, backward, out-of-bounds and invalid suffix requests',()=>{
  assert.deepEqual(parseVideoRange('bytes=0-3',100),{start:0,end:3,status:206});
  assert.deepEqual(parseVideoRange('bytes=-5',100),{start:95,end:99,status:206});
  assert.deepEqual(parseVideoRange('bytes=98-',100),{start:98,end:99,status:206});
  assert.deepEqual(parseVideoRange(null,100),{start:0,end:99,status:200});
  for(const range of ['bytes=1-0','bytes=100-','bytes=0-1,2-3','bytes=-0','items=0-3','bytes=99999999999999999999-'])assert.equal(parseVideoRange(range,100),null,range);
});

test('local MP4 upload is owner-only, limited, authenticated, and not public until moderation',async()=>{
  const x=setup();try{
    const {admin,student,outsider,lessonId}=await x.seed();
    assert.equal((await x.request(`lessons/${lessonId}/video`)).status,404);
    assert.equal((await x.request(`lessons/${lessonId}/video`,'POST',fixture)).status,401);
    assert.equal((await x.request(`lessons/${lessonId}/video`,'POST',fixture,outsider)).status,403);
    assert.equal((await x.request(`lessons/${lessonId}/video`,'POST',fixture,admin)).status,403);
    assert.equal((await x.request(`lessons/${lessonId}/video`,'POST',fixture,student,{origin:'https://evil.test'})).status,403);
    assert.equal((await x.request(`lessons/${lessonId}/video`,'POST',Buffer.from('not media'),student)).status,422);
    assert.equal((await x.request(`lessons/${lessonId}/video`,'POST',fixture,student,{'content-type':'text/html'})).status,415);
    assert.equal((await x.request(`lessons/${lessonId}/video`,'POST',fixture,student,{'content-length':String(MAX_VIDEO_BYTES+1)})).status,413);
    const upload=await x.request(`lessons/${lessonId}/video`,'POST',fixture,student);
    assert.equal(upload.status,201);
    assert.equal(upload.body.video.hasVideo,true);
    assert.equal(upload.body.video.sizeBytes,fixture.length);
    assert.equal((await x.request(`lessons/${lessonId}/video`,'POST',fixture,student)).body.video.replayed,true);
    const privatePlay=await x.request(`lessons/${lessonId}/video`,'GET',undefined,student,{range:'bytes=0-39'});
    assert.equal(privatePlay.status,206);
    assert.equal(privatePlay.response.headers.get('content-range'),`bytes 0-39/${fixture.length}`);
    assert.deepEqual(Buffer.from(privatePlay.body),fixture.subarray(0,40));
    assert.equal((await x.request(`lessons/${lessonId}/video`,'GET',undefined,outsider)).status,404);
    assert.equal((await x.request(`lessons/${lessonId}/video`)).status,404);
    assert.equal((await x.request(`lessons/${lessonId}/video`,'HEAD',undefined,admin)).status,200);
    assert.equal((await x.request(`lessons/${lessonId}/video`,'GET',undefined,admin,{range:'bytes=0-1,3-5'})).status,416);
  }finally{x.close();}
});

test('published video is streamed to verified students, survives restart, and cannot be silently replaced after approval',async()=>{
  const x=setup();try{
    const {admin,student,lessonId,course}=await x.seed();
    await x.request(`lessons/${lessonId}/video`,'POST',fixture,student);
    const queued=(await x.request('my/lessons','GET',undefined,student)).body.lessons;
    assert.equal(queued[0].hasVideo,true);
    await x.request(`lessons/${lessonId}/submit`,'POST',{},student);
    assert.equal((await x.request(`lessons/${lessonId}/video`,'POST',fixture,student)).status,409);
    const queue=await x.request('admin/review-queue','GET',undefined,admin);
    assert.equal(queue.body.lessons[0].hasVideo,true);
    await x.request(`lessons/${lessonId}/review`,'POST',{decision:'approve',reason:'Original lesson and video reviewed'},admin);
    const publicPage=await x.request(`lessons/${lessonId}`,'GET',undefined,student);
    assert.equal(publicPage.body.lesson.hasVideo,true);
    const catalog=await x.request(`courses/${course}`);
    assert.equal(catalog.body.lessons[0].hasVideo,true);
    assert.equal((await x.request(`lessons/${lessonId}/video`,'GET',undefined,student)).status,403);
    const grant=(await x.request(`lessons/${lessonId}/playback-grant`,'POST',{},student)).response.headers.get('set-cookie').split(';')[0];
    const secured={cookie:'campus_local_session='+student+'; '+grant};
    const full=await x.request(`lessons/${lessonId}/video`,'GET',undefined,student,secured);
    assert.equal(full.status,200);
    assert.equal(full.response.headers.get('content-type'),'video/mp4');
    assert.equal(full.response.headers.get('x-content-type-options'),'nosniff');
    assert.deepEqual(Buffer.from(full.body),fixture);
    const suffix=await x.request(`lessons/${lessonId}/video`,'GET',undefined,student,{range:'bytes=-20',...secured});
    assert.equal(suffix.status,206);
    assert.deepEqual(Buffer.from(suffix.body),fixture.subarray(-20));
    x.reopen();
    assert.equal((await x.request(`lessons/${lessonId}/video`,'HEAD',undefined,student,secured)).status,200);
    assert.equal(x.store.publicLesson(lessonId).hasVideo,true);
    assert.equal((await x.request(`lessons/${lessonId}/video`,'POST',fixture,student)).status,409);
  }finally{x.close();}
});

test('upload quota caps new file replacements and preserves existing playable media',async()=>{
  const x=setup();try{
    const {student,lessonId}=await x.seed();
    for(let i=0;i<8;i++){
      // A valid extension box keeps MP4 framing intact while varying the file digest.
      const freeBox=Buffer.alloc(9);freeBox.writeUInt32BE(9,0);freeBox.write('free',4);freeBox[8]=i;
      const variant=Buffer.concat([fixture,freeBox]);
      const uploaded=await x.request(`lessons/${lessonId}/video`,'POST',variant,student);
      assert.equal(uploaded.status,201,`upload ${i+1}`);
    }
    const blocked=await x.request(`lessons/${lessonId}/video`,'POST',Buffer.concat([fixture,Buffer.from([9])]),student);
    assert.equal(blocked.status,429);
    assert.equal(blocked.body.error,'VIDEO_RATE_LIMIT');
    // Even when future uploads are temporarily blocked, existing media still plays for its owner.
    assert.equal((await x.request(`lessons/${lessonId}/video`,'HEAD',undefined,student)).status,200);
  }finally{x.close();}
});

test('streamed upload size enforcement works without a declared content length',async()=>{
  const x=setup();try{
    const {student,lessonId}=await x.seed();
    const large=new ReadableStream({start(controller){
      controller.enqueue(new Uint8Array(MAX_VIDEO_BYTES));
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    }});
    const req=new Request(`http://localhost:3000/api/local/lessons/${lessonId}/video`,{
      method:'POST',headers:{origin:'http://localhost:3000','content-type':'video/mp4',cookie:`campus_local_session=${student}`},body:large,duplex:'half'
    });
    const response=await createLocalHandler(x.store)(req,['lessons',lessonId,'video']);
    assert.equal(response.status,413);
    assert.equal((await response.json()).error,'VIDEO_TOO_LARGE');
    assert.equal((await x.request(`lessons/${lessonId}/video`,'GET',undefined,student)).status,404);
  }finally{x.close();}
});

test('deactivated courses hide published lessons, notes, creator discovery and video from the public',async()=>{
  const x=setup();try{
    const {admin,student,outsider,lessonId,course}=await x.seed();
    const creatorId=x.store.getSession(student).id;
    await x.request(`lessons/${lessonId}/video`,'POST',fixture,student);
    await x.request(`lessons/${lessonId}/submit`,'POST',{},student);
    await x.request(`lessons/${lessonId}/review`,'POST',{decision:'approve',reason:'Original teaching material'},admin);
    assert.equal((await x.request(`lessons/${lessonId}`,'GET',undefined,student)).status,200);
    const grant=(await x.request(`lessons/${lessonId}/playback-grant`,'POST',{},student)).response.headers.get('set-cookie').split(';')[0];
    const secured={cookie:'campus_local_session='+student+'; '+grant};
    assert.equal((await x.request(`lessons/${lessonId}/video`,'HEAD',undefined,student,secured)).status,200);
    assert.equal((await x.request(`creators/${creatorId}`)).status,200);
    assert.equal((await x.request(`creators/${creatorId}/follow`,'POST',{},outsider)).status,200);
    assert.deepEqual((await x.request('following','GET',undefined,outsider)).body.creators,[creatorId]);

    // Synthetic administrative deactivation, because there is no public course-disable endpoint.
    const db=new DatabaseSync(x.path);
    try{db.prepare('UPDATE courses SET active=0 WHERE id=?').run(course);}
    finally{db.close();}
    assert.equal((await x.request(`courses/${course}`)).status,404);
    assert.equal((await x.request(`lessons/${lessonId}`)).status,404);
    assert.equal((await x.request(`lessons/${lessonId}/notes`)).status,404);
    assert.equal((await x.request(`lessons/${lessonId}/video`)).status,404);
    assert.equal((await x.request(`lessons/${lessonId}/video`,'HEAD')).status,404);
    assert.equal((await x.request(`creators/${creatorId}`)).status,404);
    assert.deepEqual((await x.request('following','GET',undefined,outsider)).body.creators,[]);
    assert.deepEqual(x.store.publicLessons(course),[]);
    assert.equal(x.store.publicLesson(lessonId),null);
    // Authors may still review their own existing media privately.
    assert.equal((await x.request(`lessons/${lessonId}/video`,'HEAD',undefined,student)).status,200);

    const restore=new DatabaseSync(x.path);
    try{restore.prepare('UPDATE courses SET active=1 WHERE id=?').run(course);}
    finally{restore.close();}
    assert.equal((await x.request(`lessons/${lessonId}`,'GET',undefined,student)).status,200);
    assert.equal((await x.request(`lessons/${lessonId}/video`,'HEAD',undefined,student,secured)).status,200);
  }finally{x.close();}
});
