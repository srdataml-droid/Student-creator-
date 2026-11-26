const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function contentShareUrl(origin,id){
 if(!UUID.test(id??''))throw Error('INVALID_CONTENT');
 const base=new URL(origin);
 if(!['https:','http:'].includes(base.protocol)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('INVALID_ORIGIN');
 return new URL('/lessons/'+id,base.origin).href;
}
export function visibleResumeItems(items,actor,read){
 if(!UUID.test(actor??'')||!Array.isArray(items))return [];
 return items.filter(p=>UUID.test(p?.id??'')&&typeof p.title==='string').flatMap(p=>{let seconds;try{seconds=Number(read('student-creators:resume:'+actor+':'+p.id));}catch{return [];}return Number.isFinite(seconds)&&seconds>=5&&seconds<86400?[{id:p.id,title:p.title,seconds:Math.floor(seconds)}]:[];}).slice(0,6);
}
export function elapsedLabel(seconds){return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');}
