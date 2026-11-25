import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertNoBrowserSecrets} from '../../../scripts/assert-no-browser-secrets.mjs';
const marker='synthetic_secret_boundary_1234567890';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'wk-browser-secret-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'static','chunks'),{recursive:true});await mkdir(join(root,'server','app'),{recursive:true});
 await writeFile(join(root,'static','chunks','bundle.js'),'public code');
 await writeFile(join(root,'server','app','index.html'),'<html>public</html>');
 await writeFile(join(root,'server','app','server.js'),marker);
 return root;
}
test('browser artifacts scanned, server-only JS excluded',async t=>{
 const root=await fixture(t);
 const result=await assertNoBrowserSecrets(root,{supabase_secret_key:marker,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public_key'});
 assert.equal(result.filesInspected,2);assert.ok(result.configuredSecretVariants>0);
});
test('rejects raw and encoded server credentials in browser output without exposing values',async t=>{
 const root=await fixture(t);
 for(const bytes of [marker,Buffer.from(marker).toString('base64'),Buffer.from(marker).toString('base64url')]){
  await writeFile(join(root,'server','app','index.rsc'),bytes);
  await assert.rejects(assertNoBrowserSecrets(root,{mux_sigining_secret_key:marker}),e=>/browser-visible/.test(e.message)&&!e.message.includes(marker));
 }
});
test('rejects accidentally public aliases and missing build artifacts',async t=>{
 const root=await fixture(t);
 await assert.rejects(assertNoBrowserSecrets(root,{NEXT_PUBLIC_RESEND_API:marker}),/browser-visible name/);
 await assert.rejects(assertNoBrowserSecrets(join(root,'missing'),{}));
});
