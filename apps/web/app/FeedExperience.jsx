'use client';
import Link from 'next/link';
import {useEffect,useMemo,useState} from 'react';
import {api,friendlyError} from '../lib/local-client.js';
const relative=(date)=>{if(!date)return 'Recently';const d=new Date(date);return Number.isNaN(d.valueOf())?'Recently':d.toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'});};
const alias=(id)=>'Student creator · '+String(id||'').slice(0,5).toUpperCase();
function Post({post,onSave,saved,pending}){
  const letter=String(post.title||'S')[0].toUpperCase();
  return <article className="creator-post" aria-label={post.title}>
    <div className="post-author"><div className="creator-avatar" aria-hidden="true">{letter}</div><div className="post-author-info"><Link href={`/creators/${post.creatorId}`} className="post-handle">{alias(post.creatorId)}</Link><span>{post.institutionName} <span aria-hidden="true">·</span> {relative(post.publishedAt)}</span></div><Link href={`/courses/${post.courseId}`} className="post-course">{post.courseCode||'Course'}</Link></div>
    <div className="post-content"><div className="post-kind">{post.hasVideo?'▶  VIDEO LESSON':'✎  STUDENT WORK'}</div><h3><Link href={`/lessons/${post.id}`}>{post.title}</Link></h3>{post.description&&<p>{post.description}</p>}</div>
    {post.hasVideo?<div className="post-media"><video controls playsInline preload="none" aria-label={`Student video: ${post.title}`}><source src={`/api/local/lessons/${post.id}/video`} type="video/mp4"/>Your browser cannot play this video.</video></div>:<Link className="text-preview" href={`/lessons/${post.id}`}><span className="preview-label">A preview of this creator's work</span><p>{post.previewText||'Open this work to see the full original explanation.'}</p><span className="preview-arrow">Read post ↗</span></Link>}
    <div className="post-actions"><Link href={`/lessons/${post.id}`}>↗ <span>View post</span></Link><Link href={`/messages/${post.creatorId}`}>◌ <span>Message creator</span></Link><button disabled={pending} onClick={()=>onSave(post.id)} type="button" aria-pressed={saved}>{pending?'Updating…':saved?'✓ Saved':'♧ Save'}</button></div>
  </article>;
}
export default function FeedExperience({posts=[],courses=[],ready=true}){
 const [tab,setTab]=useState('all'),[query,setQuery]=useState(''),[saved,setSaved]=useState([]),[pending,setPending]=useState(null),[error,setError]=useState(''),[following,setFollowing]=useState([]);
 useEffect(()=>{
   let active=true;
   api('my/bookmarks').then(({lessons})=>{
     if(active)setSaved(Array.isArray(lessons)?lessons.map(item=>item.id):[]);
   }).catch(()=>{/* Signed-out visitors can still browse public posts. */});
   return ()=>{active=false;};
 },[]);
 const shown=useMemo(()=>posts.filter(post=>{
   if(tab==='following'&&!following.includes(post.creatorId))return false;
   if(tab==='video'&&!post.hasVideo)return false;
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
     setSaved(list=>alreadySaved?list.filter(savedId=>savedId!==id):list.includes(id)?list:[...list,id]);
   }catch(e){setError(friendlyError(e));}
   finally{setPending(null);}
 }
 return <section aria-labelledby="feed-title" className="feed-area">
   <div className="feed-heading"><div><div className="feed-kicker">EXPLORE THE COMMUNITY</div><h2 id="feed-title">The student feed<span className="heading-spark">✳</span></h2></div><Link href="/studio" className="post-create">＋ Create post</Link></div>
   <div className="feed-toolbar"><div role="group" aria-label="Filter posts" className="feed-tabs">{[['all','For you'],['following','Following'],['video','Videos'],['text','Notes'],['assignment','Assignments']].map(([key,label])=><button type="button" key={key} onClick={()=>selectTab(key)} className={tab===key?'active':''} aria-pressed={tab===key}>{label}</button>)}</div><label className="feed-search"><span aria-hidden="true">⌕</span><span className="visually-hidden">Search posts</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find posts, courses..." maxLength={80}/></label></div>
   {error&&<p className="feed-notice" role="alert">{error} <Link href="/sign-in">Sign in</Link></p>}
   {!ready?<div className="feed-empty"><div className="empty-symbol">⚙</div><h3>Creator feed not connected</h3><p>This environment does not have its local content server. Configure local SQLite before publishing content.</p></div>:shown.length? <div className="post-stack">{shown.map(post=><Post post={post} key={post.id} onSave={save} pending={pending===post.id} saved={saved.includes(post.id)}/>)}</div>:<div className="feed-empty"><div className="empty-symbol">{posts.length?'⌕':'✦'}</div><h3>{posts.length?'No posts match yet':'This is where the first creators shine.'}</h3><p>{posts.length?'Try another filter or search.':'Your community starts with its first original post. Create work, submit it for review and it will appear in the feed.'}</p><div className="empty-buttons"><Link href="/studio" className="creator-btn filled">Share your work ↗</Link><Link href="/search" className="creator-btn outlined">Explore lessons</Link></div></div>}
   <div className="feed-bottom">A better campus starts with what we share. <span>✺</span></div>
 </section>;
}