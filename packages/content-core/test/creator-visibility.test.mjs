import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCreatorVisibility as transition} from '../src/creator-visibility.mjs';
const actor={id:'owner',verifiedAt:'2026-11-24',suspended:false};
const item={creatorId:'owner',status:'published'};
test('owner can unpublish and archive with revocation requirement',()=>{
 assert.deepEqual(transition({actor,item,action:'unpublish'}),{expectedStatus:'published',nextStatus:'draft',revokePlayback:true});
 assert.equal(transition({actor,item,action:'archive'}).nextStatus,'archived');
});
test('other, suspended and unverified accounts cannot change visibility',()=>{
 for(const a of [{...actor,id:'other'},{...actor,suspended:true},{...actor,verifiedAt:null},null])
  assert.throws(()=>transition({actor:a,item,action:'archive'}),{code:'FORBIDDEN'});
});
test('review and archived states cannot bypass moderation',()=>{
 for(const status of ['in_review','processing','taken_down','archived'])
  for(const action of ['archive','unpublish'])
   assert.throws(()=>transition({actor,item:{...item,status},action}),{code:'INVALID_STATE'});
 assert.throws(()=>transition({actor,item,action:'publish'}),{code:'INVALID_STATE'});
});
