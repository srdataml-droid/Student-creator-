'use client';
import {useEffect,useRef,useState} from 'react';
import {useHostedAccount} from './HostedAccountProvider.jsx';
export default function AccountRequests({type}){
 const a=useHostedAccount(),lock=useRef(false),[rows,setRows]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const privacy=type==='privacy',list=privacy?'privacyRequests':'institutionAppeals',submit=privacy?'submitPrivacyRequest':'submitInstitutionAppeal';
 async function run(fn){if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e.status===409?'A request is already open. Review its status before submitting again.':e.status===403?'Your account is not eligible for this request.':'Request status unavailable. Refresh and retry.');}finally{lock.current=false;setBusy(false);}}
 async function load(){const r=await a.creatorRequest(list,{});if(!Array.isArray(r))throw Error('INVALID_REQUESTS');setRows(r);}
 useEffect(()=>{void run(load);},[type]);
 return <section className="panel"><div className="heading-row"><h2>{privacy?'Privacy requests':'Verification appeals'}</h2><button type="button" className="quiet-button" disabled={busy} onClick={()=>run(load)}>Refresh</button></div>
 <p className="hint">{privacy?'Submit an account data request for review. This does not automatically delete, export or change your data.':'An appeal requests a manual review; it does not grant student eligibility.'}</p>
 {rows?.length===0&&<p>No previous requests.</p>}{rows&&<ul className="lesson-list">{rows.map(x=><li key={x.id}><strong>{privacy?x.kind:'Appeal'}</strong> · {x.status.replaceAll('_',' ')}<p>{new Date(x.created_at).toLocaleDateString()}</p>{x.review_note&&<p>{x.review_note}</p>}</li>)}</ul>}
 {(privacy||!a.accountState?.student)&&<form className="form-stack" onSubmit={e=>{e.preventDefault();const form=e.currentTarget,d=new FormData(form);run(async()=>{const result=await a.creatorRequest(submit,{...(privacy?{kind:d.get('kind')}:{}),reason:d.get('reason')});if(!result.id)throw Error('UNCONFIRMED');form.reset();setNotice('Request recorded for review.');await load();});}}>{privacy&&<><label htmlFor="privacy-kind">Request type</label><select id="privacy-kind" name="kind" required defaultValue=""><option value="">Choose type</option><option value="access">Access my data</option><option value="correction">Correct my data</option><option value="erasure">Request erasure</option><option value="restriction">Restrict processing</option><option value="portability">Data portability</option></select></>}
 <label htmlFor={type+'-reason'}>Reason</label><textarea id={type+'-reason'} name="reason" minLength={20} maxLength={privacy?1000:800} required disabled={busy}/><p className="hint">Do not include passwords, payment credentials or identity-document numbers.</p><button className="primary-link" disabled={busy}>Submit request</button></form>}
 {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}</section>;
}
