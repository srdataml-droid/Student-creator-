import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createSupabaseAuthEmailHandler,buildSupabaseAuthEmailHook} from '../src/supabase-auth-email-hook.mjs';
import {createResendTransport} from '../src/resend-transport.mjs';
const key=Buffer.alloc(32,7),secret='v1,whsec_'+key.toString('base64'),recipient='pilot@example.invalid',origin='https://staging.example.invalid';
const time=1800000000,id='msg_fixture_1',leaseId='11111111-1111-4111-8111-111111111111';
const payload={user:{email:recipient},email_data:{token:'123456',token_hash:'tokenhash_synthetic_123456789',email_action_type:'recovery',redirect_to:'https://evil.example/'}};
function req(data=payload,{signedData=data,t=time,webhookId=id}={}){
 const raw=JSON.stringify(data),sig=createHmac('sha256',key).update(webhookId+'.'+t+'.'+JSON.stringify(signedData)).digest('base64');
 return new Request(origin+'/api/webhooks/auth-email',{method:'POST',headers:{'webhook-id':webhookId,'webhook-timestamp':String(t),'webhook-signature':'v1,'+sig,'content-type':'application/json'},body:raw});
}
function fixture({claim={status:'claimed',leaseId},send=async()=>({id:'resend_message_1'}),finish=true}={}){
 const calls=[];
 const handler=createSupabaseAuthEmailHandler({secret,recipient,origin,deliverySecret:'synthetic_idempotency_pepper_123456789',now:()=>time,
  store:{claim:async x=>{calls.push(['claim',x]);return claim;},finish:async x=>{calls.push(['finish',x]);return finish;}},
  transport:{send:async x=>{calls.push(['send',x]);return send(x);}}});
 return {handler,calls};
}
test('signed recovery hook sends only approved recipient, OTP and fixed origin',async()=>{
 const {handler,calls}=fixture();assert.equal((await handler(req())).status,200);
 const msg=calls[1][1];assert.equal(msg.to,recipient);assert.match(msg.text,/123456/);assert.match(msg.text,/https:\/\/staging\.example\.invalid\/auth\/confirm/);
 assert.doesNotMatch(msg.text,/evil\.example|tokenhash/);assert.equal(calls[0][1].key.length,64);
 assert.equal(JSON.stringify(calls[0][1]).includes(recipient),false);
 assert.equal(calls[2][1].leaseId,leaseId);assert.equal(calls[2][1].providerId,'resend_message_1');
});
test('tampered, stale, unapproved recipient and unsupported action never send',async()=>{
 for(const request of [req({...payload,user:{email:'other@example.invalid'}},{signedData:payload}),
 req(payload,{t:time-301}),req({...payload,user:{email:'other@example.invalid'}}),
 req({...payload,email_data:{...payload.email_data,email_action_type:'email_change'}})]){
  const {handler,calls}=fixture();assert.equal((await handler(request)).status,400);assert.equal(calls.length,0);
 }
});
test('duplicate token across webhook IDs uses stable delivery identity; busy and collision fail safely',async()=>{
 const a=fixture(),b=fixture();await a.handler(req());await b.handler(req(payload,{webhookId:'msg_fixture_2'}));
 assert.deepEqual(a.calls[0],b.calls[0]);
 for(const [status,code] of [['duplicate',200],['busy',503],['collision',409],['limited',429],['expired',503]]){
  const {handler,calls}=fixture({claim:{status}});assert.equal((await handler(req())).status,code);assert.equal(calls.length,1);
 }
});
test('provider failure and uncertain finalization do not acknowledge delivery',async()=>{
 const a=fixture({send:async()=>{throw Error('secret');}});const response=await a.handler(req());
 assert.equal(response.status,503);assert.equal(a.calls[2][1].providerId,null);assert.doesNotMatch(await response.text(),/secret/);
 const b=fixture({finish:false});assert.equal((await b.handler(req())).status,503);
});
test('Resend client fixes provider host, sender and recipient, and uses stable idempotency',async()=>{
 let seen;const transport=createResendTransport({apiKey:'re_fixture_123456',fromEmail:'sender@example.invalid',allowedRecipients:[recipient],
 fetcher:async(url,opts)=>{seen={url,opts};return Response.json({id:'provider_fixture'});}});
 const message={to:recipient,subject:'Verify',text:'Synthetic',idempotencyKey:'student-auth/fixture_123456'};
 assert.deepEqual(await transport.send(message),{id:'provider_fixture'});assert.equal(seen.url,'https://api.resend.com/emails');
 assert.equal(seen.opts.headers['idempotency-key'],message.idempotencyKey);assert.equal(seen.opts.redirect,'error');
 assert.deepEqual(JSON.parse(seen.opts.body).to,[recipient]);await assert.rejects(transport.send({...message,to:'other@example.invalid'}));
});
test('unapproved staging hook contacts no provider',async()=>{
 let n=0;const h=buildSupabaseAuthEmailHook({getEnv:()=>({}),fetcher:async()=>{n++;}});
 assert.equal((await h(req())).status,503);assert.equal(n,0);
});
