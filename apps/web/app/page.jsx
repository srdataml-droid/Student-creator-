import Link from 'next/link';
import {getPublicCourses} from '../lib/public-courses.mjs';
import {getLocalPublicCourses,isLocalMode} from '../lib/local-public.mjs';
export const dynamic='force-dynamic';
export default async function Home(){
 let data;
 try{data=isLocalMode()?{state:'ready',courses:getLocalPublicCourses()}:await getPublicCourses();}
 catch{data={state:'unavailable',courses:[]};}
 return <main id="main" className="main">
 <section className="hero">
  <p className="eyebrow">Knowledge belongs in your campus community</p>
  <h1>Good explanations. From students who have been there.</h1>
  <p className="intro">Explore your courses, share original lessons, and learn with people in your academic community. Every lesson is reviewed before it becomes publicly available.</p>
  <div className="hero-actions"><Link href="/join" className="primary-link">Join as a student</Link><Link className="secondary-link" href="/search">Search lessons</Link><Link className="secondary-link" href="/studio">Create a lesson</Link></div>
  {isLocalMode()&&<p className="mode-tag" role="note">Local workspace · SQLite · No online services or payment credentials needed</p>}
 </section>
 <section aria-labelledby="courses-heading" className="course-section">
 <div className="heading-row"><div><p className="eyebrow">Your course library</p><h2 id="courses-heading">Browse by course</h2></div><p>Clear explanations that stay attached to the course they teach.</p></div>
 {data.state==='not_configured'?<p role="status" className="status">Course discovery is not connected to a school database yet.</p>:data.state==='unavailable'?<p role="status" className="status">Course discovery is temporarily unavailable.</p>:data.courses.length===0?<p role="status" className="status">No courses yet. A local administrator can create a campus and its first courses from the Manage area.</p>:<ul className="course-grid">{data.courses.map(course=><li key={course.id}><Link className="course-card" href={`/courses/${course.id}`}><span className="code">{course.code}</span><strong>{course.title}</strong><span className="more">Explore explanations →</span></Link></li>)}</ul>}
 </section>
 <section className="steps-section" aria-labelledby="steps-title"><p className="eyebrow">How it works</p><h2 id="steps-title">Built around quality, not shortcuts</h2><div className="step-grid"><article><span className="step-number">01</span><h3>Find your course</h3><p>Explore relevant learning material, organised around real campus courses.</p></article><article><span className="step-number">02</span><h3>Teach in your own words</h3><p>Verified students publish their original explanations and examples.</p></article><article><span className="step-number">03</span><h3>Learn with confidence</h3><p>A separate reviewer checks content before publication. No completed assignments for submission.</p></article></div></section>
 </main>;
}
