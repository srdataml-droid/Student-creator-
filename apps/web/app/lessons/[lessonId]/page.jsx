import Link from 'next/link';
import {notFound} from 'next/navigation';
import {getLocalPublishedLesson,getLocalPublicCreator,isLocalMode} from '../../../lib/local-public.mjs';
import BookmarkButton from './BookmarkButton.jsx';
import LikeButton from './LikeButton.jsx';
import LessonComments from './LessonComments.jsx';
export const dynamic='force-dynamic';
export default async function LessonPage({params}){
 const {lessonId}=await params;
 if(!isLocalMode())return notFound();
 let lesson;try{lesson=getLocalPublishedLesson(lessonId);}catch{return <main id="main" className="main"><p role="status">The local lesson directory is currently unavailable.</p></main>}
 if(!lesson)return notFound();
 const creator=getLocalPublicCreator(lesson.creatorId);
 return <main id="main" className="main"><Link className="back" href={`/courses/${lesson.courseId}`}>← Back to course</Link><article className="lesson-article"><p className="eyebrow">Approved original lesson · Free to read</p><h1>{lesson.title}</h1><p className="intro">{lesson.description}</p>{lesson.hasVideo&&<figure className="lesson-video-preview"><video controls playsInline preload="none" aria-label={`Original video lesson: ${lesson.title}`}><source src={`/api/local/lessons/${lesson.id}/video`} type="video/mp4"/>This browser cannot play the attached MP4 lesson.</video><figcaption className="hint">A free, moderator-approved video hosted by the local development server. You need a connection to this server to play it.</figcaption></figure>}
 <BookmarkButton lessonId={lesson.id}/><LikeButton lessonId={lesson.id} initialCount={lesson.likeCount}/><p><a className="secondary-link" href={`/api/local/lessons/${lesson.id}/notes`} download>Download free study notes (.txt)</a></p><div className="lesson-reading">{lesson.lessonText}</div>{creator?.allowMessages&&<p><Link className="secondary-link" href={`/messages/${creator.id}`}>Ask this creator a question</Link></p>}<LessonComments lessonId={lesson.id}/><p className="hint">This lesson is a learning resource, not an assessment to submit as your own.</p></article></main>;
}
