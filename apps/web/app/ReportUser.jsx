'use client';
import {useId,useState} from 'react';
import {api,friendlyError} from '../lib/local-client.js';
export default function ReportUser({userId}){
 const id=useId(),[open,setOpen]=useState(false),[category,setCategory]=useState('harassment'),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 async function submit(e){e.preventDefault();setBusy(true);setNotice('');try{await api('users/'+userId+'/report',{method:'POST',body:{category,reason}});setOpen(false);setReason('');setNotice('Account report submitted for independent review.');}catch(error){setNotice(friendlyError(error));}finally{setBusy(false);}}
 return <div><button type="button" className="quiet-button" disabled={busy} onClick={()=>{setOpen(v=>!v);setNotice('');}}>Report account</button>{open&&<form className="form-stack" onSubmit={submit}><label htmlFor={id+'-category'}>Report category</label><select id={id+'-category'} value={category} onChange={e=>setCategory(e.target.value)}><option value="harassment">Harassment</option><option value="impersonation">Impersonation</option><option value="spam">Spam</option><option value="other">Other</option></select><label htmlFor={id+'-reason'}>Explain what happened</label><textarea required id={id+'-reason'} minLength={10} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/><button type="submit" className="secondary-link" disabled={busy||reason.trim().length<10}>Send report</button></form>}{notice&&<p role="status">{notice}</p>}</div>;
}
