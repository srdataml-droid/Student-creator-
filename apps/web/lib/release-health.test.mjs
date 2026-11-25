import {test} from 'node:test';
import assert from 'node:assert/strict';
import {releaseHealth,releaseHealthResponse} from './release-health.mjs';
test('liveness is minimal, no-cache and does not claim provider readiness',async()=>{
 const revision='a'.repeat(40);
 const env={VERCEL_GIT_COMMIT_SHA:revision,VERCEL_ENV:'preview',SUPABASE_SECRET_KEY:'fixture-not-to-expose'};
 const response=releaseHealthResponse(env);
 assert.equal(response.status,200);
 assert.match(response.headers.get('cache-control'),/no-store/);
 assert.deepEqual(await response.json(),{status:'serving',environment:'preview',revision});
 assert.deepEqual(releaseHealth({VERCEL_GIT_COMMIT_SHA:'bad',VERCEL_ENV:'injected'}),{status:'serving',environment:'local',revision:null});
});
