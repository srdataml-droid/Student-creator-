'use client';
import {useSyncExternalStore} from 'react';

function subscribe(onChange) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}
function onlineSnapshot() { return navigator.onLine; }
function serverSnapshot() { return true; }

export default function ConnectionStatus() {
  const online = useSyncExternalStore(subscribe, onlineSnapshot, serverSnapshot);
  return <div role="status" aria-live="polite" aria-atomic="true">
    {!online && <p className="status" style={{margin:'12px',overflowWrap:'anywhere'}}>
      You're offline. Reconnect before sending messages, uploading content or making a purchase.
      If an action was interrupted, check its status before retrying.
    </p>}
  </div>;
}
