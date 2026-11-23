import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openLocalStore,SESSION_COOKIE} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';

// A real MP4 container containing only synthetic frames, not student-owned media.
const mp4=Buffer.from(readFileSync(new URL('./fixtures/synthetic-1s.mp4.base64',import.meta.url),'utf8'),'base64');
const BASE='http://localhost:3000/api/local/';
const pilotEmail='one-consented-person@example.invalid';
const password='Strong Synthetic Student Password 2026';
const text='This is an original synthetic explanation. I introduce the problem, describe a worked example using independent data, explain each step in a clear order and check the result without revealing another student\'s assignment or private information.';

test('one-student alpha: invite, verify, original video, independent review, play and revoke',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'school-one-student-'));
  const store=openLocalStore(join(dir,'one.sqlite'),{pilotStudentCap:1,pilotAllowedEmail:pilotEmail});
  const handle=createLocalHandler(store);
  async function send(path,method='GET',body,token,extra={}){
    const media=body instanceof Uint8Array;
    const headers={...(token?{cookie:SESSION_COOKIE+'='+token}:{}),
      ...(method==='POST'?{origin:'http://localhost:3000'}:{}),
      ...(body!==undefined?{'content-type':media?'video/mp4':'application/json'}:{}),...extra};
    const input=new Request(BASE+path,{method,headers,
      ...(body===undefined?{}:{body:media?body:JSON.stringify(body)})});
    const response=await handle(input,path.split('/'));
    const type=response.headers.get('content-type')??'';
    const data=method==='HEAD'?null:type.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer());
    return {status:response.status,data,headers:response.headers,
      token:response.headers.get('set-cookie')?.match(/campus_local_session=([^;]+)/)?.[1]};
  }
  try{
    store.bootstrapAdmin('moderator@example.invalid','Strong Synthetic Moderator Password 2026');
    const admin=(await send('auth/login','POST',{email:'moderator@example.invalid',password:'Strong Synthetic Moderator Password 2026'})).token;
    const institution=(await send('admin/institutions','POST',{name:'One-Person Pilot University'},admin)).data.institution.id;
    const course=(await send('admin/courses','POST',{institutionId:institution,code:'ONE101',title:'Original Media'},admin)).data.course.id;
    const invite={email:pilotEmail,password,institutionId:institution};
    const rejected=await send('auth/register','POST',{...invite,email:'uninvited@example.invalid'});
    assert.equal(rejected.status,403);
    const registered=await send('auth/register','POST',invite);
    assert.equal(registered.status,201);
    const retry=await send('auth/register','POST',invite);
    assert.equal(retry.status,403);
    assert.equal(retry.data.error,'PILOT_CAP_REACHED');
    const owner=(await send('auth/login','POST',{email:pilotEmail,password})).token;
    const draftBody={courseId:course,title:'One original synthetic creator video',
      description:'An independent original teaching demonstration',previewText:'Original introduction',
      lessonText:text,rightsAttested:true,creationKey:'one-alpha-original-draft-2026'};
    assert.equal((await send('lessons/drafts','POST',draftBody,owner)).status,403);
    assert.equal((await send('admin/verify','POST',{userId:registered.data.user.id},admin)).status,200);
    const draft=await send('lessons/drafts','POST',draftBody,owner);
    assert.equal(draft.status,201);
    const id=draft.data.lesson.id;
    assert.equal((await send('lessons/'+id+'/video','POST',mp4,owner)).status,201);
    assert.equal((await send('lessons/'+id+'/video','GET',undefined,undefined)).status,404);
    assert.equal((await send('lessons/'+id+'/submit','POST',{},owner)).status,200);
    assert.equal((await send('lessons/'+id+'/review','POST',{decision:'approve',reason:'Synthetic rights-cleared original work'},admin)).status,200);
    assert.equal((await send('lessons/'+id+'/video','GET',undefined,owner)).status,403);
    const issued=(await send('lessons/'+id+'/playback-grant','POST',{},owner)).headers.get('set-cookie').split(';')[0];
    const secured={cookie:SESSION_COOKIE+'='+owner+'; '+issued};
    const playback=await send('lessons/'+id+'/video','GET',undefined,owner,{range:'bytes=0-15',...secured});
    assert.equal(playback.status,206);
    assert.deepEqual(playback.data,mp4.subarray(0,16));
    assert.match(playback.headers.get('cache-control')??'',/no-store/);
    assert.equal((await send('lessons/'+id,'GET',undefined,owner)).status,200);
    // The authenticated MP4 can still be downloaded; this is a known DRM limit, not a piracy fix.
    const fullVideo=await send('lessons/'+id+'/video','GET',undefined,owner,secured);
    assert.deepEqual(fullVideo.data,mp4);
    assert.equal((await send('lessons/'+id+'/video','GET')).status,401);
    assert.equal((await send('lessons/'+id+'/video','HEAD')).status,401);
    assert.equal((await send('auth/logout','POST',{},owner)).status,200);
    assert.equal((await send('lessons/'+id+'/video','GET',undefined,owner)).status,401);
    assert.equal((await send('lessons/'+id,'GET',undefined,owner)).status,401);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
