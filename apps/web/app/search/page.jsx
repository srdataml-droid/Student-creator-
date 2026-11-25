
import Link from 'next/link';
import {getHostedDiscovery} from '../../lib/hosted-discovery.mjs';
import {getPagedHostedDiscovery} from '../../lib/paged-hosted-discovery.mjs';
import {isLocalMode,getLocalPublicCourses,getLocalPublicInstitutions,getLocalTopics,searchLocalPublishedLessons} from '../../lib/local-public.mjs';
export const dynamic='force-dynamic';
export const metadata={title:'Search | Student Creators'};
export default async function SearchPage({searchParams}){
 const params=(await searchParams)||{};
 const q=typeof params.q==='string'?params.q.trim():'';
 const institutionId=typeof params.institutionId==='string'?params.institutionId:'';
 const courseId=typeof params.courseId==='string'?params.courseId:'';
 const topicId=typeof params.topicId==='string'?params.topicId:'';
 const local=isLocalMode();let enabled=true;
 let schools=[],courses=[],topics=[],results=[],error='',page=1,hasNext=false;
 if(local)try{
   schools=getLocalPublicInstitutions();
   courses=getLocalPublicCourses();
   if(courseId)topics=getLocalTopics(courseId);
   if(q)results=searchLocalPublishedLessons({q,institutionId:institutionId||null,courseId:courseId||null,topicId:topicId||null});
 }catch(e){error=['INVALID_SEARCH','INVALID_SEARCH_FILTER','INVALID_SEARCH_LIMIT'].includes(e?.code)?'Invalid search or mismatched filters. Enter 2–80 characters.':'Search is temporarily unavailable. Please try again.';}
 if(!local)try{const data=await getHostedDiscovery({directoryOnly:true});schools=data.schools;courses=data.courses;const found=await getPagedHostedDiscovery({filters:{q:params.q??'',institutionId:params.institutionId??'',courseId:params.courseId??'',page:params.page??'1'}});results=found.items;page=found.page;hasNext=found.hasNext;}catch(e){if(e.message==='INVALID_DISCOVERY_FILTER')error='Enter 2–80 letters or numbers and valid filters.';else enabled=false;}
 const pageHref=n=>'/search?'+new URLSearchParams({q,institutionId,courseId,page:String(n)}).toString();
 return <main id="main" className="main">
  <section className="hero compact"><p className="eyebrow">Learn through original explanations</p><h1>Search approved lessons.</h1><p className="intro">Find published student work across universities and courses.</p></section>
  {!enabled?<p className="status" role="status">Search is temporarily unavailable.</p>:<>
   <section className="panel search-panel"><h2>Find a lesson</h2><form className="form-stack" action="/search" method="GET">
    <label htmlFor="search-keywords">Keywords</label><input id="search-keywords" type="search" name="q" placeholder="Calculus, MTH 101, study skills" required={local} minLength={2} maxLength={80} defaultValue={q}/>
    <div className="search-filters"><div><label htmlFor="search-school">University</label><select id="search-school" name="institutionId" defaultValue={institutionId}><option value="">All universities</option>{schools.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
    <div><label htmlFor="search-course">Course</label><select id="search-course" name="courseId" defaultValue={courseId}><option value="">All courses</option>{courses.map(x=><option key={x.id} value={x.id}>{x.code} — {x.title}</option>)}</select></div>
    {local&&courseId&&<div><label htmlFor="search-topic">Topic</label><select id="search-topic" name="topicId" defaultValue={topicId}><option value="">All topics</option>{topics.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></div>}</div>
    <button className="primary-link" type="submit">Search lessons</button></form></section>
   {!local&&<p className="hint">Search published titles, descriptions and excerpts.</p>}{error?<p role="alert" className="status">{error}</p>:!q&&local?<p role="status" className="status">Enter a course or lesson keyword above.</p>:<section aria-labelledby="results-title" className="course-section"><h2 id="results-title">{results.length} approved result{results.length===1?'':'s'}{!local?' on this page':''}{q?' for “'+q+'”':''}</h2>
    {results.length===0?<p className="status">No approved lessons matched. Try fewer filters or another keyword.</p>:<ul className="lesson-list">{results.map(item=><li key={item.id} className="lesson"><p className="code">{item.institutionName} · {item.courseCode}{item.hasVideo?' · Video':''}</p><h3><Link href={'/lessons/'+item.id}>{item.title}</Link></h3><p>{item.previewText||item.description}</p><p className="hint">{item.courseTitle}{!local?' · Public preview':''}</p></li>)}</ul>}{!local&&<nav className="hosted-pagination" aria-label="Search pages">{page>1&&<Link href={pageHref(page-1)}>Previous</Link>}<span>Page {page}</span>{hasNext&&<Link href={pageHref(page+1)}>Next</Link>}</nav>}</section>}
  </>}
 </main>;
}
