'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../lib/local-client.js';
const titles={message:'New private message',follow:'A student followed you',like:'A student liked your work',comment:'New lesson comment or reply',community_reply:'New reply to your discussion'};
const groups={messages:'Direct messages',social:'Follows, likes and comments',community:'Community replies'};
function destination(n){
 if(n.kind==='message')return '/messages/'+n.targetId;
 if(n.kind==='like'||n.kind==='comment')return '/lessons/'+n.targetId;
 if(n.kind==='community_reply')return '/communities/'+n.targetId;
 return null;
}
export default function Notifications(){
 const [items,setItems]=useState([]),[prefs,setPrefs]=useState(null),[state,setState]=useState('loading'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;Promise.all([api('notifications'),api('notifications/preferences')]).then(([a,b])=>{if(active){setItems(a.notifications);setPrefs(b.preferences);setState('ready');}}).catch(e=>{if(active)setState(e.status===401?'signed-out':'unavailable');});return()=>{active=false;};},[]);
 async function save(e){e.preventDefault();setBusy(true);setError('');try{const d=await api('notifications/preferences',{method:'POST',body:prefs});setPrefs(d.preferences);}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
 async function read(id){setBusy(true);setError('');try{await api('notifications/'+id+'/read',{method:'POST',body:{}});const d=await api('notifications');setItems(d.notifications);}catch(e){setError(friendlyError(e));}finally{setBusy(false);}}
 return <main id="main" className="main"><h1>Notifications</h1>
 {state==='loading'?<p role="status">Loading notifications…</p>:state==='signed-out'?<p><Link href="/sign-in">Sign in</Link> to see your notifications.</p>:state==='unavailable'?<p role="alert">A verified student account is required.</p>:<>
 <form onSubmit={save} className="panel form-stack"><h2>Notification preferences</h2><p>Choose which new in-app notifications to receive. This does not change message access or erase existing notifications.</p>
 {Object.entries(groups).map(([k,label])=><label key={k}><input type="checkbox" checked={prefs[k]} disabled={busy} onChange={e=>setPrefs(old=>({...old,[k]:e.target.checked}))}/> {label}</label>)}
 <button className="primary-link" disabled={busy}>Save preferences</button></form>
 <h2>Recent activity</h2>{items.length===0?<p>No notifications yet.</p>:<ul className="lesson-list">{items.map(n=><li className="lesson" key={n.id}><h3>{destination(n)?<Link href={destination(n)}>{titles[n.kind]}</Link>:titles[n.kind]}</h3><p>{new Date(n.createdAt).toLocaleString()} · {n.readAt?'Read':'Unread'}</p>{!n.readAt&&<button type="button" className="quiet-button" disabled={busy} onClick={()=>read(n.id)}>Mark as read</button>}</li>)}</ul>}</>}
 {error&&<p role="alert">{error}</p>}</main>;
}
