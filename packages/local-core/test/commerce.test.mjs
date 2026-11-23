import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';
const lessonText='An original synthetic explanation of a mathematical worked example. We explain the independent derivation, check each step and give a detailed conclusion without any real user data.';
test('₦200 synthetic purchase gates access, resists retries, balances journal and survives restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'commerce-test-')),path=join(dir,'campus.sqlite');
 let store=openLocalStore(path),sandboxGateway=null;
 const pw='Strong Synthetic Student Password 2026';
 const req=async(route,method='GET',body,session)=>{
  const r=new Request('http://localhost:3000/api/local/'+route,{method,
   headers:{...(session?{cookie:'campus_local_session='+session}:{}),...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const response=await createLocalHandler(store,{sandboxGateway})(r,route.split('/'));
  return {status:response.status,data:await response.json()};
 };
 try{
  store.bootstrapAdmin('admin@synthetic.test','Synthetic Administrator Password 2026');
  const admin=store.login('admin@synthetic.test','Synthetic Administrator Password 2026');
  const campus=store.createInstitution(admin.user,'Original Synthetic Learning Campus');
  const course=store.createCourse(admin.user,{institutionId:campus.id,code:'MON101',title:'Synthetic Mathematics'});
  for(const email of ['creator@synthetic.test','buyer@synthetic.test','other@synthetic.test']){
   const r=store.register({email,password:pw,institutionId:campus.id});store.verifyStudent(admin.user,r.id);
  }
  const creator=store.login('creator@synthetic.test',pw),buyer=store.login('buyer@synthetic.test',pw),other=store.login('other@synthetic.test',pw);
  const id=store.createDraft(creator.user,{courseId:course.id,title:'Independent paid explanation',description:'Synthetic',
   previewText:'Only original examples',lessonText,rightsAttested:true,creationKey:'commerce-unique-draft-0001'}).lesson.id;
  assert.equal((await req('lessons/'+id+'/price','POST',{amountKobo:19999},creator.token)).status,422);
  assert.equal((await req('lessons/'+id+'/price','POST',{amountKobo:20000},buyer.token)).status,403);
  assert.equal((await req('lessons/'+id+'/price','POST',{amountKobo:20000},creator.token)).status,200);
  store.submit(creator.user,id);
  store.review(admin.user,id,{decision:'approve',reason:'Safe original explanation reviewed'});
  assert.equal(store.publicLesson(id).priceKobo,20000);
  assert.equal((await req('lessons/'+id+'/price','POST',{amountKobo:0},creator.token)).status,409);
  assert.equal((await req('lessons/'+id,'GET',undefined,buyer.token)).status,402);
  assert.equal((await req('lessons/'+id+'/notes','GET',undefined,buyer.token)).status,402);
  assert.equal((await req('lessons/'+id+'/playback-grant','POST',{},buyer.token)).status,402);
  assert.equal((await req('lessons/'+id+'/orders','POST',{requestKey:'long-request-key-0001'})).status,401);
  assert.equal((await req('lessons/'+id+'/orders','POST',{requestKey:'long-request-key-0001'},creator.token)).status,403);
  const first=await req('lessons/'+id+'/orders','POST',{requestKey:'long-request-key-0001'},buyer.token);
  assert.equal(first.status,201);
  const reference=first.data.order.reference;
  assert.equal(first.data.order.status,'pending');
  assert.equal(first.data.order.amountKobo,20000);
  assert.equal(first.data.order.creatorShareKobo,20000);
  assert.equal((await req('lessons/'+id+'/orders','POST',{requestKey:'long-request-key-0001'},buyer.token)).status,200);
  const repeated=await req('lessons/'+id+'/orders','POST',{requestKey:'long-request-key-0002'},buyer.token);
  assert.equal(repeated.data.order.reference,reference);
  const payment=(tid)=>({status:true,data:{status:'success',reference,amount:20000,currency:'NGN',
   domain:'test',customer:{email:'buyer@synthetic.test'},id:tid}});
  for(const [extra,code] of [[{amount:21000},'AMOUNT_MISMATCH'],[{currency:'USD'},'CURRENCY_MISMATCH'],[{domain:'live'},'ENVIRONMENT_MISMATCH'],[{customer:{email:'other@synthetic.test'}},'BUYER_MISMATCH']]){
   assert.throws(()=>store.applyVerifiedTestCharge(reference,{status:true,data:{...payment('tr_test_01').data,...extra}}),{code});
  }
  assert.throws(()=>store.applyVerifiedTestCharge(reference,{status:false,data:payment('tr_test_01').data}),{code:'NOT_PAID'});
  assert.equal((await req('lessons/'+id,'GET',undefined,buyer.token)).status,402);
  assert.equal((await req('orders/'+reference+'/checkout','POST',{},buyer.token)).status,503);
  sandboxGateway={
   initialize:async snapshot=>{assert.equal(snapshot.reference,reference);assert.equal(snapshot.amountKobo,20000);assert.equal(snapshot.domain,'test');return {reference,authorizationUrl:'https://checkout.paystack.com/synthetic-test-only'};},
   verify:async snapshot=>{assert.equal(snapshot.reference,reference);return {reference,amountKobo:20000,currency:'NGN',providerTransactionId:'tr_test_01'};}
  };
  assert.equal((await req('orders/'+reference+'/checkout','POST',{},other.token)).status,404);
  const checkout=await req('orders/'+reference+'/checkout','POST',{},buyer.token);
  assert.equal(checkout.status,200);assert.match(checkout.data.checkout.authorizationUrl,/checkout\.paystack\.com/);
  assert.equal((await req('orders/'+reference+'/confirm','POST',{},other.token)).status,404);
  assert.equal((await req('orders/'+reference+'/confirm','POST',{providerTransactionId:'fake'},buyer.token)).status,400);
  const confirmed=await req('orders/'+reference+'/confirm','POST',{},buyer.token);
  assert.equal(confirmed.status,200);assert.equal(confirmed.data.order.status,'paid');
  assert.equal(store.applyVerifiedTestCharge(reference,payment('tr_test_01')).status,'paid');
  assert.equal(store.applyVerifiedTestCharge(reference,payment('tr_test_01')).replayed,true);
  assert.throws(()=>store.applyVerifiedTestCharge(reference,payment('tr_test_02')),{code:'PAYMENT_CONFLICT'});
  assert.equal((await req('lessons/'+id,'GET',undefined,buyer.token)).status,200);
  assert.equal((await req('lessons/'+id,'GET',undefined,other.token)).status,402);
  assert.equal((await req('lessons/'+id+'/access','GET',undefined,other.token)).data.access.entitled,false);
  assert.equal((await req('lessons/'+id+'/access','GET',undefined,buyer.token)).data.access.entitled,true);
  assert.equal((await req('my/purchases','GET',undefined,buyer.token)).data.orders.length,1);
  assert.equal((await req('my/purchases','GET',undefined,other.token)).data.orders.length,0);
  assert.equal((await req('my/creator-earnings','GET',undefined,creator.token)).data.earnings.creatorPendingKobo,20000);
  const db=new DatabaseSync(path);
  try{
   const journal=db.prepare('SELECT SUM(debit_kobo) AS debit,SUM(credit_kobo) AS credit,COUNT(*) AS count FROM commerce_journal').get();
   assert.equal(journal.debit,20000);assert.equal(journal.credit,20000);assert.equal(journal.count,2);
   assert.equal(db.prepare('SELECT COUNT(*) AS count FROM content_entitlements').get().count,1);
   assert.equal(db.prepare('SELECT COUNT(*) AS count FROM purchase_orders').get().count,1);
  }finally{db.close();}
  store.setCreatorRestrictions(creator.user,creator.user.id,buyer.user.id,{view:true,comment:false,message:false});
  assert.equal((await req('lessons/'+id,'GET',undefined,buyer.token)).status,403);
  store.setCreatorRestrictions(creator.user,creator.user.id,buyer.user.id,{view:false,comment:false,message:false});
  assert.equal((await req('lessons/'+id,'GET',undefined,buyer.token)).status,200);
  store.close();store=openLocalStore(path);
  assert.equal((await req('lessons/'+id,'GET',undefined,buyer.token)).status,200);
  assert.equal((await req('my/creator-earnings','GET',undefined,creator.token)).data.earnings.creatorPendingKobo,20000);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
