'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {useParams} from 'next/navigation';
import HostedGate from './HostedGate.jsx';
import PublicCommunityOverview from './PublicCommunityOverview.jsx';
import {useHostedAccount} from './HostedAccountProvider.jsx';
import {availableNightClasses,sessionHref} from '../lib/community-discovery.mjs';
import {makeDraftKey} from '../lib/studio-workflow.mjs';
import {readCommunityPosts,readCheckoutResult,readClassGrant} from '../lib/hosted-creator-client.mjs';
function useJob(){
 const lock=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function run(fn){if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await fn(setNotice);}catch(e){setError(e.status===401?'Sign in again.':e.status===403?'Access denied. Check your student membership.':e.status===429?'Too many requests. Try later.':e.message==='LIVEKIT_SDK_UNAVAILABLE'?'The verified browser media SDK is unavailable.':e.message==='INVALID_CHECKOUT_URL'?'The payment destination was rejected.':'The service could not confirm the request. Refresh before retrying.');}finally{lock.current=false;setBusy(false);}}
 return {busy,error,notice,run};
}
function Feedback({job}){return <>{job.error&&<p role="alert" className="form-error">{job.error}</p>}{job.notice&&<p role="status" className="form-success">{job.notice}</p>}</>;}
export function HostedCommunity(){
 const {courseId}=useParams(),account=useHostedAccount();
 if(account?.session.state==='signed-in')return <HostedGate title="Course discussion"><Community key={account.session.userId+courseId} courseId={courseId}/></HostedGate>;
 return <PublicCommunityOverview key={courseId} courseId={courseId} checking={account?.session.state==='checking'}/>;
}
function Community({courseId}){
 const account=useHostedAccount(),job=useJob(),key=useRef(''),composer=useRef(null);
 const [status,setStatus]=useState(null),[posts,setPosts]=useState([]),[text,setText]=useState(''),[reply,setReply]=useState(null),[report,setReport]=useState(null),[reason,setReason]=useState('');
 async function load(operation='communityStatus'){
  const r=await account.creatorRequest(operation,{courseId});
  if(typeof r.joined!=='boolean'||!Number.isSafeInteger(r.memberCount)||r.memberCount<0)throw Error('INVALID_COMMUNITY');
  setStatus(r);setPosts([]);
  if(r.joined)setPosts(readCommunityPosts(await account.creatorRequest('communityPosts',{courseId}),courseId));
 }
 useEffect(()=>{void job.run(()=>load());},[courseId]);
 function replyTo(id){setReply(id);key.current='';composer.current?.focus();}
 return <section className="panel community-composer"><Link href={'/courses/'+courseId}>Back to course</Link><div className="heading-row"><h2>Class community</h2><button className="quiet-button" type="button" disabled={job.busy} onClick={()=>job.run(()=>load())}>Refresh</button></div>
 {status&&<><p>{status.memberCount} members</p>{status.joined?<><button type="button" className="secondary-link" disabled={job.busy} onClick={()=>job.run(async()=>{await load('leaveCommunity');setReply(null);setText('');key.current='';})}>Leave discussion</button><form className="form-stack" onSubmit={e=>{e.preventDefault();job.run(async notice=>{key.current||=makeDraftKey();const r=await account.creatorRequest('communityPost',{courseId,text,replyTo:reply,creationKey:key.current});if(typeof r.id!=='string')throw Error('UNCONFIRMED');key.current='';setReply(null);setText('');notice('Contribution accepted.');await load();});}}>
 <label htmlFor="hosted-community-text">{reply?'Reply to post':'Start a discussion'}</label><textarea ref={composer} id="hosted-community-text" value={text} onChange={e=>{setText(e.target.value);key.current='';}} minLength={3} maxLength={2000} required disabled={job.busy}/>{reply&&<button type="button" className="quiet-button" disabled={job.busy} onClick={()=>{setReply(null);key.current='';}}>Cancel reply</button>}<button className="primary-link" type="submit" disabled={job.busy||text.trim().length<3}>Post to class</button></form>
 {posts.length===0?<p>No discussions yet.</p>:<ul className="community-feed lesson-list">{posts.map(p=><li key={p.id} className="lesson"><p className="hint">{p.parentId?'Reply · ':''}{new Date(p.createdAt).toLocaleString()}</p><p className="community-text">{p.body}</p><div className="button-row"><button type="button" className="quiet-button" disabled={job.busy} onClick={()=>replyTo(p.id)}>Reply</button><button type="button" className="quiet-button" disabled={job.busy} onClick={()=>{setReport(p.id);setReason('');}}>Report</button></div>{report===p.id&&<form className="form-stack" onSubmit={e=>{e.preventDefault();job.run(async notice=>{const r=await account.creatorRequest('communityReport',{courseId,postId:p.id,reason});if(!r.id)throw Error('UNCONFIRMED');setReport(null);notice('Report accepted for review.');});}}><label htmlFor={'community-report-'+p.id}>Reason</label><textarea id={'community-report-'+p.id} minLength={10} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} required disabled={job.busy}/><button className="secondary-link" disabled={job.busy}>Send report</button><button type="button" className="quiet-button" disabled={job.busy} onClick={()=>setReport(null)}>Cancel</button></form>}</li>)}</ul>}</>:<><p>Verified students at the matching campus may join.</p><button className="primary-link" type="button" disabled={job.busy} onClick={()=>job.run(()=>load('joinCommunity'))}>Join discussion</button></>}</>}
 <Feedback job={job}/></section>;
}
export function HostedPurchaseHistory(){
 const account=useHostedAccount(),job=useJob(),[data,setData]=useState(null);
 async function load(){setData(null);const r=await account.creatorRequest('purchaseHistory',{});if(!Array.isArray(r.orders))throw Error('INVALID_RESPONSE');setData(r);}
 useEffect(()=>{if(account.session.state==='signed-in')void job.run(load);},[account.session.state]);
 return <HostedGate title="My access"><section className="panel"><div className="heading-row"><h2>Purchase history</h2><button type="button" className="quiet-button" onClick={()=>job.run(load)} disabled={job.busy}>Refresh</button></div>{data?.orders.length===0&&<p>No orders for this account.</p>}{data&&<ul className="review-list">{data.orders.map(o=><li key={o.id}><p>{o.environment==='test'?'Test order (no real funds)':'Live order'} · {o.status.replaceAll('_',' ')}</p><h3>{(o.amountKobo/100).toLocaleString('en-NG',{style:'currency',currency:'NGN'})}</h3><p className="hint">Order ID: <code>{o.id}</code> · {new Date(o.createdAt).toLocaleDateString()}</p><p>{o.accessRecorded?'An active access record exists. Viewing permission is checked again when opening content.':'No active access record returned.'}</p><Link className="secondary-link" href={'/lessons/'+o.contentId}>Open content</Link></li>)}</ul>}{data?.truncated&&<p className="hint">Showing the latest 100 orders.</p>}<Feedback job={job}/></section></HostedGate>;
}
export function HostedCheckout({lessonId,mode='disabled',terms}){
 const account=useHostedAccount(),job=useJob(),key=useRef(''),[order,setOrder]=useState(null),[quote,setQuote]=useState(null),[accepted,setAccepted]=useState(false);
 async function getQuote(){setQuote(null);const r=await account.creatorRequest('checkoutQuote',{lessonId});if(r.currency!=='NGN'||!(r.accessAvailable===true&&r.priceKobo===null)&&(!Number.isSafeInteger(r.priceKobo)||r.priceKobo<20000))throw Error('INVALID_PRICE');setQuote(r);}
 return <section className="panel"><h2>Content access</h2>{mode==='disabled'?<p role="status">Checkout is not currently enabled.</p>:<>
 <p>{mode==='test'?'Test checkout. Do not enter real payment details.':'Live checkout for limited viewing access. The creator retains ownership.'}</p>
 <button type="button" className="secondary-link" disabled={job.busy||Boolean(order)} onClick={()=>job.run(getQuote)}>Check current access price</button>
 {quote?.accessAvailable?<p role="status">You already have viewing access. No checkout is needed.</p>:quote&&<p>Access price: <strong>{(quote.priceKobo/100).toLocaleString('en-NG',{style:'currency',currency:'NGN'})}</strong>. Confirm the final amount on Paystack.</p>}
 {mode==='live'&&terms&&<><details><summary>Purchase terms (version {terms.version})</summary><p className="purchase-terms">{terms.text}</p></details><label className="check-line"><input type="checkbox" checked={accepted} disabled={job.busy||Boolean(order)} onChange={e=>setAccepted(e.target.checked)}/>I have read and accept these purchase terms.</label></>}
 <button type="button" className="primary-link" disabled={job.busy||!quote||quote.accessAvailable===true||(mode==='live'&&(!terms||!accepted))||Boolean(order?.authorizationUrl)||order?.status==='paid'} onClick={()=>job.run(async()=>{key.current||=makeDraftKey();const r=readCheckoutResult(await account.creatorRequest(mode==='live'?'liveCheckout':'checkout',{lessonId,creationKey:key.current,termsVersion:terms?.version}));setOrder(r);})}>{mode==='live'?'Request secure checkout':'Request test checkout'}</button>
 {order&&<><p>Order ID: <code>{order.orderId}</code></p>{order.authorizationUrl?<a className="primary-link" href={order.authorizationUrl} rel="noreferrer" referrerPolicy="no-referrer">Continue to Paystack {mode==='test'?'test checkout':'checkout'}</a>:<p role="status">Server order status: {order.status}. This does not establish viewing permission.</p>}</>}
 <p className="hint">Browser payment results do not grant access. Check purchase history after returning from the provider.</p></>}
 <p><Link href="/purchases">View purchase history</Link></p><Feedback job={job}/></section>;
}

