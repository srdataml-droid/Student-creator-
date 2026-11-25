'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {useParams} from 'next/navigation';
import {api,friendlyError} from '../../../../lib/local-client.js';

// LiveKit's documented UMD browser build, pinned to an exact public Apache-2.0 release.
// Pilot integration only; vendor a lockfile-backed build and audit CSP/SRI before production.
const SDK='https://cdn.jsdelivr.net/npm/livekit-client@2.25.0/dist/livekit-client.umd.min.js';
let sdkPromise=null;
function loadSdk(){
  if(typeof window==='undefined')return Promise.reject(Error('BROWSER_REQUIRED'));
  if(window.LivekitClient?.Room)return Promise.resolve(window.LivekitClient);
  if(sdkPromise)return sdkPromise;
  sdkPromise=new Promise((resolve,reject)=>{
    const tag=document.createElement('script');
    tag.src=SDK;tag.async=true;tag.crossOrigin='anonymous';tag.referrerPolicy='no-referrer';
    tag.dataset.studentCreatorsLivekit='2.25.0';
    tag.onload=()=>window.LivekitClient?.Room?resolve(window.LivekitClient):reject(Error('LIVEKIT_CLIENT_UNAVAILABLE'));
    tag.onerror=()=>reject(Error('LIVEKIT_CLIENT_UNAVAILABLE'));
    document.head.appendChild(tag);
  }).catch(error=>{sdkPromise=null;throw error;});
  return sdkPromise;
}
const time=s=>new Date(s).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});

