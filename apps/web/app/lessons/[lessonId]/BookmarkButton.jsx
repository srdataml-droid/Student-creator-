
'use client';
import Link from 'next/link';
import {useState} from 'react';
import {api,friendlyError} from '../../../lib/local-client.js';
export default function BookmarkButton({lessonId}){
 const [state,setState]=useState('idle'),[notice,setNotice]=useState('');
 async function save(){setState('busy');setNotice('');try{await api('lessons/'+lessonId+'/bookmark',{method:'POST',body:{}});setState('saved');setNotice('Saved to your learning list.');}catch(e){setState('idle');setNotice(friendlyError(e));}}
 return <div className="bookmark-action"><button type="button" className="secondary-link" disabled={state==='busy'||state==='saved'} onClick={save}>{state==='saved'?'Saved ✓':state==='busy'?'Saving…':'Save lesson'}</button> <Link href="/saved">Your saved lessons</Link>{notice&&<p role="status" className="hint">{notice}</p>}</div>;
}
