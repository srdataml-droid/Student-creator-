'use client';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../lib/local-client.js';

const EMPTY={view:false,comment:false,message:false};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/** Local alpha creator controls; the server, not the checkboxes, enforces restrictions. */
export default function CreatorRestrictions({creatorId,inbox=[]}){
  const [viewerId,setViewerId]=useState('');
  const [rules,setRules]=useState(EMPTY);
  const [saved,setSaved]=useState([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  useEffect(()=>{
    let active=true;
    setLoading(true);
    api(`creators/${creatorId}/restrictions`).then(({restrictions})=>{
      if(active)setSaved(restrictions||[]);
    }).catch(err=>{if(active)setError(friendlyError(err));})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[creatorId]);

  async function save(e){
    e.preventDefault();
    setError('');setNotice('');
    const id=viewerId.trim().toLowerCase();
    if(!UUID.test(id)){setError('Enter a valid student account reference.');return;}
    if(id===creatorId){setError('You cannot restrict your own account.');return;}
    setBusy(true);
    try{
      await api(`creators/${creatorId}/restrictions/${id}`,{method:'POST',body:rules});
      const {restrictions}=await api(`creators/${creatorId}/restrictions`);
      setSaved(restrictions||[]);
      setNotice('Creator permissions saved for this account.');
    }catch(err){setError(friendlyError(err));}
    finally{setBusy(false);}
  }
  function select(entry){
    setViewerId(entry.viewerId);
    setRules({view:entry.view,comment:entry.comment,message:entry.message});
    setError('');setNotice('');
  }
  return <section className="panel" aria-labelledby="creator-safety-title">
    <h2 id="creator-safety-title">Creator safety controls</h2>
    <p className="hint">Restrict a verified student independently from watching your full work, commenting, or sending you direct messages. Public previews may still be discoverable. Existing conversations and reports are preserved.</p>
    <form className="form-stack" onSubmit={save}>
      <label htmlFor="restriction-viewer">Student account reference</label>
      <input id="restriction-viewer" value={viewerId} onChange={e=>{setViewerId(e.target.value);setNotice('');}}
        placeholder="Paste the student account ID" required autoComplete="off" spellCheck={false}
        aria-describedby="restriction-help" list="creator-recent-contacts" />
      <datalist id="creator-recent-contacts">{inbox.filter(x=>UUID.test(x.peerId)).map(x=><option key={x.peerId} value={x.peerId}/>)}</datalist>
      <p className="hint" id="restriction-help">Select an account from a recent conversation or enter a student reference. Do not enter school ID card numbers.</p>
      <label className="check-line"><input type="checkbox" checked={rules.view} onChange={e=>setRules(v=>({...v,view:e.target.checked}))}/><span>Prevent full post and video viewing</span></label>
      <label className="check-line"><input type="checkbox" checked={rules.comment} onChange={e=>setRules(v=>({...v,comment:e.target.checked}))}/><span>Prevent new comments</span></label>
      <label className="check-line"><input type="checkbox" checked={rules.message} onChange={e=>setRules(v=>({...v,message:e.target.checked}))}/><span>Prevent direct messages</span></label>
      {error&&<p className="form-error" role="alert">{error}</p>}
      {notice&&<p className="form-success" role="status">{notice}</p>}
      <button type="submit" className="secondary-link" disabled={busy}>{busy?'Saving permissions…':'Save account restrictions'}</button>
    </form>
    <h3>Restricted accounts</h3>
    {loading?<p role="status" className="hint">Loading saved controls…</p>:saved.length?<ul className="review-list">{saved.map(entry=><li key={entry.viewerId}>
      <span className="hint">Account {entry.viewerId.slice(0,8)}…</span>
      <p className="hint">{[entry.view?'Viewing':'',entry.comment?'Comments':'',entry.message?'Messages':''].filter(Boolean).join(' · ')}</p>
      <button type="button" className="quiet-button" disabled={busy} onClick={()=>select(entry)}>Edit permissions</button>
    </li>)}</ul>:<p className="hint">No account-specific restrictions saved.</p>}
    <p className="hint">To unblock an account, open its permissions, clear all three checkboxes and save. A paid buyer's refund or appeal must be reviewed separately; payments are not enabled in this local alpha.</p>
  </section>;
}
