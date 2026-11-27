'use client';
import {useEffect,useRef,useState} from 'react';
import {useHostedAccount} from './HostedAccountProvider.jsx';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function AuthorizedThumbnail({lessonId}){
 const account=useHostedAccount(),actor=account?.session.state==='signed-in'?account.session.userId:null;
 return actor&&UUID.test(lessonId||'')?<ScopedThumbnail key={actor+':'+lessonId} account={account} lessonId={lessonId}/>:null;
}
function ScopedThumbnail({account,lessonId}){
 const anchor=useRef(null),[url,setUrl]=useState(''),[loaded,setLoaded]=useState(false);
 useEffect(()=>{
  let active=true,started=false,observer;
  async function request(){
   if(started||!active)return;started=true;observer?.disconnect();
   try{
    const grant=await account.creatorRequest('thumbnail',{lessonId});
    const parsed=new URL(grant.url),now=Math.floor(Date.now()/1000);
    if(parsed.origin!=='https://image.mux.com'||parsed.username||parsed.password||parsed.hash||!/^\/[A-Za-z0-9_-]{6,128}\/thumbnail\.jpg$/.test(parsed.pathname)||[...parsed.searchParams.keys()].length!==1||! /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(parsed.searchParams.get('token')||'')||!Number.isSafeInteger(grant.expiresAt)||grant.expiresAt<=now||grant.expiresAt>now+120)return;
    if(active)setUrl(parsed.href);
   }catch{/* No access or media unavailable: keep the metadata poster. */}
  }
  if(typeof IntersectionObserver==='undefined')void request();
  else{observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))void request();},{rootMargin:'80px'});if(anchor.current)observer.observe(anchor.current);}
  return()=>{active=false;observer?.disconnect();};
 },[lessonId]);
 return <span ref={anchor} className={'authorized-thumbnail'+(loaded?' loaded':'')} aria-hidden="true">{url&&<img src={url} alt="" decoding="async" referrerPolicy="no-referrer" onLoad={()=>setLoaded(true)} onError={()=>{setLoaded(false);setUrl('');}}/>}</span>;
}
