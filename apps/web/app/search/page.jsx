
import Link from 'next/link';
import HostedDiscovery from '../HostedDiscovery.jsx';
import {searchCategory,searchPublicDirectory} from '../../lib/public-directory-search.mjs';
import {isLocalMode,getLocalPublicCourses,getLocalPublicInstitutions,getLocalTopics,searchLocalPublishedLessons} from '../../lib/local-public.mjs';
export const dynamic='force-dynamic';
export const metadata={title:'Search | Student Creators'};
export default async function SearchPage({searchParams}){
 const params=(await searchParams)||{};
 if(!isLocalMode()){
  const category=searchCategory(params.category),q=typeof params.q==='string'?params.q.slice(0,80):'',courseId=typeof params.courseId==='string'?params.courseId:'';
  const contentSearch=['all','video','short'].includes(category);
  let directory=[],error='';
  if(!contentSearch)try{directory=await searchPublicDirectory({category,q});}catch(e){error=e.message==='INVALID_DISCOVERY_FILTER'?'Enter a valid search.':'Search is temporarily unavailable.';}
  function categoryHref(key){const query=new URLSearchParams();if(q)query.set('q',q);if(['all','video','short'].includes(key)&&courseId)query.set('courseId',courseId);if(key!=='all')query.set('category',key);return '/search?'+query;}
  return <main id="main" className="creator-main modern-home hosted-home viewer-search-page"><div className="feed-column"><Link className="viewer-back watch-back" href="/"><span aria-hidden="true">←</span> Search results</Link><h1 className="visually-hidden">Search Student Creators</h1><form className="viewer-search-form" action="/search" method="GET"><label className="visually-hidden" htmlFor="viewer-search-query">Search published content</label><svg aria-hidden="true" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input key={q} id="viewer-search-query" type="search" name="q" defaultValue={q} placeholder="Search Student Creators" maxLength={80}/>{category!=='all'&&<input type="hidden" name="category" value={category}/>} {contentSearch&&courseId&&<input type="hidden" name="courseId" value={courseId}/>}<button type="submit">Search</button></form>
  <nav className="feed-tabs public-feed-tabs viewer-search-categories" aria-label="Search categories">{[['all','All'],['video','Videos'],['short','Shorts'],['creators','Creators'],['communities','Communities']].map(([key,label])=><Link href={categoryHref(key)} key={key} aria-current={category===key?'page':undefined}>{label}</Link>)}</nav>
  {contentSearch?<HostedDiscovery params={params} format={category==='all'?'':category} search/>:<section className="viewer-directory-results" aria-label={category==='creators'?'Creator results':'Community results'}>{error?<p role="alert">{error}</p>:!q?<p className="hint">Search by {category==='creators'?'creator name or handle':'course name or code'}.</p>:directory.length===0?<p className="hint" role="status">No matching {category} found.</p>:<><ul className="community-preview-list">{directory.map(item=><li key={item.id}><Link className="community-preview-item" href={(category==='creators'?'/creators/':'/communities/')+item.id}><span className="community-preview-symbol" aria-hidden="true">{category==='creators'?item.title.charAt(0).toUpperCase():'#'}</span><span className="community-preview-copy"><strong>{item.title}</strong><small>{item.subtitle}</small></span><span aria-hidden="true">›</span></Link></li>)}</ul>{directory.length===50&&<p className="hint">Showing up to 50 results. Refine your search to find more.</p>}</>}</section>}
  </div></main>;
 }
 const q=typeof params.q==='string'?params.q.trim():'';
 const institutionId=typeof params.institutionId==='string'?params.institutionId:'';
 const courseId=typeof params.courseId==='string'?params.courseId:'';
 const topicId=typeof params.topicId==='string'?params.topicId:'';
 const enabled=isLocalMode();
 let schools=[],courses=[],topics=[],results=[],error='';
 if(enabled)try{
   schools=getLocalPublicInstitutions();
   courses=getLocalPublicCourses();
   if(courseId)topics=getLocalTopics(courseId);
   if(q)results=searchLocalPublishedLessons({q,institutionId:institutionId||null,courseId:courseId||null,topicId:topicId||null});
 }catch(e){error=['INVALID_SEARCH','INVALID_SEARCH_FILTER','INVALID_SEARCH_LIMIT'].includes(e?.code)?'Invalid search or mismatched filters. Enter 2–80 characters.':'Search is temporarily unavailable. Please try again.';}
 return <main id="main" className="main">
  <section className="hero compact"><p className="eyebrow">Learn through original explanations</p><h1>Search approved lessons.</h1><p className="intro">Find student-created learning resources across universities, courses and topics. Drafts and rejected materials never appear here.</p></section>
  {!enabled?<p className="status" role="status">Search is temporarily unavailable.</p>:<>
   <section className="panel search-panel"><h2>Find a lesson</h2><form className="form-stack" action="/search" method="GET">
    <label htmlFor="search-keywords">Keywords</label><input id="search-keywords" type="search" name="q" placeholder="Calculus, MTH 101, study skills" required minLength={2} maxLength={80} defaultValue={q}/>
    <div className="search-filters"><div><label htmlFor="search-school">University</label><select id="search-school" name="institutionId" defaultValue={institutionId}><option value="">All universities</option>{schools.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
    <div><label htmlFor="search-course">Course</label><select id="search-course" name="courseId" defaultValue={courseId}><option value="">All courses</option>{courses.map(x=><option key={x.id} value={x.id}>{x.code} — {x.title}</option>)}</select></div>
    {courseId&&<div><label htmlFor="search-topic">Topic</label><select id="search-topic" name="topicId" defaultValue={topicId}><option value="">All topics</option>{topics.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></div>}</div>
    <button className="primary-link" type="submit">Search lessons</button></form></section>
   {error?<p role="alert" className="status">{error}</p>:!q?<p role="status" className="status">Enter a course or lesson keyword above.</p>:<section aria-labelledby="results-title" className="course-section"><h2 id="results-title">{results.length} approved result{results.length===1?'':'s'} for “{q}”</h2>
    {results.length===0?<p className="status">No approved lessons matched. Try fewer filters or another keyword.</p>:<ul className="lesson-list">{results.map(item=><li key={item.id} className="lesson"><p className="code">{item.institutionName} · {item.courseCode}{item.hasVideo?' · Video':''}</p><h3><Link href={'/lessons/'+item.id}>{item.title}</Link></h3><p>{item.previewText||item.description}</p><p className="hint">{item.courseTitle}</p></li>)}</ul>}</section>}
  </>}
 </main>;
}
