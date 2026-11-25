import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftHandler} from '../src/draft-api.mjs';
import {createSupabaseDraftDependencies} from '../src/supabase-draft-store.mjs';

const ID={student:'11111111-1111-4111-8111-111111111111',school:'22222222-2222-4222-8222-222222222222',course:'33333333-3333-4333-8333-333333333333',topic:'44444444-4444-4444-8444-444444444444',lesson:'55555555-5555-4555-8555-555555555555',outside:'66666666-6666-4666-8666-666666666666'};
const KEY='draft_attempt_123456';
const BODY={courseId:ID.course,topicId:ID.topic,title:'Introduction to integration',description:'Understand substitution',previewText:'This is an original preview',rightsAttested:true};
const makeRequest=(body=BODY,opts={})=>new Request('https://school.example/api/lessons/drafts',{method:'POST',headers:{'Content-Type':opts.type||'application/json',...(opts.auth===false?{}:{Authorization:`Bearer validtoken`}),...((opts.key===false)?{}:{'Idempotency-Key':opts.key||KEY})},body:opts.raw??JSON.stringify(body)});
function makeDependencies(overrides={}) {
  const saved=new Map();const calls={insert:0,audit:[]};
  const store={
    async getProfile(){return {institutionId:ID.school,verifiedAt:'2026-11-19',suspended:false};},
    async getCourse(){return {id:ID.course,institutionId:ID.school,active:true};},
    async getTopic(){return {id:ID.topic,courseId:ID.course};},
    async insertDraftOnce({draft,creationKey,creationHash}){
      calls.insert++;
      const k=`${draft.creatorId}:${creationKey}`;
      if(saved.has(k)) {const row=saved.get(k);return row.hash===creationHash?{created:false,item:row.item}:{conflict:true};}
      const item={id:ID.lesson,creatorId:draft.creatorId,courseId:draft.courseId,topicId:draft.topicId,title:draft.title,status:'draft'};
      saved.set(k,{hash:creationHash,item});return {created:true,item};
    },
    ...overrides.store
  };
  const auth={async getUser(){return {id:ID.student};},...overrides.auth};
  const handler=createDraftHandler({auth,store,audit:record=>calls.audit.push(record)});
  return {handler,calls};
}
const bodyOf=async response=>({status:response.status,...await response.json()});
test('verified student creates a persistent-intent draft with only public metadata',async()=>{
  const {handler,calls}=makeDependencies();const response=await bodyOf(await handler(makeRequest()));
  assert.equal(response.status,201);assert.equal(response.draft.status,'draft');assert.equal(response.draft.id,ID.lesson);
  assert.equal(calls.insert,1);assert.equal(calls.audit[0].event,'lesson.draft.created');
  assert.equal('creatorId' in response.draft,false);
});
test('client retry uses same key and returns existing draft without duplication',async()=>{
  const {handler,calls}=makeDependencies();const a=await bodyOf(await handler(makeRequest()));const b=await bodyOf(await handler(makeRequest()));
  assert.equal(a.status,201);assert.equal(b.status,200);assert.deepEqual(a.draft,b.draft);assert.equal(calls.audit[1].event,'lesson.draft.replayed');
});
test('same idempotency key with changed content is rejected',async()=>{
  const {handler}=makeDependencies();await handler(makeRequest());const r=await bodyOf(await handler(makeRequest({...BODY,title:'Unrelated topic'})));
  assert.equal(r.status,409);assert.equal(r.error,'IDEMPOTENCY_KEY_CONFLICT');
});
test('no bearer authentication never reaches storage',async()=>{
  const {handler,calls}=makeDependencies();const r=await bodyOf(await handler(makeRequest(BODY,{auth:false})));
  assert.equal(r.status,401);assert.equal(calls.insert,0);
});
test('invalid bearer identity blocks publish',async()=>{
  const {handler,calls}=makeDependencies({auth:{async getUser(){return null;}}});const r=await bodyOf(await handler(makeRequest()));
  assert.equal(r.status,401);assert.equal(calls.insert,0);
});
test('unverified and suspended users cannot create drafts',async()=>{
  for(const p of [{institutionId:ID.school,verifiedAt:null,suspended:false},{institutionId:ID.school,verifiedAt:'2026-11-19',suspended:true}]){
    const {handler,calls}=makeDependencies({store:{async getProfile(){return p;}}});const r=await bodyOf(await handler(makeRequest()));
    assert.equal(r.status,403);assert.equal(calls.insert,0);
  }
});
test('campus boundary and course status enforce server authorization',async()=>{
  for(const course of [{id:ID.course,institutionId:ID.outside,active:true},{id:ID.course,institutionId:ID.school,active:false}]){
    const {handler,calls}=makeDependencies({store:{async getCourse(){return course;}}});const r=await bodyOf(await handler(makeRequest()));
    assert.equal(r.status,403);assert.equal(calls.insert,0);
  }
});
test('cannot claim a topic belonging to a different course',async()=>{
  const {handler,calls}=makeDependencies({store:{async getTopic(){return {id:ID.topic,courseId:ID.outside};}}});const r=await bodyOf(await handler(makeRequest()));
  assert.equal(r.status,422);assert.equal(calls.insert,0);
});
test('invalid JSON, content type and oversized body are bounded errors',async()=>{
  const {handler,calls}=makeDependencies();
  assert.equal((await bodyOf(await handler(makeRequest(BODY,{raw:'{"bad"'})))).status,400);
  assert.equal((await bodyOf(await handler(makeRequest(BODY,{type:'text/plain'})))).status,415);
  assert.equal((await bodyOf(await handler(makeRequest(BODY,{raw:JSON.stringify({...BODY,description:'a'.repeat(12000)})})))).status,413);
  assert.equal(calls.insert,0);
});
test('requires stable sufficiently long idempotency key',async()=>{
  const {handler,calls}=makeDependencies();for(const opts of [{key:false},{key:'short'}]){
    const r=await bodyOf(await handler(makeRequest(BODY,opts)));assert.equal(r.status,400);
  }assert.equal(calls.insert,0);
});
test('provider timeout yields safe 503 with correlation and no data exposure',async()=>{
  const {handler,calls}=makeDependencies({store:{async insertDraftOnce(){throw new Error('PRIVATE_DB_PASSWORD:exposed');}}});
  const r=await bodyOf(await handler(makeRequest()));assert.equal(r.status,503);
  assert.equal(r.error,'SERVICE_UNAVAILABLE');assert.equal(r.correlationId?.length,36);
  assert.equal(JSON.stringify(r).includes('PRIVATE_DB_PASSWORD'),false);assert.equal(calls.audit.at(-1).event,'lesson.draft.error');
});
test('trusts database actor not attacker-supplied userId, institution or published state',async()=>{
  const {handler}=makeDependencies();const r=await bodyOf(await handler(makeRequest({...BODY,creatorId:ID.outside,institutionId:ID.outside,status:'published'})));
  assert.equal(r.status,201);assert.equal(r.draft.status,'draft');
});