export function HostedEarnings(){
 const account=useHostedAccount(),job=useJob(),[data,setData]=useState(null),[amount,setAmount]=useState(''),key=useRef('');
 async function load(){const r=await account.creatorRequest('myPayouts',{});if(!r.balance||!Array.isArray(r.items)||['clearedKobo','reservedKobo','availableKobo'].some(k=>typeof r.balance[k]!=='string'||!(k==='clearedKobo'?/^-?\d+$/:/^\d+$/).test(r.balance[k])))throw Error('INVALID_BALANCE');setData(r);}
 const money=v=>{const n=BigInt(v),abs=n<0n?-n:n;return (n<0n?'-':'')+'₦'+(abs/100n).toLocaleString('en-NG')+'.'+String(abs%100n).padStart(2,'0');};
 useEffect(()=>{void job.run(load);},[account.session.userId]);
 return <section className="panel"><h2>Creator earnings</h2><button type="button" className="quiet-button" disabled={job.busy} onClick={()=>job.run(load)}>Refresh balance</button>{data&&<><dl><dt>Cleared earnings</dt><dd>{money(data.balance.clearedKobo)}</dd><dt>Reserved for payout</dt><dd>{money(data.balance.reservedKobo)}</dd><dt>Available to request</dt><dd>{money(data.balance.availableKobo)}</dd></dl><p className="hint">Requests reserve eligible earnings for review. They do not transfer money. Test funds are excluded.</p><form className="form-stack" onSubmit={e=>{e.preventDefault();job.run(async notice=>{if(!/^\d{1,8}$/.test(amount)||Number(amount)<1||BigInt(amount)*100n>BigInt(data.balance.availableKobo))throw Error('INVALID_AMOUNT');key.current||=makeDraftKey();const r=await account.creatorRequest('requestPayout',{amountKobo:Number(amount)*100,requestKey:key.current});if(!r.id||r.transferEnabled!==false)throw Error('UNCONFIRMED');setAmount('');key.current='';notice('Payout request recorded, not transferred.');await load();});}}><label htmlFor="withdraw-amount">Request amount (naira)</label><input id="withdraw-amount" value={amount} onChange={e=>{setAmount(e.target.value);key.current='';}} inputMode="numeric" required disabled={job.busy}/><button className="primary-link" disabled={job.busy||data.balance.availableKobo==='0'}>Request withdrawal</button></form><h3>Requests</h3>{data.items.length===0?<p>No requests.</p>:<ul>{data.items.map(x=><li key={x.id}>{money(x.amount_kobo)} · {x.state.replaceAll('_',' ')} {['pending_review','reserved'].includes(x.state)&&<button type="button" disabled={job.busy} onClick={()=>job.run(async notice=>{const r=await account.creatorRequest('cancelPayout',{requestId:x.id});if(r.state!=='cancelled')throw Error('UNCONFIRMED');notice('Request cancelled.');await load();})}>Cancel request</button>}</li>)}</ul>}</>}{!data&&!job.error&&<p role="status">Loading creator balance…</p>}<Feedback job={job}/></section>;
}
const SDK='https://cdn.jsdelivr.net/npm/livekit-client@2.25.0/dist/livekit-client.umd.min.js';
let sdkPromise;
function loadVerifiedSdk(integrity){
 if(!/^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(integrity||''))return Promise.reject(Error('LIVEKIT_SDK_UNAVAILABLE'));
 if(!sdkPromise)sdkPromise=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src=SDK;script.integrity=integrity;script.crossOrigin='anonymous';script.referrerPolicy='no-referrer';script.async=true;
  script.onload=()=>window.LivekitClient?.Room?resolve(window.LivekitClient):reject(Error('LIVEKIT_SDK_UNAVAILABLE'));
  script.onerror=()=>{script.remove();reject(Error('LIVEKIT_SDK_UNAVAILABLE'));};document.head.appendChild(script);
 }).catch(e=>{sdkPromise=null;throw e;});
 return sdkPromise;
}
export function HostedClassEntry({integrity,checkoutMode,terms}){
 const account=useHostedAccount();
 return <HostedGate title="Live classes"><ClassDirectory key={account.session.userId||'guest'} checkoutMode={checkoutMode} terms={terms}/></HostedGate>;
}
export function CommunityNightDirectory({session,checkoutMode,terms}){
 const account=useHostedAccount();
 if(!account)return <p className="hint">Night classes are not configured in local mode.</p>;
 if(account.session.state==='checking')return <p role="status">Checking your account…</p>;
 if(account.session.state==='unavailable')return <p>Sign in to access night classes. <Link href="/sign-in">Sign in</Link></p>;
 if(account.session.state!=='signed-in')return <p>Sign in to discover available sessions. <Link href="/sign-in">Sign in</Link></p>;
 return <ClassDirectory key={account.session.userId+':'+(session||'all')} checkoutMode={checkoutMode} terms={terms} availableOnly session={session}/>;
}
function ClassDirectory({checkoutMode,terms,availableOnly=false,session=null}){
 const account=useHostedAccount(),job=useJob(),[rows,setRows]=useState(null),[courses,setCourses]=useState([]),[creating,setCreating]=useState(false),key=useRef('');
 async function load(){const r=await account.creatorRequest(availableOnly?'availableClasses':'classes',session?{classId:session}:{});if(!Array.isArray(r))throw Error('INVALID_CLASSES');setRows(availableOnly?availableNightClasses(r).filter(x=>!session||x.id===session):r);}
 useEffect(()=>{void job.run(load);let active=true;fetch('/api/courses',{cache:'no-store',credentials:'same-origin'}).then(r=>r.json()).then(r=>{if(active&&Array.isArray(r.courses))setCourses(r.courses);}).catch(()=>{});return()=>{active=false;};},[]);
 async function action(op,id){await job.run(async notice=>{const r=await account.creatorRequest(op,{classId:id});if(r.id!==id)throw Error('UNCONFIRMED');notice('Server confirmed '+r.status.replaceAll('_',' ')+'.');await load();});}
 return <section className="panel"><div className="heading-row"><h2>{session?'Session details':availableOnly?'Available night classes':'Upcoming and previous classes'}</h2><button type="button" disabled={job.busy} onClick={()=>job.run(load)}>Refresh</button>{!session&&<button type="button" disabled={job.busy} onClick={()=>setCreating(x=>!x)}>{creating?'Close':'Schedule class'}</button>}</div>{creating&&<form className="form-stack" onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);job.run(async notice=>{key.current||=makeDraftKey();const r=await account.creatorRequest('createClass',{courseId:d.get('course'),title:d.get('title'),description:d.get('description'),startsAt:new Date(d.get('start')).toISOString(),endsAt:new Date(d.get('end')).toISOString(),capacity:Number(d.get('capacity')),creationKey:key.current,...(d.get('price')?{priceKobo:Number(d.get('price'))*100}:{})});if(r.status!=='scheduled')throw Error('UNCONFIRMED');key.current='';setCreating(false);notice('Class scheduled.');await load();});}}><label htmlFor="class-course">Course</label><select id="class-course" name="course" required><option value="">Choose course</option>{courses.map(c=><option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</select><label htmlFor="class-name">Class name</label><input id="class-name" name="title" required minLength={5} maxLength={120}/><label htmlFor="class-description">Description</label><textarea id="class-description" name="description" maxLength={1200}/><label htmlFor="class-start">Starts (local time)</label><input id="class-start" name="start" type="datetime-local" required/><label htmlFor="class-end">Ends (local time)</label><input id="class-end" name="end" type="datetime-local" required/><label htmlFor="class-capacity">Capacity</label><input id="class-capacity" name="capacity" type="number" min="1" max="50" defaultValue="12" required/><label htmlFor="class-price">Optional paid access (naira)</label><input id="class-price" name="price" type="number" min="200" max="10000000" step="1" placeholder="Free if blank"/><p className="hint">Leave the price empty for free access.</p><button className="primary-link" disabled={job.busy}>Schedule class</button></form>}
 {rows===null&&!job.error&&<p role="status">Loading classes…</p>}{rows?.length===0&&<p>{session?'This session is unavailable or has ended.':'No classes scheduled yet.'}</p>}{rows&&<ul className="lesson-list">{rows.map(c=><li key={c.id} className="lesson"><h3>{availableOnly&&!session?<Link href={sessionHref(c.id)}>{c.title}</Link>:c.title}</h3><p>{c.description}</p><p>{new Date(c.starts_at).toLocaleString()} · {c.status.replaceAll('_',' ')}</p><p>{c.price_kobo===0?'Free':(c.price_kobo/100).toLocaleString('en-NG',{style:'currency',currency:'NGN'})}</p><div className="button-row">{c.host_id===account.session.userId?(c.status==='scheduled'?<button disabled={job.busy} type="button" onClick={()=>action('openClass',c.id)}>Open class</button>:c.status==='room_open'?<button disabled={job.busy} type="button" onClick={()=>action('completeClass',c.id)}>Complete class</button>:null):c.status==='scheduled'&&c.price_kobo===0?<><button disabled={job.busy} type="button" onClick={()=>action('enrollClass',c.id)}>Enroll</button><button disabled={job.busy} type="button" onClick={()=>action('withdrawClass',c.id)}>Withdraw enrollment</button></>:null}{c.status==='room_open'&&<Link className="primary-link" href={'/classes/'+c.id+'/room'}>Enter class</Link>}</div>{c.host_id===account.session.userId&&['scheduled','room_open'].includes(c.status)&&<ClassHostActions item={c} onChange={load}/>}{c.host_id!==account.session.userId&&c.status==='scheduled'&&c.price_kobo>0&&<PaidClassCheckout item={c} mode={checkoutMode} terms={terms}/>}</li>)}</ul>}<Feedback job={job}/></section>;
}
export function HostedClassRoom({classId,integrity}){
 const account=useHostedAccount();
 return <HostedGate title="Class room"><LiveRoom key={(account?.session.userId||'guest')+classId} classId={classId} integrity={integrity}/></HostedGate>;
}
function LiveRoom({classId,integrity}){
 const account=useHostedAccount(),job=useJob(),room=useRef(null),tracks=useRef(null),generation=useRef(0),[state,setState]=useState('idle'),[role,setRole]=useState(null),[mic,setMic]=useState(false),[camera,setCamera]=useState(false),[share,setShare]=useState(false);
 function clear(){tracks.current?.replaceChildren();setRole(null);setMic(false);setCamera(false);setShare(false);setState('idle');}
 async function leave(){generation.current++;const r=room.current;room.current=null;try{await r?.disconnect();}finally{clear();}}
 useEffect(()=>()=>{generation.current++;const r=room.current;room.current=null;void r?.disconnect();},[]);
 async function connect(){await job.run(async()=>{
  const current=++generation.current;setState('connecting');let active;
  try{
   const sdk=await loadVerifiedSdk(integrity);if(current!==generation.current)return;
   const grant=readClassGrant(await account.creatorRequest('classGrant',{classId}),classId);
   if(current!==generation.current)return;
   active=new sdk.Room({adaptiveStream:true,dynacast:true,videoCaptureDefaults:{resolution:{width:640,height:360},frameRate:15}});
   room.current=active;
   active.on(sdk.RoomEvent.TrackSubscribed,track=>{if(generation.current!==current||!tracks.current)return;const el=track.attach();el.autoplay=true;el.playsInline=true;tracks.current.appendChild(el);});
   active.on(sdk.RoomEvent.TrackUnsubscribed,track=>{for(const el of track.detach())el.remove();});
   active.on(sdk.RoomEvent.Reconnecting,()=>{if(current===generation.current)setState('reconnecting');});
   active.on(sdk.RoomEvent.Reconnected,()=>{if(current===generation.current)setState('connected');});
   active.on(sdk.RoomEvent.Disconnected,()=>{if(current===generation.current){room.current=null;clear();}});
   await active.connect(grant.url,grant.token,{autoSubscribe:true});
   if(current!==generation.current){await active.disconnect();return;}setRole(grant.role);setState('connected');
  }catch(e){try{await active?.disconnect();}finally{if(current===generation.current){room.current=null;clear();}}throw e;}
 });}
 function toggle(kind){job.run(async()=>{const p=room.current?.localParticipant;if(!p||role!=='host')return;if(kind==='mic'){await p.setMicrophoneEnabled(!mic);setMic(!mic);}else if(kind==='camera'){await p.setCameraEnabled(!camera);setCamera(!camera);}else{await p.setScreenShareEnabled(!share);setShare(!share);}});}
 return <section className="course-section"><p role="status">Room: {state}</p><div className="button-row">{state==='idle'&&<button type="button" className="primary-link" disabled={job.busy||!classId||!integrity} onClick={connect}>Join live class</button>}{state!=='idle'&&<button type="button" className="secondary-link" onClick={()=>void leave()}>Leave class</button>}{state==='connected'&&<button type="button" className="quiet-button" disabled={job.busy} onClick={()=>job.run(async()=>{await room.current?.startAudio();})}>Enable sound</button>}</div>
 {state==='connected'&&role==='host'&&<div className="button-row"><button type="button" disabled={job.busy} onClick={()=>toggle('mic')}>{mic?'Mute microphone':'Enable microphone'}</button><button type="button" disabled={job.busy} onClick={()=>toggle('camera')}>{camera?'Disable camera':'Enable camera'}</button><button type="button" disabled={job.busy} onClick={()=>toggle('share')}>{share?'Stop screen share':'Share screen'}</button></div>}
 <div className="livekit-remote-tracks" ref={tracks} aria-label="Remote classroom media"/>{!integrity&&<p role="status">Live classes require the verified SDK integrity configuration.</p>}<Feedback job={job}/></section>;
}

