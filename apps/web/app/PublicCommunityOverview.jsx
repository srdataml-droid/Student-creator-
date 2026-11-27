'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
export default function PublicCommunityOverview({courseId,checking=false}){
 const [result,setResult]=useState({state:'loading'}),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  setResult({state:'loading'});
  (async()=>{
   try{
    const response=await fetch('/api/public-communities/'+encodeURIComponent(courseId),{cache:'no-store',signal:controller.signal});
    if(response.status===404){if(!controller.signal.aborted)setResult({state:'missing'});return;}
    if(!response.ok)throw Error('UNAVAILABLE');
    const data=await response.json();
    if(data.id!==courseId||typeof data.title!=='string'||typeof data.code!=='string')throw Error('INVALID_RESPONSE');
    if(!controller.signal.aborted)setResult({state:'ready',course:data});
   }catch{if(!controller.signal.aborted)setResult({state:'error'});}
  })();
  return ()=>controller.abort();
 },[courseId,attempt]);
 return <main id="main" className="main community-directory content-community">
  <Link className="back" href="/communities">← Community</Link>
  {result.state==='ready'?<><header><p className="eyebrow">{result.course.code}</p><h1>{result.course.title}</h1></header><section className="community-section"><h2>Community discussion</h2><p className="hint">Connect with students in this course.</p>{checking?<p role="status">Checking account…</p>:<Link className="primary-link" href="/sign-in">Sign in to join</Link>}<p><Link href={'/courses/'+encodeURIComponent(courseId)}>Browse course videos</Link></p></section></>:<><h1>Community</h1>{result.state==='loading'?<p role="status">Loading community…</p>:result.state==='missing'?<p role="status">Community not found.</p>:<><p role="status">Could not load this community.</p><button className="quiet-button" type="button" onClick={()=>setAttempt(v=>v+1)}>Retry</button></>}</>}
 </main>;
}
