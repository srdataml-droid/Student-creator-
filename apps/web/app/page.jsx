import Link from 'next/link';
import FeedExperience from './FeedExperience.jsx';
import {toFeedPreview} from '../lib/feed-preview.mjs';
import {getLocalPublicCourses,getLocalCourseLessons,getLocalPublicInstitutions,isLocalMode} from '../lib/local-public.mjs';
import {getPublicCourses} from '../lib/public-courses.mjs';
import {loadHostedFeed} from '../lib/hosted-feed.mjs';
import {buildCatalogRoute} from '../../../packages/content-core/src/route-factory.mjs';
const boundedFetch=(url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(5000)});
export const dynamic='force-dynamic';
export const metadata={title:'Home | Student Creators'};
export default async function Home(){
 let courses=[],institutions=[],posts=[],ready=true,partial=false;
 const local=isLocalMode();
 try{
  if(local){
   courses=getLocalPublicCourses().slice(0,80);
   institutions=getLocalPublicInstitutions();
   const bySchool=new Map(institutions.map(item=>[item.id,item.name]));
   posts=courses.flatMap(course=>getLocalCourseLessons(course.id).map(item=>toFeedPreview(item,course,bySchool.get(course.institutionId)||'Campus creator'))).sort((a,b)=>String(b.publishedAt||b.createdAt).localeCompare(String(a.publishedAt||a.createdAt))).slice(0,60);
  }else{({courses,posts,partial}=await loadHostedFeed({getCourses:()=>getPublicCourses({fetcher:boundedFetch}),getCatalog:buildCatalogRoute({fetcher:boundedFetch})}));}
 }catch{ready=false;}
 return <main id="main" className="creator-main modern-home">
  <div className="feed-column">
   <h1 className="visually-hidden">Discover student creators</h1>
   {local?<FeedExperience posts={posts} courses={courses} ready={ready}/>:<section className="feed-area" aria-labelledby="hosted-discovery-title">
    <div className="reference-feed-heading"><h2 id="hosted-discovery-title">Discover student work</h2></div>
    {!ready?<div className="feed-empty" role="status"><h3>Discovery temporarily unavailable</h3><p>The course catalog could not be loaded. Please refresh to retry.</p></div>:<>
     {partial&&<p className="hint" role="status">Some courses could not be loaded. Showing available previews.</p>}
     {posts.length>0?<ul className="lesson-list">{posts.map(post=><li className="lesson" key={post.id}><p className="hint">{post.courseCode} · {post.courseTitle}</p><h3>{post.title}</h3>{post.previewText&&<p>{post.previewText}</p>}<Link className="secondary-link" href={'/courses/'+post.courseId}>Explore course</Link></li>)}</ul>:<div className="feed-empty"><h3>{courses.length?'No previews in the featured courses yet':'No courses published yet'}</h3><p>{courses.length?'Explore the course directory for more student work.':'Courses appear here when the directory is published.'}</p></div>}
     {courses.length>0&&<section aria-labelledby="hosted-courses-title" className="course-section"><h2 id="hosted-courses-title">Explore courses</h2><ul className="lesson-list">{courses.map(course=><li className="lesson" key={course.id}><Link href={'/courses/'+course.id}>{course.code} · {course.title}</Link></li>)}</ul></section>}
    </>}
   </section>}
  </div>
  {local&&<aside className="creator-aside" aria-label="Discover more">
   <section className="aside-panel"><h2>Get started</h2><p>Join your campus community to follow creators, save posts and share your own work.</p><div className="home-rail-actions"><Link href="/join" className="creator-btn filled">Create account</Link><Link href="/sign-in" className="creator-btn outlined">Log in</Link></div></section>
   <section className="aside-panel"><div className="aside-heading"><h2>Explore courses</h2><Link href="/search">See all</Link></div>
    {courses.length?<ul className="aside-course-list">{courses.slice(0,6).map(c=><li key={c.id}><Link href={'/courses/'+c.id}><span className="course-color">{c.code?.slice(0,2)||'SC'}</span><span><strong>{c.code}</strong><small>{c.title}</small></span><span aria-hidden="true" className="aside-chevron">›</span></Link></li>)}</ul>:<p className="aside-empty">{ready?'Courses appear here as campuses are added.':'Course discovery is temporarily unavailable.'}</p>}
   </section>
   <section className="aside-panel home-rail-note"><h2>Share what you know</h2><p>Publish your original explanations and projects. You retain copyright in your work.</p><Link href="/studio">Open creator studio →</Link></section>
  </aside>}
 </main>;
}
