/** Local-development MP4 format checks, size caps and byte ranges.
 * A well-formed box layout does NOT establish playable codecs, harmless content,
 * copyright ownership, or malware safety. Production still requires quarantine,
 * probing/transcoding, malware scanning, and human moderation before publication.
 */
export const MAX_VIDEO_BYTES=25*1024*1024;
const validBrands=new Set(['isom','iso2','iso4','iso5','iso6','avc1','mp41','mp42','M4V ','dash']);
const allowedTopLevelBoxes=new Set(['ftyp','moov','mdat','free','skip','wide','uuid','sidx','styp','moof','mfra','prft']);
const invalidVideo=()=>Object.assign(Error('INVALID_VIDEO'),{status:422});

/** Check full top-level ISO-BMFF box framing, not just the 12-byte ftyp marker. */
export function validateMp4(value){
  if(!Buffer.isBuffer(value)||value.length<32||value.length>MAX_VIDEO_BYTES)throw invalidVideo();
  let pos=0,boxCount=0,moovCount=0,mdatCount=0;
  while(pos<value.length){
    if(value.length-pos<8||++boxCount>2048)throw invalidVideo();
    let length=value.readUInt32BE(pos);
    const type=value.toString('ascii',pos+4,pos+8);
    let header=8;
    if(length===1){
      if(value.length-pos<16)throw invalidVideo();
      const large=value.readBigUInt64BE(pos+8);
      if(large>BigInt(Number.MAX_SAFE_INTEGER))throw invalidVideo();
      length=Number(large);header=16;
    }else if(length===0){
      // A zero-size box is only valid for final mdat reaching EOF.
      if(type!=='mdat')throw invalidVideo();
      length=value.length-pos;
    }
    if(length<header||length>value.length-pos||!allowedTopLevelBoxes.has(type))throw invalidVideo();
    if(boxCount===1){
      if(type!=='ftyp'||header!==8||length<16||(length-16)%4!==0)throw invalidVideo();
      const brand=value.toString('ascii',pos+8,pos+12);
      if(!validBrands.has(brand))throw invalidVideo();
    }else if(type==='ftyp')throw invalidVideo();
    if(type==='moov'){
      if(++moovCount>1||length<=header)throw invalidVideo();
    }
    if(type==='mdat'){
      if(length<=header)throw invalidVideo();
      mdatCount++;
    }
    pos+=length;
  }
  if(moovCount!==1||mdatCount===0||pos!==value.length)throw invalidVideo();
  return true;
}
export async function readMp4Body(request){
  if(!/^video\/mp4(?:\s*;\s*[^\r\n]*|\s*$)/i.test(request.headers.get('content-type')??''))throw Object.assign(Error('VIDEO_MP4_REQUIRED'),{status:415});
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>MAX_VIDEO_BYTES))throw Object.assign(Error('VIDEO_TOO_LARGE'),{status:413});
  const reader=request.body?.getReader();if(!reader)throw invalidVideo();
  const parts=[];let n=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;
      if(n>MAX_VIDEO_BYTES){await reader.cancel().catch(()=>{});throw Object.assign(Error('VIDEO_TOO_LARGE'),{status:413});}
      parts.push(Buffer.from(value));
    }
  }finally{reader.releaseLock();}
  const bytes=Buffer.concat(parts,n);validateMp4(bytes);return bytes;
}
export function parseVideoRange(raw,size){
  if(!Number.isSafeInteger(size)||size<=0)return null;
  if(!raw)return {start:0,end:size-1,status:200};
  const match=/^bytes=(\d*)-(\d*)$/.exec(raw);
  if(!match||(!match[1]&&!match[2]))return null;
  let start,end;
  if(match[1]){start=Number(match[1]);end=match[2]?Number(match[2]):size-1;}
  else{const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<1)return null;start=Math.max(0,size-suffix);end=size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||start>end)return null;
  return {start,end:Math.min(end,size-1),status:206};
}
