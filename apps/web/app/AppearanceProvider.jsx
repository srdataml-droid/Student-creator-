'use client';
import {createContext,useContext,useEffect,useState} from 'react';
const Context=createContext(null);
export default function AppearanceProvider({children}){
 const [theme,setTheme]=useState('dark');
 useEffect(()=>{try{const saved=localStorage.getItem('student-creators:appearance');if(saved==='light'||saved==='dark')setTheme(saved);}catch{}},[]);
 useEffect(()=>{document.documentElement.dataset.appearance=theme;},[theme]);
 function change(next){if(next!=='light'&&next!=='dark')return;setTheme(next);try{localStorage.setItem('student-creators:appearance',next);}catch{}}
 return <Context.Provider value={{theme,change}}>{children}</Context.Provider>;
}
export function AppearanceSetting(){const a=useContext(Context);if(!a)return null;return <section className="appearance-setting"><h2>Appearance</h2><p className="hint">Choose how Student Creators looks on this device.</p><div role="group" aria-label="Appearance"><button type="button" aria-pressed={a.theme==='light'} onClick={()=>a.change('light')}>Light</button><button type="button" aria-pressed={a.theme==='dark'} onClick={()=>a.change('dark')}>Dark</button></div></section>;}
