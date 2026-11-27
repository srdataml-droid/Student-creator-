'use client';
import Link from 'next/link';
import {useHostedAccount} from '../HostedAccountProvider.jsx';
const options=[
 {title:'Upload a video',detail:'Long-form original content',href:'/studio?format=video#studio-create',icon:'video'},
 {title:'Create a short',detail:'Vertical, quick content',href:'/studio?format=short#studio-create',icon:'short'},
 {title:'Photo or text post',detail:'Ideas, images and experiences',icon:'image',unavailable:true},
 {title:'Go live',detail:'Host a night class',href:'/classes',icon:'live'},
 {title:'Your drafts',detail:'Continue unfinished work',href:'/studio#studio-content',icon:'draft'},
 {title:'Creator studio',detail:'Content, analytics and earnings',href:'/studio',icon:'studio'}
];
function Symbol({type}){return <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{type==='video'?<><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/></>:type==='short'?<><circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/></>:type==='image'?<><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 4-5 5 6"/></>:type==='live'?<><circle cx="12" cy="12" r="2"/><path d="M8 8a6 6 0 0 0 0 8m8-8a6 6 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></>:type==='draft'?<><path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h8"/></>:<><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 17v-5m5 5V7m5 10v-8"/></>}</svg>;}
export default function CreatePage(){
 const account=useHostedAccount(),eligible=account?.session.state==='signed-in'&&account.accountState?.student===true;
 const signedIn=account?.session.state==='signed-in';
 const pending=signedIn&&!account.accountState;
 return <main id="main" className="main content-create watch-section-page"><h1>Create</h1><p className="hint">Share something original.</p>{!account?<Link href="/studio">Open creator studio</Link>:<>
 <ul className="community-preview-list create-options">{options.map(o=><li key={o.title}>{o.unavailable?<div className="community-preview-item" aria-disabled="true"><span className="community-preview-symbol"><Symbol type={o.icon}/></span><span className="community-preview-copy"><strong>{o.title}</strong><small>{o.detail}</small></span><small className="hint">Not yet available</small></div>:<Link className="community-preview-item" href={eligible?o.href:signedIn?'/verification':'/sign-in'}><span className="community-preview-symbol"><Symbol type={o.icon}/></span><span className="community-preview-copy"><strong>{o.title}</strong><small>{o.detail}</small></span><span aria-hidden="true">›</span></Link>}</li>)}</ul>
 {!eligible&&<section className="watch-access-note">{pending?<><h2>Checking creator access</h2><button type="button" className="quiet-button" onClick={()=>account.reloadAccount().catch(()=>{})}>Check again</button></>:<><h2>{signedIn?'Student membership required':'Sign in to start creating'}</h2><p className="hint">Creator features require verified student membership.</p><Link className="primary-link" href={signedIn?'/verification':'/sign-in'}>{signedIn?'Check student membership':'Sign in'}</Link></>}</section>}
 </>}</main>;
}
