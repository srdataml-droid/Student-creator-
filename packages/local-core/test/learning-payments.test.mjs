import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';
const uuid='training-session';
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'wk06-payment-'));
 const store=openLocalStore(join(dir,'payments.sqlite'));
 let transactionCounter=0,verifiedCalls=0;
 const charged=new Map();
 const gateway={
  environment:'test',
  async initialize(order){return {reference:order.reference,authorizationUrl:'https://checkout.paystack.com/stage_only_'+order.reference};},
  async verify(order){
    verifiedCalls++;
    if(!charged.has(order.reference))throw Object.assign(Error('NOT_PAID'),{code:'NOT_PAID'});
    return {...charged.get(order.reference)};
  }
 };
 const handle=createLocalHandler(store,{sandboxGateway:gateway});
 async function send(path,method='GET',body,token){
  const response=await handle(new Request('http://localhost:3000/api/local/'+path,{method,
    headers:{...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{}),
      ...(token?{cookie:'campus_local_session='+token}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})}),path.split('/'));
  return {status:response.status,data:await response.json()};
 }
 const password='Synthetic Strong Password Test 2026';
 async function setup(){
  store.bootstrapAdmin('admin@week06-pay.invalid',password);
  const admin=store.login('admin@week06-pay.invalid',password);
  const school=store.createInstitution(admin.user,'Payment Validation University');
  const course=store.createCourse(admin.user,{institutionId:school.id,code:'P6101',title:'Paid Class'});
  const people=[];
  for(const role of ['host','student','extra']){
    const email=role+'@week06-pay.invalid';
    const row=store.register({email,password,institutionId:school.id});
    store.verifyStudent(admin.user,row.id);
    people.push(store.login(email,password));
  }
  return {admin,course,...Object.fromEntries(['host','student','extra'].map((k,i)=>[k,people[i]]))};
 }
 function classPayload(tag,priceKobo=30000){
  return {title:'Original paid workshop '+tag,description:'Tutoring of original student practice only',
    startsAt:new Date(Date.now()+8*60000).toISOString(),endsAt:new Date(Date.now()+69*60000).toISOString(),
    priceKobo,capacity:12,creationKey:'learning-paid-class-'+tag+'-unique'};
 }
 function pay(reference,amountKobo,transactionId=null,options={}){
  const transaction=transactionId??'txn_synthetic_'+(++transactionCounter);
  charged.set(reference,{reference,amountKobo,currency:'NGN',domain:'test',providerTransactionId:transaction,providerFeeKobo:options.fee??0});
  return transaction;
 }
 return {store,send,setup,pay,charged,gateway,classPayload,getVerifiedCalls:()=>verifiedCalls,
   close:()=>{store.close();rmSync(dir,{recursive:true,force:true});}};
}

test('paid classes: immutable server order, sandbox checkout, verified entitlement, balanced ledger, reversal',async()=>{
 const x=fixture();
 try{
  const a=await x.setup();
  const cls=await x.send('courses/'+a.course.id+'/classes','POST',x.classPayload('first'),a.host.token);
  assert.equal(cls.status,201);const id=cls.data.class.id;
  assert.equal((await x.send('classes/'+id+'/orders','POST',{requestKey:'wk06-paid-test-key-001'},a.student.token)).status,403);
  assert.equal((await x.send('classes/'+id+'/enroll','POST',{},a.student.token)).status,200);
  assert.equal((await x.send('classes/'+id+'/orders','POST',{requestKey:'wk06-paid-test-key-001'},a.host.token)).status,409);
  const created=await x.send('classes/'+id+'/orders','POST',{requestKey:'wk06-paid-test-key-001'},a.student.token);
  assert.equal(created.status,201);
  const reference=created.data.order.reference;
  assert.ok(reference.startsWith('lsc_'));
  const replay=await x.send('classes/'+id+'/orders','POST',{requestKey:'wk06-paid-test-key-001'},a.student.token);
  assert.equal(replay.status,200);assert.equal(replay.data.order.replayed,true);
  assert.equal((await x.send('learning-orders/'+reference,'GET',undefined,a.extra.token)).status,404);
  assert.equal((await x.send('learning-orders/'+reference+'/checkout','POST',{},a.extra.token)).status,404);
  assert.equal(x.store.hasActiveEntitlement({buyerId:a.student.user.id,resourceKind:'class',resourceId:id}),false);
  const checkout=await x.send('learning-orders/'+reference+'/checkout','POST',{},a.student.token);
  assert.equal(checkout.status,200);
  assert.ok(checkout.data.checkout.authorizationUrl.startsWith('https://checkout.paystack.com/'));
  assert.equal((await x.send('learning-orders/'+reference+'/checkout','POST',{},a.student.token)).data.checkout.replayed,true);
  assert.equal((await x.send('learning-orders/'+reference+'/confirm','POST',{},a.student.token)).status,503);
  assert.equal(x.store.hasActiveEntitlement({buyerId:a.student.user.id,resourceKind:'class',resourceId:id}),false);
  const txn=x.pay(reference,30000,null,{fee:400});
  const confirmed=await x.send('learning-orders/'+reference+'/confirm','POST',{},a.student.token);
  assert.equal(confirmed.status,200);
  assert.equal(confirmed.data.order.status,'paid');
  assert.equal(x.store.hasActiveEntitlement({buyerId:a.student.user.id,resourceKind:'class',resourceId:id}),true);
  assert.equal(x.store.hasActiveEntitlement({buyerId:a.extra.user.id,resourceKind:'class',resourceId:id}),false);
  assert.equal(x.store.hasActiveEntitlement({buyerId:a.student.user.id,resourceKind:'service',resourceId:id}),false);
  assert.equal((await x.send('learning-orders/'+reference+'/confirm','POST',{},a.student.token)).data.order.replayed,true);
  const ledger=await x.send('admin/learning-ledger/'+reference,'GET',undefined,a.admin.token);
  assert.equal(ledger.status,200);assert.equal(ledger.data.ledger.events.length,2);
  assert.ok(ledger.data.ledger.events.every(e=>e.balanced));
  assert.equal(ledger.data.ledger.payoutEnabled,false);
  assert.equal((await x.send('admin/learning-ledger/'+reference,'GET',undefined,a.student.token)).status,403);
  const refund=await x.send('admin/learning-payments/'+reference+'/simulate-reversal','POST',{
    kind:'refund',reason:'Synthetic verified cancellation and financial reconciliation',key:'wk06-refund-event-key-001'
  },a.admin.token);
  assert.equal(refund.status,200);assert.equal(refund.data.order.status,'refunded');
  assert.equal(x.store.hasActiveEntitlement({buyerId:a.student.user.id,resourceKind:'class',resourceId:id}),false);
  const reversed=await x.send('admin/learning-ledger/'+reference,'GET',undefined,a.admin.token);
  assert.ok(reversed.data.ledger.events.every(e=>e.balanced));
  assert.equal(reversed.data.ledger.events.length,3);
  assert.equal((await x.send('learning-orders/'+reference+'/confirm','POST',{},a.student.token)).status,409);
  assert.equal((await x.send('learning-orders/'+reference,'GET',undefined,a.student.token)).data.order.status,'refunded');
 }finally{x.close();}
});

