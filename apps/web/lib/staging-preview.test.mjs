import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectPreview} from '../../../scripts/check-staging-preview.mjs';
const revision='a'.repeat(40),origin='https://student-preview.example.vercel.app';
const ok={status:'serving',environment:'preview',revision};
const response=(body=ok,headers={'cache-control':'no-store'})=>Response.json(body,{headers});
test('preview probe requires exact protected-preview deployment identity and never claims integration',async()=>{
 let calls=0;
 const result=await inspectPreview({origin,revision,fetcher:async(url,options)=>{
  calls++;assert.equal(url.href,origin+'/api/health');assert.equal(options.redirect,'manual');
  assert.equal(options.method,'GET');assert.equal(options.headers.authorization,undefined);
  return response();
 }});
 assert.equal(calls,1);
 assert.deepEqual(result,{previewLivenessVerified:true,revision,hostedProvidersVerified:false,releaseApproved:false});
});
test('preview probe denies production, wrong revision, stale cache, and unavailable protected endpoint',async()=>{
 const options={origin,revision};
 for(const url of ['http://test.vercel.app','https://test.vercel.app/path','https://test.vercel.app?token=x','https://other.example','https://test.vercel.app.evil.example','https://test.vercel.app@evil.example'])
  await assert.rejects(inspectPreview({...options,origin:url}),{message:'INVALID_STAGING_ORIGIN'});
 await assert.rejects(inspectPreview({...options,revision:'main'}),{message:'EXACT_REVISION_REQUIRED'});
 for(const status of [302,401,403])await assert.rejects(inspectPreview({...options,fetcher:async()=>new Response('',{status})}),{message:'STAGING_PROTECTED_OR_REDIRECTED'});
 for(const data of [{...ok,environment:'production'},{...ok,revision:'b'.repeat(40)},{...ok,status:'error'}])
  await assert.rejects(inspectPreview({...options,fetcher:async()=>response(data)}),{message:'STAGING_REVISION_OR_ENVIRONMENT_MISMATCH'});
 await assert.rejects(inspectPreview({...options,fetcher:async()=>response(ok,{})}),{message:'STAGING_CACHE_POLICY_INVALID'});
 await assert.rejects(inspectPreview({...options,fetcher:async()=>{throw Error('network');}}),{message:'STAGING_UNREACHABLE'});
});
