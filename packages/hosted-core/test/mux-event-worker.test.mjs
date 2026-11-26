import test from 'node:test';
import assert from 'node:assert/strict';
import {processMuxEvent,createMuxWorker} from '../src/mux-event-worker.mjs';
const id='f1710000-0000-4000-8000-000000000001',leaseId='f1710000-0000-4000-8000-000000000002',reservation='f1710000-0000-4000-8000-000000000003';
const upload={id:'upload_fixture',status:'asset_created',asset_id:'asset_fixture',test:true,new_asset_settings:{passthrough:reservation,test:true,playback_policies:['signed']}};
const asset={id:'asset_fixture',upload_id:upload.id,passthrough:reservation,test:true,status:'ready',playback_ids:[{id:'playback_fixture',policy:'signed'}]};
function fixture(kind='video.asset.ready',changes={}){
 let applied=[],finished=[],revoked=[];
 const queue={claim:async()=>({id,leaseId,kind,resourceId:kind.startsWith('video.upload')?upload.id:asset.id}),finish:async(...args)=>{finished.push(args);return true;},revoke:async a=>{revoked.push(a);return true;}};
 const mux={getAsset:async()=>asset,getUpload:async()=>upload,...changes};
 const store={apply:async s=>{applied.push(s);return {id:reservation,state:s.state};}};
 return {queue,mux,store,applied,finished,revoked};
}
test('asset event re-reads authoritative associated provider state',async()=>{const f=fixture();assert.deepEqual(await processMuxEvent(f),{state:'processed'});assert.equal(f.applied[0].state,'ready');assert.equal(f.applied[0].reservation,reservation);assert.deepEqual(f.finished,[[id,leaseId,'processed']]);});
test('upload event uses immutable reservation',async()=>{const f=fixture('video.upload.asset_created');assert.equal((await processMuxEvent(f)).state,'processed');assert.equal(f.applied[0].uploadId,upload.id);});
test('mismatch and provider outage retry without changing assets',async()=>{for(const changes of [{getAsset:async()=>({...asset,test:false})},{getUpload:async()=>({...upload,asset_id:'different'})},{getAsset:async()=>{throw Error('secret');}}]){const f=fixture('video.asset.ready',changes);assert.equal((await processMuxEvent(f)).state,'retry');assert.equal(f.applied.length,0);}});
test('signed deletion only revokes; unsupported events ignored',async()=>{const f=fixture('video.asset.deleted');assert.equal((await processMuxEvent(f)).state,'processed');assert.deepEqual(f.revoked,[asset.id]);assert.equal(f.applied.length,0);const g=fixture('video.other');assert.equal((await processMuxEvent(g)).state,'ignored');});
test('stale lease cannot claim successful completion and disabled worker never fetches',async()=>{const f=fixture();f.queue.finish=async()=>false;await assert.rejects(processMuxEvent(f));assert.throws(()=>createMuxWorker({env:{},fetcher:()=>{throw Error('unexpected');}}));});