function ClassHostActions({item,onChange}){
 const account=useHostedAccount(),job=useJob(),[rows,setRows]=useState(null),[reason,setReason]=useState(''),[target,setTarget]=useState('');
 return <details><summary>Manage class</summary><button type="button" disabled={job.busy} onClick={()=>job.run(async()=>{const r=await account.creatorRequest('classEnrollments',{classId:item.id});if(!Array.isArray(r))throw Error('INVALID_ROSTER');setRows(r);})}>Load enrollments</button>{rows&&<ul>{rows.map(x=><li key={x.student_id}>Student {x.student_id.slice(0,8)} · {x.state}{x.state==='enrolled'&&<button type="button" disabled={job.busy} onClick={()=>{setTarget(x.student_id);setReason('');}}>Remove</button>}</li>)}</ul>}
 <button type="button" disabled={job.busy} onClick={()=>{setTarget('cancel');setReason('');}}>Cancel class</button>{target&&<form className="form-stack" onSubmit={e=>{e.preventDefault();job.run(async notice=>{const r=await account.creatorRequest(target==='cancel'?'cancelClass':'removeClassParticipant',{classId:item.id,studentId:target,reason});if(r.id!==item.id)throw Error('UNCONFIRMED');setTarget('');setRows(null);notice('Request accepted: '+r.status.replaceAll('_',' ')+'.');await onChange();});}}><label htmlFor={'class-reason-'+item.id}>{target==='cancel'?'Reason for cancellation':'Reason for removal'}</label><textarea id={'class-reason-'+item.id} value={reason} onChange={e=>setReason(e.target.value)} minLength={8} maxLength={500} required/><button type="submit" disabled={job.busy}>Confirm {target==='cancel'?'cancellation':'removal'}</button><button type="button" onClick={()=>setTarget('')}>Back</button></form>}<Feedback job={job}/></details>;
}
function PaidClassCheckout({item,mode,terms}){
 const account=useHostedAccount(),job=useJob(),[accepted,setAccepted]=useState(false),[order,setOrder]=useState(null),key=useRef('');
 if(mode!=='live'||!terms)return <p className="hint">Paid enrollment is not currently available.</p>;
 return <div><details><summary>Enrollment terms</summary><p className="purchase-terms">{terms.text}</p></details><label className="check-line"><input type="checkbox" checked={accepted} disabled={Boolean(order)} onChange={e=>setAccepted(e.target.checked)}/>I accept these terms.</label><button type="button" className="primary-link" disabled={!accepted||job.busy||Boolean(order?.authorizationUrl)} onClick={()=>job.run(async()=>{key.current||=makeDraftKey();setOrder(readCheckoutResult(await account.creatorRequest('liveClassCheckout',{classId:item.id,creationKey:key.current,termsVersion:terms.version})));})}>Request paid enrollment</button>{order?.authorizationUrl?<a className="secondary-link" href={order.authorizationUrl} rel="noreferrer">Continue to secure checkout</a>:order&&<p role="status">Order {order.status}. Enrollment is confirmed only by the server.</p>}<Feedback job={job}/></div>;
}
