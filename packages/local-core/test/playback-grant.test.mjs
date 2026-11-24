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
   assert.throws(()=>store.getVideoFile(viewer.user,lesson),/PLAYBACK_GRANT_REQUIRED/);
   assert.equal(store.verifyPlaybackGrant(viewer.user,lesson,token,viewer.token),true);
   assert.equal(store.getVideoFile(viewer.user,lesson,token,viewer.token).sizeBytes,media.length);
   assert.throws(()=>store.verifyPlaybackGrant(author.user,lesson,token,author.token),/PLAYBACK_GRANT_REQUIRED/);
   assert.throws(()=>store.verifyPlaybackGrant(viewer.user,lesson,token+'x',viewer.token),/PLAYBACK_GRANT_REQUIRED/);
   const secondSession=store.login('buyer@grant.test',pw);
   assert.throws(()=>store.verifyPlaybackGrant(secondSession.user,lesson,token,secondSession.token),/PLAYBACK_GRANT_REQUIRED/);
   store.setCreatorRestrictions(author.user,author.user.id,viewer.user.id,{view:true,comment:false,message:false});
   assert.throws(()=>store.getVideoFile(viewer.user,lesson,token,viewer.token),/CREATOR_ACCESS_RESTRICTED/);
   const {DatabaseSync}=await import('node:sqlite');
   const db=new DatabaseSync(join(dir,'campus.sqlite'));
   try{
     assert.equal(db.prepare('SELECT count(*) AS n FROM playback_grants WHERE user_id=?').get(viewer.user.id).n,0);
   }finally{db.close();}
   store.setCreatorRestrictions(author.user,author.user.id,viewer.user.id,{view:false,comment:false,message:false});
   assert.throws(()=>store.getVideoFile(viewer.user,lesson,token,viewer.token),/PLAYBACK_GRANT_REQUIRED/);
   const renewed=store.issuePlaybackGrant(viewer.user,lesson,viewer.token);
   assert.equal(store.getVideoFile(viewer.user,lesson,renewed.token,viewer.token).sizeBytes,media.length);
   const expiredDb=new DatabaseSync(join(dir,'campus.sqlite'));
   try{expiredDb.prepare('UPDATE playback_grants SET expires_at=0').run();}finally{expiredDb.close();}
   assert.throws(()=>store.getVideoFile(viewer.user,lesson,renewed.token,viewer.token),/PLAYBACK_GRANT_REQUIRED/);
   const live1=store.issuePlaybackGrant(viewer.user,lesson,viewer.token);
   const live2=store.issuePlaybackGrant(secondSession.user,lesson,secondSession.token);
   const authorGrant=store.issuePlaybackGrant(author.user,lesson,author.token);
   assert.equal((await request('auth/logout-all','POST',{},undefined)).status,401);
   assert.equal((await request('auth/logout-all','POST',{userId:author.user.id},viewer.token)).status,400);
   assert.equal((await request('auth/logout-all','POST',{},viewer.token,{origin:'https://outside.test'})).status,403);
   const revoked=await request('auth/logout-all','POST',{},viewer.token);
   assert.equal(revoked.status,200);assert.equal(revoked.data.revokedCount,2);
   assert.match(revoked.cookie,/Max-Age=0/);
   assert.equal(store.getSession(viewer.token),null);
   assert.equal(store.getSession(secondSession.token),null);
   assert.throws(()=>store.verifyPlaybackGrant(viewer.user,lesson,live1.token,viewer.token),/PLAYBACK_GRANT_REQUIRED/);
   assert.throws(()=>store.verifyPlaybackGrant(secondSession.user,lesson,live2.token,secondSession.token),/PLAYBACK_GRANT_REQUIRED/);
   assert.equal(store.verifyPlaybackGrant(author.user,lesson,authorGrant.token,author.token),true);
   assert.equal((await request('auth/logout-all','POST',{},viewer.token)).status,401);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('student suspension revokes sessions and creator playback grants; reinstatement requires fresh login',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'student-suspension-')),store=openLocalStore(join(dir,'campus.sqlite'));
 const pw='Synthetic Student Password 2026',adminPw='Synthetic Admin Password 2026';
 const request=async(path,body,token,origin='http://localhost:3000')=>{
  const req=new Request('http://localhost:3000/api/local/'+path,{method:'POST',headers:{origin,'content-type':'application/json',...(token?{cookie:'campus_local_session='+token}:{})},body:JSON.stringify(body)});
  const res=await createLocalHandler(store)(req,path.split('/'));
  return {status:res.status,data:await res.json()};
 };
 try{
  store.bootstrapAdmin('operator@suspension.test',adminPw);
  const operator=store.login('operator@suspension.test',adminPw);
  const school=store.createInstitution(operator.user,'Synthetic Suspension Campus');
  const course=store.createCourse(operator.user,{institutionId:school.id,code:'SEC101',title:'Synthetic Security'});
  const creator=store.register({email:'creator@suspension.test',password:pw,institutionId:school.id});
  const buyer=store.register({email:'buyer@suspension.test',password:pw,institutionId:school.id});
  store.verifyStudent(operator.user,creator.id);store.verifyStudent(operator.user,buyer.id);
  const author=store.login('creator@suspension.test',pw),viewer=store.login('buyer@suspension.test',pw);
  const second=store.login('creator@suspension.test',pw);
  const lesson=store.createDraft(author.user,{courseId:course.id,title:'Synthetic suspension video',description:'Original',previewText:'Preview',lessonText:textBody,rightsAttested:true,creationKey:'suspension-lesson-key-0001'}).lesson.id;
  store.saveVideo(author.user,lesson,media);store.submit(author.user,lesson);
  store.review(operator.user,lesson,{decision:'approve',reason:'Original content accepted'});
  const grant=store.issuePlaybackGrant(viewer.user,lesson,viewer.token);
  const ownGrant=store.issuePlaybackGrant(author.user,lesson,author.token);
  const path='admin/students/'+creator.id+'/suspension',decision={suspended:true,reason:'Synthetic policy review'};
  assert.equal((await request(path,decision)).status,401);
  assert.equal((await request(path,decision,viewer.token)).status,403);
  assert.equal((await request(path,decision,operator.token,'https://outside.test')).status,403);
  assert.equal((await request(path,{...decision,userId:buyer.id},operator.token)).status,400);
  assert.equal((await request(path,{...decision,suspended:'true'},operator.token)).status,422);
  assert.equal((await request('admin/students/'+operator.user.id+'/suspension',decision,operator.token)).status,404);
  const result=await request(path,decision,operator.token);
  assert.equal(result.status,200);assert.equal(result.data.student.revokedSessions,2);
  assert.equal(result.data.student.revokedCreatorGrants,1);
  assert.equal(store.getSession(author.token),null);assert.equal(store.getSession(second.token),null);
  assert.equal(store.login('creator@suspension.test',pw),null);
  assert.ok(store.getSession(viewer.token));
  assert.throws(()=>store.getVideoFile(viewer.user,lesson,grant.token,viewer.token),/CREATOR_UNAVAILABLE/);
  assert.throws(()=>store.verifyPlaybackGrant(author.user,lesson,ownGrant.token,author.token),/VERIFICATION_REQUIRED/);
  assert.equal((await request(path,decision,operator.token)).status,409);
  assert.equal((await request(path,{suspended:false,reason:'Synthetic reinstatement review'},operator.token)).status,200);
  assert.equal(store.getSession(author.token),null);assert.equal(store.getSession(second.token),null);
  assert.throws(()=>store.getVideoFile(viewer.user,lesson,grant.token,viewer.token),/PLAYBACK_GRANT_REQUIRED/);
  const fresh=store.login('creator@suspension.test',pw);assert.ok(fresh?.token);
  const freshGrant=store.issuePlaybackGrant(viewer.user,lesson,viewer.token);
  assert.equal(store.getVideoFile(viewer.user,lesson,freshGrant.token,viewer.token).sizeBytes,media.length);
  const {DatabaseSync}=await import('node:sqlite');
  const db=new DatabaseSync(join(dir,'campus.sqlite'));
  try{
   const events=db.prepare("SELECT actor_id,action FROM audit_events WHERE resource_id=? AND action IN ('student.suspended','student.reinstated') ORDER BY rowid").all(creator.id);
   assert.deepEqual(events.map(e=>[e.actor_id,e.action]),[[operator.user.id,'student.suspended'],[operator.user.id,'student.reinstated']]);
  }finally{db.close();}
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
