'use client';
import {useEffect,useState} from 'react';
import {api,friendlyError} from '../../../lib/local-client.js';
export default function FollowButton({creatorId,initialFollowers=0}){
 const [following,setFollowing]=useState(false);
 const [count,setCount]=useState(initialFollowers);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{
   let cancelled=false;
   api(`creators/${creatorId}/follow`).then(x=>{if(!cancelled)setFollowing(Boolean(x.following));}).catch(()=>{});
   return ()=>{cancelled=true;};
 },[creatorId]);
 async function toggle(){
   setBusy(true);setError('');
   try{
    const target=following?'unfollow':'follow';
    const r=await api(`creators/${creatorId}/${target}`,{method:'POST',body:{}});
    if(r.follow.following!==following){
      setFollowing(r.follow.following);
      setCount(n=>Math.max(0,n+(r.follow.following?1:-1)));
    }
   }catch(err){setError(friendlyError(err));}
   finally{setBusy(false);}
 }
 return <div className="follow-box"><button type="button" className={following?'follow-button following':'follow-button'} onClick={toggle} disabled={busy} aria-pressed={following}>{busy?'Updating…':following?'✓ Following':'+ Follow creator'}</button>{error&&<span className="follow-error" role="alert">{error}</span>}</div>;
}