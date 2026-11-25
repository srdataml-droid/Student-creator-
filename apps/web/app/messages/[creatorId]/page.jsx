'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../../lib/local-client.js';
export default function Conversation({params}){
 const [peer,setPeer]=useState(''),[user,setUser]=useState(null),[messages,setMessages]=useState([]),[blocked,setBlocked]=useState(false),[text,setText]=useState(''),[state,setState]=useState('loading'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{let active=true;async function load(){const {creatorId}=await params;if(!active)return;setPeer(creatorId);try{const m=await api('me');if(!active)return;setUser(m.user);const c=await api(`messages/${creatorId}`);if(active){setMessages(c.messages);setBlocked(c.blocked);setState('ready');}}catch(e){if(active)setState(e.status===401?'signed-out':'unavailable');}}load();return()=>{active=false;};},[params]);
 useEffect(()=>{
   if(state!=='ready'||!peer||busy)return;
   let cancelled=false,inFlight=false,timer=null,failures=0;
   const canRead=()=>!cancelled&&document.visibilityState==='visible'&&navigator.onLine!==false;
   function clear(){if(timer!==null){clearTimeout(timer);timer=null;}}
   function schedule(){
     clear();
     if(canRead()&&!inFlight)timer=setTimeout(()=>{void refresh();},Math.min(60000,8000*2**failures));
   }
   async function refresh(){
     clear();
     if(!canRead()||inFlight)return;
     inFlight=true;
     try{
       const d=await api(`messages/${peer}`);
       if(!cancelled){failures=0;setMessages(d.messages);setBlocked(d.blocked);}
     }catch(e){
       if(!cancelled){
         if(e?.status===401||e?.status===403){
           setMessages([]);setUser(null);setText('');setState(e.status===401?'signed-out':'unavailable');
           cancelled=true;
         }else failures=Math.min(failures+1,3);
       }
     }finally{inFlight=false;schedule();}
   }
   function changed(){clear();if(canRead())void refresh();}
   document.addEventListener('visibilitychange',changed);
   window.addEventListener('online',changed);
   window.addEventListener('offline',changed);
   schedule();
   return ()=>{cancelled=true;clear();document.removeEventListener('visibilitychange',changed);window.removeEventListener('online',changed);window.removeEventListener('offline',changed);};
 },[peer,state,busy]);
 async function send(e){e.preventDefault();setBusy(true);setError('');setNotice('');try{await api(`messages/${peer}`,{method:'POST',body:{text}});setText('');const c=await api(`messages/${peer}`);setMessages(c.messages);setNotice('Message delivered.');}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
 async function block(){if(!window.confirm(blocked?'Unblock this contact?':'Block this contact from messaging you?'))return;setBusy(true);setError('');try{await api(`messages/${peer}/${blocked?'unblock':'block'}`,{method:'POST',body:{}});setBlocked(!blocked);setNotice(blocked?'Contact unblocked.':'Contact blocked.');}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
 async function report(msg){const reason=window.prompt('Why are you reporting this received message? (10+ characters)');if(reason===null)return;setBusy(true);setError('');try{await api('messages/report',{method:'POST',body:{messageId:msg.id,reason}});setNotice('Report submitted to moderators.');}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
 return <main id="main" className="main"><Link href="/messages" className="back">← Conversations</Link><div className="hero compact"><p className="eyebrow">Private peer question</p><h1>Conversation</h1><p className="intro">Messages are not end-to-end encrypted, and authorized moderators can examine messages you report. Conversations refresh while you are online and viewing this page.</p></div>
 {state==='loading'?<p role="status">Opening conversation…</p>:state==='signed-out'?<p role="status">You need to <Link href="/sign-in">sign in</Link> to message creators.</p>:state==='unavailable'?<p role="alert" className="status">This conversation is unavailable or needs a verified student account.</p>:<div className="conversation-shell"><div className="conversation-header"><div><strong>Peer contact</strong><p className="hint">Account reference: {peer.slice(0,8)}…</p></div><button className="quiet-button" onClick={block} disabled={busy}>{blocked?'Unblock contact':'Block contact'}</button></div>
 <div className="message-thread" aria-label="Conversation messages">{messages.length===0?<p className="hint">No messages yet. Ask about an original lesson or a concept you would like to understand.</p>:messages.map(m=><article key={m.id} className={m.senderId===user.id?'message-bubble own':'message-bubble'}><p>{m.body}</p><div className="message-meta"><time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString()}</time>{m.senderId!==user.id&&<button className="quiet-text" disabled={busy} onClick={()=>report(m)}>Report</button>}</div></article>)}</div>
 {error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status" className="form-success">{notice}</p>}
 <form className="form-stack" onSubmit={send}><label htmlFor="message">Message (max 2,000 characters)</label><textarea id="message" value={text} required maxLength="2000" rows="3" onChange={e=>setText(e.target.value)} placeholder="Could you explain how you approached the worked example?"/><button type="submit" className="primary-link" disabled={busy||blocked||!text.trim()}>{busy?'Sending…':'Send message'}</button></form></div>}
 </main>;
}
