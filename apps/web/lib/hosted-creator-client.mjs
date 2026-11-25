const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=v=>{if(typeof v!=='string'||!UUID.test(v))throw Error('INVALID_ID');return v;};
const fail=(code,status)=>Object.assign(Error(code),{status});
export function validateIdentityFile(file){
 if(!file||!['image/jpeg','image/png','application/pdf'].includes(file.type)||file.size<8||file.size>4194304)throw Error('INVALID_IDENTITY_FILE');
 return file;
}
export function validateVideoFile(file){
 if(!file||file.type!=='video/mp4'||!Number.isSafeInteger(file.size)||file.size<1||file.size>100*1024*1024)throw Error('INVALID_VIDEO_FILE');
 return file;
}
export function validateUploadDestination(value){
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!u.search||!(u.hostname==='storage.googleapis.com'||u.hostname.endsWith('.storage.googleapis.com')||u.hostname.endsWith('.mux.com')||u.hostname.endsWith('.amazonaws.com')))throw Error('INVALID_UPLOAD_DESTINATION');
 return u.href;
}
export function hostedCreatorRequest(operation,input={}){
 const json=(path,body,extra={})=>({path,method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json',...extra}});
 switch(operation){
 case 'draft':{
  const {courseId,title,description,previewText,rightsAttested,creationKey}=input;
  if(typeof creationKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(creationKey))throw Error('INVALID_DRAFT_KEY');
  if(typeof title!=='string'||title.trim().length<3||title.length>160||typeof description!=='string'||description.length>2500||typeof previewText!=='string'||previewText.length>800||rightsAttested!==true)throw Error('INVALID_DRAFT');
  return json('/api/lessons/drafts',{courseId:id(courseId),title:title.trim(),description:description.trim(),previewText:previewText.trim(),rightsAttested:true},{'idempotency-key':creationKey});
 }
 case 'identity':{const file=validateIdentityFile(input.file);return {path:'/api/identity/evidence/'+id(input.requestId),method:'POST',body:file,headers:{'content-type':file.type}};}
 case 'restrictions':return json('/api/social/creatorRestrictions',{});
 case 'setRestrictions':{
  if(['view','comment','message'].some(k=>typeof input[k]!=='boolean'))throw Error('INVALID_RESTRICTIONS');
  return json('/api/social/setCreatorRestrictions',{viewerId:id(input.viewerId),view:input.view,comment:input.comment,message:input.message});
 }
 case 'messagePreference':return json('/api/social/getMessagePreference',{});
 case 'setMessagePreference':{
  if(typeof input.allowMessages!=='boolean')throw Error('INVALID_PREFERENCE');
  return json('/api/social/messagePreference',{allowMessages:input.allowMessages});
 }
 case 'muxStatus':return {path:'/api/lessons/'+id(input.lessonId)+'/mux-upload',method:'GET',headers:{}};
 case 'muxReserve':return {path:'/api/lessons/'+id(input.lessonId)+'/mux-upload',method:'POST',headers:{}};
 default:throw Error('UNKNOWN_CREATOR_OPERATION');
 }
}
export async function putMuxVideo({url,file,fetcher=fetch,signal}){
 const destination=validateUploadDestination(url);validateVideoFile(file);
 const response=await fetcher(destination,{method:'PUT',body:file,headers:{'content-type':'video/mp4'},credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',signal});
 if(!response.ok)throw fail('VIDEO_TRANSFER_UNCONFIRMED',response.status);
 return true;
}
export function readMuxStatus(data){
 const row=data?.upload;
 if(!row||!UUID.test(row.id||'')||!['initializing','waiting','processing','ready','errored','cancelled','timed_out','deleted','unsafe'].includes(row.state))throw Error('INVALID_UPLOAD_RESPONSE');
 return {id:row.id,state:row.state,...(row.state==='waiting'&&row.uploadUrl?{uploadUrl:validateUploadDestination(row.uploadUrl)}:{})};
}
