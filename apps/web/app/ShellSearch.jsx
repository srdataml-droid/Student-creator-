'use client';
import {useEffect,useRef,useState} from 'react';
import {usePathname,useRouter} from 'next/navigation';
const clean=v=>typeof v==='string'?v.trim().slice(0,80):'';
function readHistory(key){try{const r=JSON.parse(sessionStorage.getItem(key)||'[]');return Array.isArray(r)?r.map(clean).filter(x=>x.length>=2).slice(0,8):[];}catch{return [];}}
export default function ShellSearch({hosted,actor}){
 const path=usePathname(),router=useRouter(),dialog=useRef(null),input=useRef(null),trigger=useRef(null);
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[history,setHistory]=useState([]);
 const key='student-creators:search:'+ (actor||'guest');
 useEffect(()=>{setHistory([]);setQuery('');if(actor)setHistory(readHistory(key));setOpen(false);},[key,actor]);
 useEffect(()=>{setOpen(false);},[path]);
 useEffect(()=>{if(open){dialog.current?.showModal();input.current?.focus();}else if(dialog.current?.open)dialog.current.close();},[open]);
 function close(){setOpen(false);trigger.current?.focus();}
 function submit(value){const q=clean(value);if(q.length<2)return;const next=[q,...history.filter(v=>v.toLowerCase()!==q.toLowerCase())].slice(0,8);setHistory(next);if(actor)try{sessionStorage.setItem(key,JSON.stringify(next));}catch{};setQuery(q);close();router.push((hosted&&path==='/'?'/':'/search')+'?q='+encodeURIComponent(q));}
 function clear(){setHistory([]);try{sessionStorage.removeItem(key);}catch{}}
 const suggestions=history.filter(v=>!query||v.toLowerCase().includes(query.toLowerCase()));
 return <div className="watch-search"><button ref={trigger} type="button" className="watch-search-trigger" aria-label="Search Student Creators" onClick={()=>setOpen(true)}><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><span>Search</span></button><dialog ref={dialog} className="watch-search-dialog" aria-label="Search Student Creators" onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===dialog.current)close();}}><div className="watch-search-content"><form onSubmit={e=>{e.preventDefault();submit(query);}}><button type="button" aria-label="Close search" onClick={close}>‹</button><label className="visually-hidden" htmlFor="watch-query">Search Student Creators</label><input ref={input} id="watch-query" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search Student Creators" minLength={2} maxLength={80} required/><button type="submit" disabled={clean(query).length<2}>Search</button></form><div className="watch-search-history"><div className="heading-row"><h2>{query?'Matching recent searches':'Recent searches'}</h2>{history.length>0&&<button type="button" onClick={clear}>Clear</button>}</div>{suggestions.length? suggestions.map(v=><button className="watch-search-suggestion" type="button" key={v} onClick={()=>submit(v)}><span aria-hidden="true">◷</span>{v}</button>):<p className="hint">{query?'Search the published content catalog.':'Your recent searches appear here during this session.'}</p>}</div></div></dialog></div>;
}
