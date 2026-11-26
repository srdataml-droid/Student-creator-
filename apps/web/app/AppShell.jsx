'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import ShellSearch from './ShellSearch.jsx';
import {api} from '../lib/local-client.js';
import {useHostedAccount} from './HostedAccountProvider.jsx';

const paths={
 home:<><path d="M3 10.5 12 3l9 7.5V21h-6v-7H9v7H3z"/></>,
 shorts:<><rect x="6" y="3" width="12" height="18" rx="4"/><path d="m10 8 5 4-5 4z"/></>,
 search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
 create:<><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 7v10M7 12h10"/></>,
 community:<><circle cx="9" cy="8" r="3"/><path d="M2 20v-2a7 7 0 0 1 14 0v2M17 5a3 3 0 0 1 0 6M18 14a6 6 0 0 1 4 6"/></>,
 saved:<path d="M6 3h12v18l-6-4-6 4z"/>,
 access:<><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/></>,
 messages:<path d="M21 11.5a9 9 0 0 1-9 9 9.4 9.4 0 0 1-4-.9L3 21l1.4-5A9 9 0 1 1 21 11.5z"/>,
 shield:<><path d="m12 3 8 3v6c0 5-4.5 8-8 9-3.5-1-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/></>,
 user:<><circle cx="12" cy="8" r="3.5"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
 bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
 menu:<><path d="M4 7h16M4 12h16M4 17h16"/></>,
 arrow:<path d="m9 18 6-6-6-6"/>,
 };
function Icon({name}){return <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;}
const basePrimary=[
 {href:'/',label:'Home',mobile:'Home',icon:'home'},
 {href:'/search',label:'Explore',mobile:'Explore',icon:'search'},
 {href:'/studio',label:'Creator studio',mobile:'Create',icon:'create'},
 {href:'/communities',label:'Community',mobile:'Community',icon:'community'},
 {href:'/messages',label:'Inbox',mobile:'Inbox',icon:'messages'},
 {href:'/saved',label:'Saved posts',icon:'saved'},
 {href:'/purchases',label:'My access',icon:'access'}
];
const account=[
 {href:'/verification',label:'Student membership',icon:'shield'},
 {href:'/account-security',label:'Settings',icon:'user'}
];
function isCurrent(path,href){return href==='/'?path==='/':path===href||path.startsWith(href+'/');}
function NavItem({item,path,mobile=false}){const current=isCurrent(path,item.href);return <Link href={item.href} prefetch={false} className={(current?'current ':'')+(mobile&&item.icon==='create'?'mobile-create-tab':'')} aria-current={current?'page':undefined}><Icon name={item.icon}/><span>{mobile?item.mobile:item.label}</span></Link>;}

