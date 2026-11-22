import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';

const teaching='This is an original explanation of a real study technique. We break down the reasoning, show how to inspect a worked example, then apply it to a fresh exercise without submitting another person\'s answers as our own. All examples are synthetic and the content is free.';
async function withCampus(fn){
 const directory=mkdtempSync(join(tmpdir(),'student-engagement-')),db=join(directory,'study.sqlite');
 let store=openLocalStore(db);
 async function req(path,method='GET',body,token){
  const request=new Request('http://localhost:3000/api/local/'+path,{
   method,headers:{...(token?{cookie:'campus_local_session='+token}:{}),
     ...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const res=await createLocalHandler(store)(request,path.split('/'));
  return {status:res.status,data:await res.json(),token:res.headers.get('set-cookie')?.match(/campus_local_session=([^;]+)/)?.[1]};
 }
 try{
  store.bootstrapAdmin('admin@engagement.test','Strong Password Admin 2026');
  const admin=(await req('auth/login','POST',{email:'admin@engagement.test',password:'Strong Password Admin 2026'})).token;
  const institution=(await req('admin/institutions','POST',{name:'Learning Campus'},admin)).data.institution.id;
  const course=(await req('admin/courses','POST',{institutionId:institution,code:'CSC 200',title:'Original Research'},admin)).data.course.id;
  async function student(email,password,verify=true){
   const id=(await req('auth/register','POST',{email,password,institutionId:institution})).data.user.id;
   if(verify)await req('admin/verify','POST',{userId:id},admin);
   return {id,token:(await req('auth/login','POST',{email,password})).token};
  }
  const creator=await student('author@engagement.test','Strong Password Creator 2026');
  const reader=await student('reader@engagement.test','Strong Password Reader 2026');
  const other=await student('other@engagement.test','Strong Password Other 2026');
  const pending=await student('pending@engagement.test','Strong Password Pending 2026',false);
  const lesson=(await req('lessons/drafts','POST',{courseId:course,title:'Study tips for everyone',
    description:'Original worked study strategies',previewText:'Independent learning',
    lessonText:teaching,rightsAttested:true,creationKey:'engagement-approved-001'},creator.token)).data.lesson.id;
  const draft=(await req('lessons/drafts','POST',{courseId:course,title:'Private draft tips',
    description:'Hidden',previewText:'Hidden',lessonText:teaching,rightsAttested:true,
    creationKey:'engagement-private-0001'},creator.token)).data.lesson.id;
  assert.equal((await req('lessons/'+lesson+'/submit','POST',{},creator.token)).status,200);
  assert.equal((await req('lessons/'+lesson+'/review','POST',{decision:'approve',reason:'Original work approved'},admin)).status,200);
  await fn({req,lesson,draft,admin,creator,reader,other,pending,reopen(){store.close();store=openLocalStore(db);}});
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
}

test('comments allow idempotent creation and owner removal while excluding unpublished notes',()=>withCampus(async({req,lesson,reader,other,pending,reopen})=>{
 const key='engagement-comment-001',path='lessons/'+lesson+'/comments';
 assert.equal((await req(path)).data.comments.length,0);
 assert.equal((await req('lessons/'+lesson+'/comments','GET',undefined,pending.token)).status,200);
 assert.equal((await req('lessons/'+lesson+'/comments','POST',{text:'Unverified cannot post',creationKey:'pending_attempt_00001'},pending.token)).status,403);
 assert.equal((await req('lessons/'+draft+'/comments')).status,404);
 assert.equal((await req(path,'POST',{text:'An insightful point',creationKey:key})).status,401);
 assert.equal((await req(path,'POST',{text:'An insightful point',creationKey:key},pending.token)).status,403);
 assert.equal((await req(path,'POST',{text:'x',creationKey:key},reader.token)).status,422);
 const created=await req(path,'POST',{text:'An insightful question about this concept',creationKey:key},reader.token);
 assert.equal(created.status,201);
 assert.equal((await req(path,'POST',{text:'An insightful question about this concept',creationKey:key},reader.token)).status,200);
 assert.equal((await req(path,'POST',{text:'A different question with the same key',creationKey:key},reader.token)).status,409);
 const item=created.data.comment;
 assert.equal((await req(path)).data.comments[0].id,item.id);
 assert.equal((await req(path)).data.comments.length,1);
 assert.equal(JSON.stringify((await req(path)).data).includes('reader@engagement.test'),false);
 assert.equal((await req('lesson-comments/'+item.id+'/remove','POST',{},other.token)).status,404);
 reopen();
 assert.equal((await req(path)).data.comments.length,1);
 assert.equal((await req('lesson-comments/'+item.id+'/remove','POST',{},reader.token)).status,201);
 assert.equal((await req('lesson-comments/'+item.id+'/remove','POST',{},reader.token)).status,200);
 assert.equal((await req(path)).data.comments.length,0);
 assert.equal((await req(path)).data.comments.length,0);
 assert.equal((await req(path,'POST',{text:'An insightful question about this concept',creationKey:key},reader.token)).status,409);
}));

test('comments can be reported by others and hidden only through administrator review',()=>withCampus(async({req,lesson,reader,other,creator,admin})=>{
 const path='lessons/'+lesson+'/comments';
 const a=(await req(path,'POST',{text:'A useful on-topic learning comment',creationKey:'engagement-comment-002'},reader.token)).data.comment.id;
 const b=(await req(path,'POST',{text:'Another independent idea',creationKey:'engagement-comment-003'},creator.token)).data.comment.id;
 assert.equal((await req('admin/comment-reports')).status,401);
 assert.equal((await req('admin/comment-reports','GET',undefined,reader.token)).status,403);
 assert.equal((await req('lesson-comments/'+a+'/report','POST',{reason:'Copy-pasted abusive or misleading content'},reader.token)).status,403);
 const report=await req('lesson-comments/'+a+'/report','POST',{reason:'Potential harassment in a learning comment'},other.token);
 assert.equal(report.status,201);
 assert.equal((await req('lesson-comments/'+a+'/report','POST',{reason:'Potential harassment in a learning comment'},other.token)).status,409);
 assert.equal((await req('admin/comment-reports','GET',undefined,admin)).data.reports.length,1);
 assert.equal((await req('admin/comment-reports/'+report.data.report.reportId,'POST',{decision:'hide',reason:'Moderation completed'},reader.token)).status,403);
 assert.equal((await req('admin/comment-reports/'+report.data.report.reportId,'POST',{decision:'hide',reason:'Moderation completed'},admin)).status,200);
 assert.equal((await req('admin/comment-reports','GET',undefined,admin)).data.reports.length,0);
 assert.deepEqual((await req(path)).data.comments.map(x=>x.id),[b]);
 assert.equal((await req(path)).data.comments.length,1);
 assert.equal((await req('admin/comment-reports/'+report.data.report.reportId,'POST',{decision:'hide',reason:'Repeated action'},admin)).status,409);
 const r2=(await req('lesson-comments/'+b+'/report','POST',{reason:'Please check this explanation'},other.token)).data.report.reportId;
 assert.equal((await req('admin/comment-reports/'+r2,'POST',{decision:'dismiss',reason:'No violation found'},admin)).status,200);
 assert.equal((await req(path)).data.comments.length,1);
 assert.equal((await req('admin/comment-reports','GET',undefined,admin)).data.reports.length,0);
}));
