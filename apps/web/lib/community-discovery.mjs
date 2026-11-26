const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function communityTab(value){return ['discover','mine','night','public'].includes(value)?value:'discover';}
export function availableNightClasses(rows,now=Date.now()){
 if(!Array.isArray(rows))throw Error('INVALID_CLASSES');
 return rows.filter(x=>x&&UUID.test(x.id??'')&&typeof x.title==='string'&&x.title.trim()&&['scheduled','room_open'].includes(x.status)&&Number.isFinite(Date.parse(x.starts_at))&&Date.parse(x.ends_at)>now&&Date.parse(x.ends_at)>Date.parse(x.starts_at)&&Number.isSafeInteger(x.price_kobo)&&x.price_kobo>=0&&x.currency==='NGN')
 .sort((a,b)=>(Number(b.status==='room_open')-Number(a.status==='room_open'))||Date.parse(a.starts_at)-Date.parse(b.starts_at)||a.id.localeCompare(b.id));
}
export function sessionHref(id){if(!UUID.test(id??''))throw Error('INVALID_CLASS');return '/communities?tab=night&session='+id;}
export function publicCommunityPreview(courses,limit=3){if(!Array.isArray(courses))throw Error('INVALID_COMMUNITIES');return courses.slice(0,limit);}
export function isSessionId(value){return typeof value==='string'&&UUID.test(value);}
