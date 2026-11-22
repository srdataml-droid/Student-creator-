'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../../lib/local-client.js';
import {isLessonSaved} from '../../../lib/bookmark-state.mjs';

export default function BookmarkButton({lessonId}){
 const [state,setState]=useState('loading'),[notice,setNotice]=useState('');
 useEffect(()=>{
   let active=true;
   setState('loading');
   api('my/bookmarks').then(({lessons})=>{
     if(active)setState(isLessonSaved(lessons,lessonId)?'saved':'idle');
   }).catch(()=>{if(active)setState('idle');});
   return ()=>{active=false;};
 },[lessonId]);
 async function toggle(){
   const wasSaved=state==='saved';
   setState('busy');setNotice('');
   try{
     await api('lessons/'+lessonId+'/'+(wasSaved?'unbookmark':'bookmark'),{method:'POST',body:{}});
     setState(wasSaved?'idle':'saved');
     setNotice(wasSaved?'Removed from your learning list.':'Saved to your learning list.');
   }catch(e){setState(wasSaved?'saved':'idle');setNotice(friendlyError(e));}
 }
 return <div className="bookmark-action"><button type="button" className="secondary-link" disabled={state==='loading'||state==='busy'} aria-pressed={state==='saved'} onClick={toggle}>{state==='saved'?'Saved ✓ · Remove':state==='loading'?'Checking saved lessons…':state==='busy'?'Updating…':'Save lesson'}</button> <Link href="/saved">Your saved lessons</Link>{notice&&<p role="status" className="hint">{notice}</p>}</div>;
}
