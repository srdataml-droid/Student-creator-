import {pathToFileURL} from 'node:url';
const revisionPattern=/^[a-f0-9]{40}$/;
export async function inspectPreview({origin,revision,fetcher=fetch}={}){
 let base;
 try{base=new URL(origin);}catch{throw Error('INVALID_STAGING_ORIGIN');}
 if(base.protocol!=='https:'||!base.hostname.endsWith('.vercel.app')||base.username||base.password||
    base.port||base.pathname!=='/'||base.search||base.hash)
   throw Error('INVALID_STAGING_ORIGIN');
 if(!revisionPattern.test(revision||''))throw Error('EXACT_REVISION_REQUIRED');
 let response;
 try{
  response=await fetcher(new URL('/api/health',base),{method:'GET',redirect:'manual',cache:'no-store',
   headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});
 }catch{throw Error('STAGING_UNREACHABLE');}
 if([301,302,303,307,308,401,403].includes(response.status))throw Error('STAGING_PROTECTED_OR_REDIRECTED');
 if(response.status!==200)throw Error('STAGING_UNAVAILABLE');
 if(!/application\/json/i.test(response.headers.get('content-type')||''))throw Error('STAGING_INVALID_RESPONSE');
 if(!/no-store/i.test(response.headers.get('cache-control')||''))throw Error('STAGING_CACHE_POLICY_INVALID');
 let data;
 try{data=await response.json();}catch{throw Error('STAGING_INVALID_RESPONSE');}
 if(data?.status!=='serving'||data.environment!=='preview'||data.revision!==revision)
   throw Error('STAGING_REVISION_OR_ENVIRONMENT_MISMATCH');
 return {previewLivenessVerified:true,revision,hostedProvidersVerified:false,releaseApproved:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await inspectPreview({origin:process.argv[2],revision:process.argv[3]})));}
 catch(e){console.error(e.message);process.exitCode=1;}
}
