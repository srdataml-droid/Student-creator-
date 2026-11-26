import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';
const unavailable=()=>new Error('Unsafe or unavailable Supabase Auth settings');
export function isSafePilotAuthSettings(settings){
 return settings?.disable_signup===true&&settings?.mailer_autoconfirm===false&&
 settings?.external?.anonymous_users===false&&settings?.external?.email===true;
}
export async function requireSafePilotAuthSettings({url,publicKey,fetcher=fetch}){
 if(url!=='https://jnkqmlbkkvccnxrgkpno.supabase.co'||!publicKey)throw unavailable();
 const response=await fetcher(new URL('/auth/v1/settings',url),{method:'GET',headers:{apikey:publicKey},
 cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw unavailable();
 const settings=JSON.parse(await readBoundedGatewayResponse(response,32768,unavailable));
 if(!isSafePilotAuthSettings(settings))throw unavailable();
 return true;
}
