import Link from 'next/link';
import {HostedLesson} from '../../HostedSocialWorkspace.jsx';
import {notFound,redirect} from 'next/navigation';
import {getLocalViewablePublishedLesson,getLocalPublicCreator,getLocalCourseLessons,isLocalMode} from '../../../lib/local-public.mjs';
import ProtectedVideo from '../../ProtectedVideo.jsx';
import BookmarkButton from '../../lessons/[lessonId]/BookmarkButton.jsx';
import LikeButton from '../../lessons/[lessonId]/LikeButton.jsx';
import LessonComments from '../../lessons/[lessonId]/LessonComments.jsx';

export const dynamic='force-dynamic';
export default async function WatchLesson({params}){
 const {lessonId}=await params;
 if(!isLocalMode())return <HostedLesson lessonId={lessonId}/>;
 let lesson;
 try{lesson=await getLocalViewablePublishedLesson(lessonId);}
 catch(error){
  if(error?.status===404)return notFound();
  if(error?.status===402)redirect('/lessons/'+lessonId);
  if(error?.status===401||error?.status===403)
   return <main className="main" id="main"><div className="panel"><h1>Private creator viewing</h1><p>You need a verified account and permission from this creator to watch.</p><Link href="/sign-in" className="primary-link">Sign in</Link> <Link href="/" className="secondary-link">Back to feed</Link></div></main>;
  return <main className="main" id="main"><p role="status" className="status">The video viewer is temporarily unavailable.</p></main>;
 }
 if(!lesson||!lesson.hasVideo)return notFound();
 const creator=getLocalPublicCreator(lesson.creatorId);
 const handle=creator?.displayName||'Verified student creator';
 let related=[],relatedAvailable=true;
 try{related=getLocalCourseLessons(lesson.courseId).filter(item=>item.id!==lesson.id&&item.status==='published'&&item.hasVideo).slice(0,5).map(item=>({id:item.id,title:item.title,priceKobo:item.priceKobo??0}));}
 catch{relatedAvailable=false;}
 return <main id="main" className="watch-page">
   <div className="watch-header"><Link className="watch-back" href="/">← Discover</Link><Link className="watch-explore" href={'/courses/'+lesson.courseId}>Course</Link></div>
   <div className="watch-layout" aria-label="Protected video and creator information">
    <div className="watch-primary">
     <div className="watch-stage">
      <div className="watch-video-frame">
       <ProtectedVideo lessonId={lesson.id} label={'Original video lesson: '+lesson.title} hasCaptions={lesson.hasCaptions}/>
      </div>
     </div>
     <section className="watch-details" aria-labelledby="watch-title">
      <div className="watch-detail-meta"><span>Original student video</span><span className={lesson.priceKobo>0?'watch-paid-chip':'watch-free-chip'}>{lesson.priceKobo>0?'Purchased access':'Free access'}</span></div>
      <h1 id="watch-title">{lesson.title}</h1>
      <div className="watch-profile-row">
       <Link className="watch-creator-link" href={'/creators/'+lesson.creatorId} prefetch={false}><span className="watch-creator-avatar" aria-hidden="true">{handle.slice(0,1).toUpperCase()}</span><span><strong>{handle}</strong><small>Verified student creator</small></span></Link>
       {creator?.allowMessages&&<Link className="secondary-link" href={'/messages/'+lesson.creatorId} prefetch={false}>Message</Link>}
      </div>
      <div className="watch-utility"><LikeButton lessonId={lesson.id} initialCount={lesson.likeCount}/><BookmarkButton lessonId={lesson.id}/></div>
      {(lesson.description||lesson.previewText)&&<p className="watch-summary">{lesson.description||lesson.previewText}</p>}
      <Link className="primary-link" href={'/lessons/'+lesson.id} prefetch={false}>Read lesson &amp; notes</Link>
      <p className="watch-rights">Viewing access is personal. Copyright remains with the creator. This player cannot prevent authorized screen recordings or downloads.</p>
     </section>
     <LessonComments lessonId={lesson.id}/>
    </div>
    <aside className="watch-info" aria-label="More from this course">
     <h2>More from this course</h2>
     {!relatedAvailable?<p role="status" className="hint">Related videos are temporarily unavailable.</p>:related.length===0?<p className="hint">No other published videos for this course yet.</p>:<ul className="related-video-list">{related.map(item=><li key={item.id}><Link href={'/lessons/'+item.id} prefetch={false}><span className="related-video-tile" aria-hidden="true">▶</span><span><strong>{item.title}</strong><small>{item.priceKobo>0?'₦'+(item.priceKobo/100).toLocaleString('en-NG'):'Free'}</small></span></Link></li>)}</ul>}
     <Link href={'/courses/'+lesson.courseId} className="secondary-link" prefetch={false}>Explore course</Link>
    </aside>
   </div>
 </main>;
}
