'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api} from '../../lib/local-client.js';
export default function Inbox(){
 const [state,setState]=useState('loading'),[threads,setThreads]=useState([]);
 useEffect(()=>{api('messages/inbox').then(d=>{setThreads(d.inbox);setState('ready');}).catch(e=>setState(e.status===401?'signed-out':'unavailable'));},[]);
 return <main id="main" className="main"><section className="hero compact"><p className="eyebrow">Your conversations</p><h1>Peer questions, privately.</h1><p className="intro">Return to a lesson and message its creator after they opt in. Your inbox shows conversations you have already joined.</p></section>
 {state==='loading'?<p role="status">Loading your inbox…</p>:state==='signed-out'?<p role="status">Please <Link href="/sign-in">sign in</Link> to see your conversations.</p>:state==='unavailable'?<p role="alert">Inbox unavailable. A verified student account is required.</p>:threads.length===0?<p className="status">No conversations yet. Find an approved lesson and ask its creator a question.</p>:<ul className="lesson-list">{threads.map(t=><li key={t.peerId} className="lesson"><h2><Link href={`/messages/${t.peerId}`}>Conversation {t.peerId.slice(0,8)}…</Link></h2><p className="hint">Last message: {new Date(t.lastMessageAt).toLocaleString()}</p></li>)}</ul>}
 </main>;
}
