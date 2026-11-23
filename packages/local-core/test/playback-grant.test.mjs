import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';

const media=Buffer.from(readFileSync(fileURLToPath(new URL('./fixtures/synthetic-1s.mp4.base64',import.meta.url)),'utf8'),'base64');
const textBody='An original synthetic guide to video access verification, showing a unique mathematical example and independently derived checks to explain each step without personal information.';

test('playback grants bind user, session, lesson and a five-minute expiry without exposing token in JSON',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'playback-grant-')),store=openLocalStore(join(dir,'campus.sqlite'));
 const request=async(path,method='GET',body,token,headers={})=>{
   const req=new Request('http://localhost:3000/api/local/'+path,{method,headers:{
     ...(token?{cookie:'campus_local_session='+token}:{}),
     ...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{}),...headers},
     ...(body===undefined?{}:{body:JSON.stringify(body)})});
   const res=await createLocalHandler(store)(req,path.split('/'));
   return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')};
 };
 try{
   store.bootstrapAdmin('admin@grant.test','Synthetic Admin Password 2026');
   const admin=store.login('admin@grant.test','Synthetic Admin Password 2026').user;
   const school=store.createInstitution(admin,'Synthetic Video Campus');
   const course=store.createCourse(admin,{institutionId:school.id,code:'VID101',title:'Original Video Research'});
   const pw='Synthetic Student Password 2026';
   const creator=store.register({email:'creator@grant.test',password:pw,institutionId:school.id});
   const buyer=store.register({email:'buyer@grant.test',password:pw,institutionId:school.id});
   store.verifyStudent(admin,creator.id);
   store.verifyStudent(admin,buyer.id);
   const author=store.login('creator@grant.test',pw),viewer=store.login('buyer@grant.test',pw);
   const lesson=store.createDraft(author.user,{courseId:course.id,title:'A protected synthetic MP4',
     description:'Original media',previewText:'A preview',lessonText:textBody,rightsAttested:true,
     creationKey:'grant-lesson-key-0000001'}).lesson.id;
   store.saveVideo(author.user,lesson,media);
   store.submit(author.user,lesson);
   store.review(admin,lesson,{decision:'approve',reason:'Original content accepted'});
   const path='lessons/'+lesson+'/playback-grant';
   assert.equal((await request(path,'POST',{})).status,401);
   assert.equal((await request(path,'POST',{},viewer.token,{origin:'https://outside.test'})).status,403);
   assert.equal((await request(path,'POST',{unknown:true},viewer.token)).status,400);
   const result=await request(path,'POST',{},viewer.token);
   assert.equal(result.status,200);
   assert.equal(Object.hasOwn(result.data,'token'),false);
   assert.match(result.cookie,/HttpOnly; SameSite=Strict; Max-Age=300/);
   const token=result.cookie.split(';')[0].split('=')[1];
   assert.equal(store.verifyPlaybackGrant(viewer.user,lesson,token,viewer.token),true);
   assert.throws(()=>store.verifyPlaybackGrant(author.user,lesson,token,author.token),/PLAYBACK_GRANT_REQUIRED/);
   assert.throws(()=>store.verifyPlaybackGrant(viewer.user,lesson,token+'x',viewer.token),/PLAYBACK_GRANT_REQUIRED/);
   const secondSession=store.login('buyer@grant.test',pw);
   assert.throws(()=>store.verifyPlaybackGrant(secondSession.user,lesson,token,secondSession.token),/PLAYBACK_GRANT_REQUIRED/);
   store.logout(viewer.token);
   assert.throws(()=>store.verifyPlaybackGrant(secondSession.user,lesson,token,secondSession.token),/PLAYBACK_GRANT_REQUIRED/);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
