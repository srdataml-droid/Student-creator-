import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api,friendlyError} from './local-client.js';

test('browser API transport keeps cookies private, reports ambiguous writes and never replays',async(t)=>{
  const savedFetch=globalThis.fetch;
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  let calls=[];
  function online(value){Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:value}});}
  t.after(()=>{globalThis.fetch=savedFetch;if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;});
  online(false);
  globalThis.fetch=async(...args)=>{calls.push(args);throw new Error('transport failed');};
  await assert.rejects(api('me'),{message:'NETWORK_OFFLINE'});
  await assert.rejects(api('messages',{method:'POST',body:{text:'synthetic'}}),{message:'NETWORK_OFFLINE'});
  assert.equal(calls.length,0);

  online(true);
  await assert.rejects(api('me'),{message:'NETWORK_UNAVAILABLE'});
  await assert.rejects(api('messages',{method:'POST',body:{text:'synthetic'}}),{message:'MUTATION_OUTCOME_UNKNOWN'});
  assert.equal(calls.length,2);
  assert.match(friendlyError(new Error('MUTATION_OUTCOME_UNKNOWN')),/Check its current status/);

  globalThis.fetch=async(...args)=>{calls.push(args);return new Response('<html>unexpected</html>',{status:200});};
  await assert.rejects(api('me'),{message:'INVALID_SERVER_RESPONSE'});
  await assert.rejects(api('messages',{method:'POST',body:{}}),{message:'MUTATION_OUTCOME_UNKNOWN'});
  assert.equal(calls.length,4);

  globalThis.fetch=async()=>Response.json({error:'AUTH_REQUIRED'},{status:401});
  await assert.rejects(api('me'),{message:'AUTH_REQUIRED',status:401});
  globalThis.fetch=async()=>Response.json({error:'GATEWAY_ERROR'},{status:502});
  await assert.rejects(api('purchase',{method:'POST',body:{}}),{message:'MUTATION_OUTCOME_UNKNOWN',status:502});
  globalThis.fetch=async(...args)=>{calls.push(args);return Response.json({ok:true});};
  assert.deepEqual(await api('me'),{ok:true});
  const [url,options]=calls.at(-1);
  assert.equal(url,'/api/local/me');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.signal.aborted,false);
  const {signal,...other}=options;
  assert.deepEqual(other,{method:'GET',credentials:'same-origin',cache:'no-store',headers:{}});
});


test('request deadlines cover slow headers and bodies without replaying mutations',async(t)=>{
  const original=globalThis.fetch;
  t.after(()=>{globalThis.fetch=original;});
  let calls=0;
  const waitForAbort=signal=>new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new Error('aborted'));return;}
    signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
  });
  globalThis.fetch=async(url,{signal})=>{calls++;return waitForAbort(signal);};
  await assert.rejects(api('me',{timeoutMs:10}),{message:'NETWORK_TIMEOUT'});
  await assert.rejects(api('purchase',{method:'POST',body:{},timeoutMs:10}),{message:'MUTATION_OUTCOME_UNKNOWN'});
  globalThis.fetch=async(url,{signal})=>{calls++;return {status:200,ok:true,json:()=>waitForAbort(signal)};};
  await assert.rejects(api('me',{timeoutMs:10}),{message:'NETWORK_TIMEOUT'});
  await assert.rejects(api('messages',{method:'POST',body:{},timeoutMs:10}),{message:'MUTATION_OUTCOME_UNKNOWN'});
  assert.equal(calls,4);
  await assert.rejects(api('me',{timeoutMs:0}),RangeError);
  assert.equal(calls,4);
});
