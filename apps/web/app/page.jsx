import Link from 'next/link';
import FeedExperience from './FeedExperience.jsx';
import {toFeedPreview} from '../lib/feed-preview.mjs';
import {getLocalPublicCourses,getLocalCourseLessons,getLocalPublicInstitutions,isLocalMode} from '../lib/local-public.mjs';
export const dynamic='force-dynamic';
export const metadata={title:'Home | Student Creators'};
export default function Home(){
 let courses=[],institutions=[],posts=[],ready=true;
 try{
  if(isLocalMode()){
   courses=getLocalPublicCourses().slice(0,80);
   institutions=getLocalPublicInstitutions();
   const bySchool=new Map(institutions.map(item=>[item.id,item.name]));
   posts=courses.flatMap(course=>getLocalCourseLessons(course.id).map(item=>toFeedPreview(item,course,bySchool.get(course.institutionId)||'Campus creator'))).sort((a,b)=>String(b.publishedAt||b.createdAt).localeCompare(String(a.publishedAt||a.createdAt))).slice(0,60);
  }else{ready=false;}
 }catch{ready=false;}
 return <main id="main" className="creator-main modern-home">
  <div className="feed-column">
   <header className="home-heading"><div><p className="home-eyebrow">Your student community</p><h1>Discover</h1><p>Find original work and learn from fellow students.</p></div><Link href="/studio" className="creator-btn filled">+ Create</Link></header>
   <FeedExperience posts={posts} courses={courses} ready={ready}/>
  </div>
  <aside className="creator-aside" aria-label="Discover more">
   <section className="aside-panel"><h2>Get started</h2><p>Join your campus community to follow creators, save posts and share your own work.</p><div className="home-rail-actions"><Link href="/join" className="creator-btn filled">Create account</Link><Link href="/sign-in" className="creator-btn outlined">Log in</Link></div></section>
   <section className="aside-panel"><div className="aside-heading"><h2>Explore courses</h2><Link href="/search">See all</Link></div>
    {courses.length?<ul className="aside-course-list">{courses.slice(0,6).map(c=><li key={c.id}><Link href={'/courses/'+c.id}><span className="course-color">{c.code?.slice(0,2)||'SC'}</span><span><strong>{c.code}</strong><small>{c.title}</small></span><span aria-hidden="true" className="aside-chevron">›</span></Link></li>)}</ul>:<p className="aside-empty">{ready?'Courses appear here as campuses are added.':'Course discovery is temporarily unavailable.'}</p>}
   </section>
   <section className="aside-panel home-rail-note"><h2>Share what you know</h2><p>Publish your original explanations and projects. You retain copyright in your work.</p><Link href="/studio">Open creator studio →</Link></section>
  </aside>
 </main>;
}
