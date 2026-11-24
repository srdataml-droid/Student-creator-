'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api} from '../../lib/local-client.js';
export default function Inbox(){
 const [state,setState]=useState('loading'),[threads,setThreads]=useState([]),[nextBefore,setNextBefore]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;api('messages/inbox').then(d=>{if(active){setThreads(d.inbox);setNextBefore(d.nextBefore);setState('ready');}}).catch(e=>{if(active)setState(e.status===401?'signed-out':'unavailable');});return()=>{active=false;};},[]);
 async function older(){
  if(!nextBefore||busy)return;
  setBusy(true);setError('');
  try{const d=await api('messages/inbox?before='+encodeURIComponent(nextBefore));setThreads(old=>[...new Map([...old,...d.inbox].map(t=>[t.peerId,t])).values()]);setNextBefore(d.nextBefore);}
  catch{setError('Unable to load more conversations. Refresh the inbox.');}finally{setBusy(false);}
 }
 return <main id="main" className="main"><section className="hero compact"><p className="eyebrow">Your conversations</p><h1>Peer questions, privately.</h1><p className="intro">Return to a lesson and message its creator after they opt in. Your inbox shows conversations you have already joined.</p></section>
 <p><Link href="/notifications">Notifications and preferences</Link></p>
 {state==='loading'?<p role="status">Loading your inbox…</p>:state==='signed-out'?<p role="status">Please <Link href="/sign-in">sign in</Link> to see your conversations.</p>:state==='unavailable'?<p role="alert">Inbox unavailable. A verified student account is required.</p>:threads.length===0?<p className="status">No conversations yet. Find an approved lesson and ask its creator a question.</p>:<ul className="lesson-list">{threads.map(t=><li key={t.peerId} className="lesson"><h2><Link href={`/messages/${t.peerId}`}>Conversation {t.peerId.slice(0,8)}…</Link></h2><p className="hint">Last message: {new Date(t.lastMessageAt).toLocaleString()}{t.unreadCount>0&&<> · <strong>{t.unreadCount} unread</strong></>}</p></li>)}</ul>}
 {nextBefore&&<button type="button" className="quiet-button" disabled={busy} onClick={older}>{busy?'Loading…':'More conversations'}</button>}
 {error&&<p role="alert">{error}</p>}
 </main>;
}
