'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {useHostedAccount} from './HostedAccountProvider.jsx';
export default function HostedCreatorActions({creatorId}){
 const a=useHostedAccount(),[following,setFollowing]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),lock=useRef(false);
 useEffect(()=>{let active=true;setFollowing(null);if(a?.session.state==='signed-in'&&a.session.userId!==creatorId)a.creatorRequest('isFollowing',{creatorId}).then(r=>{if(!Array.isArray(r))throw Error();if(active)setFollowing(r.some(x=>x.creator_id===creatorId));}).catch(()=>{if(active)setError('Following status unavailable.');});return()=>{active=false;};},[creatorId,a?.session.userId,a?.session.state]);
 if(!a||a.session.state!=='signed-in')return <Link className="primary-link" href="/sign-in">Sign in to follow</Link>;
 if(a.session.userId===creatorId)return <Link className="primary-link" href="/studio">Edit your profile</Link>;
 return <div className="button-row"><button className="secondary-link" type="button" disabled={following===null||busy} aria-pressed={following===true} onClick={async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const expected=!following,r=await a.creatorRequest(expected?'follow':'unfollow',{creatorId});if(r.following!==expected)throw Error();setFollowing(expected);}catch{setError('Could not confirm follow status.');}finally{lock.current=false;setBusy(false);}}}>{following?'Unfollow':'Follow'}</button><Link className="secondary-link" href={'/messages/'+creatorId}>Message</Link>{error&&<p role="alert">{error}</p>}</div>;
}
