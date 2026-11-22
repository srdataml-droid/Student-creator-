import test from 'node:test';
import assert from 'node:assert/strict';
import {creatorProfileInput} from '../src/creator-profile.mjs';
test('public creator aliases normalize safe handles and names without leaking email',()=>{
 const profile=creatorProfileInput({handle:'  Samuel_Builds  ',displayName:'  Samuel  O\u0301la  ',bio:'  Sharing   original teaching  '});
 assert.deepEqual(profile,{handle:'samuel_builds',displayName:'Samuel Óla',bio:'Sharing original teaching'});
 assert.deepEqual(creatorProfileInput({handle:'ada_234',displayName:"Ada O'Neill"}),{handle:'ada_234',displayName:"Ada O'Neill",bio:''});
});
test('reserved platform and school identities cannot be self-assigned',()=>{
 for(const handle of ['admin','admin_ops','staff','support_team','official','verified','moderator_1',
  'system','worthkind','registrar','platform_news','x','9user','fake@site','a'.repeat(25)]){
  assert.throws(()=>creatorProfileInput({handle,displayName:'A regular student'}),{message:'INVALID_HANDLE'},handle);
 }
 for(const displayName of ['Official Lecturer','University Support','Worthkind Admin','Campus Faculty',
   'Support Desk','Verified Creator','Админ Creator','AΒC Student','Hacker🙂']){
  assert.throws(()=>creatorProfileInput({handle:'real_student',displayName}),{message:'INVALID_PUBLIC_NAME'},displayName);
 }
});
test('profile fields cannot set role, claim verification or inject URLs/PII into bio',()=>{
 const safe={handle:'alice_teaches',displayName:'Alice Teaches'};
 for(const payload of [{...safe,role:'admin'},{...safe,userId:'fake'},{...safe,verifiedAt:'now'},
   {...safe,displayName:'a'},{...safe,displayName:'A'.repeat(61)},
   {...safe,bio:'Reach me at test@school.edu'},{...safe,bio:'https://phishing.invalid'},
   {...safe,bio:'www.example.com'},{...safe,bio:'x'.repeat(281)},
   {...safe,bio:{x:1}},null,[],{}]){
  assert.throws(()=>creatorProfileInput(payload),payload===null?undefined:/INVALID_/);
 }
});