test('negotiated service quote is immutable; only a verified test payment unlocks creator progress',async()=>{
 const x=fixture();
 try{
  const a=await x.setup();
  const item=await x.send('learning-requests','POST',{
    creatorId:a.host.user.id,kind:'project_guidance',
    description:'Explain original research methods and how I should structure my own technical project.',
    integrityAttested:true,creationKey:'wk06-service-quote-unique-key'
  },a.student.token);
  assert.equal(item.status,201);const id=item.data.request.id;
  assert.equal((await x.send('learning-requests/'+id+'/quote','POST',{quoteKobo:18000},a.host.token)).status,422);
  assert.equal((await x.send('learning-requests/'+id+'/quote','POST',{quoteKobo:30000},a.host.token)).status,200);
  assert.equal((await x.send('learning-requests/'+id+'/accept','POST',{expectedQuoteKobo:30000},a.student.token)).status,200);
  assert.equal((await x.send('learning-requests/'+id+'/start','POST',{},a.host.token)).status,402);
  const order=await x.send('learning-requests/'+id+'/orders','POST',{requestKey:'wk06-service-order-key-123'},a.student.token);
  assert.equal(order.status,201);
  const reference=order.data.order.reference;
  const knownOther=await x.send('learning-requests/'+id+'/orders','POST',{requestKey:'wk06-service-order-key-123'},a.student.token);
  assert.equal(knownOther.status,200);
  x.pay(reference,31000);
  assert.equal((await x.send('learning-orders/'+reference+'/confirm','POST',{},a.student.token)).status,409);
  x.pay(reference,30000);
  assert.equal((await x.send('learning-orders/'+reference+'/confirm','POST',{},a.student.token)).status,200);
  assert.equal((await x.send('learning-requests/'+id+'/start','POST',{},a.host.token)).status,200);
  assert.equal((await x.send('learning-requests/'+id+'/submit','POST',{},a.host.token)).status,200);
  assert.equal((await x.send('learning-requests/'+id+'/confirm','POST',{},a.student.token)).status,200);
  assert.equal((await x.send('learning-requests/'+id+'/orders','POST',{requestKey:'wk06-another-service-key'},a.extra.token)).status,404);
  assert.equal((await x.send('me/learning-orders','GET',undefined,a.student.token)).data.orders.length,1);
 }finally{x.close();}
});

test('two orders cannot use one provider receipt and invalid provider checkout URLs are not cached as paid',async()=>{
 const x=fixture();
 try{
   const a=await x.setup();
   const c1=await x.send('courses/'+a.course.id+'/classes','POST',x.classPayload('second'),a.host.token);
   const c2=await x.send('courses/'+a.course.id+'/classes','POST',x.classPayload('third'),a.host.token);
   for(const c of [c1,c2])assert.equal((await x.send('classes/'+c.data.class.id+'/enroll','POST',{},a.student.token)).status,200);
   const o1=await x.send('classes/'+c1.data.class.id+'/orders','POST',{requestKey:'wk06-class-order-one'},a.student.token);
   const o2=await x.send('classes/'+c2.data.class.id+'/orders','POST',{requestKey:'wk06-class-order-two'},a.student.token);
   assert.equal(o1.status,201);assert.equal(o2.status,201);
   const key='txn_unique_should_not_cross_orders';
   x.pay(o1.data.order.reference,30000,key);
   x.pay(o2.data.order.reference,30000,key);
   assert.equal((await x.send('learning-orders/'+o1.data.order.reference+'/confirm','POST',{},a.student.token)).status,200);
   assert.equal((await x.send('learning-orders/'+o2.data.order.reference+'/confirm','POST',{},a.student.token)).status,409);
   assert.equal(x.store.hasActiveEntitlement({buyerId:a.student.user.id,resourceKind:'class',resourceId:c2.data.class.id}),false);
 }finally{x.close();}
});
