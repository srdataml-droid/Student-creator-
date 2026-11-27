'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {CreatorActions,OfficialActions} from './MediaActions.jsx';
import {Player} from './HostedSocialWorkspace.jsx';
import {useHostedAccount} from './HostedAccountProvider.jsx';
export default function ShortsFeed({initial=[],hasNext=false,catalogAvailable,checkoutMode,terms}){
 const account=useHostedAccount(),signed=account?.session.state==='signed-in',actor=account?.session.userId||'guest';
 const [items,setItems]=useState(initial),[index,setIndex]=useState(0),[page,setPage]=useState(1),[more,setMore]=useState(hasNext),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),touch=useRef(null),abort=useRef(null),post=items[index];
 useEffect(()=>()=>abort.current?.abort(),[]);
 async function next(){if(index+1<items.length){setIndex(i=>i+1);return;}if(!more||lock.current)return;lock.current=true;setBusy(true);setError('');const controller=new AbortController();abort.current=controller;try{const r=await fetch('/api/discovery?format=short&page='+(page+1),{cache:'no-store',signal:controller.signal});const d=await r.json();if(!r.ok||!Array.isArray(d.items)||d.page!==page+1||typeof d.hasNext!=='boolean'||d.items.some(x=>x.contentFormat!=='short'))throw Error('INVALID_SHORTS');const nextItems=d.items.filter(x=>!items.some(p=>p.id===x.id));setItems(old=>[...old,...nextItems]);setPage(d.page);setMore(d.hasNext);if(nextItems.length)setIndex(i=>i+1);}catch(e){if(e.name!=='AbortError')setError('More shorts could not be loaded.');}finally{lock.current=false;setBusy(false);}}
 function previous(){setIndex(i=>Math.max(0,i-1));}
 function onTouchStart(e){touch.current=e.touches[0]?.clientY??null;}
 function onTouchEnd(e){const y=touch.current;touch.current=null;if(y===null)return;const delta=y-(e.changedTouches[0]?.clientY??y);if(delta>70)void next();else if(delta< -70)previous();}
 return <main id="main" className="main shorts-page immersive-shorts"><h1 className="visually-hidden">Shorts</h1><div className="shorts-shell">
 <section className="shorts-stage" aria-label="Short video" onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='ArrowDown'){e.preventDefault();void next();}if(e.key==='ArrowUp'){e.preventDefault();previous();}}} tabIndex={0}>
 <div className="shorts-portrait" key={post?.id||'official'} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
 {post?signed?<Player key={actor+':'+post.id} lessonId={post.id}/>:<div className="shorts-locked"><span className="shorts-category">{post.courseCode||'Student Creators'}</span><h2>{post.title}</h2><Link className="primary-link" href="/sign-in">Sign in to watch</Link></div>:<video controls muted loop playsInline preload="metadata" poster="/platform-intro.svg" aria-label="Silent Worthkind introduction"><source src="/api/platform-intro?format=webm" type="video/webm"/><source src="/api/platform-intro" type="video/mp4"/></video>}
 <div className="shorts-caption"><strong>{post?.displayName||post?.institutionName||'Worthkind'}</strong><p>{post?.title||'Welcome to Student Creators'}</p>{!post&&<small>Official introduction · Free</small>}</div></div>
 {post?<CreatorActions post={post} vertical checkoutMode={checkoutMode} terms={terms}/>:<OfficialActions vertical/>}
 </section>
 {items.length>0?<div className="shorts-navigation" aria-label="Short video navigation"><button type="button" className="quiet-button" onClick={previous} disabled={index===0||busy}>Previous</button><span>{index+1} / {items.length}{more?'+':''}</span><button type="button" className="quiet-button" onClick={next} disabled={busy||(!more&&index+1>=items.length)}>{busy?'Loading…':'Next short'}</button></div>:<p className="hint shorts-catalog-note">{catalogAvailable?'No student Shorts published yet.':'Shorts catalog is temporarily unavailable.'}</p>}
 {error&&<p role="alert">{error}</p>}</div></main>;
}