export default function ClassRoom(){
 const {classId}=useParams();
 const [details,setDetails]=useState(null),[me,setMe]=useState(null),[state,setState]=useState('loading'),[busy,setBusy]=useState(false);
 const [message,setMessage]=useState(''),[error,setError]=useState('');
 const [role,setRole]=useState(null),[camera,setCamera]=useState(false),[mic,setMic]=useState(false),[share,setShare]=useState(false);
 const [remoteCount,setRemoteCount]=useState(0);
 const [attendance,setAttendance]=useState([]),[removeReasons,setRemoveReasons]=useState({});
 const mediaRef=useRef(null),roomRef=useRef(null),mounted=useRef(true);
 useEffect(()=>{
   mounted.current=true;
   Promise.all([api('classes/'+classId),api('me')]).then(([detail,account])=>{
     if(!mounted.current)return;
     setDetails(detail.class);setMe(account.user);setState('idle');
   }).catch(e=>{if(mounted.current){setState('failed');setError(friendlyError(e));}});
   return()=>{
     mounted.current=false;
     const room=roomRef.current;roomRef.current=null;
     try{room?.disconnect();}catch{}
     if(mediaRef.current)mediaRef.current.replaceChildren();
   };
 },[classId]);
 async function refreshAttendance(){
   try{const result=await api('classes/'+classId+'/attendance');setAttendance(result.attendance||[]);}
   catch(e){setError(friendlyError(e));}
 }
 async function removeAttendee(studentId){
   const reason=(removeReasons[studentId]||'').trim();
   if(reason.length<8){setError('Add a reason of at least eight characters.');return;}
   setBusy(true);setError('');
   try{
     const response=await api('classes/'+classId+'/remove-participant',{method:'POST',body:{studentId,reason}});
     setMessage(response.removal?.providerRemoved?'Participant removed from the live room.':'Participant access revoked; provider disconnection is queued for retry.');
     await refreshAttendance();
   }catch(e){setError(friendlyError(e));}
   finally{setBusy(false);}
 }
 function leave(){
   const room=roomRef.current;roomRef.current=null;
   if(room)room.disconnect();
   mediaRef.current?.replaceChildren();
   setRemoteCount(0);setCamera(false);setMic(false);setShare(false);setRole(null);setState('idle');
   setMessage('You left the class. Rejoining will request a fresh permission check.');
 }
 async function connect(){
   if(busy||roomRef.current)return;
   setBusy(true);setError('');setMessage('');
   let room=null;
   try{
     // The backend re-evaluates current enrollment, verification, host/participant
     // permissions, cancellation, schedule and active paid entitlement on EVERY connect.
     const grant=(await api('classes/'+classId+'/room-token',{method:'POST',body:{}})).room;
     if(!grant?.url||!grant?.token||!['host','participant'].includes(grant.role))
       throw Error('LIVEKIT_NOT_CONFIGURED');
     const livekit=await loadSdk();
     room=new livekit.Room({adaptiveStream:true,dynacast:true,
       videoCaptureDefaults:{resolution:{width:640,height:360},frameRate:15}});
     room.on(livekit.RoomEvent.TrackSubscribed,(track)=>{
       if(!mounted.current||!mediaRef.current)return;
       if(track.kind===livekit.Track.Kind.Video||track.kind===livekit.Track.Kind.Audio){
         const element=track.attach();
         element.autoplay=true;
         if(track.kind===livekit.Track.Kind.Video)element.playsInline=true;
         element.dataset.remoteTrack='true';
         mediaRef.current.appendChild(element);
         setRemoteCount(n=>n+1);
       }
     });
     room.on(livekit.RoomEvent.TrackUnsubscribed,track=>{
       for(const el of track.detach())el.remove();
       if(mounted.current)setRemoteCount(n=>Math.max(0,n-1));
     });
     room.on(livekit.RoomEvent.Reconnecting,()=>mounted.current&&setState('reconnecting'));
     room.on(livekit.RoomEvent.Reconnected,()=>mounted.current&&setState('connected'));
     room.on(livekit.RoomEvent.Disconnected,()=>{
       roomRef.current=null;
       if(mounted.current){
         setState('idle');setRole(null);setMessage('Connection ended. Rejoin to recheck access.');
         setRemoteCount(0);setCamera(false);setMic(false);setShare(false);
       }
     });
     await room.connect(grant.url,grant.token,{autoSubscribe:true});
     if(!mounted.current){await room.disconnect();return;}
     roomRef.current=room;setRole(grant.role);setState('connected');
     if(grant.role==='host')void refreshAttendance();
     setMessage(grant.role==='host'?'Connected as host. Turn on your microphone and camera when ready.':'Connected as a participant. You can hear and watch the host.');
   }catch(e){
     try{await room?.disconnect();}catch{}
     roomRef.current=null;
     if(mounted.current){setError(friendlyError(e));setState('idle');}
   }finally{if(mounted.current)setBusy(false);}
 }
 async function media(kind,enabled){
   if(!roomRef.current||role!=='host')return;
   setBusy(true);setError('');
   try{
     const host=roomRef.current.localParticipant;
     if(kind==='camera'){await host.setCameraEnabled(enabled);setCamera(enabled);}
     else if(kind==='microphone'){await host.setMicrophoneEnabled(enabled);setMic(enabled);}
     else if(kind==='screen'){await host.setScreenShareEnabled(enabled);setShare(enabled);}
   }catch(e){setError(e?.message?.includes('Permission')?'Camera or microphone permission was denied.': 'Could not change '+kind+'. Check browser or device permissions.');}
   finally{setBusy(false);}
 }
 async function enableAudio(){
   if(!roomRef.current)return;
   try{await roomRef.current.startAudio?.();setMessage('Audio playback enabled.');}
   catch{setError('Audio playback is blocked. Allow sound in the browser and retry.');}
 }
 const isHost=details?.hostId===me?.id;
 return <main id="main" className="main">
   <Link className="back" href="/classes">← All classes</Link>
   <section className="hero compact"><p className="eyebrow">Live class room</p>
     <h1>{details?.title||'Class room'}</h1>
     <p className="intro">Join securely with your student account. Your permissions and paid access are rechecked on reconnection.</p>
     {details&&<p className="hint">{time(details.startsAt)} – {time(details.endsAt)} · {details.status.replaceAll('_',' ')} · {details.priceKobo===0?'Free':'Paid'}</p>}
   </section>
   {state==='loading'?<p role="status">Checking class access…</p>:null}
   {error&&<p role="alert" className="status">{error}</p>}
   {message&&<p role="status" className="status">{message}</p>}
   {details&&<>
     <section className="course-section">
       <h2>Room connection</h2>
       <p className="hint" role="status">Status: {state==='reconnecting'?'Reconnecting to media service':state==='connected'?'Connected to media service':state==='failed'?'Unavailable':'Not connected'}</p>
       <div className="button-row">
         {!roomRef.current&&<button className="secondary-link" type="button" onClick={connect}
           disabled={busy||details.status!=='room_open'}>{busy?'Connecting…':'Join live class'}</button>}
         {roomRef.current&&<button className="quiet-button" type="button" onClick={leave}>Leave class</button>}
         {roomRef.current&&<button className="quiet-button" type="button" onClick={enableAudio}>Enable sound</button>}
       </div>
       {details.status!=='room_open'&&<p className="hint">This class is not currently open. Only its verified host can open the room near the scheduled start time.</p>}
       <p className="hint">If you lose connection, LiveKit will attempt a brief reconnection. After disconnection, choose Join again for a new server-authorized token.</p>
     </section>
     <section className="course-section"><h2>Host and participants</h2>
       <div className="button-row">
         {roomRef.current&&role==='host'&&<>
           <button type="button" className="secondary-link" disabled={busy} onClick={()=>media('microphone',!mic)}>{mic?'Mute microphone':'Turn on microphone'}</button>
           <button type="button" className="quiet-button" disabled={busy} onClick={()=>media('camera',!camera)}>{camera?'Turn off camera':'Turn on camera'}</button>
           <button type="button" className="quiet-button" disabled={busy} onClick={()=>media('screen',!share)}>{share?'Stop sharing screen':'Share screen'}</button>
         </>}
       </div>
       <div ref={mediaRef} className="livekit-remote-tracks" aria-label="Remote class audio and video" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12,margin:'20px 0'}}/>
       {remoteCount===0&&<p className="status">{state==='connected'?(role==='host'?'No learners are publishing video. You control the class camera and microphone.':'Waiting for the host to share audio or video.'): 'Video and audio will appear after an authorized connection.'}</p>}
       {isHost&&<>
         <p className="hint">You are the class host. Only the host may publish camera, microphone or screen in this first release.</p>
         <div className="button-row"><button type="button" className="quiet-button" disabled={busy} onClick={refreshAttendance}>Refresh verified attendance</button></div>
         <ul className="lesson-list" aria-label="Verified classroom attendance">
           {attendance.map(item=><li className="lesson" key={item.studentId}>
             <p className="hint">Student {item.studentId.slice(0,8)} · Verified provider joins: {item.providerEvents} · {item.enrollmentStatus}</p>
             {item.enrollmentStatus==='enrolled'&&<>
               <label htmlFor={'class-remove-'+item.studentId}>Reason for ending this student's participation</label>
               <input id={'class-remove-'+item.studentId} value={removeReasons[item.studentId]||''} minLength={8} maxLength={500}
                 onChange={e=>setRemoveReasons(x=>({...x,[item.studentId]:e.target.value}))}/>
               <button type="button" className="quiet-button" disabled={busy} onClick={()=>removeAttendee(item.studentId)}>Remove participant</button>
             </>}
           </li>)}
         </ul>
       </>}
       {!isHost&&details.hostId&&<Link className="secondary-link" href={'/messages/'+details.hostId}>Ask the creator a question</Link>}
     </section>
   </>}
   <p className="hint">A successful connection must be confirmed on two real devices before calling this feature live-tested. Camera and microphone are never started automatically.</p>
 </main>;
}
