import Link from 'next/link';
import {notFound,redirect} from 'next/navigation';
import {getLocalViewablePublishedLesson,getLocalPublicCreator,isLocalMode} from '../../../lib/local-public.mjs';
import ProtectedVideo from '../../ProtectedVideo.jsx';
import BookmarkButton from '../../lessons/[lessonId]/BookmarkButton.jsx';
import LikeButton from '../../lessons/[lessonId]/LikeButton.jsx';

export const dynamic='force-dynamic';
export default async function WatchLesson({params}){
 const {lessonId}=await params;
 if(!isLocalMode())return notFound();
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
 return <main id="main" className="watch-page">
   <div className="watch-header">
    <Link className="watch-back" href={'/lessons/'+lesson.id}>← Lesson details</Link>
    <span className="watch-label">STUDENT CREATORS · ORIGINAL VIDEO</span>
    <Link className="watch-explore" href="/">Explore more</Link>
   </div>
   <section className="watch-layout" aria-label="Protected video and creator information">
    <div className="watch-stage">
     <div className="watch-stage-top"><span>ORIGINAL STUDENT VIDEO</span>{lesson.priceKobo>0?<span className="watch-paid-chip">PURCHASED ACCESS</span>:<span className="watch-free-chip">FREE ACCESS</span>}</div>
     <div className="watch-video-frame">
      <ProtectedVideo lessonId={lesson.id} label={'Original video lesson: '+lesson.title}/>
     </div>
     <div className="watch-stage-caption">
      <p className="watch-stage-creator">{handle}</p>
      <h1>{lesson.title}</h1>
      <p>{lesson.previewText||lesson.description||'An original student-created explanation.'}</p>
     </div>
    </div>
    <aside className="watch-info" aria-label="Creator and lesson actions">
     <p className="watch-eyebrow">LEARN FROM YOUR PEERS</p>
     <h2>{lesson.title}</h2>
     <p className="watch-summary">{lesson.description||'A peer-created learning resource.'}</p>
     <Link className="watch-creator-link" href={'/creators/'+lesson.creatorId}>
      <span className="watch-creator-avatar" aria-hidden="true">✳</span>
      <span><strong>{handle}</strong><small>Verified student creator · open profile</small></span>
     </Link>
     <div className="watch-utility"><LikeButton lessonId={lesson.id} initialCount={lesson.likeCount}/><BookmarkButton lessonId={lesson.id}/></div>
     <div className="watch-nav-actions">
      <Link className="primary-link" href={'/lessons/'+lesson.id}>Read lesson & notes</Link>
      {creator?.allowMessages&&<Link className="secondary-link" href={'/messages/'+lesson.creatorId}>Message creator</Link>}
     </div>
     <p className="watch-rights">Viewing access is personal. Copyright remains with the creator. This player cannot prevent authorized screen recordings or downloads.</p>
    </aside>
   </section>
 </main>;
}
