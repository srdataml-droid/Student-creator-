import {readDedicatedSupabaseRuntimeConfig} from '../packages/content-core/src/supabase-runtime-config.mjs';
import {createPrivateIdentityProvider} from '../packages/hosted-core/src/private-identity-api.mjs';
import {createClamdIdentityScanner,processNextIdentityScan} from '../packages/hosted-core/src/private-identity-scanner.mjs';
async function main(){
 const env=process.env;
 if(env.STUDENT_CREATORS_IDENTITY_DATA_POLICY_APPROVED!=='true'||
 env.STUDENT_CREATORS_PRIVATE_IDENTITY_BUCKET!=='student-creators-private-identity'||
 env.STUDENT_CREATORS_IDENTITY_SCANNER_ENABLED!=='true')throw Error('Scanner activation blocked');
 const config=readDedicatedSupabaseRuntimeConfig(env,{server:true});
 if(!config)throw Error('Scanner configuration unavailable');
 const provider=createPrivateIdentityProvider({url:config.url,serverKey:config.serverKey});
 const scanner=createClamdIdentityScanner({socketPath:env.CLAMD_SOCKET});
 const result=await processNextIdentityScan({...provider,scanner});
 console.log(JSON.stringify(result));
 if(result.status==='inconclusive')process.exitCode=1;
}
main().catch(()=>{console.error('Identity scan unavailable; no evidence released.');process.exitCode=1;});
