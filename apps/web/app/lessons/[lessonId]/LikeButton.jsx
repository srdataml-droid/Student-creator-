'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../../lib/local-client.js';

export default function LikeButton({lessonId,initialCount=0}){
 const [state,setState]=useState('loading');
 const [count,setCount]=useState(Math.max(0,Number(initialCount)||0));
 const [notice,setNotice]=useState('');
 useEffect(()=>{
   let active=true;
   setState('loading');
   setCount(Math.max(0,Number(initialCount)||0));
   api('my/likes').then(({likes})=>{
     if(active)setState(Array.isArray(likes)&&likes.includes(lessonId)?'liked':'idle');
   }).catch(()=>{if(active)setState('idle');});
   return ()=>{active=false;};
 },[lessonId,initialCount]);
 async function toggle(){
   if(state==='loading'||state==='busy')return;
   const previouslyLiked=state==='liked';
   setState('busy');setNotice('');
   try{
     const {like}=await api('lessons/'+lessonId+'/'+(previouslyLiked?'unlike':'like'),{method:'POST',body:{}});
     setState(like.liked?'liked':'idle');
     if(!like.replayed)setCount(n=>Math.max(0,n+(previouslyLiked?-1:1)));
     setNotice(like.liked?'Added to liked posts.':'Like removed.');
   }catch(error){
     setState(previouslyLiked?'liked':'idle');
     setNotice(friendlyError(error));
   }
 }
 return <div className="bookmark-action">
   <button type="button" className="secondary-link" onClick={toggle}
     aria-pressed={state==='liked'} disabled={state==='loading'||state==='busy'}>
     {state==='liked'?'♥ Liked':state==='loading'?'Checking likes…':state==='busy'?'Updating…':'♡ Like post'} · {count} {count===1?'like':'likes'}
   </button>
   {notice&&<p role="status" className="hint">{notice} {notice==='Please sign in to continue.'&&<Link href="/sign-in">Sign in</Link>}</p>}
 </div>;
}
