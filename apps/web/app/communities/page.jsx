import Link from 'next/link';
import {getLocalPublicCourses,getLocalPublicInstitutions,isLocalMode} from '../../lib/local-public.mjs';
import {getPublicCourses} from '../../lib/public-courses.mjs';

export const dynamic='force-dynamic';
export const metadata={title:'Communities | Student Creators'};
export default async function Communities({searchParams}){
 const params=(await searchParams)||{};
 const q=typeof params.q==='string'?params.q.trim().slice(0,80):'';
 const campus=typeof params.campus==='string'?params.campus.slice(0,128):'';
 const local=isLocalMode();
 let courses=[],schools=[],state='ready';
 try{
  if(local){courses=getLocalPublicCourses();schools=getLocalPublicInstitutions();}
  else{const catalog=await getPublicCourses();courses=catalog.courses;state=catalog.state==='ready'?'ready':'unavailable';}
 }catch{state='unavailable';}
 const names=new Map(schools.map(s=>[s.id,s.name]));
 const filtered=courses.filter(c=>(!campus||c.institutionId===campus)&&[c.code,c.title,names.get(c.institutionId)||''].join(' ').toLowerCase().includes(q.toLowerCase()));
 return <main id="main" className="main community-directory">
  <section className="hero compact"><h1>Communities</h1><p className="intro">Find a course discussion and study with your classmates.</p></section>
  <form className="directory-filters form-stack" action="/communities" method="GET">
   <div><label htmlFor="community-query">Find a course</label><input id="community-query" name="q" type="search" placeholder="Course name or code" maxLength={80} defaultValue={q}/></div>
   {schools.length>0&&<div><label htmlFor="community-campus">Institution</label><select id="community-campus" name="campus" defaultValue={campus}><option value="">All institutions</option>{schools.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></div>}
   <button className="primary-link" type="submit">Find communities</button>
  </form>
  {state==='unavailable'?<section className="panel" role="status"><h2>Directory unavailable</h2><p className="hint">The course directory could not be loaded.</p><Link className="secondary-link" href="/communities" prefetch={false}>Try again</Link></section>:<>
   
   <div className="directory-heading"><h2>Course communities</h2><p className="hint">{filtered.length} course{filtered.length===1?'':'s'}</p></div>
   {filtered.length===0?<section className="panel"><h3>{q||campus?'No matching courses':'No courses available yet'}</h3><p className="hint">{q||campus?'Try a different search or institution.':'Courses appear when the campus catalog is configured.'}</p>{(q||campus)&&<Link className="secondary-link" href="/communities">Clear filters</Link>}</section>:<ul className="directory-list">{filtered.map(c=><li key={c.id}><div><span className="directory-code">{c.code}</span><h3>{c.title}</h3>{names.has(c.institutionId)&&<p className="hint">{names.get(c.institutionId)}</p>}</div><div className="directory-actions">{local?<><Link className="primary-link" href={'/communities/'+c.id} prefetch={false}>Discussion</Link><Link className="secondary-link" href={'/study/'+c.id} prefetch={false}>Study rounds</Link></>:<><Link className="primary-link" href={'/communities/'+c.id} prefetch={false}>Discussion</Link><Link className="secondary-link" href={'/courses/'+c.id} prefetch={false}>View course</Link></>}</div></li>)}</ul>}
  </>}
 </main>;
}
