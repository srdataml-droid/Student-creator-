const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function mediaSourceDestination({grant,actorId,lessonId}){
 if(![grant?.id,actorId,lessonId].every(x=>UUID.test(x??''))||grant.state!=='reserved')throw Error('INVALID_MEDIA_GRANT');
 const u=new URL(grant.uploadUrl);
 const stem='/storage/v1/object/upload/sign/student-creators-private-media/private/media/'+actorId+'/'+lessonId+'/'+grant.id;
 if(u.origin!=='https://jnkqmlbkkvccnxrgkpno.supabase.co'||u.username||u.password||u.hash||![stem+'.mp4',stem+'.webm'].includes(u.pathname)||u.searchParams.size!==1||! /^[A-Za-z0-9_.-]{16,2048}$/.test(u.searchParams.get('token')??''))throw Error('INVALID_MEDIA_GRANT');
 return u.href;
}
export async function uploadMediaSource({file,lessonId,actorId,request,fetcher=fetch,crypto=globalThis.crypto}){
 if(!file||!['video/mp4','video/webm'].includes(file.type)||!Number.isSafeInteger(file.size)||file.size<12||file.size>104857600)throw Error('INVALID_VIDEO_FILE');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
 const grant=await request('mediaSourceReserve',{lessonId,mime:file.type,bytes:file.size,digest});
 if(!UUID.test(grant?.id??''))throw Error('INVALID_MEDIA_GRANT');
 if(grant.state!=='reserved')return {state:grant.state,id:grant.id};
 const url=mediaSourceDestination({grant,actorId,lessonId});
 const response=await fetcher(url,{method:'PUT',headers:{'content-type':file.type,'x-upsert':'false'},body:file,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store'});
 if(!response.ok)throw Error('TRANSFER_UNCONFIRMED');
 const done=await request('mediaSourceComplete',{lessonId,sourceId:grant.id});
 if(done.queued!==true)throw Error('QUEUE_UNCONFIRMED');
 return {id:grant.id,state:'queued'};
}
