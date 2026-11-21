import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { quoteLessonPurchase, verifyLegacyPaystackSignature, decodeVerifiedLegacyWebhook, validateVerifiedCharge, PaymentValidationError } from '../src/payments.mjs';

const order = Object.freeze({reference:'order-c34a',amountKobo:20000,buyerEmail:'student@university.edu.ng',domain:'test'});
const response = () => ({status:true,data:{status:'success',reference:order.reference,amount:order.amountKobo,currency:'NGN',domain:'test',id:4321,customer:{email:order.buyerEmail}}});
const sign = (body, key='secret') => createHmac('sha512',key).update(body).digest('hex');
const throwsCode = (fn, code) => assert.throws(fn, e => e instanceof PaymentValidationError && e.code === code);

test('₦200 quote preserves exact kobo and allocates 10% platform fee', () => {let v=quoteLessonPurchase(20000);assert.deepEqual(v,{currency:'NGN',amountKobo:20000,platformFeeBps:1000,platformFeeKobo:2000,creatorGrossShareKobo:18000});});
test('commission and creator allocation conserve the total with odd kobo',()=>{const v=quoteLessonPurchase(20001,1500);assert.equal(v.platformFeeKobo+v.creatorGrossShareKobo,20001);});
test('reject below-minimum, decimal kobo, unsafe integer and invalid basis points',()=>{throwsCode(()=>quoteLessonPurchase(19999),'BELOW_MINIMUM_PRICE');throwsCode(()=>quoteLessonPurchase(20000.5),'INVALID_AMOUNT');throwsCode(()=>quoteLessonPurchase(Number.MAX_SAFE_INTEGER+1),'INVALID_AMOUNT');throwsCode(()=>quoteLessonPurchase(20000,-1),'INVALID_COMMISSION')});
test('valid legacy Paystack signature with raw bytes is accepted',()=>{const raw=Buffer.from('{"event":"charge.success","data":{"id":1}}');assert.equal(verifyLegacyPaystackSignature(raw,sign(raw),['secret']),true)});
test('tampering, malformed signature and wrong secret are denied',()=>{const raw=Buffer.from('{"event":"charge.success","data":{}}');assert.equal(verifyLegacyPaystackSignature(raw,sign(raw),['bad']),false);assert.equal(verifyLegacyPaystackSignature(raw,'abc',['secret']),false);assert.equal(verifyLegacyPaystackSignature(Buffer.from(raw.toString()+' '),sign(raw),['secret']),false)});
test('accepts signed events with rotated keys, rejects unsigned payload',()=>{const raw='{"event":"ping","data":{"ok":true}}';assert.equal(decodeVerifiedLegacyWebhook(raw,sign(raw,'old-key'),['new-key','old-key']).event,'ping');throwsCode(()=>decodeVerifiedLegacyWebhook(raw,'',['old-key']),'INVALID_SIGNATURE')});
test('rejects signed invalid JSON and malformed event',()=>{const raw='{x';throwsCode(()=>decodeVerifiedLegacyWebhook(raw,sign(raw),['secret']),'BAD_JSON');const raw2='{}';throwsCode(()=>decodeVerifiedLegacyWebhook(raw2,sign(raw2),['secret']),'INVALID_EVENT')});
test('provider-verified success with exact order fields returns immutable verification',()=>{const v=validateVerifiedCharge(order,response());assert.equal(v.amountKobo,20000);assert.equal(v.providerTransactionId,'4321');assert.equal(Object.isFrozen(v),true)});
test('browser return or webhook alone is not a verified payment',()=>{throwsCode(()=>validateVerifiedCharge(order,{reference:order.reference,status:true}),'NOT_PAID');throwsCode(()=>validateVerifiedCharge(order,{status:true,data:{status:'pending'}}),'NOT_PAID')});
test('provider amount mismatch fails closed',()=>{const v=response();v.data.amount+=100;throwsCode(()=>validateVerifiedCharge(order,v),'AMOUNT_MISMATCH')});
test('provider currency mismatch fails closed',()=>{const v=response();v.data.currency='USD';throwsCode(()=>validateVerifiedCharge(order,v),'CURRENCY_MISMATCH')});
test('provider reference mismatch fails closed',()=>{const v=response();v.data.reference='other';throwsCode(()=>validateVerifiedCharge(order,v),'REFERENCE_MISMATCH')});
test('provider environment mismatch fails closed',()=>{const v=response();v.data.domain='live';throwsCode(()=>validateVerifiedCharge(order,v),'ENVIRONMENT_MISMATCH')});
test('provider buyer mismatch fails closed',()=>{const v=response();v.data.customer.email='attacker@example.com';throwsCode(()=>validateVerifiedCharge(order,v),'BUYER_MISMATCH')});
test('missing provider ID fails closed',()=>{const v=response();v.data.id=null;throwsCode(()=>validateVerifiedCharge(order,v),'MISSING_TRANSACTION_ID')});
test('missing order env fails closed',()=>{throwsCode(()=>validateVerifiedCharge({...order,domain:null},response()),'INVALID_ORDER')});