test('Supabase adapter verifies user with public key, DB with server key, and decodes schema',async()=>{
  const seen=[];
  const fetcher=async(url,options)=>{
    seen.push({url:String(url),...options});
    if(String(url).includes('/auth/v1/user')) return Response.json({id:ID.student,email:'synthetic@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'});
    if(String(url).includes('/student_creators_session_active')||String(url).includes('/affiliation_eligible'))return Response.json(true);
    if(String(url).includes('student_profiles')) return Response.json([{user_id:ID.student,institution_id:ID.school,verified_at:'2026-11-19',suspended:false}]);
    if(String(url).includes('courses'))return Response.json([{id:ID.course,institution_id:ID.school,active:true}]);
    if(String(url).includes('course_topics'))return Response.json([{id:ID.topic,course_id:ID.course}]);
    throw new Error('Unknown route');
  };
  const {auth,store}=createSupabaseDraftDependencies({url:'https://example.supabase.co',publicKey:'pub',serverKey:'service',fetcher});
  const token='e30.'+Buffer.from(JSON.stringify({sub:ID.student,session_id:ID.lesson,role:'authenticated',exp:Math.floor(Date.now()/1000)+600})).toString('base64url')+'.signature';
  assert.deepEqual(await auth.getUser(token),{id:ID.student});
  assert.equal((await store.getProfile(ID.student)).institutionId,ID.school);
  assert.equal((await store.getCourse(ID.course)).active,true);
  assert.equal((await store.getTopic(ID.topic)).courseId,ID.course);
  assert.equal(seen[0].headers.authorization,'Bearer '+token);assert.equal(seen[0].headers.apikey,'pub');
  assert.equal(seen[1].headers.authorization,'Bearer service');assert.equal(seen[1].headers.apikey,'service');
});
test('Supabase adapter does not create duplicates when PostgREST reports conflict',async()=>{
  const requests=[];
  const existing={id:ID.lesson,creator_id:ID.student,course_id:ID.course,topic_id:ID.topic,title:'Lesson',status:'draft',creation_hash:'a'.repeat(64)};
  const fetcher=async(url,options)=>{requests.push({url:String(url),options});if(options.method==='POST')return Response.json([]);return Response.json([existing]);};
  const {store}=createSupabaseDraftDependencies({url:'https://example.supabase.co',publicKey:'pub',serverKey:'service',fetcher});
  const x=await store.insertDraftOnce({draft:{creatorId:ID.student,institutionId:ID.school,courseId:ID.course,topicId:ID.topic,title:'Lesson',description:'ok',previewText:'ok'},creationKey:KEY,creationHash:'a'.repeat(64)});
  assert.equal(x.created,false);assert.equal(x.item.id,ID.lesson);assert.match(requests[0].url,/on_conflict=creator_id%2Ccreation_key/);
  assert.match(requests[0].options.headers.prefer,/ignore-duplicates/);
});
test('Supabase adapter catches conflicting reuse of idempotency key',async()=>{
  const fetcher=async(url,options)=>options.method==='POST'?Response.json([]):Response.json([{creation_hash:'b'.repeat(64)}]);
  const {store}=createSupabaseDraftDependencies({url:'https://example.supabase.co',publicKey:'pub',serverKey:'service',fetcher});
  const result=await store.insertDraftOnce({draft:{creatorId:ID.student,institutionId:ID.school,courseId:ID.course,topicId:null,title:'Lesson',description:'ok',previewText:'ok'},creationKey:KEY,creationHash:'a'.repeat(64)});
  assert.equal(result.conflict,true);
});
test('Supabase adapter rejects insecure remote URLs',()=>{
  assert.throws(()=>createSupabaseDraftDependencies({url:'http://example.com',publicKey:'pub',serverKey:'private'}),/HTTPS/);
});
