import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeConversationMessages,pendingReadIds,isConversationAccessLost} from './conversation-state.mjs';
const m=(id,senderId,recipientId,createdAt='2026-11-25T00:00:00Z')=>({id,senderId,recipientId,createdAt});
test('route switches cannot merge foreign pair data; duplicates are stable and sorted',()=>{
 const old=[m('z','a','b'),m('foreign','a','c')],incoming=[m('a','b','a'),m('z','a','b'),m('foreign2','c','b')];
 assert.deepEqual(mergeConversationMessages(old,incoming,'b','a').map(x=>x.id),['a','z']);
 assert.deepEqual(mergeConversationMessages(old,incoming,'c','a').map(x=>x.id),['foreign']);
});
test('only unique incoming messages for the active pair are acknowledged, excluding successful batches',()=>{
 const messages=[m('old','b','a'),m('new','b','a'),m('new','b','a'),m('own','a','b'),m('foreign','c','a')];
 assert.deepEqual(pendingReadIds(messages,'b','a',new Set(['old'])),['new']);
});
test('signout or eligibility loss clears history, while contact blocks preserve existing history',()=>{
 assert.equal(isConversationAccessLost({status:401}),true);
 assert.equal(isConversationAccessLost({status:403,message:'VERIFICATION_REQUIRED'}),true);
 assert.equal(isConversationAccessLost({status:403,message:'CONTACT_BLOCKED'}),false);
 assert.equal(isConversationAccessLost({status:503}),false);
});
