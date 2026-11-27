'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {contentShareUrl,visibleResumeItems,elapsedLabel} from '../lib/watch-experience.mjs';
export function ShareContent({contentId,title='Student Creators content'}){
 const [url,setUrl]=useState(''),[notice,setNotice]=useState('');
 async function share(){
  setNotice('');let link;
  try{link=contentShareUrl(window.location.origin,contentId);}catch{setNotice('This content link is unavailable.');return;}
  if(typeof navigator.share==='function'){try{await navigator.share({title,url:link});return;}catch(e){if(e.name==='AbortError')return;}}
  setUrl(link);
  try{await navigator.clipboard.writeText(link);setNotice('Content page link copied.');}catch{setNotice('Copy the content page link below.');}
 }
 return <div className="content-share"><button type="button" className="watch-action" onClick={share}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8 12 20 5M8 12l12 7"/><circle cx="5" cy="12" r="3"/><circle cx="20" cy="4" r="3"/><circle cx="20" cy="20" r="3"/></svg>Share</button>{notice&&<p role="status">{notice}</p>}{url&&<input aria-label="Content page link" readOnly value={url} onFocus={e=>e.currentTarget.select()}/>}</div>;
}
export function ContinueWatching({items,actor}){
 const [rows,setRows]=useState([]);
 useEffect(()=>{setRows(visibleResumeItems(items,actor,k=>localStorage.getItem(k)));},[items,actor]);
 if(!rows.length)return null;
 return <section className="watch-resume" aria-label="Continue watching"><h2>Continue watching</h2><ul>{rows.map(p=><li key={p.id}><Link href={'/lessons/'+p.id}><span className="watch-resume-icon" aria-hidden="true">▶</span><span><strong>{p.title}</strong><small>Resume at {elapsedLabel(p.seconds)}</small></span><span aria-hidden="true">›</span></Link></li>)}</ul></section>;
}
