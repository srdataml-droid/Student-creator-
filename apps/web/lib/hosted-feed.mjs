/** Public-only discovery; never infer price, video availability or private access. */
export async function loadHostedFeed({getCourses,getCatalog}={}) {
  const directory=await getCourses();
  if(directory?.state!=='ready'||!Array.isArray(directory.courses))throw Error('CATALOG_UNAVAILABLE');
  const courses=directory.courses.slice(0,50);
  const sampled=courses.slice(0,12);
  const posts=[];
  let failed=0;
  for(let i=0;i<sampled.length;i+=4){
    const batch=await Promise.allSettled(sampled.slice(i,i+4).map(async course=>{
      const url=new URL('https://catalog.invalid/api/lessons');
      url.searchParams.set('courseId',course.id);url.searchParams.set('limit','12');
      const response=await getCatalog(new Request(url));
      if(!response.ok)throw Error('CATALOG_UNAVAILABLE');
      const {items}=await response.json();
      if(!Array.isArray(items))throw Error('CATALOG_UNAVAILABLE');
      return items.filter(p=>p.courseId===course.id&&typeof p.id==='string'&&typeof p.title==='string').map(p=>({id:p.id,courseId:course.id,courseCode:course.code,courseTitle:course.title,title:p.title,previewText:typeof p.previewText==='string'?p.previewText:'',publishedAt:typeof p.publishedAt==='string'?p.publishedAt:''}));
    }));
    for(const entry of batch){if(entry.status==='fulfilled')posts.push(...entry.value);else failed++;}
  }
  if(sampled.length&&failed===sampled.length)throw Error('CATALOG_UNAVAILABLE');
  return {courses,posts:posts.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,60),partial:failed>0};
}
