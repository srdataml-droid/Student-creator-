'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {useHostedAccount} from './HostedAccountProvider.jsx';
import {availableNightClasses,sessionHref,currentNightClass} from '../lib/community-discovery.mjs';
const dateLabel=v=>new Date(v).toLocaleString('en-NG',{timeZone:'Africa/Lagos',weekday:'short',hour:'numeric',minute:'2-digit',month:'short',day:'numeric'})+' WAT';
export function CommunityRowIcon({kind='community'}){return <svg aria-hidden="true" viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{kind==='moon'?<path d="M20.8 15.2A9 9 0 0 1 8.8 3.2a9 9 0 1 0 12 12Z"/>:kind==='live'?<><circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7m7-7a5 5 0 0 1 0 7M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></>:<><circle cx="9" cy="8" r="3.5"/><path d="M2 19v-1a7 7 0 0 1 14 0v1M17 5a3.5 3.5 0 0 1 0 7m1 2a6 6 0 0 1 4 5"/></>}</svg>;}
function useScopedRead(operation,input,enabled){
 const account=useHostedAccount(),request=useRef(account?.creatorRequest),generation=useRef(0),[result,setResult]=useState({state:'loading',rows:[]});
 request.current=account?.creatorRequest;
 const actor=account?.session.userId,signature=JSON.stringify(input);
 async function load(){
  const current=++generation.current;setResult({state:'loading',rows:[]});
  try{const rows=await request.current(operation,JSON.parse(signature));if(!Array.isArray(rows))throw Error('INVALID_RESPONSE');if(current===generation.current)setResult({state:'ready',rows});}
  catch(e){if(current===generation.current)setResult({state:e.status===403?'forbidden':'error',rows:[]});}
 }
 useEffect(()=>{if(enabled&&actor)void load();return()=>{generation.current++;};},[actor,enabled,operation,signature]);
 return {...result,load};
}
function AccessState({account,children}){
 if(!account)return <p className="hint">Live community services are unavailable in this local environment.</p>;
 if(account.session.state==='checking')return <p role="status" className="hint">Checking your account…</p>;
 if(account.session.state==='unavailable')return <p className="hint">Sign in to access your community activity. <Link href="/sign-in">Sign in</Link></p>;
 if(account.session.state!=='signed-in')return <div className="community-empty"><p>Sign in to see night classes and communities available to your campus.</p><Link className="secondary-link" href="/sign-in">Sign in</Link></div>;
 return children;
}
function ReadState({result,empty,children}){
 if(result.state==='loading')return <p role="status" className="hint">Loading…</p>;
 if(result.state==='forbidden')return <p className="hint">Verified student membership is required. <Link href="/verification">Check membership</Link>.</p>;
 if(result.state==='error')return <div className="community-empty"><p role="alert">Could not load this list.</p><button type="button" className="quiet-button" onClick={result.load}>Retry</button></div>;
 return children??<p className="hint">{empty}</p>;
}
export function NightClassPreview(){
 const account=useHostedAccount();
 return <AccessState account={account}>{account?.session.state==='signed-in'&&<NightList key={account.session.userId}/>}</AccessState>;
}
function NightList(){
 const result=useScopedRead('availableClasses',{},true),rows=availableNightClasses(result.rows).slice(0,3);
 return <ReadState result={result} empty="No available night classes yet.">{rows.length?<ul className="community-preview-list">{rows.map(c=><li key={c.id}><Link href={sessionHref(c.id)} className="community-preview-item"><span className="community-preview-symbol" aria-hidden="true"><CommunityRowIcon kind={c.status==='room_open'?'live':'moon'}/></span><span className="community-preview-copy"><strong>{c.title}</strong><small>{c.status==='room_open'?'Room open':dateLabel(c.starts_at)} · {c.price_kobo===0?'Free':'₦'+(c.price_kobo/100).toLocaleString('en-NG')}</small></span><span aria-hidden="true">›</span></Link></li>)}</ul>:null}</ReadState>;
}
export function MyCommunityList(){
 const account=useHostedAccount();
 return <AccessState account={account}>{account?.session.state==='signed-in'&&<JoinedList key={account.session.userId}/>}</AccessState>;
}
function JoinedList(){
 const result=useScopedRead('myCommunities',{},true);
 const rows=result.rows.filter(r=>r.course?.active===true&&r.course.id===r.course_id&&typeof r.course.title==='string');
 return <ReadState result={result} empty="You have not joined any communities yet.">{rows.length?<ul className="community-preview-list">{rows.map(r=><li key={r.course_id}><Link href={'/communities/'+encodeURIComponent(r.course_id)} className="community-preview-item"><span className="community-preview-symbol" aria-hidden="true"><CommunityRowIcon/></span><span className="community-preview-copy"><strong>{r.course.title}</strong><small>{r.course.code}</small></span><span aria-hidden="true">›</span></Link></li>)}</ul>:null}</ReadState>;
}
export function HomeNightAnnouncement(){
 const account=useHostedAccount();
 return account?.session.state==='signed-in'?<Announcement key={account.session.userId} actor={account.session.userId}/>:null;
}
function Announcement({actor}){
 const result=useScopedRead('availableClasses',{},true),[dismissed,setDismissed]=useState(null);
 const [now,setNow]=useState(Date.now);useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[]);
 const item=currentNightClass(result.rows,now),id=item?.id;
 useEffect(()=>{if(!id)return;try{setDismissed(sessionStorage.getItem('night-class:'+actor+':'+id)==='1'?id:null);}catch{setDismissed(null);}},[actor,id]);
 if(result.state!=='ready'||!item||dismissed===id)return null;
 function close(){setDismissed(id);try{sessionStorage.setItem('night-class:'+actor+':'+id,'1');}catch{}}
 return <aside className="night-announcement" aria-label="Available night class"><Link href={sessionHref(id)}><span className="night-announcement-label">{item.status==='room_open'?'Night class is live':'Upcoming night class'}</span><strong>{item.title}</strong><small>{dateLabel(item.starts_at)} · {item.price_kobo===0?'Free':'₦'+(item.price_kobo/100).toLocaleString('en-NG')}</small></Link><button type="button" className="quiet-button" aria-label="Dismiss night class announcement" onClick={close}>×</button></aside>;
}
