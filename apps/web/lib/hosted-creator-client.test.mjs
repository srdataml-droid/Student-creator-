import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedCreatorRequest,validateIdentityFile,validateVideoFile,validateUploadDestination,putMuxVideo,readMuxStatus} from './hosted-creator-client.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('draft request allowlists metadata and uses idempotency header',()=>{
 const r=hostedCreatorRequest('draft',{courseId:id,title:'Title',description:'',previewText:'Excerpt',rightsAttested:true,creationKey:'unique-key-123456',creatorId:id,lessonText:'private'});
 assert.equal(r.path,'/api/lessons/drafts');assert.equal(r.headers['idempotency-key'],'unique-key-123456');
 assert.deepEqual(Object.keys(JSON.parse(r.body)),['courseId','title','description','previewText','rightsAttested']);
 assert.throws(()=>hostedCreatorRequest('draft',{courseId:'../../bad'}));
});
test('identity sends only raw approved file with bounded size and validated request id',()=>{
 const file=new Blob(['%PDF-1234'],{type:'application/pdf'});
 const r=hostedCreatorRequest('identity',{requestId:id,file});
 assert.equal(r.path,'/api/identity/evidence/'+id);assert.equal(r.body,file);
 assert.throws(()=>validateIdentityFile(new Blob(['x'],{type:'text/plain'})));
 assert.throws(()=>hostedCreatorRequest('identity',{requestId:'../bad',file}));
});
test('privacy writes send explicit independent boolean choices',()=>{
 const r=hostedCreatorRequest('setRestrictions',{viewerId:id,view:true,comment:false,message:true});
 assert.deepEqual(JSON.parse(r.body),{viewerId:id,view:true,comment:false,message:true});
 assert.throws(()=>hostedCreatorRequest('setRestrictions',{viewerId:id,view:1,comment:false,message:true}));
});
test('Mux reservation is bodyless; unsafe upload destinations rejected',()=>{
 assert.equal(hostedCreatorRequest('muxReserve',{lessonId:id}).body,undefined);
 assert.equal(hostedCreatorRequest('muxStatus',{lessonId:id}).method,'GET');
 for(const url of ['http://storage.googleapis.com/a?x=1','https://storage.googleapis.com.evil.test/a?x=1','https://u@storage.googleapis.com/a?x=1','https://storage.googleapis.com/a'])assert.throws(()=>validateUploadDestination(url));
 assert.throws(()=>readMuxStatus({upload:{id,state:'published'}}));
 assert.equal(readMuxStatus({upload:{id,state:'ready',uploadUrl:'https://evil.test'}}).uploadUrl,undefined);
});
test('direct Mux transfer never attaches browser session or bearer',async()=>{
 const file=new Blob(['video'],{type:'video/mp4'});let called;
 await putMuxVideo({url:'https://storage.googleapis.com/path?sig=123',file,fetcher:async(u,o)=>{called=o;return new Response(null,{status:200});}});
 assert.equal(called.credentials,'omit');assert.equal(called.redirect,'error');assert.equal(called.headers.authorization,undefined);assert.equal(called.body,file);
 assert.throws(()=>validateVideoFile(new Blob([],{type:'video/mp4'})));
 await assert.rejects(putMuxVideo({url:'https://storage.googleapis.com/path?sig=123',file,fetcher:async()=>new Response('',{status:500})}),/VIDEO_TRANSFER_UNCONFIRMED/);
});

test('payout browser requests target fixed authenticated routes and exclude injected identity or recipient fields',()=>{
 const input={bankCode:'058',accountNumber:'0123456789',consent:true,creatorId:'fake',recipientCode:'fake'};
 const lookup=hostedCreatorRequest('payoutBankResolve',input);
 assert.equal(lookup.path,'/api/account/payout-bank/resolve');
 assert.deepEqual(JSON.parse(lookup.body),{bankCode:'058',accountNumber:'0123456789',consent:true});
 assert.equal(hostedCreatorRequest('payoutBankSubmit',input).path,'/api/account/payout-bank-workflow/submit');
 assert.equal(hostedCreatorRequest('payoutBankStatus').path,'/api/account/payout-bank-workflow/status');
 assert.throws(()=>hostedCreatorRequest('payoutBankSubmit',{...input,consent:false}));
 assert.throws(()=>hostedCreatorRequest('payoutBankResolve',{...input,accountNumber:123}));
 const id='da130000-0000-4000-8000-000000000001';
 assert.deepEqual(JSON.parse(hostedCreatorRequest('payoutBankRegister',{id,recipientCode:'fake'}).body),{id});
 assert.throws(()=>hostedCreatorRequest('payoutBankReview',{id,decision:'approve',evidence:'invalid reference'}));
 assert.deepEqual(JSON.parse(hostedCreatorRequest('payoutBankReview',{id,decision:'approve',evidence:'verified-ref',reviewer:'fake'}).body),{id,decision:'approve',evidence:'verified-ref'});
});
