import Link from 'next/link';
import {notFound} from 'next/navigation';
import {getPublicCourse} from '../../../lib/public-courses.mjs';
import {getLocalCourse,getLocalTopics,getLocalCourseLessons,isLocalMode} from '../../../lib/local-public.mjs';
import {discoveryConfig,getHostedDiscovery} from '../../../lib/hosted-discovery.mjs';
const boundedFetch=(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(5000)});
export const dynamic='force-dynamic';
export default async function CoursePage({params,searchParams}){
 const {courseId}=await params;const query=await searchParams;
 let course;let entries=[];let topics=[];let selectedTopic=null;let unavailable=false;
 try {
  if(isLocalMode()){course=getLocalCourse(courseId);if(course){topics=getLocalTopics(courseId);selectedTopic=topics.find(t=>t.id===query?.topic)?.id||null;entries=getLocalCourseLessons(courseId,selectedTopic);}}
  else{discoveryConfig(process.env);course=await getPublicCourse({id:courseId,fetcher:boundedFetch});if(course){const data=await getHostedDiscovery({filters:{courseId},fetcher:boundedFetch});entries=data.items.map(item=>({...item,status:'published'}));}}
 }catch{unavailable=true;}
 if(unavailable)return <main className="main" id="main"><p role="status">The course directory is temporarily unavailable. Please try again.</p></main>;
 if(!course)return notFound();
 return <main className="main" id="main"><Link href="/" className="back">← All courses</Link><section className="hero compact"><p className="eyebrow">{course.code}</p><h1>{course.title}</h1><p className="intro">Original peer-made explanations for this course.</p></section>
 {isLocalMode()&&<div className="button-row"><Link className="secondary-link" href={`/communities/${courseId}`}>Join the course discussion</Link><Link className="secondary-link" href={`/study/${courseId}`}>Study rounds</Link></div>}<section className="course-section" aria-labelledby="lessons-heading">{topics.length>0&&<nav className="topic-filters" aria-label="Filter lessons by topic"><Link className={!selectedTopic?'topic-chip selected':'topic-chip'} href={`/courses/${courseId}`}>All topics</Link>{topics.map(t=><Link key={t.id} className={selectedTopic===t.id?'topic-chip selected':'topic-chip'} href={`/courses/${courseId}?topic=${t.id}`}>{t.name}</Link>)}</nav>}<div className="heading-row"><h2 id="lessons-heading">Approved lessons</h2>{isLocalMode()?<Link href="/studio" className="secondary-link">Contribute a lesson</Link>:<Link href={'/search?courseId='+encodeURIComponent(courseId)} className="secondary-link">Search this course</Link>}</div>
 {entries.length===0?<p className="status">No lessons have been approved here yet. Be the first to teach a topic you know well.</p>:<ul className="lesson-list">{entries.filter(x=>x.status==='published').map(x=><li key={x.id} className="lesson"><p className="code">{topics.find(t=>t.id===x.topicId)?.name||'Original lesson'}</p><h3>{isLocalMode()?<Link href={`/lessons/${x.id}`}>{x.title}</Link>:x.title}</h3><p>{x.previewText||x.description||'A peer explanation'}</p>{!isLocalMode()&&<p className="hint">Public preview only. Full access is not available here.</p>}</li>)}</ul>}
 </section></main>;
}
