import {readdir,readFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Explicit server-only aliases: publishable keys and ordinary public Firebase
// settings are deliberately excluded. Never print secret values or file text.
const PRIVATE=new Set([
 'SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPERBASE_SECRET_KEY','SUPABASE_CONNECTION_STRING',
 'MUX_TOKEN_ID','MUX_TOKEN_SECRET','MUX_API','MUX_SECRET_KEY','MUX_ENV_KEY','MUX_SIGNING_KEY','MUX_SIGNING_SECRET_KEY',
 'MUX_SIGINING_SECRET_KEY','MUX_PLAYBACK_PRIVATE_KEY_BASE64','MUX_WEBHOOK_SIGNING_SECRET',
 'LIVEKIT_API_SECRET','LIVEKIT_API_KEY','LIVEKIT_APIKEY','LIVEKIT_SIP',
 'RESEND_API_KEY','RESEND_API','SUPABASE_AUTH_EMAIL_HOOK_SECRET',
 'PAYSTACK_TEST_SECRET_KEY','PAYSTACK_SECRET_KEY','PAYSTACK_LIVE_SECRET_KEY','PAYSTACK_WEBHOOK_SIGNING_SECRET',
 'PAYSTACK_WEBHOOK_KEY_ID','STUDENT_CREATORS_PILOT_INVITE_SECRET','STUDENT_CREATORS_HOSTED_AUTH_PEPPER',
 'STUDENT_CREATORS_HEALTH_TOKEN','STUDENT_CREATORS_AUTH_TEST_PASSWORD','STUDENT_CREATORS_STORAGE_TEST_TOKEN_A',
 'STUDENT_CREATORS_STORAGE_TEST_TOKEN_B','STUDENT_CREATORS_PILOT_EMAIL','STUDENT_CREATORS_STAGING_ADMIN_EMAIL','LOCAL_ADMIN_PASSWORD','SENTRY_AUTH_TOKEN','FIREBASE_PRIVATE_KEY',
 'FIREBASE_SERVICE_ACCOUNT','FIREBASE_SERVICE_ACCOUNT_JSON'
]);
function privateName(name){return PRIVATE.has(name.toUpperCase());}
const clientServerArtifact=/\.(?:html|rsc|json|txt|body|meta)$/i;
async function* walk(root,accept){
 for(const e of await readdir(root,{withFileTypes:true})){
  const p=join(root,e.name);
  if(e.isSymbolicLink())throw Error('Unexpected symbolic link in browser artifact');
  if(e.isDirectory())yield* walk(p,accept);
  else if(e.isFile()&&accept(p))yield p;
 }
}
export async function assertNoBrowserSecrets(root,env=process.env){
 const needles=new Set();
 for(const [name,value] of Object.entries(env)){
  if(typeof value!=='string'||!value.trim())continue;
  if(name.toUpperCase().startsWith('NEXT_PUBLIC_')&&privateName(name.slice(12)))
   throw Error('Server-only credential is configured with a browser-visible name');
  if(!privateName(name)||value.length<12)continue;
  const v=value.trim();
  if(v.length<12)continue;
  for(const variant of [v,JSON.stringify(v).slice(1,-1),encodeURIComponent(v),Buffer.from(v).toString('base64'),Buffer.from(v).toString('base64url')])
   if(variant.length>=12)needles.add(variant);
 }
 const staticRoot=join(root,'static'),serverApp=join(root,'server','app');
 // Next's static chunks and generated HTML/RSC payloads are browser-visible.
 // Server JS is excluded because server-only configuration is permitted there.
 if(!(await stat(staticRoot)).isDirectory()||!(await stat(serverApp)).isDirectory())
  throw Error('Expected Next build artifacts missing');
 let files=0;
 for(const [dir,accept] of [[staticRoot,()=>true],[serverApp,p=>clientServerArtifact.test(p)]]){
  for await(const p of walk(dir,accept)){
   const bytes=await readFile(p);files++;
   for(const needle of needles)if(bytes.includes(Buffer.from(needle)))
    throw Error('Server-only credential detected in a browser-visible build artifact');
  }
 }
 if(files===0)throw Error('No browser build artifacts inspected');
 return {filesInspected:files,configuredSecretVariants:needles.size};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const result=await assertNoBrowserSecrets(resolve(process.argv[2]||'.next'));
  console.log('Browser credential boundary passed; '+result.filesInspected+' artifacts inspected.');
 }catch{
  console.error('Browser credential boundary failed; inspect private build configuration and artifacts.');
  process.exitCode=1;
 }
}
