import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareLessonDraft,prepareReviewSubmission,prepareModerationDecision,isDiscoverable,ContentRuleError} from '../src/content.mjs';
const creator={id:'11111111-1111-4111-8111-111111111111',institutionId:'22222222-2222-4222-8222-222222222222',verifiedAt:'2026-11-19T00:00:00Z',suspended:false};
const course={id:'33333333-3333-4333-8333-333333333333',institutionId:creator.institutionId,active:true};
const topic={id:'44444444-4444-4444-8444-444444444444',courseId:course.id};
const input={title:'  Intro to Integration  ',description:'A step-by-step explanation',previewText:'Learn how to reason through an integral.',rightsAttested:true};
const item={id:'55555555-5555-4555-8555-555555555555',creatorId:creator.id,status:'draft'};
const asset={contentId:item.id,processingStatus:'ready',scanVerdict:'clean',privateObjectKey:'private/resource.pdf'};
const mod={id:'66666666-6666-4666-8666-666666666666',role:'moderator',suspended:false};
const fail=(fn,code)=>assert.throws(fn,e=>e instanceof ContentRuleError && e.code===code);
test('verified creator can prepare course-scoped, metadata-only lesson draft',()=>{
 const x=prepareLessonDraft({actor:creator,course,topic,input});assert.equal(x.title,'Intro to Integration');assert.equal(x.creatorId,creator.id);assert.equal(x.institutionId,creator.institutionId);assert.equal(x.topicId,topic.id);assert.equal(x.status,'draft');assert.equal(Object.isFrozen(x),true);assert.equal('privateObjectKey' in x,false);
});
test('unverified or suspended campus member cannot create a lesson',()=>{
 fail(()=>prepareLessonDraft({actor:{...creator,verifiedAt:null},course,input}),'NOT_VERIFIED');
 fail(()=>prepareLessonDraft({actor:{...creator,suspended:true},course,input}),'NOT_VERIFIED');
});
test('cannot create in another university or inactive course',()=>{
 fail(()=>prepareLessonDraft({actor:creator,course:{...course,institutionId:'88888888-8888-4888-8888-888888888888'},input}),'WRONG_COURSE');
 fail(()=>prepareLessonDraft({actor:creator,course:{...course,active:false},input}),'WRONG_COURSE');
});
test('cannot assign topic from another course',()=>fail(()=>prepareLessonDraft({actor:creator,course,topic:{...topic,courseId:'77777777-7777-4777-8777-777777777777'},input}),'WRONG_TOPIC'));
test('rejects invalid title/preview size and missing creator permission',()=>{
 fail(()=>prepareLessonDraft({actor:creator,course,input:{...input,title:'x'}}),'INVALID_CONTENT');
 fail(()=>prepareLessonDraft({actor:creator,course,input:{...input,previewText:'x'.repeat(801)}}),'INVALID_CONTENT');
 fail(()=>prepareLessonDraft({actor:creator,course,input:{...input,rightsAttested:false}}),'RIGHTS_REQUIRED');
});
test('ready, scanned and private resource can enter review',()=>assert.equal(prepareReviewSubmission({actor:creator,item,assets:[asset]}).nextStatus,'in_review'));
test('draft owner cannot submit unscanned, mismatched or missing media',()=>{
 fail(()=>prepareReviewSubmission({actor:creator,item,assets:[]}), 'ASSET_NOT_READY');
 fail(()=>prepareReviewSubmission({actor:creator,item,assets:[{...asset,scanVerdict:'unknown'}]}), 'ASSET_NOT_READY');
 fail(()=>prepareReviewSubmission({actor:creator,item,assets:[{...asset,contentId:'other'}]}), 'ASSET_NOT_READY');
 fail(()=>prepareReviewSubmission({actor:creator,item,assets:[{...asset,privateObjectKey:'public/resource.pdf'}]}), 'ASSET_NOT_READY');
});
test('another student cannot submit creator draft',()=>fail(()=>prepareReviewSubmission({actor:{...creator,id:'99999999-9999-4999-8999-999999999999'},item,assets:[asset]}),'FORBIDDEN'));
test('cannot republish taken-down or already-published content through submission',()=>{
 fail(()=>prepareReviewSubmission({actor:creator,item:{...item,status:'taken_down'},assets:[asset]}),'INVALID_STATE');
 fail(()=>prepareReviewSubmission({actor:creator,item:{...item,status:'published'},assets:[asset]}),'INVALID_STATE');
});
test('second-person moderation approves with reason and reviewer identity',()=>{
 const x=prepareModerationDecision({actor:mod,item:{...item,status:'in_review'},decision:'approve',reason:'Original, relevant lesson'});
 assert.equal(x.nextStatus,'published');assert.equal(x.reviewerId,mod.id);
});
test('moderator can reject, but cannot approve own content',()=>{
 assert.equal(prepareModerationDecision({actor:mod,item:{...item,status:'in_review'},decision:'reject',reason:'Copyright claim'}).nextStatus,'rejected');
 fail(()=>prepareModerationDecision({actor:{...mod,id:creator.id},item:{...item,status:'in_review'},decision:'approve',reason:'Looks fine'}),'CONFLICT_OF_INTEREST');
});
test('moderation denies students, missing reasons and wrong state',()=>{
 fail(()=>prepareModerationDecision({actor:{...mod,role:'student'},item:{...item,status:'in_review'},decision:'approve',reason:'Fine material'}),'FORBIDDEN');
 fail(()=>prepareModerationDecision({actor:mod,item:{...item,status:'in_review'},decision:'approve',reason:'x'}),'INVALID_DECISION');
 fail(()=>prepareModerationDecision({actor:mod,item,decision:'approve',reason:'Good material'}),'INVALID_STATE');
});
test('only published metadata is discoverable',()=>{
 for(const status of ['draft','in_review','rejected','processing','taken_down','archived']) assert.equal(isDiscoverable({status}),false);
 assert.equal(isDiscoverable({status:'published'}),true);
});
