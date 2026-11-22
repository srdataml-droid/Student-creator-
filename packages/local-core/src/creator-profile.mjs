/** Public aliases only. Never treat this text as a verified legal or campus identity. */
const HANDLE=/^[a-z][a-z0-9_]{2,23}$/;
const NAME=/^[\p{L}][\p{L}\p{M}\p{N} .'-]{2,59}$/u;
const RESERVED=/^(?:admin|administrator|staff|official|verified|support|moderator|system|platform|worthkind|registrar|school_admin)(?:_|$)/;
const RESERVED_NAME=/(?:^|[^\p{L}\p{N}])(?:admin|administrator|staff|official|verified|support|moderator|system|platform|worthkind|registrar|school admin)(?:$|[^\p{L}\p{N}])/iu;
export function creatorProfileInput(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).some(key=>!['handle','displayName','bio'].includes(key)))
   throw Object.assign(new Error('INVALID_PUBLIC_PROFILE'),{code:'INVALID_PUBLIC_PROFILE',status:422});
 const fail=(code)=>{throw Object.assign(new Error(code),{code,status:422});};
 if(typeof value.handle!=='string')fail('INVALID_HANDLE');
 const handle=value.handle.trim().toLowerCase();
 if(!HANDLE.test(handle)||RESERVED.test(handle))fail('INVALID_HANDLE');
 if(typeof value.displayName!=='string')fail('INVALID_PUBLIC_NAME');
 const displayName=value.displayName.normalize('NFKC').trim().replace(/\s+/gu,' ');
 if(!NAME.test(displayName)||RESERVED_NAME.test(displayName))fail('INVALID_PUBLIC_NAME');
 const bio=value.bio===undefined?'':value.bio;
 if(typeof bio!=='string')fail('INVALID_BIO');
 const cleanBio=bio.normalize('NFKC').trim().replace(/\s+/gu,' ');
 if(cleanBio.length>280||/[\p{Cc}\p{Cf}]/u.test(cleanBio)||
   /https?:\/\/|www\.|@/iu.test(cleanBio))fail('INVALID_BIO');
 return {handle,displayName,bio:cleanBio};
}
