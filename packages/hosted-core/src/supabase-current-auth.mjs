import {supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const unavailable=()=>new Error('Hosted authentication unavailable');

// Server-only shared Auth boundary. The JWT payload is not authoritative:
// Supabase Auth MUST verify the exact token before its claims are used.
export function createCurrentSupabaseAuth({url,publicKey,serverKey,requireStudent=false,fetcher=fetch}){
 const base=new URL(url);
 if(base.protocol!=='https:'||base.username||base.password||base.port||base.pathname!=='/'||base.search||base.hash||
    !/^[a-z0-9]{3,}\.supabase\.co$/.test(base.hostname)||!publicKey||!serverKey||typeof fetcher!=='function')
   throw unavailable();
 async function rpc(name,body){
  const response=await fetcher(new URL('/rest/v1/rpc/'+name,base),{
   method:'POST',headers:{...supabaseServerHeaders(serverKey),'content-type':'application/json'},
   body:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)throw unavailable();
  const result=await response.json();
  if(typeof result!=='boolean')throw unavailable();
  return result;
 }
 return {async getUser(token){
  if(typeof token!=='string'||token.length>8192||!JWT.test(token))return null;
  try{
   const response=await fetcher(new URL('/auth/v1/user',base),{
    method:'GET',headers:{apikey:publicKey,authorization:'Bearer '+token},
    redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)
   });
   if([401,403].includes(response.status))return null;
   if(!response.ok)throw unavailable();
   const user=await response.json();
   if(!UUID.test(user?.id??'')||user.is_anonymous===true||typeof user.email!=='string'||
      typeof user.email_confirmed_at!=='string'||!Number.isFinite(Date.parse(user.email_confirmed_at)))return null;
   let claims;
   try{claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));}catch{return null;}
   if(!claims||claims.sub!==user.id||!UUID.test(claims.session_id??'')||
      claims.role!=='authenticated'||!Number.isSafeInteger(claims.exp)||claims.exp<=Math.floor(Date.now()/1000))return null;
   if(!await rpc('student_creators_session_active',{_user_id:user.id,_session_id:claims.session_id}))return null;
   if(requireStudent&&!await rpc('affiliation_eligible',{_user_id:user.id}))return null;
   return Object.freeze({id:user.id});
  }catch{throw unavailable();}
 }};
}
