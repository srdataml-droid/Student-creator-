import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';
import {parseVideoRange,validateMp4} from '../src/video.mjs';

// Original synthetic one-second MP4; never use a header-only fake to validate uploads.
const mp4=Buffer.from(readFileSync(fileURLToPath(new URL('./fixtures/synthetic-1s.mp4.base64',import.meta.url)),'utf8'),'base64');
const explanation='An original teaching note: start with the question, describe a related example, work through the method, and verify the result. This explanation is original study material, not a completed graded assignment for submission.';

test('MP4 signature checks and seek ranges reject invalid values',()=>{
 assert.equal(validateMp4(mp4),true);
 assert.throws(()=>validateMp4(Buffer.alloc(64)),/INVALID_VIDEO/);
 assert.deepEqual(parseVideoRange('bytes=0-9',64),{start:0,end:9,status:206});
 assert.deepEqual(parseVideoRange('bytes=-5',64),{start:59,end:63,status:206});
 assert.equal(parseVideoRange('bytes=2-1',64),null);
 assert.equal(parseVideoRange('bytes=0-2,4-7',64),null);
});

test('SQLite video upload, private review, publication and persistence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'campus-video-contract-'));
 let store=openLocalStore(join(dir,'campus.sqlite'));
 try{
  store.bootstrapAdmin('admin@local.test','Strong Administrator Password 2026');
  async function send(route,method='GET',body,token,headers={}){
   const media=body instanceof Uint8Array;
   const req=new Request('http://localhost:3000/api/local/'+route,{
    method,headers:{...(token?{cookie:'campus_local_session='+token}:{}),
      ...(method==='POST'?{origin:'http://localhost:3000'}:{}),
      ...(body!==undefined?{'content-type':media?'video/mp4':'application/json'}:{}),...headers},
    ...(body!==undefined?{body:media?body:JSON.stringify(body)}:{})
   });
   const response=await createLocalHandler(store)(req,route.split('/'));
   const type=response.headers.get('content-type')||'';
   const content=method==='HEAD'?null:(type.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer()));
   return {status:response.status,data:content,cookie:response.headers.get('set-cookie')?.match(/campus_local_session=([^;]+)/)?.[1]};
  }
  const admin=(await send('auth/login','POST',{email:'admin@local.test',password:'Strong Administrator Password 2026'})).cookie;
  const school=(await send('admin/institutions','POST',{name:'Example Video Campus'},admin)).data.institution.id;
  const course=(await send('admin/courses','POST',{institutionId:school,code:'VID 101',title:'Video Study Skills'},admin)).data.course.id;
  const uid=(await send('auth/register','POST',{email:'creator@local.test',password:'Strong Creator Password 2026',institutionId:school})).data.user.id;
  await send('admin/verify','POST',{userId:uid},admin);
  const creator=(await send('auth/login','POST',{email:'creator@local.test',password:'Strong Creator Password 2026'})).cookie;
  const id=(await send('lessons/drafts','POST',{courseId:course,title:'Understanding video lessons',description:'Original visual explanation',previewText:'Learning demonstration',lessonText:explanation,rightsAttested:true,creationKey:'unique-video-lesson-2026-001'},creator)).data.lesson.id;
  assert.equal((await send('lessons/'+id+'/video')).status,404);
  assert.equal((await send('lessons/'+id+'/video','POST',mp4)).status,401);
  assert.equal((await send('lessons/'+id+'/video','POST',Buffer.from('bad'),creator)).status,422);
  assert.equal((await send('lessons/'+id+'/video','POST',mp4,creator)).status,201);
  assert.equal((await send('lessons/'+id+'/video','POST',mp4,creator)).status,200);
  assert.equal((await send('lessons/'+id+'/video')).status,404);
  const ownRange=await send('lessons/'+id+'/video','GET',undefined,creator,{range:'bytes=0-4'});
  assert.equal(ownRange.status,206);
  assert.deepEqual(ownRange.data,mp4.subarray(0,5));
  await send('lessons/'+id+'/submit','POST',{},creator);
  assert.equal((await send('lessons/'+id+'/video','POST',mp4,creator)).status,409);
  await send('lessons/'+id+'/review','POST',{decision:'approve',reason:'Verified original visual study material'},admin);
  assert.equal((await send('lessons/'+id)).data.lesson.hasVideo,true);
  assert.deepEqual((await send('lessons/'+id+'/video')).data,mp4);
  store.close();
  store=openLocalStore(join(dir,'campus.sqlite'));
  assert.equal((await send('lessons/'+id+'/video','HEAD')).status,200);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
