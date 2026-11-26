import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedSocialClient} from '../src/hosted-social-api.mjs';
const projectRef='abcdefghij1234567890',publishableKey='sb_publishable_TESTONLY_EXAMPLE_123456789',accessToken='e30.eyJzdWIiOiJ0ZXN0In0.SIGNATUREonly';
const actor='80c0c4f0-847e-4779-a83c-2ff1993f1921',peer='11111111-1111-4111-8111-111111111111';
const user={id:actor,email:'verified@example.test',email_confirmed_at:'2026-11-24T00:00:00Z',is_anonymous:false};
function fixture({session=true,eligible=true,reply={ok:true},status=200}={}){
 const calls=[];
 const client=createHostedSocialClient({projectRef,publishableKey,isCurrentSession:async()=>session,authorizeStudent:async()=>eligible,fetchImpl:async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/auth/v1/user'))return Response.json(user);
  return status===204?new Response(null,{status}):Response.json(reply,{status});
 }});
 return {calls,run:(operation,input={})=>client.execute({accessToken,operation,input})};
}
test('hosted social uses verified user bearer and explicit RPC args, never service credentials',async()=>{
 const x=fixture();await x.run('send',{peerId:peer,text:'  question  '});
 assert.equal(x.calls.length,2);
 const {url,options}=x.calls[1];
 assert.equal(url,'https://'+projectRef+'.supabase.co/rest/v1/rpc/social_message_action');
 assert.deepEqual(JSON.parse(options.body),{_action:'send',_peer:peer,_body:'question'});
 assert.equal(options.headers.Authorization,'Bearer '+accessToken);assert.equal(options.headers.apikey,publishableKey);
 assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
});
test('session revocation, ineligible users, forged fields and arbitrary routes fail before social IO',async()=>{
 for(const config of [{session:false},{eligible:false}]){
  const x=fixture(config);await assert.rejects(x.run('inbox'),{status:config.session===false?401:403});assert.equal(x.calls.length,1);
 }
 for(const [op,input] of [['send',{peerId:peer,text:'hello',senderId:peer}],['thread',{peerId:'bad'}],['readMessages',{peerId:peer,messageIds:[peer,peer]}],['feed',{limit:101}],['rpc/arbitrary',{}],['updateNotificationPreferences',{messages:true,social:true,community:'yes'}]]){
  const x=fixture();await assert.rejects(x.run(op,input));assert.equal(x.calls.length,1);
 }
});
test('reads use bounded allowlisted columns and likes derive actor from verified Auth',async()=>{
 const x=fixture();
 await x.run('notifications');let url=new URL(x.calls[1].url);
 assert.equal(url.pathname,'/rest/v1/social_notifications');assert.equal(url.searchParams.get('select'),'id,kind,target_id,created_at,read_at');
 await x.run('comments',{contentId:peer});url=new URL(x.calls[3].url);
 assert.equal(url.searchParams.get('content_id'),'eq.'+peer);assert.equal(url.searchParams.get('select').includes('creation_hash'),false);
 await x.run('like',{contentId:peer});assert.deepEqual(JSON.parse(x.calls[5].options.body),{_content:peer,_enabled:true});assert.ok(x.calls[5].url.endsWith('/rpc/social_like_action'));
});
test('database errors map to safe client outcomes without exposing provider detail',async()=>{
 for(const [code,status,expected] of [['42501',403,403],['P0002',404,404],['23505',409,409],['22023',400,422],['P0001',400,429]]){
  const x=fixture({status,reply:{code,message:code==='P0001'?'MESSAGE_RATE_LIMIT':'Sensitive provider detail'}});
  await assert.rejects(x.run('send',{peerId:peer,text:'question'}),err=>err.status===expected&&!err.message.includes('Sensitive'));
 }
});

test('creator restriction mutation derives owner from verified token and rejects spoofing',async()=>{
 const x=fixture();await x.run('setCreatorRestrictions',{viewerId:peer,view:true,comment:false,message:false});assert.deepEqual(JSON.parse(x.calls[1].options.body),{_viewer:peer,_view:true,_comment:false,_message:false});
 const y=fixture();await assert.rejects(y.run('setCreatorRestrictions',{creatorId:peer,viewerId:actor,view:true,comment:false,message:false}),{status:422});assert.equal(y.calls.length,1);
});

test('own-account payout and copyright requests use current Auth, never client actor or transfer instructions',async()=>{const x=fixture({eligible:false});await x.run('myPayouts');assert.deepEqual(JSON.parse(x.calls[1].options.body),{_action:'list'});await x.run('cancelPayout',{requestId:peer});assert.deepEqual(JSON.parse(x.calls[3].options.body),{_action:'cancel',_id:peer});await x.run('copyrightClaim',{id:peer,reason:'Synthetic claim details for contract testing'});assert.equal(JSON.parse(x.calls[5].options.body)._action,'submit');await assert.rejects(x.run('requestPayout',{amountKobo:1000,requestKey:'fixture-request-key'}),{status:403});await assert.rejects(fixture().run('requestPayout',{amountKobo:1,requestKey:'fixture-request-key',creatorId:peer}),{status:422});await assert.rejects(fixture().run('transferPayout',{requestId:peer}),{status:404});await assert.rejects(fixture({session:false}).run('myPayouts'),{status:401});});

test('community membership and available class discovery retain own-account and eligibility boundaries',async()=>{
 const x=fixture();await x.run('myCommunities');
 let url=new URL(x.calls[1].url);assert.equal(url.pathname,'/rest/v1/social_community_members');assert.equal(url.searchParams.get('user_id'),'eq.'+actor);assert.equal(url.searchParams.get('course.active'),'eq.true');
 await x.run('availableClasses',{classId:peer,limit:3});url=new URL(x.calls[3].url);assert.equal(url.pathname,'/rest/v1/interactive_classes');assert.equal(url.searchParams.get('id'),'eq.'+peer);assert.equal(url.searchParams.get('status'),'in.(scheduled,room_open)');assert.equal(url.searchParams.get('limit'),'3');assert.match(url.searchParams.get('ends_at'),/^gt\.\d{4}-/);assert.equal(url.searchParams.get('select').includes('room_name'),false);assert.equal(x.calls[3].options.headers.Authorization,'Bearer '+accessToken);
 for(const op of ['myCommunities','availableClasses']){const y=fixture({eligible:false});await assert.rejects(y.run(op),{status:403});assert.equal(y.calls.length,1);const z=fixture();await assert.rejects(z.run(op,{userId:peer}),{status:422});assert.equal(z.calls.length,1);}
});
