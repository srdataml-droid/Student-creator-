import test from 'node:test';
import assert from 'node:assert/strict';
import {savedIdsFromLessons,isLessonSaved,afterBookmarkRequest} from './bookmark-state.mjs';

test('bookmark hydration ignores invalid or repeated entries without mutating the response', () => {
 const lessons=[{id:'one'},{id:'one'},null,{id:'two'},{id:''},{id:5}];
 assert.deepEqual(savedIdsFromLessons(lessons),['one','two']);
 assert.deepEqual(savedIdsFromLessons(undefined),[]);
 assert.equal(isLessonSaved(lessons,'two'),true);
 assert.equal(isLessonSaved(lessons,'three'),false);
 assert.equal(lessons.length,6);
});

test('save and un-save are replay safe and preserve other bookmarks', () => {
 const original=['one','two'];
 assert.deepEqual(afterBookmarkRequest(original,'two',true),['one']);
 assert.deepEqual(afterBookmarkRequest(original,'three',false),['one','two','three']);
 assert.deepEqual(afterBookmarkRequest(original,'one',false),original);
 assert.deepEqual(afterBookmarkRequest(original,'missing',true),original);
 assert.deepEqual(original,['one','two']);
});