export default function AppShell({children}){
 const path=usePathname()||'/';
 const menu=useRef(null);
 const [open,setOpen]=useState(false);
 const hostedAccount=useHostedAccount();
 const [localSession,setSession]=useState({state:'checking',role:null});
 const session=hostedAccount?.session||localSession;
 useEffect(()=>{
  if(hostedAccount)return;
  let active=true;let generation=0;
  async function check(){const request=++generation;try{const {user}=await api('me');if(active&&request===generation)setSession(user?.id?{state:'signed-in',role:user.role,userId:user.id}:{state:'guest',role:null});}catch(error){if(active&&request===generation)setSession({state:error.status===401?'guest':'unavailable',role:null});}}
  void check();
  function onVisible(){if(document.visibilityState==='visible')void check();}
  document.addEventListener('visibilitychange',onVisible);
  return()=>{active=false;document.removeEventListener('visibilitychange',onVisible);};
 },[Boolean(hostedAccount)]);
 const signedIn=session.state==='signed-in';
 const primary=hostedAccount?basePrimary.map(item=>item.href==='/studio'?{...item,href:'/create',label:'Create'}:item.href==='/search'?{...item,href:'/shorts',label:'Shorts',mobile:'Shorts',icon:'shorts'}:item):basePrimary;
 useEffect(()=>{setOpen(false)},[path]);
 useEffect(()=>{
  if(!open)return;
  function dismiss(e){if(e.key==='Escape'){setOpen(false);menu.current?.querySelector('button')?.focus();}else if(e.type==='pointerdown'&&!menu.current?.contains(e.target))setOpen(false);}
  document.addEventListener('keydown',dismiss);document.addEventListener('pointerdown',dismiss);
  return ()=>{document.removeEventListener('keydown',dismiss);document.removeEventListener('pointerdown',dismiss);};
 },[open]);
 return <>
  <header className="creator-nav modern-header"><div className="nav-inner">
   <Link href="/" className="creator-logo" aria-label="Student Creators home"><span className="reference-wordmark">Worthkind<small>Student Creators</small></span></Link>
   <ShellSearch hosted={Boolean(hostedAccount)} actor={signedIn?session.userId:null}/><div className="nav-auth">{hostedAccount&&<Link className="header-icon" href="/notifications" aria-label="Notifications"><Icon name="bell"/></Link>}{signedIn?<Link className="nav-join" href={hostedAccount?'/account-security':session.role==='admin'?'/manage':'/studio'} prefetch={false}>{hostedAccount?'Account':session.role==='admin'?'Staff console':'My studio'}</Link>:session.state==='checking'?<span className="shell-session-check" role="status">Checking account…</span>:<><Link className="nav-signin" href="/sign-in">Log in</Link><Link className="nav-join" href="/join">Join</Link></>}
    <div className="shell-menu" ref={menu}>
     <button type="button" className="shell-menu-toggle" aria-label="Account and navigation menu" aria-expanded={open} aria-controls="shell-account-menu" onClick={()=>setOpen(v=>!v)}><Icon name="menu"/></button>
     {open&&<nav id="shell-account-menu" className="shell-menu-panel" aria-label="Account menu">
       {[...(!signedIn?[{href:'/sign-in',label:'Log in',icon:'user'},{href:'/join',label:'Join Student Creators',icon:'user'}]:[]),...primary,...account,...(hostedAccount?[{href:'/notifications',label:'Notifications',icon:'messages'}]:[]),...(session.role==='admin'?[{href:'/manage',label:'Staff console',icon:'shield'}]:[])].map(item=><Link key={item.href} href={item.href} prefetch={false} onClick={()=>setOpen(false)} aria-current={isCurrent(path,item.href)?'page':undefined}><Icon name={item.icon}/>{item.label}</Link>)}
     </nav>}
    </div>
   </div>
  </div></header>
  <div className="app-frame modern-frame">
   <aside className="creator-sidebar" aria-label="Community navigation">
    <div className="side-section-label">Discover</div>
    <nav className="side-nav" aria-label="Primary navigation">{primary.slice(0,2).map(item=><NavItem key={item.href} item={item} path={path}/>)}</nav>
    <div className="side-section-label">Your space</div>
    <nav className="side-nav" aria-label="Your workspace">{[...primary.slice(2),...(hostedAccount?[{href:'/notifications',label:'Notifications',icon:'messages'}]:[])].map(item=><NavItem key={item.href} item={item} path={path}/>)}</nav>
    <div className="sidebar-divider"/>
    <div className="side-section-label">Account</div>
    <nav className="side-nav" aria-label="Account navigation">{account.map(item=><NavItem key={item.href} item={item} path={path}/>)}</nav>
    <div className="side-foot">Student Creators by Worthkind<br/>Original work. Real community.</div>
   </aside>
   <div className="app-content">{hostedAccount?.notice&&<p className="status" role="status">{hostedAccount.notice}</p>}{children}<nav className="mobile-creator-tabs" aria-label="Mobile navigation">{primary.filter(item=>item.mobile).map(item=><NavItem key={item.href} item={item} path={path} mobile/>)}</nav><footer className="creator-footer"><span>© Student Creators by Worthkind</span><Link href="/verification">Student membership</Link></footer></div>
  </div>
 </>;
}
