'use client';
import Link from 'next/link';
import {useEffect,useMemo,useState} from 'react';
import {api,friendlyError} from '../lib/local-client.js';
import {savedIdsFromLessons,afterBookmarkRequest} from '../lib/bookmark-state.mjs';
const relative=(date)=>{if(!date)return 'Recently';const d=new Date(date);return Number.isNaN(d.valueOf())?'Recently':d.toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'});};
const alias=(id)=>'Student creator · '+String(id||'').slice(0,5).toUpperCase();
function Post({post,onSave,saved,pending,canPlay}){
 const paid=(post.priceKobo??0)>=20000;
 const priceText=paid?'₦'+(post.priceKobo/100).toLocaleString('en-NG'):'Free';
 const detail='/lessons/'+post.id;
 const destination=paid||!post.hasVideo?detail:canPlay?'/watch/'+post.id:'/sign-in';
 return <article className="creator-post discovery-card" aria-label={post.title}>
   <Link className={'discovery-media '+(post.hasVideo?'video-preview':'note-preview')} href={destination} aria-label={(post.hasVideo?(paid?'View paid access: ':canPlay?'Watch video: ':'Sign in to watch: '):'Read post: ')+post.title}>
     <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{post.hasVideo?<path d="m9 5 11 7-11 7z" fill="currentColor"/>:<><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>}</svg>
     <span className="discovery-media-type">{post.hasVideo?'Video':'Student work'}</span>
     <span className={'discovery-price '+(paid?'is-paid':'')}>{priceText}</span>
   </Link>
   <div className="post-content discovery-copy">
     <h3><Link href={detail}>{post.title}</Link></h3>
     <div className="discovery-byline"><Link href={'/creators/'+post.creatorId} className="post-handle">{alias(post.creatorId)}</Link><span>{post.institutionName} · {relative(post.publishedAt)}</span></div>
     <Link href={'/courses/'+post.courseId} className="post-course">{post.courseCode||'Course'}</Link>
     {!post.hasVideo&&post.previewText&&<p className="discovery-excerpt">{post.previewText}</p>}
   </div>
   <div className="post-actions"><Link href={detail}>View post</Link>{post.hasVideo&&<Link href={'/watch/'+post.id}>Watch</Link>}<Link href={'/messages/'+post.creatorId}>Message creator</Link><button disabled={pending} onClick={()=>onSave(post.id)} type="button" aria-pressed={saved}>{pending?'Updating…':saved?'Saved':'Save'}</button></div>
 </article>;
}
export default function FeedExperience({posts=[],courses=[],ready=true}){
 const [tab,setTab]=useState('all'),[query,setQuery]=useState(''),[saved,setSaved]=useState([]),[pending,setPending]=useState(null),[error,setError]=useState(''),[following,setFollowing]=useState([]),[canPlay,setCanPlay]=useState(false);
 useEffect(()=>{
   let active=true;
   api('my/bookmarks').then(({lessons})=>{
     if(active)setSaved(savedIdsFromLessons(lessons));
   }).catch(()=>{/* Signed-out visitors can still browse public posts. */});
   api('me').then(({user})=>{if(active)setCanPlay(Boolean(user?.role==='student'&&user?.verifiedAt&&!user?.suspended));}).catch(()=>{});
   return ()=>{active=false;};
 },[]);
 const shown=useMemo(()=>posts.filter(post=>{
   if(tab==='following'&&!following.includes(post.creatorId))return false;
   if(tab==='video'&&!post.hasVideo)return false;
   if(tab==='free'&&(post.priceKobo??0)>0)return false;
   if(tab==='text'&&post.hasVideo)return false;
   if(tab==='assignment'&&!/assignment|project|exercise|practical|lab/i.test([post.title,post.description,post.previewText].join(' ')))return false;
   return [post.title,post.description,post.courseCode,post.courseTitle,post.previewText,post.institutionName].join(' ').toLowerCase().includes(query.trim().toLowerCase());
 }),[tab,query,posts,following]);
 async function selectTab(key){
   setTab(key);setError('');
   if(key==='following'){
     try{const response=await api('following');setFollowing(response.creators||[]);}
     catch(err){setFollowing([]);setError(friendlyError(err));}
   }
 }
 async function save(id){
   const alreadySaved=saved.includes(id);
   setError('');setPending(id);
   try{
     await api(`lessons/${id}/${alreadySaved?'unbookmark':'bookmark'}`,{method:'POST',body:{}});
     setSaved(list=>afterBookmarkRequest(list,id,alreadySaved));
   }catch(e){setError(friendlyError(e));}
   finally{setPending(null);}
 }
 return <section aria-labelledby="feed-title" className="feed-area">
   <div className="feed-heading"><div><div className="feed-kicker">EXPLORE THE COMMUNITY</div><h2 id="feed-title">The student feed<span className="heading-spark">✳</span></h2></div><Link href="/studio" className="post-create">＋ Create post</Link></div>
   <div className="feed-toolbar"><div role="group" aria-label="Filter posts" className="feed-tabs">{[['all','For you'],['following','Following'],['video','Videos'],['free','Free'],['text','Notes'],['assignment','Assignments']].map(([key,label])=><button type="button" key={key} onClick={()=>selectTab(key)} className={tab===key?'active':''} aria-pressed={tab===key}>{label}</button>)}</div><label className="feed-search"><span aria-hidden="true">⌕</span><span className="visually-hidden">Search posts</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find posts, courses..." maxLength={80}/></label></div>
   {error&&<p className="feed-notice" role="alert">{error} <Link href="/sign-in">Sign in</Link></p>}
   {!ready?<div className="feed-empty"><div className="empty-symbol">⚙</div><h3>Feed temporarily unavailable</h3><p>Please try again later.</p></div>:shown.length? <div className="post-stack">{shown.map(post=><Post post={post} key={post.id} onSave={save} pending={pending===post.id} saved={saved.includes(post.id)} canPlay={canPlay}/>)}</div>:<div className="feed-empty"><div className="empty-symbol">{posts.length?'⌕':'✦'}</div><h3>{posts.length?'No posts match yet':'This is where the first creators shine.'}</h3><p>{posts.length?'Try another filter or search.':'Your community starts with its first original post. Create work, submit it for review and it will appear in the feed.'}</p><div className="empty-buttons"><Link href="/studio" className="creator-btn filled">Share your work ↗</Link><Link href="/search" className="creator-btn outlined">Explore lessons</Link></div></div>}
   <div className="feed-bottom">A better campus starts with what we share. <span>✺</span></div>
 </section>;
}