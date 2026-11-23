import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLocalStore,SESSION_COOKIE} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';
import {validateWebVtt,MAX_CAPTION_BYTES} from '../src/captions.mjs';

const vtt='WEBVTT\n\n00:00:00.000 --> 00:00:00.500\nAn original explanation.\n\n00:00:00.500 --> 00:00:01.000\nThe example is complete.\n';
const mp4=Buffer.from(readFileSync(new URL('./fixtures/synthetic-1s.mp4.base64',import.meta.url),'utf8'),'base64');
const originalText='An original synthetic explanation of why a sequence converges. We take an independent example, show every step, verify the intermediate result and describe the result in plain words without exposing a real assignment.';

test('caption validator accepts bounded plain WebVTT and rejects markup and invalid timings',()=>{
 assert.equal(validateWebVtt(vtt),vtt);
 assert.equal(validateWebVtt('\uFEFFWEBVTT\r\n\r\n1\r\n00:00:00.000 --> 00:00:01.000\r\nLine one\r\n'), 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nLine one\n');
 const bad=[
  'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<script>alert(1)</script>',
  'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<c.green>Injection</c>',
  'WEBVTT\n\n00:00:01.000 --> 00:00:00.500\nBackward',
  'WEBVTT\n\n00:00:62.000 --> 00:00:63.000\nBad seconds',
  'WEBVTT\n\n00:00:00.000 --> 00:00:01.000 align:start\nUnsupported settings',
  'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nValid\n\n00:00:00.500 --> 00:00:02.000\nOverlaps',
  'WEBVTT\n\nNOTE this is a hidden instruction',
  'WEBVTT\n\nSTYLE\n::cue {color:red}',
  'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n\u202eBidi spoof',
  '\u0000WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nInvalid',
  'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n'
 ];
 for(const payload of bad)assert.throws(()=>validateWebVtt(payload),{code:'INVALID_CAPTIONS'},payload);
 assert.throws(()=>validateWebVtt(vtt+'x'.repeat(MAX_CAPTION_BYTES)),{code:'INVALID_CAPTIONS'});
});

test('creator captions: draft upload, paid playback grant, creator block, refund, no cross-account/anonymous leak',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'student-captions-')),path=join(dir,'campus.sqlite');
 let store=openLocalStore(path),handle=createLocalHandler(store);
 const password='Strong Synthetic Student Password 2026';
 async function call(route,method='GET',body,token,headers={}){
  const request=new Request('http://localhost:3000/api/local/'+route,{method,
   headers:{...(token?{cookie:SESSION_COOKIE+'='+token}:{}),...(method==='POST'?{origin:'http://localhost:3000'}:{}),
    ...(body!==undefined?{'content-type':'text/vtt'}:{}),...headers},
   ...(body!==undefined?{body}:{}),});
  return handle(request,route.split('/'));
 }
 try{
  store.bootstrapAdmin('admin@caption.invalid','Strong Synthetic Admin Password 2026');
  const admin=store.login('admin@caption.invalid','Strong Synthetic Admin Password 2026');
  const institution=store.createInstitution(admin.user,'Captions Synthetic University');
  const course=store.createCourse(admin.user,{institutionId:institution.id,code:'VTT101',title:'Original Accessible Video'});
  for(const email of ['creator@caption.invalid','buyer@caption.invalid','other@caption.invalid']){
   const user=store.register({email,password,institutionId:institution.id});store.verifyStudent(admin.user,user.id);
  }
  const creator=store.login('creator@caption.invalid',password),buyer=store.login('buyer@caption.invalid',password),other=store.login('other@caption.invalid',password);
  const id=store.createDraft(creator.user,{courseId:course.id,title:'Synthetic captioned original video',description:'Caption testing',
   previewText:'A free public preview',lessonText:originalText,rightsAttested:true,
   creationKey:'synthetic-captioned-original-2026'}).lesson.id;
  const url='lessons/'+id+'/video/captions';
  assert.equal((await call(url,'POST',vtt)).status,401);
  assert.equal((await call(url,'POST',vtt,creator.token,{'content-type':'text/plain'})).status,415);
  assert.equal((await call(url,'POST',vtt,buyer.token)).status,403);
  assert.equal((await call(url,'POST',vtt,creator.token)).status,404);
  store.saveVideo(creator.user,id,mp4);
  assert.equal((await call(url,'POST','WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<script>x</script>',creator.token)).status,422);
  assert.equal((await call(url,'POST',vtt,creator.token)).status,201);
  assert.equal((await call(url,'POST',vtt,creator.token)).status,200);
  assert.equal(store.myLessons(creator.user)[0].hasCaptions,true);
  store.setLessonPrice(creator.user,id,20000);
  store.submit(creator.user,id);store.review(admin.user,id,{decision:'approve',reason:'Original rights-cleared synthetic subtitles'});
  assert.equal((await call(url,'POST',vtt,creator.token)).status,409);
  assert.equal((await call(url,'GET')).status,401);
  assert.equal((await call(url,'HEAD')).status,401);
  assert.equal((await call(url,'GET',undefined,buyer.token)).status,402);
  assert.equal((await call(url,'GET',undefined,other.token)).status,402);
  const order=store.createPurchaseOrder(buyer.user,id,'caption-order-synthetic-0001');
  store.applyVerifiedTestCharge(order.reference,{status:true,data:{status:'success',reference:order.reference,amount:20000,currency:'NGN',domain:'test',
   customer:{email:'buyer@caption.invalid'},id:'caption_provider_001'}});
  assert.equal((await call(url,'GET',undefined,buyer.token)).status,403);
  const grant=await call('lessons/'+id+'/playback-grant','POST','{}',buyer.token,{'content-type':'application/json'});
  assert.equal(grant.status,200);
  const cookie=grant.headers.get('set-cookie').split(';')[0];
  const auth={cookie:SESSION_COOKIE+'='+buyer.token+'; '+cookie};
  const allowed=await call(url,'GET',undefined,buyer.token,auth);
  assert.equal(allowed.status,200);
  assert.equal(allowed.headers.get('content-type'),'text/vtt; charset=utf-8');
  assert.equal(allowed.headers.get('cross-origin-resource-policy'),'same-origin');
  assert.match(allowed.headers.get('cache-control'),/no-store/);
  assert.equal(await allowed.text(),vtt);
  assert.equal((await call(url,'HEAD',undefined,buyer.token,auth)).status,200);
  const otherCookie={cookie:SESSION_COOKIE+'='+other.token+'; '+cookie};
  assert.equal((await call(url,'GET',undefined,other.token,otherCookie)).status,402);
  assert.equal((await call(url,'GET',undefined,undefined,{cookie})).status,401);
  store.setCreatorRestrictions(creator.user,creator.user.id,buyer.user.id,{view:true,comment:false,message:false});
  assert.equal((await call(url,'GET',undefined,buyer.token,auth)).status,403);
  store.setCreatorRestrictions(creator.user,creator.user.id,buyer.user.id,{view:false,comment:false,message:false});
  assert.equal((await call(url,'GET',undefined,buyer.token,auth)).status,403);
  const refreshed=await call('lessons/'+id+'/playback-grant','POST','{}',buyer.token,{'content-type':'application/json'});
  const freshCookie=refreshed.headers.get('set-cookie').split(';')[0];
  assert.equal((await call(url,'GET',undefined,buyer.token,{cookie:SESSION_COOKIE+'='+buyer.token+'; '+freshCookie})).status,200);
  store.applySyntheticRefund(order.reference,{refundReference:'caption_refund_001',providerTransactionId:'caption_provider_001'});
  assert.equal((await call(url,'GET',undefined,buyer.token,{cookie:SESSION_COOKIE+'='+buyer.token+'; '+freshCookie})).status,402);
  // A database reopen must preserve authored captions and the financial access denial.
  store.close();store=openLocalStore(path);handle=createLocalHandler(store);
  assert.equal(store.myLessons(creator.user)[0].hasCaptions,true);
  assert.equal((await call(url,'GET',undefined,buyer.token,{cookie:SESSION_COOKIE+'='+buyer.token+'; '+freshCookie})).status,402);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
