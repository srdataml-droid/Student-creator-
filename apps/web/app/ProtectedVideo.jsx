'use client';
import {useState,useEffect,useRef} from 'react';
import {api,friendlyError} from '../lib/local-client.js';

/** Session cookies authorize bytes; a removable overlay only discourages capture.
 * No browser API can reliably prevent screenshots or an external camera. */
export default function ProtectedVideo({lessonId,label}){
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [watermark,setWatermark]=useState(null),[position,setPosition]=useState(0);
  const frame=useRef(null);
  useEffect(()=>{
    if(!ready||!watermark)return;
    const timer=setInterval(()=>setPosition(p=>(p+1)%4),watermark.intervalSeconds*1000);
    return ()=>clearInterval(timer);
  },[ready,watermark]);
  async function enable(){
    setBusy(true);setError('');setReady(false);
    try{
      const grant=await api(`lessons/${lessonId}/playback-grant`,{method:'POST',body:{}});
      setWatermark(grant.watermark);setPosition(0);setReady(true);
    }catch(cause){setError(friendlyError(cause));}
    finally{setBusy(false);}
  }
  async function fullscreen(){
    try{await frame.current?.requestFullscreen();}
    catch{setError('Fullscreen is unavailable in this browser. Continue watching here.');}
  }
  return <div>
    {ready?<div className="protected-video-frame" ref={frame}>
      <video controls playsInline preload="none" aria-label={label}
        controlsList="nofullscreen" disablePictureInPicture
        src={`/api/local/lessons/${lessonId}/video`}
        onError={()=>{setReady(false);setError('Playback failed or video access expired. Try enabling playback again.');}}>
        Your browser cannot play this video.
      </video>
      {watermark&&<span className={`playback-watermark position-${position}`} data-testid="playback-watermark" data-position={position} aria-hidden="true">{watermark.label}</span>}
      <button type="button" className="quiet-button video-fullscreen" onClick={fullscreen}>Fullscreen</button>
    </div>:<button type="button" className="creator-btn outlined" onClick={enable} disabled={busy}>
      {busy?'Checking access…':'Enable playback'}
    </button>}
    {error&&<p className="hint" role="alert">{error}</p>}
    {ready&&<button type="button" className="quiet-button" onClick={enable} disabled={busy}>Renew video access</button>}
  </div>;
}
