import Link from 'next/link';
import FeedExperience from './FeedExperience.jsx';
import {getLocalPublicCourses,getLocalFeed,getLocalDiscoveryActor,getLocalCreatorDiscovery,isLocalMode} from '../lib/local-public.mjs';
export const dynamic='force-dynamic';
export const metadata={title:'Student Creators | The campus creator community'};
export default async function Home(){
  let courses=[],posts=[],creators=[],ready=true;
  try{
    if(isLocalMode()){
      courses=getLocalPublicCourses().slice(0,80);
      const actor=await getLocalDiscoveryActor();
      posts=getLocalFeed(actor);
      creators=getLocalCreatorDiscovery(actor,{limit:6});
    }else{ready=false;}
  }catch{ready=false;}
  return <main id="main" className="creator-main">
    <div className="feed-column">
      <section className="creator-hero">
        <div className="hero-wordmark"><span className="live-dot"/> Made for students. Powered by students.</div>
        <h1>Your campus has <em>creators.</em><br/>Find your people.</h1>
        <p>Share videos, your own assignment examples, projects and notes. Find creators who get your courses, join communities, and learn together.</p>
        <div className="creator-hero-actions"><Link className="creator-btn filled" href="/join">Join the community <span aria-hidden="true">↗</span></Link><Link className="creator-btn light" href="/studio">Start creating <span aria-hidden="true">✦</span></Link></div>
        <div className="hero-art" aria-hidden="true"><span className="orb orb-one"/><span className="orb orb-two"/><span className="art-card art-back">STUDY<br/>YOUR<br/>WAY.</span><span className="art-card art-front">CREATE<br/><strong>CONNECT.</strong><br/>EARN.</span></div>
      </section>
      <FeedExperience posts={posts} courses={courses} ready={ready}/>
    </div>
    <aside className="creator-aside" aria-label="Discover more">
      <div className="aside-panel intro-panel"><div className="aside-kicker">THE STUDENT CREATOR SPACE</div><h2>Good work deserves to be seen.</h2><p>Learn with real people from your school. Build a creator profile and share what you know.</p><Link href="/studio" className="aside-action">Open creator studio <span>↗</span></Link></div>
      {creators.length>0&&<div className="aside-panel"><div className="aside-heading"><h2>Discover creators</h2></div><ul className="aside-course-list">{creators.map(c=><li key={c.id}><Link href={'/creators/'+c.id}><span className="course-color">✳</span><span><strong>{c.displayName||'Student creator'}</strong><small>{c.institutionName}</small></span></Link></li>)}</ul></div>}
      <div className="aside-panel"><div className="aside-heading"><h2>Explore courses</h2><Link href="/search">See all</Link></div>
        {courses.length?<ul className="aside-course-list">{courses.slice(0,6).map((c,i)=><li key={c.id}><Link href={`/courses/${c.id}`}><span className={`course-color course-color-${i%4}`}>{c.code?.slice(0,2)||'SC'}</span><span><strong>{c.code}</strong><small>{c.title}</small></span><span aria-hidden="true" className="aside-chevron">↗</span></Link></li>)}</ul>:<p className="aside-empty">The first courses appear here when an administrator sets up your campus.</p>}
      </div>
      <div className="aside-panel safety-panel"><span className="safety-emoji" aria-hidden="true">✺</span><div><h2>Original work matters.</h2><p>Share work you created and have permission to publish. Use examples to learn—not submit someone else's work.</p></div></div>
      
    </aside>
  </main>;
}