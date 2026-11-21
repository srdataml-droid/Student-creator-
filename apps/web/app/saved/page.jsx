
'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../lib/local-client.js';
export default function SavedPage(){
 const [items,setItems]=useState([]),[state,setState]=useState('loading'),[error,setError]=useState(''),[busy,setBusy]=useState(null);
 useEffect(()=>{api('my/bookmarks').then(d=>{setItems(d.lessons);setState('ready');}).catch(e=>{setState(e.status===401?'signed-out':'unavailable');setError(friendlyError(e));});},[]);
 async function remove(id){setBusy(id);setError('');try{await api('lessons/'+id+'/unbookmark',{method:'POST',body:{}});setItems(old=>old.filter(item=>item.id!==id));}catch(e){setError(friendlyError(e));}finally{setBusy(null);}}
 return <main id="main" className="main"><section className="hero compact"><p className="eyebrow">Your personal study shelf</p><h1>Saved lessons</h1><p className="intro">Return to original explanations you want to study again. Saved lists are private to your verified account.</p></section>
 {state==='loading'?<p role="status">Loading your saved lessons…</p>:state==='signed-out'?<p role="status">Please <Link href="/sign-in">sign in</Link> to view saved lessons.</p>:state==='unavailable'?<p role="alert">{error}</p>:<><p className="hint">{items.length} saved lesson{items.length===1?'':'s'}</p>{error&&<p role="alert">{error}</p>}{!items.length?<p className="status">Nothing saved yet. <Link href="/search">Find a lesson</Link> and save it.</p>:<ul className="lesson-list">{items.map(item=><li className="lesson" key={item.id}><p className="code">{item.institutionName} · {item.courseCode}{item.hasVideo?' · Video':''}</p><h2><Link href={'/lessons/'+item.id}>{item.title}</Link></h2><p>{item.previewText}</p><button className="quiet-text" type="button" disabled={busy===item.id} onClick={()=>remove(item.id)}>{busy===item.id?'Removing…':'Remove saved lesson'}</button></li>)}</ul>}</>}
 </main>;
}
