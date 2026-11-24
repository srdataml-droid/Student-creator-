import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';
import {createResendLearningEmail} from '../src/learning-email.mjs';

test('learning email requires creator opt-in plus account email proof and is idempotent',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'wk06-learning-email-'));
 const clock={time:Date.now()};
 const store=openLocalStore(join(folder,'data.sqlite'),{learningClock:()=>clock.time});
 const records=[];const sender={environment:'synthetic',
   async send(input){records.push(input);return {messageId:'synthetic-mail-id-'+records.length};}};
 const handle=createLocalHandler(store,{learningEmailDelivery:sender});
 async function call(path,method='GET',body,token){
  const req=new Request('http://localhost:3000/api/local/'+path,{method,
    headers:{...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{}),
      ...(token?{cookie:'campus_local_session='+token}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const response=await handle(req,path.split('/'));return {status:response.status,data:await response.json()};
 }
 try{
  const password='Synthetic Email Password Strong 2026';
  store.bootstrapAdmin('admin@email-wk06.invalid',password);
  const admin=store.login('admin@email-wk06.invalid',password);
  const school=store.createInstitution(admin.user,'Campus Notification Alpha');
  const students=[];
  for(const tag of ['guide','learner']){
   const email=tag+'@email-wk06.invalid';
   const registered=store.register({email,password,institutionId:school.id});
   store.verifyStudent(admin.user,registered.id);
   students.push(store.login(email,password));
  }
  const [guide,learner]=students;
  const endpoint='me/learning-email-preferences';
  assert.equal((await call(endpoint,'GET',undefined,guide.token)).data.preferences.emailOptIn,false);
  assert.equal((await call(endpoint,'POST',{emailOptIn:true},guide.token)).status,403);
  const proof=store.requestEmailVerification(guide.token);
  assert.ok(proof?.token);
  store.confirmEmailVerification(guide.token,proof.token);
  assert.equal((await call(endpoint,'POST',{emailOptIn:true},guide.token)).status,200);
  assert.equal((await call(endpoint,'GET',undefined,guide.token)).data.preferences.emailVerified,true);
  const created=await call('learning-requests','POST',{
    creatorId:guide.user.id,kind:'tutoring',
    description:'I would like an original explanation of this concept to learn the method, not a graded answer.',
    creationKey:'wk06-notify-unique-help-2026',integrityAttested:true
  },learner.token);
  assert.equal(created.status,201);
  assert.equal((await call('admin/learning-emails/drain','POST',{},learner.token)).status,403);
  const result=await call('admin/learning-emails/drain','POST',{},admin.token);
  assert.equal(result.status,200);assert.equal(result.data.delivery.sent,1);
  assert.equal(records.length,1);
  assert.equal(records[0].to,'guide@email-wk06.invalid');
  assert.match(records[0].text,/A student requested learning guidance/);
  assert.equal(records[0].idempotencyKey.length>=16,true);
  const repeated=await call('admin/learning-emails/drain','POST',{},admin.token);
  assert.equal(repeated.data.delivery.sent,0);assert.equal(records.length,1);
  assert.equal((await call(endpoint,'POST',{emailOptIn:false},guide.token)).status,200);
  const second=await call('learning-requests','POST',{
    creatorId:guide.user.id,kind:'project_guidance',
    description:'Please explain the steps required for my original research and the reasoning, not a submission.',
    creationKey:'wk06-notify-second-help-2026',integrityAttested:true
  },learner.token);
  assert.equal(second.status,201);
  assert.equal((await call('admin/learning-emails/drain','POST',{},admin.token)).data.delivery.sent,0);
  assert.equal(records.length,1);
 }finally{store.close();rmSync(folder,{recursive:true,force:true});}
});

test('retryable notice delivery does not send without consent and uses same provider idempotency key',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'wk06-email-retry-'));
 const clock={time:Date.now()};
 const store=openLocalStore(join(folder,'data.sqlite'),{learningClock:()=>clock.time});
 const emails=[],failed=[];
 const transport={async send(input){
   emails.push(input);
   if(emails.length===1)throw Error('simulated network timeout');
   return {messageId:'synthetic-resend-message'};
 }};
 try{
  const password='Synthetic Retry Strong Password 2026';
  store.bootstrapAdmin('admin@retry-wk06.invalid',password);
  const admin=store.login('admin@retry-wk06.invalid',password);
  const school=store.createInstitution(admin.user,'Retry Test Campus');
  const users=[];
  for(const role of ['teacher','student']){
   const email=role+'@retry-wk06.invalid';
   const row=store.register({email,password,institutionId:school.id});
   store.verifyStudent(admin.user,row.id);
   users.push(store.login(email,password));
  }
  const [teacher,student]=users;
  const p=store.requestEmailVerification(teacher.token);
  store.confirmEmailVerification(teacher.token,p.token);
  store.setLearningEmailPreference(teacher.user,true);
  store.requestHelp(student.user,{
   creatorId:teacher.user.id,kind:'tutoring',
   description:'Please give me an independent tutoring explanation and worked examples I can practice myself.',
   integrityAttested:true,creationKey:'wk06-email-retry-help-unique'
  });
  const first=await store.drainLearningEmailOutbox(admin.user,transport);
  assert.equal(first.sent,0);assert.equal(first.failed,1);
  assert.equal((await store.drainLearningEmailOutbox(admin.user,transport)).sent,0);
  assert.equal(emails.length,1);
  clock.time+=61000;
  const second=await store.drainLearningEmailOutbox(admin.user,transport);
  assert.equal(second.sent,1);assert.equal(second.failed,0);
  assert.equal(emails.length,2);
  assert.equal(emails[0].idempotencyKey,emails[1].idempotencyKey);
  assert.equal((await store.drainLearningEmailOutbox(admin.user,transport)).sent,0);
 }finally{store.close();rmSync(folder,{recursive:true,force:true});}
});

test('Resend sender sends only via fixed HTTPS endpoint with idempotency',async()=>{
 const sent=[];
 const fakeFetch=async(url,options)=>{
  sent.push({url,options});
  return Response.json({id:'synthetic-provider-id'});
 };
 assert.throws(()=>createResendLearningEmail({apiKey:'invalid',from:'bad'}),{code:'LEARNING_EMAIL_NOT_CONFIGURED'});
 const adapter=createResendLearningEmail({
  apiKey:'re_synthetic_test_long_token_2026',from:'notices@worthkind.example',fetchImpl:fakeFetch
 });
 const result=await adapter.send({
  to:'verified@example.invalid',subject:'A learning reminder',text:'Your class is approaching',
  idempotencyKey:'wk06-email-confirmed-123456'
 });
 assert.equal(result.messageId,'synthetic-provider-id');
 assert.equal(sent.length,1);
 assert.equal(sent[0].url,'https://api.resend.com/emails');
 assert.equal(sent[0].options.redirect,'error');
 assert.ok(sent[0].options.headers['Idempotency-Key']);
 assert.equal(JSON.parse(sent[0].options.body).to[0],'verified@example.invalid');
});
