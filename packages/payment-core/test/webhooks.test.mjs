import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyPaystackWebhookV1,decodeVerifiedPaystackWebhookV1} from '../src/webhooks.mjs';
const keys=[{id:'whk_synthetic_old',secret:'whsec_synthetic_old_abc123'},{id:'whk_synthetic_new',secret:'whsec_synthetic_new_def456'}];
const now=1763930000;
const body=Buffer.from('{"event":"charge.success","data":{"reference":"sc_synthetic","amount":20000}}');
const sign=(raw,key=keys[0],t=now)=>'t='+t+',v1='+key.id+':'+createHmac('sha512',key.secret).update(Buffer.concat([Buffer.from(String(t)+'.'),raw])).digest('hex');
test('timestamped Paystack webhook: exact raw bytes, key id, rotation and safe event parser',()=>{
 const hdr=sign(body);assert.equal(verifyPaystackWebhookV1(body,hdr,keys,{nowSeconds:now}),keys[0].id);
 assert.equal(decodeVerifiedPaystackWebhookV1(body,hdr,keys,{nowSeconds:now}).event,'charge.success');
 const rotated=sign(body,keys[0])+',v1='+keys[1].id+':'+sign(body,keys[1]).split(':').at(-1);
 assert.equal(verifyPaystackWebhookV1(body,rotated,[keys[1]],{nowSeconds:now}),keys[1].id);
 assert.equal(verifyPaystackWebhookV1(body,sign(body,keys[0],now-300),keys,{nowSeconds:now}),keys[0].id);
 assert.equal(verifyPaystackWebhookV1(body,sign(body,keys[0],now+300),keys,{nowSeconds:now}),keys[0].id);
 for(const h of [sign(body,keys[0],now-301),sign(body,keys[0],now+301),hdr+',t='+now,'t=nope,v1=whk_fake:00',hdr.replace('whk_synthetic_old','whk_synthetic_new'),hdr.replace(/.$/,'0')]){
  assert.equal(verifyPaystackWebhookV1(body,h,keys,{nowSeconds:now}),null,h);
 }
 assert.equal(verifyPaystackWebhookV1(Buffer.from(body.toString()+' '),hdr,keys,{nowSeconds:now}),null);
 assert.equal(verifyPaystackWebhookV1(body,hdr,[{id:keys[0].id,secret:keys[1].secret}],{nowSeconds:now}),null);
 assert.equal(verifyPaystackWebhookV1(body,hdr,[],{nowSeconds:now}),null);
 assert.equal(verifyPaystackWebhookV1(Buffer.alloc(1024*1024+1),hdr,keys,{nowSeconds:now}),null);
 assert.equal(verifyPaystackWebhookV1(body,'t='+now+',v1=whk_abc:'+('0'.repeat(128)),keys,{nowSeconds:now}),null);
 assert.throws(()=>decodeVerifiedPaystackWebhookV1(body,sign(body,keys[0],now-301),keys,{nowSeconds:now}),{code:'INVALID_SIGNATURE'});
 const invalid=Buffer.from('{not json}');assert.throws(()=>decodeVerifiedPaystackWebhookV1(invalid,sign(invalid),keys,{nowSeconds:now}),{code:'BAD_JSON'});
 const missing=Buffer.from('{}');assert.throws(()=>decodeVerifiedPaystackWebhookV1(missing,sign(missing),keys,{nowSeconds:now}),{code:'INVALID_EVENT'});
});
