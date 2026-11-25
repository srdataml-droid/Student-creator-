import test from 'node:test';
import assert from 'node:assert/strict';
import {createCurrentSupabaseAuth} from '../src/supabase-current-auth.mjs';
const id='11111111-1111-4111-8111-111111111111', session='22222222-2222-4222-8222-222222222222';
const user={id,email:'synthetic@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z',is_anonymous:false};
const token=(claims={})=>'e30.'+Buffer.from(JSON.stringify({sub:id,session_id:session,role:'authenticated',exp:Math.floor(Date.now()/1000)+60,...claims})).toString('base64url')+'.signature';
function fixture({provider=user,authStatus=200,active=true,eligible=true,requireStudent=true}={}){
 const seen=[];
 const auth=createCurrentSupabaseAuth({url:'https://example.supabase.co',publicKey:'public',serverKey:'sb_secret_test',requireStudent,
  fetcher:async(url,opts)=>{const path=new URL(url).pathname;seen.push({path,opts});
   if(path==='/auth/v1/user')return Response.json(provider,{status:authStatus});
   if(path.endsWith('/student_creators_session_active'))return Response.json(active);
   if(path.endsWith('/affiliation_eligible'))return Response.json(eligible);
   throw Error('unexpected');
  }});
 return {auth,seen};
}
test('verified student uses separate scoped server checks and no browser secret',async()=>{
 const {auth,seen}=fixture();assert.deepEqual(await auth.getUser(token()),{id});
 assert.equal(seen.length,3);assert.equal(seen[0].opts.headers.apikey,'public');
 assert.equal(seen[1].opts.headers.apikey,'sb_secret_test');
 assert.equal(seen[1].opts.headers.authorization,undefined);
 assert.deepEqual(JSON.parse(seen[1].opts.body),{_user_id:id,_session_id:session});
 assert.deepEqual(JSON.parse(seen[2].opts.body),{_user_id:id});
 for(const {opts} of seen){assert.equal(opts.redirect,'error');assert.equal(opts.cache,'no-store');assert.ok(opts.signal);}
});
test('staff requires live session but not student affiliation',async()=>{
 const {auth,seen}=fixture({requireStudent:false,eligible:false});
 assert.deepEqual(await auth.getUser(token()),{id});assert.equal(seen.length,2);
});
test('inactive, unconfirmed, anonymous, expired, missing and mismatched sessions fail closed',async()=>{
 for(const [f,t] of [[{active:false},token()],[{eligible:false},token()],
 [{provider:{...user,email_confirmed_at:null}},token()],[{provider:{...user,is_anonymous:true}},token()],
 [{authStatus:401},token()],[{},token({sub:session})],[{},token({session_id:null})],
 [{},token({role:'anon'})],[{},token({exp:0})],[{},'invalid']]){
  const {auth}=fixture(f);assert.equal(await auth.getUser(t),null);
 }
});
test('provider errors and nonboolean policy responses never authorize',async()=>{
 for(const options of [{authStatus:500},{active:'true'},{eligible:null}]){
  const {auth}=fixture(options);await assert.rejects(auth.getUser(token()),/Hosted authentication unavailable/);
 }
});
test('rejects alternate destination and insecure configuration',()=>{
 for(const url of ['https://evil.example','http://example.supabase.co','https://example.supabase.co/path','https://user@example.supabase.co']){
  assert.throws(()=>createCurrentSupabaseAuth({url,publicKey:'public',serverKey:'server'}),/Hosted authentication unavailable/);
 }
});
