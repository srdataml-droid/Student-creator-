import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedCreatorRequest,readCheckoutResult,readClassGrant,readCommunityPosts} from './hosted-creator-client.mjs';
import {checkoutSettings} from './checkout-ui-settings.mjs';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',key='batch-four-order-123456';
test('community posts are scoped, valid and retry-keyed',()=>{
 const spec=hostedCreatorRequest('communityPost',{courseId:id,text:'Original question',creationKey:key,replyTo:other,authorId:other});
 assert.deepEqual(JSON.parse(spec.body),{courseId:id,text:'Original question',creationKey:key,replyTo:other,topicId:null});
 const row={id:other,course_id:id,parent_id:null,body:'Original',created_at:'2026-11-25T10:00:00Z'};
 assert.equal(readCommunityPosts([row],id)[0].body,'Original');
 assert.throws(()=>readCommunityPosts([{...row,course_id:other}],id));
 assert.throws(()=>hostedCreatorRequest('communityPost',{courseId:id,text:'x',creationKey:key}));
});
test('class grant is bodyless, accepts ISO expiry, rejects foreign destinations and expired grants',()=>{
 const grant={classId:id,role:'participant',url:'wss://sample.livekit.cloud',token:'one.two.three',expiresAt:new Date(1120*1000).toISOString()};
 assert.equal(hostedCreatorRequest('classGrant',{classId:id}).body,undefined);
 assert.equal(readClassGrant(grant,id,1000).expiresAt,1120);
 for(const patch of [{url:'wss://sample.livekit.cloud.evil.test'},{url:'https://sample.livekit.cloud'},{url:'wss://user@sample.livekit.cloud'},{classId:other},{expiresAt:new Date(999000).toISOString()},{role:'admin'}])assert.throws(()=>readClassGrant({...grant,...patch},id,1000));
});
test('checkout sends no caller amount and only validated Paystack destinations',()=>{
 const spec=hostedCreatorRequest('checkout',{lessonId:id,creationKey:key,amountKobo:1});
 assert.equal(spec.body,undefined);assert.equal(spec.headers['idempotency-key'],key);
 assert.equal(hostedCreatorRequest('liveCheckout',{lessonId:id,creationKey:key,termsVersion:'2026.11'}).headers['x-student-creators-terms-version'],'2026.11');
 assert.throws(()=>hostedCreatorRequest('liveCheckout',{lessonId:id,creationKey:key}));
 assert.deepEqual(readCheckoutResult({orderId:id,status:'pending'}),{orderId:id,status:'pending'});
 assert.equal(readCheckoutResult({orderId:id,authorizationUrl:'https://checkout.paystack.com/safe'}).authorizationUrl,'https://checkout.paystack.com/safe');
 for(const url of ['https://checkout.paystack.com.evil.test/safe','http://checkout.paystack.com/safe','https://evil@checkout.paystack.com/safe','https://checkout.paystack.com/safe#x','https://checkout.paystack.com/a b'])assert.throws(()=>readCheckoutResult({orderId:id,authorizationUrl:url}));
});
test('payment mode fails closed until all approvals and actual terms are configured',()=>{
 const staging={APP_DATA_MODE:'hosted',STUDENT_CREATORS_DISTRIBUTION_CHANNEL:'independent_web',STUDENT_CREATORS_STAGING_APPROVED:'true',STUDENT_CREATORS_PAYSTACK_TEST_ENABLED:'true',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'false'};
 assert.deepEqual(checkoutSettings(staging),{mode:'test'});
 assert.deepEqual(checkoutSettings({...staging,STUDENT_CREATORS_ENVIRONMENT:'production'}),{mode:'disabled'});
 const prod={...staging,STUDENT_CREATORS_PAYSTACK_TEST_ENABLED:'false',STUDENT_CREATORS_ENVIRONMENT:'production',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'true',PAYSTACK_LIVE_PAYMENTS_ENABLED:'1',STUDENT_CREATORS_LIVE_DELIVERY_APPROVED:'true',STUDENT_CREATORS_LIVE_REVERSAL_APPROVED:'true',STUDENT_CREATORS_LIVE_PROVIDER_APPROVED:'true',STUDENT_CREATORS_CHECKOUT_TERMS_VERSION:'v1.0',STUDENT_CREATORS_CHECKOUT_TERMS_TEXT:'Approved test-only terms fixture. '.repeat(5)};
 assert.equal(checkoutSettings(prod).mode,'live');
 for(const missing of ['STUDENT_CREATORS_LIVE_REVERSAL_APPROVED','STUDENT_CREATORS_LIVE_PROVIDER_APPROVED','STUDENT_CREATORS_CHECKOUT_TERMS_TEXT','STUDENT_CREATORS_DISTRIBUTION_CHANNEL']){const e={...prod};delete e[missing];assert.equal(checkoutSettings(e).mode,'disabled');}
});
