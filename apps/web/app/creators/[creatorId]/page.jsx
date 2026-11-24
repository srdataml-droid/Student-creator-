import Link from 'next/link';
import {notFound} from 'next/navigation';
import FollowButton from './FollowButton.jsx';
import ReportUser from '../../ReportUser.jsx';
import {getLocalPublicCreator,getLocalPublicCourses,getLocalCourseLessons,isLocalMode,getLocalDiscoveryActor} from '../../../lib/local-public.mjs';
export const dynamic='force-dynamic';
export async function generateMetadata({params}){
 const {creatorId}=await params;
 return {title:`Student creator ${creatorId.slice(0,6)} | Student Creators`,description:'Original student work, posts and campus learning resources'};
}
export default async function CreatorProfile({params}){
 const {creatorId}=await params;
 if(!isLocalMode())return notFound();
 let creator,posts;
 try{
  creator=getLocalPublicCreator(creatorId);
  if(!creator)return notFound();
  const actor=await getLocalDiscoveryActor();
  posts=getLocalPublicCourses().flatMap(course=>getLocalCourseLessons(course.id,null,actor).filter(lesson=>lesson.creatorId===creatorId).map(lesson=>({...lesson,courseCode:course.code}))).sort((a,b)=>String(b.publishedAt||b.createdAt).localeCompare(String(a.publishedAt||a.createdAt))).slice(0,80);
 }catch{return <main id="main" className="main"><p role="status">This creator profile is unavailable right now.</p></main>}
 return <main id="main" className="main creator-profile-shell">
   <Link className="back" href="/">← Discover creators</Link>
   <section className="public-creator-header"><div className="public-creator-cover"/><div className="public-creator-details"><div className="public-creator-avatar" aria-hidden="true">✳</div><div><p className="eyebrow">VERIFIED STUDENT CREATOR</p><h1>{creator.displayName||<>Student creator <span>{creatorId.slice(0,6).toUpperCase()}</span></>}</h1>{creator.handle&&<p className="hint">@{creator.handle} · Self-chosen public alias</p>}<p>{creator.bio||'Original work and lessons shared with the student community.'}</p><p className="hint">Verified student status refers to membership approval, not an institutional endorsement of this public name.</p></div></div>
   <div className="creator-profile-actions"><span className="creator-profile-count">{posts.length} published {posts.length===1?'post':'posts'} · {creator.followerCount||0} followers</span><FollowButton creatorId={creatorId} initialFollowers={creator.followerCount||0}/>{creator.allowMessages&&<Link href={`/messages/${creatorId}`} className="creator-btn filled">Message creator ↗</Link>}<ReportUser userId={creatorId}/></div></section>
   <section className="creator-profile-posts"><p className="feed-kicker">THEIR WORK</p><h2>Published posts</h2>{posts.length?<div className="profile-post-grid">{posts.map(post=><Link className="profile-post" href={`/lessons/${post.id}`} key={post.id}><div className="profile-post-visual"><span aria-hidden="true">{post.hasVideo?'▶':'✎'}</span><small>{post.courseCode}</small><b className={post.priceKobo>=20000?"profile-post-price paid":"profile-post-price free"}>{post.priceKobo>=20000?'₦'+(post.priceKobo/100).toLocaleString('en-NG'):'FREE'}</b></div><div className="profile-post-copy"><span>{post.hasVideo?'VIDEO':'STUDY WORK'}</span><h3>{post.title}</h3><p>{post.previewText?.slice(0,125)||post.description}</p></div></Link>)}</div>:<p className="status">No published posts yet.</p>}</section>
 </main>;
}