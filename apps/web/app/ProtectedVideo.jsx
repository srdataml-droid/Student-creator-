'use client';
import {useState,useEffect,useRef,useCallback} from 'react';
import {api,friendlyError} from '../lib/local-client.js';

/**
 * The media endpoint, not this UI, decides who may watch. Every new grant
 * rechecks current verification, creator blocks and payment entitlement.
 * Watermark overlays deter casual copying; they are not DRM.
 */
export default function ProtectedVideo({lessonId,label,hasCaptions=false}){
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [watermark,setWatermark]=useState(null),[position,setPosition]=useState(0);
  const [expiresAtMs,setExpiresAtMs]=useState(null);
  const frame=useRef(null),videoRef=useRef(null);
  const resumeAt=useRef(0),resumePlaying=useRef(false),inFlight=useRef(null);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);

  const authorize=useCallback(async()=>{
    if(inFlight.current)return inFlight.current;
    const v=videoRef.current;
    // Snapshot continuously, and again immediately before a refresh. Never
    // unmount a working <video> just to replace its HttpOnly grant cookie.
    if(v&&Number.isFinite(v.currentTime)){
      resumeAt.current=Math.max(0,v.currentTime);
      resumePlaying.current=!v.paused&&!v.ended;
    }
    const task=(async()=>{
      setBusy(true);setError('');
      try{
        const grant=await api(`lessons/${lessonId}/playback-grant`,{method:'POST',body:{}});
        if(!alive.current)return;
        if(!Number.isSafeInteger(grant.expiresAt)||grant.expiresAt*1000<=Date.now())
          throw Error('INVALID_GRANT_EXPIRATION');
        setExpiresAtMs(grant.expiresAt*1000);
        setWatermark(grant.watermark);setPosition(0);
        // For a manual renewal the existing player and its position survive.
        // A failed media element can be recreated by re-enabling playback.
        if(v?.error){setReady(false);}
        else setReady(true);
      }catch(cause){
        if(!alive.current)return;
        setError(friendlyError(cause));
        // An explicit revocation must stop the UI immediately. Temporary
        // connectivity failures do not discard a currently buffered video.
        if(/AUTH_REQUIRED|VERIFICATION_REQUIRED|PURCHASE_REQUIRED|CREATOR_ACCESS_RESTRICTED|PLAYBACK_GRANT_LIMIT|FORBIDDEN/.test(String(cause?.message)))
          setReady(false);
      }finally{
        if(alive.current)setBusy(false);
      }
    })();
    inFlight.current=task;
    try{return await task;}finally{if(inFlight.current===task)inFlight.current=null;}
  },[lessonId]);

  // Renew shortly before expiration while keeping the video element alive.
  // Uses only a small POST; media continues to have preload=none for data saving.
  useEffect(()=>{
    if(!ready||!expiresAtMs)return;
    const delay=Math.max(1000,expiresAtMs-Date.now()-45000);
    const timer=setTimeout(()=>{void authorize();},delay);
    return ()=>clearTimeout(timer);
  },[ready,expiresAtMs,authorize]);

  useEffect(()=>{
    if(!ready||!watermark)return;
    const timer=setInterval(()=>setPosition(p=>(p+1)%4),watermark.intervalSeconds*1000);
    return ()=>clearInterval(timer);
  },[ready,watermark]);

  // A media fetch can fail after grant expiry or network interruption. Capture
  // playback position and require another server-authorized grant; never
  // automatically bypass a block/refund just because bytes were once buffered.
  function onMediaError(event){
    const v=event.currentTarget;
    if(Number.isFinite(v.currentTime))resumeAt.current=Math.max(0,v.currentTime);
    resumePlaying.current=!v.paused&&!v.ended;
    setReady(false);
    setError('Video decoding or access failed. Renew authorization to retry from your previous position.');
  }

  function restorePosition(event){
    const v=event.currentTarget;
    const saved=resumeAt.current;
    if(!Number.isFinite(saved)||saved<=0)return;
    if(Number.isFinite(v.duration)&&v.duration>0){
      try{v.currentTime=Math.min(saved,Math.max(0,v.duration-0.05));}catch{}
    }
    if(resumePlaying.current){
      resumePlaying.current=false;
      // Autoplay can be blocked by the browser; a manual play button remains.
      void v.play().catch(()=>{});
    }
  }

  async function fullscreen(){
    try{await frame.current?.requestFullscreen();}
    catch{setError('Fullscreen is unavailable in this browser. Continue watching here.');}
  }

  return <div>
    {ready?<div className="protected-video-frame" ref={frame}>
      <video ref={videoRef} controls playsInline preload="none" aria-label={label}
        controlsList="nofullscreen" disablePictureInPicture
        src={`/api/local/lessons/${lessonId}/video`}
        onError={onMediaError}
        onTimeUpdate={event=>{if(Number.isFinite(event.currentTarget.currentTime))resumeAt.current=event.currentTarget.currentTime;}}
        onLoadedMetadata={restorePosition}
        onPlay={()=>{if(expiresAtMs&&expiresAtMs<=Date.now()+20000)void authorize();}}>
        {hasCaptions&&<track kind="captions" srcLang="en" label="English captions" src={`/api/local/lessons/${lessonId}/video/captions`} default/>}
        Your browser cannot play this video.
      </video>
      {watermark&&<span className={`playback-watermark position-${position}`} data-testid="playback-watermark" data-position={position} aria-hidden="true">{watermark.label}</span>}
      <button type="button" className="quiet-button video-fullscreen" onClick={fullscreen}>Fullscreen</button>
    </div>:<button type="button" className="creator-btn outlined" onClick={()=>void authorize()} disabled={busy}>
      {busy?'Checking access…':'Enable playback'}
    </button>}
    {error&&<p className="hint" role="alert">{error}</p>}
    {ready&&<button type="button" className="quiet-button" onClick={()=>void authorize()} disabled={busy}>
      {busy?'Renewing access…':'Renew video access'}
    </button>}
  </div>;
}
