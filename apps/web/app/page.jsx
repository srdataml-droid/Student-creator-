import Link from 'next/link';
import FeedExperience from './FeedExperience.jsx';
import HostedDiscovery from './HostedDiscovery.jsx';
import {getHostedDiscovery,filterHostedPreviews} from '../lib/hosted-discovery.mjs';
import {toFeedPreview} from '../lib/feed-preview.mjs';
import {getLocalPublicCourses,getLocalCourseLessons,getLocalPublicInstitutions,isLocalMode} from '../lib/local-public.mjs';
export const dynamic='force-dynamic';
export const metadata={title:'Home | Student Creators'};
export default async function Home({searchParams}){
 const local=isLocalMode();const params=await searchParams||{};const campus=typeof params.campus==='string'?params.campus.slice(0,80):'';const q=typeof params.q==='string'?params.q.slice(0,80):'';
 let courses=[],institutions=[],posts=[],ready=true;
 try{
  if(local){
   courses=getLocalPublicCourses().slice(0,80);
   institutions=getLocalPublicInstitutions();
   const bySchool=new Map(institutions.map(item=>[item.id,item.name]));
   posts=courses.flatMap(course=>getLocalCourseLessons(course.id).map(item=>toFeedPreview(item,course,bySchool.get(course.institutionId)||'Campus creator'))).sort((a,b)=>String(b.publishedAt||b.createdAt).localeCompare(String(a.publishedAt||a.createdAt))).slice(0,60);
  }else{const data=await getHostedDiscovery();courses=data.courses;institutions=data.schools;posts=filterHostedPreviews(data.posts,{q,institutionId:campus});}
 }catch{ready=false;}
 return <main id="main" className="creator-main modern-home">
  <div className="feed-column">
   <h1 className="visually-hidden">Discover student creators</h1>
   {local?<FeedExperience posts={posts} courses={courses} ready={ready}/>:<><form className="feed-toolbar form-stack" action="/" method="GET"><label htmlFor="hosted-feed-q">Search published previews</label><input id="hosted-feed-q" name="q" type="search" maxLength={80} defaultValue={q} placeholder="Search student work"/><label htmlFor="hosted-feed-campus">Campus</label><select id="hosted-feed-campus" name="campus" defaultValue={campus}><option value="">All campuses</option>{institutions.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select><button className="primary-link" type="submit">Apply filters</button></form><HostedDiscovery posts={posts} available={ready}/></>}
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
