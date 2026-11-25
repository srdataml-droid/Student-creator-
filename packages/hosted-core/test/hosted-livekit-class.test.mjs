import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedClassTokenHandler,buildHostedClassTokenRoute} from '../src/hosted-livekit-class.mjs';
const classId='f1810000-0000-4000-8000-000000000001',id='f1810000-0000-4000-8000-000000000002',origin='https://staging.example.invalid';
function request(body,site=origin){return new Request(origin,{method:'POST',headers:{origin:site,authorization:'Bearer fixture'},...(body?{body}:{})});}
function fixture(role='host'){
 const grant={room:'wk-class-'+classId,identity:'student-'+id,role,capacity:12};let rooms=[],issued=[];
 const deps={auth:{getUser:async()=>({id})},loadGrant:async()=>grant,roomService:{createRoom:async(...args)=>rooms.push(args)},issuer:{issue:async g=>{issued.push(g);return {url:'wss://example.invalid',token:'fixture',expiresAt:'soon'};}},origin};
 return {deps,grant,rooms,issued};
}
test('host opens provider room before issuing token; participant cannot create room',async()=>{for(const role of ['host','participant']){const f=fixture(role);const r=await createHostedClassTokenHandler(f.deps)(request(),{classId});assert.equal(r.status,200);assert.equal((await r.json()).role,role);assert.equal(f.rooms.length,role==='host'?1:0);assert.equal(f.issued.length,1);}});
test('missing, misbound and revoked grants fail closed',async()=>{for(const mode of ['missing','misbound','revoked']){const f=fixture();let count=0;f.deps.loadGrant=async()=>mode==='missing'?null:mode==='misbound'?{...f.grant,identity:'student-other'}:++count===1?f.grant:null;const r=await createHostedClassTokenHandler(f.deps)(request(),{classId});assert.equal(r.status,403);assert.equal(f.issued.length,0);}});
test('request cannot override role or origin; provider errors do not leak',async()=>{const f=fixture();const h=createHostedClassTokenHandler(f.deps);assert.equal((await h(request('{"role":"host"}'),{classId})).status,400);assert.equal((await h(request(null,'https://other.invalid'),{classId})).status,403);f.deps.roomService.createRoom=async()=>{throw Error('credential');};const r=await h(request(),{classId});assert.equal(r.status,503);assert.equal((await r.json()).error,'LIVEKIT_UNAVAILABLE');});
test('disabled staging does not fetch',async()=>{const h=buildHostedClassTokenRoute({getEnv:()=>({}),fetcher:()=>{throw Error('unexpected');}});assert.equal((await h(request(),{classId})).status,503);});
