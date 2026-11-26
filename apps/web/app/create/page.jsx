'use client';
import Link from 'next/link';
import {useHostedAccount} from '../HostedAccountProvider.jsx';
const options=[
 {title:'Upload a video',detail:'Create original content and upload a private video for review.',href:'/studio#studio-create',icon:'video'},
 {title:'Go live',detail:'Schedule and manage a night class.',href:'/communities?tab=night',icon:'live'},
 {title:'Your drafts',detail:'Continue your unpublished work.',href:'/studio#studio-content',icon:'draft'},
 {title:'Creator studio',detail:'Manage content, profile and earnings.',href:'/studio',icon:'studio'}
];
function Symbol({type}){return <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{type==='video'?<><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/></>:type==='live'?<><circle cx="12" cy="12" r="2"/><path d="M8 8a6 6 0 0 0 0 8m8-8a6 6 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></>:type==='draft'?<><path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h8"/></>:<><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 17v-5m5 5V7m5 10v-8"/></>}</svg>;}
export default function CreatePage(){
 const account=useHostedAccount();
 return <main id="main" className="main content-create"><h1>Create</h1><p className="hint">Share something original.</p>{!account?<Link href="/studio">Open creator studio</Link>:account.session.state==='checking'?<p role="status">Checking your account…</p>:account.session.state==='unavailable'?<p role="alert">Account connection unavailable. Refresh to reconnect.</p>:account.session.state!=='signed-in'?<div><p>Sign in to access creator membership.</p><Link className="primary-link" href="/sign-in">Sign in</Link></div>:!account.accountState?<p role="status">Creator eligibility has not been confirmed. <button type="button" onClick={()=>account.reloadAccount().catch(()=>{})}>Check again</button></p>:account.accountState.student!==true?<div><p>Creator access requires verified student membership.</p><Link className="primary-link" href="/verification">Check student membership</Link></div>:<><ul className="community-preview-list">{options.map(o=><li key={o.href}><Link className="community-preview-item" href={o.href}><span className="community-preview-symbol"><Symbol type={o.icon}/></span><span className="community-preview-copy"><strong>{o.title}</strong><small>{o.detail}</small></span><span aria-hidden="true">›</span></Link></li>)}</ul><p className="hint">Shorts and standalone image or text posts are not enabled until their publishing workflows are connected.</p></>}</main>;
}
