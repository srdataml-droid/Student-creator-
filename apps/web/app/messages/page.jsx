'use client';
import {useHostedAccount} from '../HostedAccountProvider.jsx';
import {HostedInbox} from '../HostedSocialWorkspace.jsx';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api} from '../../lib/local-client.js';
function LocalInbox(){
 const [state,setState]=useState('loading'),[threads,setThreads]=useState([]),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let active=true;setState('loading');
  api('messages/inbox').then(d=>{if(active){setThreads(Array.isArray(d.inbox)?d.inbox:[]);setState('ready');}}).catch(e=>{if(active)setState(e.status===401?'signed-out':'unavailable');});
  return()=>{active=false;};
 },[attempt]);
 return <main id="main" className="main inbox-page">
  <section className="hero compact"><h1>Messages</h1><p className="intro">Your private conversations with student creators.</p></section>
  <section className="inbox-card" aria-label="Conversations">
   <div className="inbox-card-heading"><h2>Inbox</h2>{state==='ready'&&<span className="hint">{threads.length} conversation{threads.length===1?'':'s'}</span>}<button type="button" className="quiet-button" onClick={()=>setAttempt(v=>v+1)} disabled={state==='loading'}>Refresh</button></div>
   {state==='loading'?<p role="status" className="inbox-state">Loading your inbox…</p>:state==='signed-out'?<div className="inbox-state"><h3>Sign in to see your messages</h3><p>Your conversations belong to your account.</p><Link href="/sign-in" className="primary-link">Sign in</Link></div>:state==='unavailable'?<div className="inbox-state" role="alert"><h3>Inbox unavailable</h3><p>A verified student account is required. Try again or check your membership.</p><Link href="/verification" className="secondary-link">Check membership</Link></div>:threads.length===0?<div className="inbox-state"><h3>No conversations yet</h3><p>Find a published post and message its creator when they accept inquiries.</p><Link href="/search" className="primary-link">Discover creators</Link></div>:<ul className="inbox-list">{threads.map(t=><li key={t.peerId}><Link href={'/messages/'+t.peerId} className="inbox-row"><span className="inbox-avatar" aria-hidden="true">SC</span><span className="inbox-row-copy"><strong>Conversation {t.peerId.slice(0,8)}…</strong><time dateTime={t.lastMessageAt}>Last message: {new Date(t.lastMessageAt).toLocaleString()}</time></span><span aria-hidden="true">›</span></Link></li>)}</ul>}
  </section>
 </main>;
}

export default function Inbox(props){const account=useHostedAccount();return account?<HostedInbox key={account.session.userId||account.session.state}/>:<LocalInbox {...props}/>;}
