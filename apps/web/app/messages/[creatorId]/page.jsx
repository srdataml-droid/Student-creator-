'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../../lib/local-client.js';
async function acknowledgeReceived(peer,messages,userId){
 if(document.visibilityState!=='visible')return;
 const messageIds=messages.filter(m=>m.recipientId===userId).map(m=>m.id);
 if(messageIds.length)await api(`messages/${peer}/read`,{method:'POST',body:{messageIds}});
}
function mergeMessages(old,incoming){
 const unique=new Map(old.map(m=>[m.id,m]));
 for(const m of incoming)unique.set(m.id,m);
 return [...unique.values()].sort((a,b)=>a.createdAt<b.createdAt?-1:a.createdAt>b.createdAt?1:a.id<b.id?-1:a.id>b.id?1:0);
}
export default function Conversation({params}){
 const [peer,setPeer]=useState(''),[user,setUser]=useState(null),[messages,setMessages]=useState([]),[blocked,setBlocked]=useState(false),[text,setText]=useState(''),[state,setState]=useState('loading'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[nextBefore,setNextBefore]=useState(null),[loadingOlder,setLoadingOlder]=useState(false);
 useEffect(()=>{let active=true;async function load(){const {creatorId}=await params;if(!active)return;setPeer(creatorId);setMessages([]);setNextBefore(null);setState('loading');try{const m=await api('me');if(!active)return;setUser(m.user);const c=await api(`messages/${creatorId}`);if(active){setMessages(c.messages);setNextBefore(c.nextBefore);setBlocked(c.blocked);setState('ready');acknowledgeReceived(creatorId,c.messages,m.user.id).catch(()=>{});}}catch(e){if(active)setState(e.status===401?'signed-out':'unavailable');}}load();return()=>{active=false;};},[params]);
 useEffect(()=>{if(state!=='ready'||!peer||!user?.id)return;let cancelled=false;const timer=setInterval(()=>{api(`messages/${peer}`).then(d=>{if(!cancelled){setMessages(old=>mergeMessages(old,d.messages));setBlocked(d.blocked);acknowledgeReceived(peer,d.messages,user.id).catch(()=>{});}}).catch(()=>{});},8000);return()=>{cancelled=true;clearInterval(timer);};},[peer,state,user?.id]);
 async function loadOlder(){
  if(!nextBefore||loadingOlder)return;
  setLoadingOlder(true);setError('');
  try{
   const data=await api(`messages/${peer}?before=${encodeURIComponent(nextBefore)}`);
   setMessages(old=>mergeMessages(old,data.messages));setNextBefore(data.nextBefore);
   await acknowledgeReceived(peer,data.messages,user.id);
  }catch(e){setError(friendlyError(e));}finally{setLoadingOlder(false);}
 }
 async function send(e){e.preventDefault();setBusy(true);setError('');setNotice('');try{await api(`messages/${peer}`,{method:'POST',body:{text}});setText('');const c=await api(`messages/${peer}`);setMessages(old=>mergeMessages(old,c.messages));acknowledgeReceived(peer,c.messages,user.id).catch(()=>{});setNotice('Message delivered to the local inbox.');}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
 async function block(){if(!window.confirm(blocked?'Unblock this contact?':'Block this contact from messaging you?'))return;setBusy(true);setError('');try{await api(`messages/${peer}/${blocked?'unblock':'block'}`,{method:'POST',body:{}});setBlocked(!blocked);setNotice(blocked?'Contact unblocked.':'Contact blocked.');}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
 async function report(msg){const reason=window.prompt('Why are you reporting this received message? (10+ characters)');if(reason===null)return;setBusy(true);setError('');try{await api('messages/report',{method:'POST',body:{messageId:msg.id,reason}});setNotice('Report submitted to local administrators.');}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
 return <main id="main" className="main"><Link href="/messages" className="back">← Conversations</Link><div className="hero compact"><p className="eyebrow">Private peer question</p><h1>Conversation</h1><p className="intro">Messages stay in the local SQLite database. They are not end-to-end encrypted, and administrators can examine messages you report. Refresh happens every eight seconds.</p></div>
 {state==='loading'?<p role="status">Opening conversation…</p>:state==='signed-out'?<p role="status">You need to <Link href="/sign-in">sign in</Link> to message creators.</p>:state==='unavailable'?<p role="alert" className="status">This conversation is unavailable or needs a verified student account.</p>:<div className="conversation-shell"><div className="conversation-header"><div><strong>Peer contact</strong><p className="hint">Account reference: {peer.slice(0,8)}…</p></div><button className="quiet-button" onClick={block} disabled={busy}>{blocked?'Unblock contact':'Block contact'}</button></div>
 {nextBefore&&<button type="button" className="quiet-button" disabled={loadingOlder} onClick={loadOlder}>{loadingOlder?'Loading…':'Load earlier messages'}</button>}
 <div className="message-thread" aria-label="Conversation messages">{messages.length===0?<p className="hint">No messages yet. Ask about an original lesson or a concept you would like to understand.</p>:messages.map(m=><article key={m.id} className={m.senderId===user.id?'message-bubble own':'message-bubble'}><p>{m.body}</p><div className="message-meta"><time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString()}</time>{m.senderId!==user.id&&<button className="quiet-text" disabled={busy} onClick={()=>report(m)}>Report</button>}</div></article>)}</div>
 {error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status" className="form-success">{notice}</p>}
 <form className="form-stack" onSubmit={send}><label htmlFor="message">Message (max 2,000 characters)</label><textarea id="message" value={text} required maxLength="2000" rows="3" onChange={e=>setText(e.target.value)} placeholder="Could you explain how you approached the worked example?"/><button type="submit" className="primary-link" disabled={busy||blocked||!text.trim()}>{busy?'Sending…':'Send message'}</button></form></div>}
 </main>;
}
