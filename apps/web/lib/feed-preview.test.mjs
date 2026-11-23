import test from 'node:test';
import assert from 'node:assert/strict';
import {toFeedPreview} from './feed-preview.mjs';

test('feed serializes only reviewed public preview fields, never full lesson or private metadata',()=>{
  const sample={
    id:'lesson-1',creatorId:'student-1',courseId:'course-1',topicId:null,
    title:'Original student video',description:'A safe description',previewText:'Public excerpt',
    publishedAt:'2026-11-23T12:00:00Z',hasVideo:1,
    lessonText:'SECRET_FULL_LESSON',creationKey:'SECRET_CREATION_KEY',
    rightsAttested:true,reviewReason:'SECRET_REVIEW_REASON',email:'SECRET_EMAIL',
  };
  const output=toFeedPreview(sample,{code:'CSC101',title:'Computer Science'},'Test Campus');
  assert.deepEqual(Object.keys(output),[
    'id','creatorId','courseId','topicId','title','description','previewText',
    'publishedAt','hasVideo','courseCode','courseTitle','institutionName'
  ]);
  assert.equal(output.previewText,'Public excerpt');
  assert.equal(output.hasVideo,true);
  for(const secret of ['SECRET_FULL_LESSON','SECRET_CREATION_KEY','SECRET_REVIEW_REASON','SECRET_EMAIL']){
    assert.equal(JSON.stringify(output).includes(secret),false);
  }
});
