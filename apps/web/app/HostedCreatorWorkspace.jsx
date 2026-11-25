'use client';
import HostedGate from './HostedGate.jsx';
import {ReviewSubmission} from './HostedSocialWorkspace.jsx';
import {useRef,useState} from 'react';
import {makeDraftKey} from '../lib/studio-workflow.mjs';
import {readMuxStatus,putMuxVideo} from '../lib/hosted-creator-client.mjs';
import {useHostedAccount} from './HostedAccountProvider.jsx';
const errorText=e=>e.status===401?'Sign in again to continue.':e.status===403?'Your account does not have permission for this action.':e.status===404?'The requested record or service is unavailable.':e.status===429?'Too many attempts. Try later.':e.status===409?'This request conflicts with a saved record. Do not repeat with different evidence.':e.message==='INVALID_IDENTITY_FILE'?'Choose a JPEG, PNG or PDF of 8 bytes to 4 MiB.':e.message==='INVALID_VIDEO_FILE'?'Choose a nonempty MP4 up to 100 MiB.':e.message==='INVALID_ID'?'Enter a valid record ID.':'The request could not be confirmed. Check the details and service availability.';

function useAction(){
 const lock=useRef(false);const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function run(fn){if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await fn(setNotice);}catch(e){setError(errorText(e));}finally{lock.current=false;setBusy(false);}}
 return {busy,error,notice,run};
}
function Feedback({action}){return <>{action.error&&<p role="alert" className="form-error">{action.error}</p>}{action.notice&&<p role="status" className="form-success">{action.notice}</p>}</>;}
export function HostedIdentity(){
 const account=useHostedAccount(),action=useAction();const [received,setReceived]=useState(false);
 return <HostedGate title="Student verification"><section className="panel"><h2>Private student ID evidence</h2><p className="hint">Use only a pending verification request issued by an authorized reviewer. The service must be enabled for the approved pilot. Receipt is not approval. Do not submit real documents in an unapproved test environment.</p>
 {received?<p role="status">Evidence received for scanning and manual review. Verification status has not been confirmed.</p>:<form className="form-stack" onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);action.run(async()=>{const out=await account.creatorRequest('identity',{requestId:String(d.get('requestId')).trim(),file:d.get('evidence')});if(out.received!==true)throw Error('UNCONFIRMED');setReceived(true);});}}>
 <label htmlFor="request-id">Verification request ID</label><input id="request-id" name="requestId" required maxLength={36} autoComplete="off"/>
 <label htmlFor="identity-evidence">Student ID evidence (JPEG, PNG, PDF; max 4 MiB)</label><input id="identity-evidence" name="evidence" type="file" accept="image/jpeg,image/png,application/pdf" required disabled={action.busy}/>
 <button className="primary-link" disabled={action.busy}>{action.busy?'Uploading…':'Submit evidence privately'}</button></form>}<Feedback action={action}/><p className="hint">A reviewer must create the request and confirm its outcome. This screen cannot create a request or read its review status yet.</p></section></HostedGate>;
}
export function HostedCreatorStudio({courses=[],catalogAvailable}){
 const account=useHostedAccount(),action=useAction(),draftKey=useRef('');
 const [draft,setDraft]=useState(null),[lessonId,setLessonId]=useState('');
 return <HostedGate title="Creator studio"><section className="panel"><h2>Create a draft</h2>
 {!catalogAvailable?<p role="alert">The course catalog is unavailable.</p>:!courses.length?<p role="status">No courses are available yet.</p>:<form className="form-stack" onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);action.run(async notice=>{draftKey.current||=makeDraftKey();const out=await account.creatorRequest('draft',{courseId:d.get('courseId'),title:d.get('title'),description:d.get('description'),previewText:d.get('previewText'),rightsAttested:d.get('rights')==='on',creationKey:draftKey.current});if(!out.draft?.id||typeof out.draft.title!=='string')throw Error('UNCONFIRMED');setDraft(out.draft);setLessonId(out.draft.id);draftKey.current='';notice('Private metadata draft saved.');});}}>
 <label htmlFor="hosted-course">Course</label><select id="hosted-course" name="courseId" required disabled={action.busy}><option value="">Select course</option>{courses.map(c=><option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}</select>
 <label htmlFor="hosted-title">Title</label><input id="hosted-title" name="title" minLength={3} maxLength={160} required disabled={action.busy}/>
 <label htmlFor="hosted-description">Description</label><textarea id="hosted-description" name="description" maxLength={2500} rows={3} disabled={action.busy}/>
 <label htmlFor="hosted-preview">Public preview</label><textarea id="hosted-preview" name="previewText" maxLength={800} rows={3} disabled={action.busy}/>
 <label className="check-line"><input name="rights" type="checkbox" required disabled={action.busy}/>I own or have permission to publish this material.</label>
 <button className="primary-link" disabled={action.busy}>{action.busy?'Saving…':'Save private draft'}</button></form>}
 <Feedback action={action}/>{draft&&<div><h3>{draft.title}</h3><p>Draft ID: <code>{draft.id}</code></p><p className="hint">Keep this ID to reopen upload status. A hosted draft list is not yet connected.</p></div>}</section>
 <MuxUpload key={draft?.id||'manual'} lessonId={lessonId} setLessonId={setLessonId}/><ReviewSubmission key={lessonId} lessonId={lessonId.trim()}/><HostedPrivacy/></HostedGate>;
}
function MuxUpload({lessonId,setLessonId}){
 const account=useHostedAccount(),action=useAction();const [state,setState]=useState(null),[file,setFile]=useState(null);const fileRef=useRef(null);
 function changeId(v){setLessonId(v);setState(null);setFile(null);if(fileRef.current)fileRef.current.value='';}
 async function status(operation){action.run(async()=>{const row=readMuxStatus(await account.creatorRequest(operation,{lessonId:lessonId.trim()}));setState({id:row.id,state:row.state});});}
 return <section className="panel"><h2>Video upload</h2><p className="hint">Private test video only. Upload processing does not publish content or establish viewing access.</p>
 <label htmlFor="mux-lesson">Your draft ID</label><input id="mux-lesson" value={lessonId} onChange={e=>changeId(e.target.value)} disabled={action.busy} maxLength={36}/>
 <div className="button-row"><button type="button" className="secondary-link" disabled={action.busy||!lessonId} onClick={()=>status('muxStatus')}>Check status</button><button type="button" className="secondary-link" disabled={action.busy||!lessonId||Boolean(state)} onClick={()=>status('muxReserve')}>Prepare upload</button></div>
 {state&&<p role="status">Provider status: {state.state}</p>}
 {state?.state==='waiting'&&<form className="form-stack" onSubmit={e=>{e.preventDefault();action.run(async notice=>{const row=readMuxStatus(await account.creatorRequest('muxStatus',{lessonId:lessonId.trim()}));setState({id:row.id,state:row.state});if(row.state!=='waiting'||!row.uploadUrl)throw Error('UNAVAILABLE');await putMuxVideo({url:row.uploadUrl,file});setFile(null);if(fileRef.current)fileRef.current.value='';setState({id:row.id,state:'transfer received; check provider status'});notice('Transfer received. Check status to verify processing.');});}}>
 <label htmlFor="mux-file">Original MP4 (up to 100 MiB)</label><input id="mux-file" ref={fileRef} type="file" accept="video/mp4,.mp4" required disabled={action.busy} onChange={e=>setFile(e.target.files?.[0]||null)}/><button className="primary-link" disabled={action.busy||!file}>{action.busy?'Transferring…':'Upload video'}</button></form>}
 <Feedback action={action}/><p className="hint">If transfer status is uncertain, check status before attempting another upload. Thumbnail and publication controls are not connected.</p></section>;
}
function HostedPrivacy(){
 const account=useHostedAccount(),action=useAction();const [rows,setRows]=useState(null),[preference,setPreference]=useState(null);
 async function load(){action.run(async()=>{const [r,p]=await Promise.all([account.creatorRequest('restrictions'),account.creatorRequest('messagePreference')]);if(!Array.isArray(r)||!Array.isArray(p))throw Error('INVALID_RESPONSE');setRows(r);setPreference(typeof p[0]?.allow_messages==='boolean'?p[0].allow_messages:null);});}
 return <section className="panel"><h2>Creator privacy</h2><p className="hint">Control which verified accounts may view, comment or contact you. Public profile editing is not connected to hosted storage yet.</p>
 <button type="button" className="secondary-link" disabled={action.busy} onClick={load}>Load privacy settings</button>
 {rows!==null&&<><h3>Current restrictions</h3>{!rows.length?<p>No restrictions returned.</p>:<ul>{rows.map(r=><li key={r.viewer_id}><code>{r.viewer_id}</code> · {['view','comment','message'].filter(k=>r['deny_'+k]===true).join(', ')||'No restriction'}</li>)}</ul>}
 <form className="form-stack" onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);action.run(async notice=>{await account.creatorRequest('setRestrictions',{viewerId:String(d.get('viewerId')).trim(),view:d.get('view')==='deny',comment:d.get('comment')==='deny',message:d.get('message')==='deny'});setRows(null);notice('Restriction request accepted. Reload settings to verify the saved state.');});}}>
 <label htmlFor="privacy-viewer">Viewer account ID</label><input id="privacy-viewer" name="viewerId" required maxLength={36}/>
 {['view','comment','message'].map(k=><label key={k}>{k}<select name={k} required defaultValue=""><option value="" disabled>Choose permission</option><option value="allow">Allow</option><option value="deny">Restrict</option></select></label>)}<button className="primary-link" disabled={action.busy}>Save restrictions</button></form></>}
 {preference!==null&&<><p>New messages: {preference?'Allowed':'Restricted'}</p><button className="secondary-link" disabled={action.busy} type="button" onClick={()=>action.run(async notice=>{await account.creatorRequest('setMessagePreference',{allowMessages:!preference});setPreference(null);notice('Preference request accepted. Reload settings to verify.');})}>{preference?'Restrict new messages':'Allow new messages'}</button></>}
 <Feedback action={action}/></section>;
}
