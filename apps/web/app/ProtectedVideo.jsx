'use client';
import {useState} from 'react';
import {api,friendlyError} from '../lib/local-client.js';

/** No bearer token is exposed in JavaScript or in video URLs.
 *  A same-origin POST creates a five-minute lesson-scoped HttpOnly cookie. */
export default function ProtectedVideo({lessonId,label}){
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function enable(){
    setBusy(true);setError('');setReady(false);
    try{
      await api(`lessons/${lessonId}/playback-grant`,{method:'POST',body:{}});
      setReady(true);
    }catch(cause){setError(friendlyError(cause));}
    finally{setBusy(false);}
  }
  return <div>
    {ready?<video controls playsInline preload="none" aria-label={label}
      src={`/api/local/lessons/${lessonId}/video`}
      onError={()=>{setReady(false);setError('Playback failed or video access expired. Try enabling playback again.');}}>
      Your browser cannot play this video.
    </video>:<button type="button" className="creator-btn outlined" onClick={enable} disabled={busy}>
      {busy?'Checking access…':'Enable playback'}
    </button>}
    {error&&<p className="hint" role="alert">{error}</p>}
    {ready&&<button type="button" className="quiet-button" onClick={enable} disabled={busy}>Renew video access</button>}
  </div>;
}
