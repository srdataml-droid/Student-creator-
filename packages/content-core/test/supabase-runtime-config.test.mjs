import test from 'node:test';
import assert from 'node:assert/strict';
import {readSupabaseRuntimeConfig,readDedicatedSupabaseRuntimeConfig,supabaseServerHeaders} from '../src/supabase-runtime-config.mjs';
const ref='jnkqmlbkkvccnxrgkpno';
const url='https://'+ref+'.supabase.co';
test('accepts existing Vercel lowercase aliases without exposing server key in public reads',()=>{
 const env={supabase_url:url,supabase_publishable_key:'sb_publishable_example',supabase_secret_key:'sb_secret_server_only',STUDENT_CREATORS_PROJECT_REF:ref};
 assert.deepEqual(readSupabaseRuntimeConfig(env),{url,publishableKey:'sb_publishable_example'});
 assert.deepEqual(readSupabaseRuntimeConfig(env,{server:true}),{url,publishableKey:'sb_publishable_example',serverKey:'sb_secret_server_only'});
});
test('rejects conflicting aliases and external or mismatched project URLs',()=>{
 const base={supabase_url:url,supabase_publishable_key:'pub'};
 assert.throws(()=>readSupabaseRuntimeConfig({...base,SUPABASE_URL:'https://another.supabase.co'}),/CONFLICTING_SUPABASE_CONFIGURATION/);
 assert.throws(()=>readSupabaseRuntimeConfig({...base,supabase_url:'https://evil.example'}),/INVALID_SUPABASE_URL/);
 assert.throws(()=>readSupabaseRuntimeConfig({...base,supabase_url:'https://user:password@'+ref+'.supabase.co'}),/INVALID_SUPABASE_URL/);
 assert.throws(()=>readSupabaseRuntimeConfig({...base,STUDENT_CREATORS_PROJECT_REF:'aaaaaaaaaaaaaaaaaaaa'}),/SUPABASE_PROJECT_REF_MISMATCH/);
});
test('does not proceed when required hosted configuration is absent',()=>{
 assert.equal(readSupabaseRuntimeConfig({}),null);
 assert.equal(readSupabaseRuntimeConfig({supabase_url:url,supabase_publishable_key:'pub'},{server:true}),null);
});
test('opaque sb_secret is only an API key, never a bearer token',()=>{
 assert.deepEqual(supabaseServerHeaders('sb_secret_server_only'),{apikey:'sb_secret_server_only'});
 assert.deepEqual(supabaseServerHeaders('eyJ.legacy.jwt'),{apikey:'eyJ.legacy.jwt',authorization:'Bearer eyJ.legacy.jwt'});
 assert.throws(()=>supabaseServerHeaders(''),/MISSING_SERVER_KEY/);
});

test('dedicated configuration distinguishes public and private key roles, including legacy project JWTs',()=>{
 const env={APP_DATA_MODE:'hosted',STUDENT_CREATORS_STAGING_APPROVED:'true',STUDENT_CREATORS_PROJECT_REF:ref,
 STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'false',
 supabase_url:url,supabase_publishable_key:'sb_publishable_fixture_public',supabase_secret_key:'sb_secret_fixture_server'};
 assert.deepEqual(readDedicatedSupabaseRuntimeConfig(env),{url,publishableKey:env.supabase_publishable_key});
 assert.equal(readDedicatedSupabaseRuntimeConfig(env,{server:true}).serverKey,env.supabase_secret_key);
 assert.equal(readDedicatedSupabaseRuntimeConfig({...env,STUDENT_CREATORS_PUBLIC_REGISTRATION:'true'}),null);
 assert.throws(()=>readDedicatedSupabaseRuntimeConfig({...env,supabase_publishable_key:env.supabase_secret_key}),/INVALID_SUPABASE_CREDENTIAL_ROLE/);
 const jwt=(role,project=ref)=>'e30.'+Buffer.from(JSON.stringify({role,ref:project})).toString('base64url')+'.signature';
 assert.equal(readDedicatedSupabaseRuntimeConfig({...env,supabase_publishable_key:jwt('anon'),supabase_secret_key:jwt('service_role')},{server:true}).serverKey,jwt('service_role'));
 assert.throws(()=>readDedicatedSupabaseRuntimeConfig({...env,supabase_publishable_key:jwt('service_role')}),/INVALID_SUPABASE_CREDENTIAL_ROLE/);
 assert.throws(()=>readDedicatedSupabaseRuntimeConfig({...env,supabase_publishable_key:jwt('anon','aaaaaaaaaaaaaaaaaaaa')}),/INVALID_SUPABASE_CREDENTIAL_ROLE/);
});

test('same project production mode keeps auth configuration available while live payments are enabled',()=>{const env={APP_DATA_MODE:'hosted',STUDENT_CREATORS_ENVIRONMENT:'production',STUDENT_CREATORS_PROJECT_REF:ref,STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'true',supabase_url:url,supabase_publishable_key:'sb_publishable_fixture_public',supabase_secret_key:'sb_secret_fixture_server'};assert.ok(readDedicatedSupabaseRuntimeConfig(env,{server:true}));assert.equal(readDedicatedSupabaseRuntimeConfig({...env,STUDENT_CREATORS_PAYSTACK_TEST_ENABLED:'true'}),null);});
