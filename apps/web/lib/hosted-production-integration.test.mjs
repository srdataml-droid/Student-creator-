import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountStateHandler} from './hosted-account-state.mjs';
import {mediaSourceDestination,uploadMediaSource} from './hosted-media-source.mjs';
import {hostedCreatorRequest} from './hosted-creator-client.mjs';
const actor='11111111-1111-4111-8111-111111111111',lesson='22222222-2222-4222-8222-222222222222',source='33333333-3333-4333-8333-333333333333';
const cfg={url:'https://test.supabase.co',publishableKey:'test-publishable',serverKey:'never-return-server-key'};
const req=new Request('https://app.invalid/api/account/state',{headers:{authorization:'Bearer one.two.three'}});
function fixture(calls,{active=true,foreign=false}={}){
 return async(url,opts)=>{calls.push({url,opts});const path=url.pathname.split('/').at(-1);
 if(path==='social_session_state')return Response.json({userId:actor,active,student:true,admin:false});
 if(path==='student_profiles')return Response.json([{user_id:actor,display_name:'Own profile',institution_id:source,verified_at:'2026-11-25',suspended:false,secret:'private'}]);
 if(path==='verification_requests')return Response.json([{id:source,user_id:foreign?lesson:actor,method:'manual_id',status:'pending',expires_at:'2026-12-01',private_evidence_path:'private/path'}]);
 if(path==='content_items')return Response.json([{id:lesson,creator_id:actor,title:'My draft',status:'draft',course_id:source,creation_key:'private'}]);
 throw Error('unexpected');
 };
}
test('account state uses exact verified actor, not caller-supplied identity, and drops private fields',async()=>{
 const calls=[];const r=await createAccountStateHandler({getConfig:()=>cfg,getAuth:()=>({getUser:async()=>({id:actor})}),fetcher:fixture(calls)})(req);
 assert.equal(r.status,200);const data=await r.json();assert.equal(data.userId,actor);assert.equal(data.drafts[0].title,'My draft');assert.equal(data.requests[0].status,'pending');assert.equal(JSON.stringify(data).includes('private'),false);
 assert.equal(calls.every(x=>x.opts.headers.apikey===cfg.publishableKey&&x.opts.headers.authorization==='Bearer one.two.three'),true);
 assert.equal(calls.find(x=>x.url.pathname.endsWith('verification_requests')).url.searchParams.get('user_id'),'eq.'+actor);
});
test('account state rejects revoked, foreign and unauthenticated data',async()=>{
 const getAuth=()=>({getUser:async()=>({id:actor})});
 assert.equal((await createAccountStateHandler({getConfig:()=>cfg,getAuth,fetcher:fixture([],{active:false})})(req)).status,401);
 assert.equal((await createAccountStateHandler({getConfig:()=>cfg,getAuth,fetcher:fixture([],{foreign:true})})(req)).status,503);
 assert.equal((await createAccountStateHandler({getConfig:()=>cfg,getAuth:()=>({getUser:async()=>null})})(req)).status,401);
});
const grant={id:source,state:'reserved',uploadUrl:'https://jnkqmlbkkvccnxrgkpno.supabase.co/storage/v1/object/upload/sign/student-creators-private-media/private/media/'+actor+'/'+lesson+'/'+source+'.mp4?token=abcdefghijklmnop'};
test('private upload validates exact actor, draft, source and destination, and never sends app bearer',async()=>{
 const file=new Blob(['1234567890123456'],{type:'video/mp4'}),calls=[];
 const result=await uploadMediaSource({file,lessonId:lesson,actorId:actor,request:async(op,input)=>{calls.push({op,input});return op==='mediaSourceReserve'?grant:{queued:true};},fetcher:async(url,opts)=>{assert.equal(url,grant.uploadUrl);assert.equal(opts.credentials,'omit');assert.equal(opts.headers.authorization,undefined);return new Response(null,{status:200});}});
 assert.equal(result.state,'queued');assert.match(calls[0].input.digest,/^[0-9a-f]{64}$/);assert.equal(calls[1].input.sourceId,source);
 assert.throws(()=>mediaSourceDestination({grant,actorId:lesson,lessonId:lesson}));
 assert.throws(()=>mediaSourceDestination({grant:{...grant,uploadUrl:grant.uploadUrl.replace('.supabase.co','.supabase.co.evil.test')},actorId:actor,lessonId:lesson}));
});
test('creator sets own draft price explicitly; free and paid stay separate; no price assigned during draft creation',()=>{
 const creation=hostedCreatorRequest('draft',{courseId:source,title:'Draft',description:'',previewText:'',rightsAttested:true,creationKey:'test-draft-123456'});
 assert.equal('priceKobo' in JSON.parse(creation.body),false);
 assert.deepEqual(JSON.parse(hostedCreatorRequest('setDraftPrice',{contentId:lesson,amountKobo:0}).body),{contentId:lesson,amountKobo:0});
 assert.deepEqual(JSON.parse(hostedCreatorRequest('setDraftPrice',{contentId:lesson,amountKobo:30000}).body),{contentId:lesson,amountKobo:30000});
 assert.throws(()=>hostedCreatorRequest('setDraftPrice',{contentId:lesson,amountKobo:100}));
 assert.deepEqual(JSON.parse(hostedCreatorRequest('createClass',{courseId:source,title:'Free lesson',startsAt:'2026-12-01T10:00:00Z',endsAt:'2026-12-01T11:00:00Z',capacity:12,creationKey:'test-class-123456'}).body),{courseId:source,title:'Free lesson',description:'',startsAt:'2026-12-01T10:00:00Z',endsAt:'2026-12-01T11:00:00Z',capacity:12,creationKey:'test-class-123456'});
});
