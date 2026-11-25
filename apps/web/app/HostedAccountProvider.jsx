'use client';
import {createContext,useContext,useEffect,useMemo,useState} from 'react';
import {createHostedBrowserAuth} from '../lib/hosted-browser-auth.mjs';
const Context=createContext(null);
export function useHostedAccount(){return useContext(Context);}
export default function HostedAccountProvider({hosted,children}){
 const client=useMemo(()=>hosted?createHostedBrowserAuth():null,[hosted]);
 const [session,setSession]=useState({state:'checking',role:null});
 const [notice,setNotice]=useState('');
 useEffect(()=>{
  if(!client)return;
  let active=true;
  async function check(){
   if(client.hasFreshSession())return;
   try{await client.refresh();if(active)setSession({state:'signed-in',role:null});}
   catch(e){if(active)setSession({state:e.status===401?'guest':'unavailable',role:null});}
  }
  void check();
  function onVisible(){if(document.visibilityState==='visible')void check();}
  document.addEventListener('visibilitychange',onVisible);
  return()=>{active=false;document.removeEventListener('visibilitychange',onVisible);};
 },[client]);
 const value=client?{session,notice,
  async signIn(email,password){await client.signIn(email,password);setNotice('');setSession({state:'signed-in',role:null});},
  invite:code=>client.invite(code),recover:email=>client.recover(email),
  async creatorRequest(operation,input){try{return await client.authorized(operation,input);}catch(e){if(e.status===401)setSession({state:'guest',role:null});throw e;}},
  async complete(...args){await client.complete(...args);setSession({state:'guest',role:null});setNotice('');},
  async logout(){setNotice('');try{const result=await client.logout();setSession({state:'guest',role:null});if(!result.remoteRevoked)setNotice('Signed out on this device. Remote revocation was not confirmed.');}
   catch(e){setSession({state:e.localSignedOut?'guest':'unavailable',role:null});setNotice(e.localSignedOut?'Signed out locally. Remote revocation could not be verified.':'Sign-out could not be confirmed. Try again.');throw e;}}
 }:null;
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
