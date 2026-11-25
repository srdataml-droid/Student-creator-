'use client';
import Link from 'next/link';
import ReportUser from '../../ReportUser.jsx';
import {useEffect,useRef,useState,use} from 'react';
import {api,friendlyError} from '../../../lib/local-client.js';
import {mergeConversationMessages,pendingReadIds,isConversationAccessLost} from '../../../lib/conversation-state.mjs';

export default function Conversation({params}){
 const {creatorId}=use(params);
 return <ConversationThread key={creatorId} peer={creatorId}/>;
}
function ConversationThread({peer}){
 const [user,setUser]=useState(null),[messages,setMessages]=useState([]),[blocked,setBlocked]=useState(false),[text,setText]=useState(''),[state,setState]=useState('loading'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[nextBefore,setNextBefore]=useState(null),[loadingOlder,setLoadingOlder]=useState(false);
 const controller=useRef(null),acknowledged=useRef(new Set()),ackBusy=useRef(false),pollBusy=useRef(false);
 const current=()=>controller.current;
 const live=signal=>signal===controller.current?.signal&&!signal.aborted;
 const request=(path,options={})=>api(path,{...options,signal:options.signal??current()?.signal});
 function revoke(e,signal){
  if(!live(signal)||!isConversationAccessLost(e))return false;
  current()?.abort();setMessages([]);setUser(null);setNextBefore(null);setText('');setError('');setNotice('');setState(e.status===401?'signed-out':'unavailable');
  return true;
 }
 function failure(e,signal){if(live(signal)&&!revoke(e,signal))setError(friendlyError(e));}
 useEffect(()=>{
  const c=new AbortController();controller.current=c;acknowledged.current.clear();ackBusy.current=false;pollBusy.current=false;
  async function load(){
   try{
    const m=await request('me',{signal:c.signal});if(!live(c.signal))return;
    const d=await request(`messages/${peer}`,{signal:c.signal});if(!live(c.signal))return;
    setUser(m.user);setMessages(mergeConversationMessages([],d.messages,peer,m.user.id));setNextBefore(d.nextBefore);setBlocked(d.blocked);setState('ready');
   }catch(e){if(live(c.signal)){setMessages([]);setUser(null);setState(e.status===401?'signed-out':'unavailable');}}
  }
  load();return()=>c.abort();
 },[peer]);
 useEffect(()=>{
  if(state!=='ready'||!user?.id)return;
  const signal=current()?.signal;if(!signal)return;
  async function refresh(){
   if(!live(signal)||pollBusy.current||document.visibilityState!=='visible')return;
   pollBusy.current=true;
   try{const d=await request(`messages/${peer}`,{signal});if(live(signal)){setMessages(old=>mergeConversationMessages(old,d.messages,peer,user.id));setBlocked(d.blocked);}}
   catch(e){if(live(signal))revoke(e,signal);}
   finally{if(live(signal))pollBusy.current=false;}
  }
  const timer=setInterval(refresh,8000);document.addEventListener('visibilitychange',refresh);
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
 },[peer,state,user?.id]);
 // Acknowledge after rendering, only in the currently visible conversation.
 // Each batch is at most 100 IDs; failed acknowledgements are retried on refresh.
 useEffect(()=>{
  if(state!=='ready'||!user?.id)return;
  const signal=current()?.signal;if(!signal)return;
  async function acknowledge(){
   if(!live(signal)||ackBusy.current||document.visibilityState!=='visible')return;
   ackBusy.current=true;
   try{
    const ids=pendingReadIds(messages,peer,user.id,acknowledged.current);
    for(let i=0;i<ids.length;i+=100){
     if(!live(signal)||document.visibilityState!=='visible')break;
     const messageIds=ids.slice(i,i+100);
     await request(`messages/${peer}/read`,{method:'POST',body:{messageIds},signal});
     if(live(signal))for(const id of messageIds)acknowledged.current.add(id);
    }
   }catch(e){if(live(signal))revoke(e,signal);}
   finally{if(live(signal))ackBusy.current=false;}
  }
  acknowledge();document.addEventListener('visibilitychange',acknowledge);
  const timer=setInterval(acknowledge,8000);
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',acknowledge);};
 },[messages,peer,state,user?.id]);
 async function loadOlder(){
  const signal=current()?.signal;if(!signal||!live(signal)||!nextBefore||loadingOlder)return;
  setLoadingOlder(true);setError('');
  try{const d=await request(`messages/${peer}?before=${encodeURIComponent(nextBefore)}`,{signal});if(live(signal)){setMessages(old=>mergeConversationMessages(old,d.messages,peer,user.id));setNextBefore(d.nextBefore);}}
  catch(e){failure(e,signal);}finally{if(live(signal))setLoadingOlder(false);}
 }
 async function send(e){
  e.preventDefault();const signal=current()?.signal;if(!signal||!live(signal)||busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const d=await request(`messages/${peer}`,{method:'POST',body:{text},signal});
   if(live(signal)){setText('');setMessages(old=>mergeConversationMessages(old,[d.message],peer,user.id));setNotice('Message sent.');}
  }catch(e){failure(e,signal);}finally{if(live(signal))setBusy(false);}
 }
 async function block(){
  if(!window.confirm(blocked?'Unblock this contact?':'Block this contact from messaging you?'))return;
  const signal=current()?.signal;if(!signal||!live(signal)||busy)return;
  setBusy(true);setError('');
  try{await request(`messages/${peer}/${blocked?'unblock':'block'}`,{method:'POST',body:{},signal});if(live(signal)){setBlocked(!blocked);setNotice(blocked?'Contact unblocked.':'Contact blocked.');}}
  catch(e){failure(e,signal);}finally{if(live(signal))setBusy(false);}
 }
 async function report(msg){
  const reason=window.prompt('Why are you reporting this received message? (10+ characters)');if(reason===null)return;
  const signal=current()?.signal;if(!signal||!live(signal)||busy)return;
  setBusy(true);setError('');
  try{await request('messages/report',{method:'POST',body:{messageId:msg.id,reason},signal});if(live(signal))setNotice('Report submitted for administrator review.');}
  catch(e){failure(e,signal);}finally{if(live(signal))setBusy(false);}
 }
 return <main id="main" className="main"><Link href="/messages" className="back">← Conversations</Link><div className="hero compact"><p className="eyebrow">Private peer question</p><h1>Conversation</h1><p className="intro">Messages are private between participants, but not end-to-end encrypted. Administrators can examine messages you report. Conversations refresh while open.</p></div>
 {state==='loading'?<p role="status">Opening conversation…</p>:state==='signed-out'?<p role="status">You need to <Link href="/sign-in">sign in</Link> to message creators.</p>:state==='unavailable'?<p role="alert" className="status">This conversation is unavailable or needs a verified student account.</p>:<div className="conversation-shell"><div className="conversation-header"><div><strong>Peer contact</strong><p className="hint">Account reference: {peer.slice(0,8)}…</p></div><button className="quiet-button" onClick={block} disabled={busy}>{blocked?'Unblock contact':'Block contact'}</button>{messages.length>0&&<ReportUser userId={peer}/>}</div>
 {nextBefore&&<button type="button" className="quiet-button" disabled={loadingOlder} onClick={loadOlder}>{loadingOlder?'Loading…':'Load earlier messages'}</button>}
 <div className="message-thread" aria-label="Conversation messages">{messages.length===0?<p className="hint">No messages yet. Ask about an original lesson or a concept you would like to understand.</p>:messages.map(m=><article key={m.id} className={m.senderId===user.id?'message-bubble own':'message-bubble'}><p>{m.body}</p><div className="message-meta"><time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString()}</time>{m.senderId!==user.id&&<button className="quiet-text" disabled={busy} onClick={()=>report(m)}>Report</button>}</div></article>)}</div>
 {error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status" className="form-success">{notice}</p>}
 <form className="form-stack" onSubmit={send}><label htmlFor="message">Message (max 2,000 characters)</label><textarea id="message" value={text} required maxLength="2000" rows="3" onChange={e=>setText(e.target.value)} placeholder="Could you explain how you approached the worked example?"/><button type="submit" className="primary-link" disabled={busy||blocked||!text.trim()}>{busy?'Sending…':'Send message'}</button></form></div>}
 </main>;
}
