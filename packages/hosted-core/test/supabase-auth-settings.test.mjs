import test from 'node:test';
import assert from 'node:assert/strict';
import {isSafePilotAuthSettings,requireSafePilotAuthSettings} from '../src/supabase-auth-settings.mjs';
const safe={disable_signup:true,mailer_autoconfirm:false,external:{anonymous_users:false,email:true}};
test('rejects provider settings drift, anonymous sign-ins, auto-confirm and missing evidence',()=>{
 assert.equal(isSafePilotAuthSettings(safe),true);
 for(const settings of [{},{...safe,disable_signup:false},{...safe,mailer_autoconfirm:true},
 {...safe,external:{anonymous_users:true,email:true}},{...safe,external:{anonymous_users:false,email:false}}])
  assert.equal(isSafePilotAuthSettings(settings),false);
});
test('actual settings adapter uses public key and fixed project, sanitizes provider failure',async()=>{
 let seen;const deps={url:'https://jnkqmlbkkvccnxrgkpno.supabase.co',publicKey:'sb_publishable_fixture_public',
 fetcher:async(url,opts)=>{seen={url:String(url),opts};return Response.json(safe);}};
 assert.equal(await requireSafePilotAuthSettings(deps),true);
 assert.equal(seen.url,deps.url+'/auth/v1/settings');assert.equal(seen.opts.headers.apikey,deps.publicKey);
 assert.equal(seen.opts.redirect,'error');assert.ok(seen.opts.signal);
 await assert.rejects(requireSafePilotAuthSettings({...deps,url:'https://other.supabase.co'}));
 await assert.rejects(requireSafePilotAuthSettings({...deps,fetcher:async()=>Response.json({}, {status:500})}),/Unsafe or unavailable/);
});
