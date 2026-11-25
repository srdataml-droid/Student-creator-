import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedBrowserAuth} from './hosted-browser-auth.mjs';
const userId='11111111-1111-4111-8111-111111111111';
const session={accessToken:'one.two.three',userId,expiresIn:3600};
test('session stays in transport closure, same-origin cookies, refresh serialization, logout bearer',async()=>{
 const calls=[];const client=createHostedBrowserAuth({now:()=>1000,fetcher:async(url,options)=>{calls.push({url,options});return Response.json(url.endsWith('logout')?{signedOut:true,remoteRevoked:true}:session);}});
 assert.deepEqual(await client.signIn('x@example.com','private-password'),{userId,expiresAt:3601000});
 assert.equal(client.hasFreshSession(),true);
 await Promise.all([client.refresh(),client.refresh()]);
 assert.deepEqual(await client.logout(),{remoteRevoked:true});assert.equal(client.hasFreshSession(),false);
 assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.redirect,'error');
 assert.equal(calls.at(-1).options.headers.authorization,'Bearer one.two.three');
});
test('missing or invalid token and failed refresh never signal a session',async()=>{
 let valid=true;const c=createHostedBrowserAuth({fetcher:async()=>valid?Response.json(session):Response.json({error:'AUTH_REQUIRED'},{status:401})});
 await c.refresh();valid=false;await assert.rejects(c.refresh(),{status:401});assert.equal(c.hasFreshSession(),false);
 const bad=createHostedBrowserAuth({fetcher:async()=>Response.json({userId,expiresIn:3600})});await assert.rejects(bad.refresh(),/INVALID_AUTH_RESPONSE/);
});
test('invitation, recovery, completion and remote logout failures stay distinct',async()=>{
 const calls=[];const c=createHostedBrowserAuth({fetcher:async(url,opts)=>{calls.push({url,opts});return url.endsWith('logout')?Response.json({signedOut:true,remoteRevoked:false},{status:503}):url.endsWith('complete')?Response.json({completed:true,signInRequired:true}):Response.json({accepted:true},{status:202});}});
 assert.equal(await c.invite('private-code'),true);assert.equal(await c.recover('x@example.com'),true);
 assert.equal(await c.complete('x@example.com','recovery','123456','new-password'),true);
 await assert.rejects(c.logout(),{status:503,localSignedOut:true});
 assert.equal(c.hasFreshSession(),false);assert.deepEqual(JSON.parse(calls[0].opts.body),{inviteCode:'private-code'});
});

test('authorized creator calls use in-memory bearer, refresh once, and never replay a mutation',async()=>{
 const calls=[];let now=1000;
 const c=createHostedBrowserAuth({now:()=>now,fetcher:async(url,opts)=>{calls.push({url,opts});return url.endsWith('refresh')||url.endsWith('sign-in')?Response.json(session):Response.json({error:'AUTH_REQUIRED'},{status:401});}});
 await c.signIn('x@example.com','private-password');now+=3600000;
 await assert.rejects(c.authorized('setMessagePreference',{allowMessages:false}),{status:401});
 assert.deepEqual(calls.map(x=>x.url),['/api/hosted-auth/sign-in','/api/hosted-auth/refresh','/api/social/messagePreference']);
 assert.equal(calls.at(-1).opts.headers.authorization,'Bearer one.two.three');
 assert.equal(c.hasFreshSession(),false);
 await assert.rejects(c.authorized('https://evil.test'),/UNKNOWN_CREATOR_OPERATION/);
 assert.equal(calls.length,3);
});
