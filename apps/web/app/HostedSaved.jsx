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
 const account=useHostedAccount(),[rows,setRows]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),lock=useRef(false);
 async function load(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const r=await account.creatorRequest('bookmarks',{});if(!Array.isArray(r))throw Error();setRows(r);}catch{setError('Could not retrieve saved posts.');}finally{lock.current=false;setBusy(false);}}
 useEffect(()=>{void load();},[]);
 async function remove(id){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const r=await account.creatorRequest('unbookmark',{contentId:id});if(r.bookmarked!==false)throw Error();setRows(old=>old.filter(p=>p.content_id!==id));}catch{setError('Removal could not be confirmed.');}finally{lock.current=false;setBusy(false);}}
 return <section className="panel"><button className="quiet-button" type="button" onClick={load} disabled={busy}>Refresh</button>{rows===null&&!error&&<p role="status">Loading saved posts…</p>}{rows?.length===0&&<p>No saved posts. <Link href="/">Discover student work</Link>.</p>}{rows&&<ul className="lesson-list">{rows.map(r=><li key={r.content_id}><Link href={'/lessons/'+r.content_id}>Open saved post</Link><p className="hint">Saved {new Date(r.created_at).toLocaleDateString()}</p><button type="button" disabled={busy} onClick={()=>remove(r.content_id)}>Remove saved post</button></li>)}</ul>}{rows?.length===100&&<p>Showing latest 100 saved posts.</p>}{error&&<p role="alert">{error}</p>}</section>;
}
