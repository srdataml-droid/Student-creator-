import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWeek1ProviderEnvironment,resolveWeek1ProviderEnvironment} from '../src/week1-provider-env.mjs';
const ref='abcdefghij1234567890';
const example={
 STUDENT_CREATORS_STAGING_APPROVED:'true',APP_DATA_MODE:'hosted',
 STUDENT_CREATORS_PROJECT_REF:ref,
 STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'false',
 supabase_url:'https://'+ref+'.supabase.co',
 supabase_publishable_key:'sb_publishable_EXAMPLEONLY_0123456789',
 supabase_secret_key:'sb_secret_EXAMPLEONLY_0123456789',
 livekit_project_url:'wss://example.livekit.cloud',livekit_apikey:'example_livekit_key',
 resend_api:'re_example_private_key',paystack_secret_key:'sk_test_ExampleOnly123456'
};
test('reads observed lowercase Vercel names only under disabled enrollment/test payment guards',()=>{
 const c=resolveWeek1ProviderEnvironment(example);
 assert.equal(c.supabase.url,example.supabase_url);
 assert.equal(c.paystack.testKey,example.paystack_secret_key);
 assert.deepEqual(c.allowedModes,{registration:false,realPayments:false});
 const report=inspectWeek1ProviderEnvironment(example);
 assert.equal(report.readyForConnectionTests,true);
 assert.equal(report.hostedIntegrationComplete,false);
 assert.equal(report.providers.muxSigning,false);
 assert.equal(report.safeToEnrollStudents,false);
 assert.equal(report.realPaymentsEnabled,false);
 for(const val of [example.supabase_secret_key,example.paystack_secret_key,example.resend_api])
  assert.equal(JSON.stringify(report).includes(val),false);
});
test('canonical uppercase names produce same server-only config',()=>{
 const c={...example};
 for(const [oldName,newName] of Object.entries({
  supabase_url:'SUPABASE_URL',supabase_publishable_key:'SUPABASE_PUBLISHABLE_KEY',
  supabase_secret_key:'SUPABASE_SECRET_KEY',livekit_project_url:'LIVEKIT_URL',
  livekit_apikey:'LIVEKIT_API_KEY',resend_api:'RESEND_API_KEY',paystack_secret_key:'PAYSTACK_TEST_SECRET_KEY'
 })) { c[newName]=c[oldName];delete c[oldName]; }
 assert.equal(resolveWeek1ProviderEnvironment(c).supabase.url,example.supabase_url);
});
test('rejects conflicting canonical and historical values instead of silently choosing',()=>{
 const c={...example,SUPABASE_URL:'https://different.supabase.co'};
 assert.throws(()=>resolveWeek1ProviderEnvironment(c),{code:'CONFLICTING_SUPABASE_URL'});
});
test('refuses unknown project, unsafe URL and missing staging approval',()=>{
 for(const patch of [{STUDENT_CREATORS_PROJECT_REF:'differentproject1234'},
  {supabase_url:'http://'+ref+'.supabase.co'},
  {supabase_url:'https://'+ref+'.supabase.co/evil'},
  {STUDENT_CREATORS_STAGING_APPROVED:'false'},{APP_DATA_MODE:'local'}]){
  assert.equal(inspectWeek1ProviderEnvironment({...example,...patch}).readyForConnectionTests,false);
 }
});
test('refuses live or malformed Paystack key, even in a variable named test',()=>{
 for(const key of ['sk_live_1234567890','pk_test_publickey','invalid']){
  assert.throws(()=>resolveWeek1ProviderEnvironment({...example,paystack_secret_key:key}),{code:'PAYSTACK_TEST_ONLY'});
 }
});
test('refuses enabling registration or live charging',()=>{
 for(const patch of [{STUDENT_CREATORS_PUBLIC_REGISTRATION:'true'},
   {STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'true'}]){
  assert.throws(()=>resolveWeek1ProviderEnvironment({...example,...patch}),
   {code:'PUBLIC_ENROLLMENT_OR_LIVE_PAYMENT_NOT_DISABLED'});
 }
});
test('optional service URLs must be secure WSS endpoints',()=>{
 for(const url of ['https://livekit.example','ws://livekit.example','wss://user:pass@livekit.example'])
  assert.throws(()=>resolveWeek1ProviderEnvironment({...example,livekit_project_url:url}),{code:'LIVEKIT_WSS_URL_REQUIRED'});
});
test('missing Supabase server secret and publishable key fail closed',()=>{
 assert.throws(()=>resolveWeek1ProviderEnvironment({...example,supabase_secret_key:''}),{code:'SUPABASE_SERVER_SECRET_REQUIRED'});
 assert.throws(()=>resolveWeek1ProviderEnvironment({...example,supabase_publishable_key:''}),{code:'SUPABASE_PUBLISHABLE_KEY_REQUIRED'});
});
