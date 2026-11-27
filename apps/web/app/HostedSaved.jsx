'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import HostedGate from './HostedGate.jsx';
import {useHostedAccount} from './HostedAccountProvider.jsx';
export function SavedControls({lessonId}){
 const account=useHostedAccount(),[saved,setSaved]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),lock=useRef(false);
 useEffect(()=>{let active=true;account.creatorRequest('isBookmarked',{contentId:lessonId}).then(rows=>{if(!Array.isArray(rows))throw Error();if(active)setSaved(rows.some(r=>r.content_id===lessonId));}).catch(()=>{if(active)setError('Saved status unavailable.');});return()=>{active=false;};},[lessonId,account.session.userId]);
 async function toggle(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const expected=!saved;const r=await account.creatorRequest(expected?'bookmark':'unbookmark',{contentId:lessonId});if(r.bookmarked!==expected)throw Error();setSaved(expected);}catch{setError('Unable to confirm saved status.');}finally{lock.current=false;setBusy(false);}}
 return <div><button type="button" className="secondary-link" disabled={saved===null||busy} aria-pressed={saved===true} onClick={toggle}>{saved?'Remove from saved':'Save post'}</button>{error&&<p role="alert">{error}</p>}</div>;
}
export function HostedSaved(){const a=useHostedAccount();return <HostedGate title="Saved posts"><SavedList key={a.session.userId||'guest'}/></HostedGate>;}
function SavedList(){
 const account=useHostedAccount(),[rows,setRows]=useState(null),[metadata,setMetadata]=useState({}),[error,setError]=useState(''),[busy,setBusy]=useState(false),lock=useRef(false),controller=useRef(null);
 async function load(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  const signal=(controller.current=new AbortController()).signal;
  try{
   const r=await account.creatorRequest('bookmarks',{});
   if(!Array.isArray(r))throw Error('INVALID_BOOKMARKS');
   const valid=r.filter(x=>typeof x?.content_id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x.content_id));
   if(signal.aborted)return;
   setRows(valid);setMetadata({});
   const ids=[...new Set(valid.map(x=>x.content_id))];
   const groups=Array.from({length:Math.ceil(ids.length/24)},(_,i)=>ids.slice(i*24,i*24+24));
   const results=await Promise.allSettled(groups.map(async group=>{
    const response=await fetch('/api/discovery?'+new URLSearchParams({ids:group.join(',')}),{cache:'no-store',credentials:'same-origin',signal});
    const data=await response.json();
    if(!response.ok||!Array.isArray(data.items))throw Error('INVALID_METADATA');
    return data.items.filter(x=>group.includes(x?.id)&&typeof x.title==='string');
   }));
   if(signal.aborted)return;
   setMetadata(Object.fromEntries(results.flatMap(x=>x.status==='fulfilled'?x.value:[]).map(x=>[x.id,x])));
   if(results.some(x=>x.status==='rejected'))setError('Some saved titles could not be loaded. Your bookmarks are unchanged.');
  }catch{if(!signal.aborted)setError('Could not retrieve saved posts.');}
  finally{lock.current=false;if(!signal.aborted)setBusy(false);}
 }
 useEffect(()=>{void load();return()=>controller.current?.abort();},[]);
 async function remove(id){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const r=await account.creatorRequest('unbookmark',{contentId:id});if(r.bookmarked!==false)throw Error();setRows(old=>old.filter(p=>p.content_id!==id));}catch{setError('Removal could not be confirmed.');}finally{lock.current=false;setBusy(false);}}
 return <section className="viewer-saved-list" aria-label="Saved content"><div className="viewer-library-heading"><p className="hint">{rows?rows.length+' saved posts':'Your saved student content'}</p><button className="quiet-button" type="button" onClick={load} disabled={busy}>Refresh</button></div>{rows===null&&!error&&<p role="status">Loading saved posts…</p>}{rows?.length===0&&<div className="watch-access-note"><h2>No saved posts yet</h2><p className="hint">Save a video to find it here later.</p><Link className="primary-link" href="/">Discover student work</Link></div>}{rows&&<ul className="viewer-library-rows">{rows.map(r=>{const item=metadata[r.content_id];return <li key={r.content_id}><Link href={'/lessons/'+r.content_id} className="viewer-library-link"><span className="viewer-related-media" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/></svg></span><span className="viewer-related-copy"><strong>{item?.title||'Open saved post'}</strong>{item&&<small>{[item.displayName,item.courseCode].filter(Boolean).join(' · ')}</small>}<small>Saved {new Date(r.created_at).toLocaleDateString('en-NG')}</small></span></Link><button className="quiet-button viewer-remove-saved" type="button" aria-label={'Remove saved post'+(item?': '+item.title:'')} disabled={busy} onClick={()=>remove(r.content_id)}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M6 3h12v18l-6-4-6 4z"/></svg></button></li>;})}</ul>}{rows?.length===100&&<p className="hint">Showing latest 100 saved posts.</p>}{error&&<p role="alert">{error}</p>}</section>;
}
