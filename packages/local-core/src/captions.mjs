/**
 * Restricted text-only WebVTT for the local alpha. Deliberately excludes
 * cue HTML, CSS, position settings and externally loaded resources.
 * Creator captions are not auto-generated or claimed to be accurate.
 */
export const MAX_CAPTION_BYTES=128*1024;
const invalid=()=>Object.assign(new Error('INVALID_CAPTIONS'),{code:'INVALID_CAPTIONS',status:422});
const CLOCK=/^(?:\d{2}:\d{2}:\d{2}|\d{2}:\d{2})\.\d{3}$/;
const TIMERANGE=/^((?:\d{2}:)?\d{2}:\d{2}\.\d{3}) --> ((?:\d{2}:)?\d{2}:\d{2}\.\d{3})$/;
const BAD_CONTROL=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;
const BAD_TEXT=/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;
function millis(s){
 if(!CLOCK.test(s))throw invalid();
 const groups=s.split(':'),last=groups.pop(),[second,ms]=last.split('.').map(Number);
 const hasHour=groups.length===2,minute=Number(groups.pop()??0),hour=Number(groups.pop()??0);
 if(second>59||(hasHour&&minute>59)||hour>48)throw invalid();
 return ((hour*60+minute)*60+second)*1000+ms;
}
export function validateWebVtt(input){
 if(typeof input!=='string'||Buffer.byteLength(input,'utf8')>MAX_CAPTION_BYTES)throw invalid();
 if(input.includes('\uFFFD'))throw invalid();
 const normalized=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trimEnd();
 if(!normalized.startsWith('WEBVTT\n\n')||BAD_CONTROL.test(normalized)||normalized.includes('\uFEFF'))throw invalid();
 const body=normalized.slice('WEBVTT\n\n'.length);
 if(!body||body.length>MAX_CAPTION_BYTES)throw invalid();
 const blocks=body.split(/\n{2,}/);
 if(blocks.length===0||blocks.length>1500)throw invalid();
 let lastEnd=0;
 for(const block of blocks){
  const lines=block.split('\n');
  if(lines.length<2||lines.length>8)throw invalid();
  // Optional simple numeric cue identifier, for common SRT→VTT exports.
  if(/^\d{1,7}$/.test(lines[0]))lines.shift();
  const match=TIMERANGE.exec(lines.shift()??'');
  if(!match||!lines.length)throw invalid();
  const start=millis(match[1]),end=millis(match[2]);
  if(start<lastEnd||start>=end||end>48*60*60*1000)throw invalid();
  lastEnd=end;
  if(lines.some(line=>!line.trim()||line.length>280||BAD_TEXT.test(line)||line.includes('-->')))throw invalid();
 }
 return normalized+'\n';
}
