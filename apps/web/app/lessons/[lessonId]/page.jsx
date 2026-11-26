import Link from 'next/link';
import {getHostedDiscovery} from '../../../lib/hosted-discovery.mjs';
import {HostedLesson} from '../../HostedSocialWorkspace.jsx';
import {checkoutSettings} from '../../../lib/checkout-ui-settings.mjs';
import {notFound} from 'next/navigation';
import {getLocalViewablePublishedLesson,getLocalPublicCreator,getLocalPublishedPricePreview,isLocalMode} from '../../../lib/local-public.mjs';
import BookmarkButton from './BookmarkButton.jsx';
import LikeButton from './LikeButton.jsx';
import LessonComments from './LessonComments.jsx';
import ProtectedVideo from '../../ProtectedVideo.jsx';
import PurchasePanel from './PurchasePanel.jsx';
export const dynamic='force-dynamic';
export default async function LessonPage({params}){
 const {lessonId}=await params;
 if(!isLocalMode()){const checkout=checkoutSettings();let preview=null;try{preview=(await getHostedDiscovery({contentId:lessonId})).items[0]??null;}catch{}return <HostedLesson lessonId={lessonId} preview={preview} checkoutMode={checkout.mode} terms={checkout.terms}/>;}
 let lesson;try{lesson=await getLocalViewablePublishedLesson(lessonId);}catch(error){
   if(error?.status===404)return notFound();
   if(error?.status===402){
     const preview=getLocalPublishedPricePreview(lessonId);
     if(!preview||preview.priceKobo<20000)return notFound();
     return <main id="main" className="main"><Link className="back" href="/">← Back to creators</Link><h1>{preview.title}</h1><PurchasePanel lessonId={preview.id} priceKobo={preview.priceKobo}/></main>;
   }
   if(error?.status===401||error?.status===403)return <main id="main" className="main"><p role="alert">Full posts require verified student membership and permission from the creator. <Link href="/sign-in">Sign in</Link> to request access.</p></main>;
   return <main id="main" className="main"><p role="status">This lesson is currently unavailable.</p></main>;
 }
 if(!lesson)return notFound();
 const creator=getLocalPublicCreator(lesson.creatorId);
 return <main id="main" className="main"><Link className="back" href={`/courses/${lesson.courseId}`}>← Back to course</Link><article className="lesson-article"><p className="eyebrow">Approved original lesson · {lesson.priceKobo?'Purchased viewing access':'Free to read'}</p><h1>{lesson.title}</h1><p className="intro">{lesson.description}</p>{lesson.hasVideo&&<figure className="lesson-video-preview"><ProtectedVideo lessonId={lesson.id} label={`Original video lesson: ${lesson.title}`} hasCaptions={lesson.hasCaptions}/><figcaption className="hint">Original video approved for publication.</figcaption></figure>}
 <BookmarkButton lessonId={lesson.id}/><LikeButton lessonId={lesson.id} initialCount={lesson.likeCount}/><p><a className="secondary-link" href={`/api/local/lessons/${lesson.id}/notes`} download>Download study notes (.txt)</a></p><div className="lesson-reading">{lesson.lessonText}</div>{creator?.allowMessages&&<p><Link className="secondary-link" href={`/messages/${creator.id}`}>Ask this creator a question</Link></p>}<LessonComments lessonId={lesson.id}/><p className="hint">{lesson.priceKobo>0?'Your purchase provides limited access; the creator keeps copyright. ':''}This lesson is a learning resource, not an assessment to submit as your own.</p></article></main>;
}
