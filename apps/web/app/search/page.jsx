
import Link from 'next/link';
import {getHostedDiscovery,filterHostedPreviews} from '../../lib/hosted-discovery.mjs';
import {isLocalMode,getLocalPublicCourses,getLocalPublicInstitutions,getLocalTopics,searchLocalPublishedLessons} from '../../lib/local-public.mjs';
export const dynamic='force-dynamic';
export const metadata={title:'Find lessons | Campus Learning'};
export default async function SearchPage({searchParams}){
 const params=(await searchParams)||{};
 const q=typeof params.q==='string'?params.q.trim():'';
 const institutionId=typeof params.institutionId==='string'?params.institutionId:'';
 const courseId=typeof params.courseId==='string'?params.courseId:'';
 const topicId=typeof params.topicId==='string'?params.topicId:'';
 const local=isLocalMode();let enabled=true;
 let schools=[],courses=[],topics=[],results=[],error='';
 if(local)try{
   schools=getLocalPublicInstitutions();
   courses=getLocalPublicCourses();
   if(courseId)topics=getLocalTopics(courseId);
   if(q)results=searchLocalPublishedLessons({q,institutionId:institutionId||null,courseId:courseId||null,topicId:topicId||null});
 }catch(e){error=['INVALID_SEARCH','INVALID_SEARCH_FILTER','INVALID_SEARCH_LIMIT'].includes(e?.code)?'Invalid search or mismatched filters. Enter 2–80 characters.':'Search is temporarily unavailable. Please try again.';}
 if(!local)try{const data=await getHostedDiscovery();schools=data.schools;courses=data.courses;if(q)results=filterHostedPreviews(data.posts,{q,institutionId,courseId});}catch{enabled=false;}
 return <main id="main" className="main">
  <section className="hero compact"><p className="eyebrow">Learn through original explanations</p><h1>Search approved lessons.</h1><p className="intro">Find published student work across universities and courses.</p></section>
  {!enabled?<p className="status" role="status">Search is temporarily unavailable.</p>:<>
   <section className="panel search-panel"><h2>Find a lesson</h2><form className="form-stack" action="/search" method="GET">
    <label htmlFor="search-keywords">Keywords</label><input id="search-keywords" type="search" name="q" placeholder="Calculus, MTH 101, study skills" required minLength={2} maxLength={80} defaultValue={q}/>
    <div className="search-filters"><div><label htmlFor="search-school">University</label><select id="search-school" name="institutionId" defaultValue={institutionId}><option value="">All universities</option>{schools.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
    <div><label htmlFor="search-course">Course</label><select id="search-course" name="courseId" defaultValue={courseId}><option value="">All courses</option>{courses.map(x=><option key={x.id} value={x.id}>{x.code} — {x.title}</option>)}</select></div>
    {local&&courseId&&<div><label htmlFor="search-topic">Topic</label><select id="search-topic" name="topicId" defaultValue={topicId}><option value="">All topics</option>{topics.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></div>}</div>
    <button className="primary-link" type="submit">Search lessons</button></form></section>
   {!local&&<p className="hint">Hosted search currently covers the latest 60 published previews.</p>}{error?<p role="alert" className="status">{error}</p>:!q?<p role="status" className="status">Enter a course or lesson keyword above.</p>:<section aria-labelledby="results-title" className="course-section"><h2 id="results-title">{results.length} approved result{results.length===1?'':'s'} for “{q}”</h2>
    {results.length===0?<p className="status">No approved lessons matched. Try fewer filters or another keyword.</p>:<ul className="lesson-list">{results.map(item=><li key={item.id} className="lesson"><p className="code">{item.institutionName} · {item.courseCode}{item.hasVideo?' · Video':''}</p><h3><Link href={'/lessons/'+item.id}>{item.title}</Link></h3><p>{item.previewText||item.description}</p><p className="hint">{item.courseTitle}{!local?' · Public preview':''}</p></li>)}</ul>}</section>}
  </>}
 </main>;
}
