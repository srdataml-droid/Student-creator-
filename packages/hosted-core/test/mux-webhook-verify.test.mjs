import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyMuxWebhookEnvelope} from '../src/mux-webhook-verify.mjs';

const webhookSecret='synthetic_webhook_secret_not_real_123456';
const timestamp=1800000000;
const event={id:'event_123456',type:'video.asset.ready',
 data:{id:'asset_123456',playback_ids:[{id:'playback_123456',policy:'signed'}]}};
const rawBody=Buffer.from(JSON.stringify(event));
const signed=(body=rawBody,ts=timestamp,secret=webhookSecret)=>{
 const raw=typeof body==='string'?Buffer.from(body):body;
 const hmac=createHmac('sha256',secret).update(Buffer.concat([Buffer.from(String(ts)+'.'),raw])).digest('hex');
 return 't='+ts+',v1='+hmac;
};
const opts={rawBody,signatureHeader:signed(),webhookSecret,nowSeconds:timestamp};
const hasCode=code=>({code});
test('verifies byte-for-byte Mux signature, returns only sanitized event identifiers',()=>{
 const result=verifyMuxWebhookEnvelope(opts);
 assert.deepEqual(result,{eventId:event.id,type:event.type,assetId:event.data.id,receivedAt:timestamp});
 assert.equal(JSON.stringify(result).includes('playback_123456'),false);
 assert.equal(JSON.stringify(result).includes(webhookSecret),false);
 assert.equal(Object.isFrozen(result),true);
});
test('rejects tampered event raw bytes even if fields are semantically equivalent',()=>{
 const spaced=JSON.stringify(event,null,2);
 assert.throws(()=>verifyMuxWebhookEnvelope({...opts,rawBody:spaced}),hasCode('MUX_WEBHOOK_SIGNATURE_INVALID'));
 assert.deepEqual(verifyMuxWebhookEnvelope({...opts,rawBody:spaced,signatureHeader:signed(spaced)}),
  {eventId:event.id,type:event.type,assetId:event.data.id,receivedAt:timestamp});
});
test('rejects wrong webhook secret, signature and other key types',()=>{
 assert.throws(()=>verifyMuxWebhookEnvelope({...opts,webhookSecret:'synthetic_another_secret_123456'}),
  hasCode('MUX_WEBHOOK_SIGNATURE_INVALID'));
 assert.throws(()=>verifyMuxWebhookEnvelope({...opts,signatureHeader:'t=1800000000,v1='+'f'.repeat(64)}),
  hasCode('MUX_WEBHOOK_SIGNATURE_INVALID'));
 assert.throws(()=>verifyMuxWebhookEnvelope({...opts,webhookSecret:''}),hasCode('MUX_WEBHOOK_SECRET_UNAVAILABLE'));
});
test('rejects old and future signatures outside five minute window',()=>{
 for(const nowSeconds of [timestamp+301,timestamp-301]){
  assert.throws(()=>verifyMuxWebhookEnvelope({...opts,nowSeconds}),
   hasCode('MUX_WEBHOOK_TIMESTAMP_EXPIRED'));
 }
 assert.equal(verifyMuxWebhookEnvelope({...opts,nowSeconds:timestamp+300}).eventId,event.id);
});
test('rejects duplicate timestamp and unknown signature schemes',()=>{
 for(const signatureHeader of [signed()+',t=1800000000','t=1800000000,v2='+'f'.repeat(64),
  't=1800000000','v1='+'f'.repeat(64),'','t=notanumber,v1='+'f'.repeat(64)]){
  assert.throws(()=>verifyMuxWebhookEnvelope({...opts,signatureHeader}),
   {code:/MUX_WEBHOOK_SIGNATURE_(?:INVALID|MISSING)/});
 }
});
test('rejects invalid, missing and oversized raw bodies',()=>{
 for(const rawBody of [null,Buffer.alloc(0),Buffer.alloc(262145)]){
  assert.throws(()=>verifyMuxWebhookEnvelope({...opts,rawBody}),
   {code:/MUX_WEBHOOK_(?:RAW_BODY_REQUIRED|BODY_SIZE_INVALID)/});
 }
});
test('rejects invalid JSON even when correctly signed',()=>{
 const rawBody=Buffer.from('{malformed');
 assert.throws(()=>verifyMuxWebhookEnvelope({...opts,rawBody,signatureHeader:signed(rawBody)}),
  hasCode('MUX_WEBHOOK_JSON_INVALID'));
});
test('rejects incomplete or malformed signed event envelopes',()=>{
 for(const payload of [{id:'',type:'video.asset.ready',data:{}},
  {id:event.id,type:null,data:{}},{id:event.id,type:'x'.repeat(129)},
  []]){
  const rawBody=Buffer.from(JSON.stringify(payload));
  assert.throws(()=>verifyMuxWebhookEnvelope({...opts,rawBody,signatureHeader:signed(rawBody)}),
   hasCode('MUX_WEBHOOK_ENVELOPE_INVALID'));
 }
});
test('does not trust unknown asset identifiers as ready-to-process resources',()=>{
 const e={...event,data:{id:'../../admin'}};
 const rawBody=Buffer.from(JSON.stringify(e));
 const verified=verifyMuxWebhookEnvelope({...opts,rawBody,signatureHeader:signed(rawBody)});
 assert.equal(verified.assetId,null);
 assert.equal(verified.type,event.type);
});
test('rejects unsafe tolerance and clock values',()=>{
 for(const toleranceSeconds of [-1,301,0.5]){
  assert.throws(()=>verifyMuxWebhookEnvelope({...opts,toleranceSeconds}),
   hasCode('MUX_WEBHOOK_CLOCK_INVALID'));
 }
 assert.throws(()=>verifyMuxWebhookEnvelope({...opts,nowSeconds:-1}),
  hasCode('MUX_WEBHOOK_CLOCK_INVALID'));
});
