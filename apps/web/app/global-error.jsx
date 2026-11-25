'use client';

// Root layout errors cannot depend on that layout, its CSS, or its navigation.
export default function GlobalError({reset}){
 return <html lang="en"><body style={{margin:0,fontFamily:'system-ui,sans-serif',color:'#17251c',background:'#f6f8f6'}}>
  <main id="main" style={{maxWidth:560,margin:'48px auto',padding:24}}>
   <h1>Student Creators is unavailable</h1>
   <p role="alert">Something went wrong. Your connection or the service may be temporarily unavailable.</p>
   <p>Check your connection before trying again. If you were submitting something, verify its status before resubmitting.</p>
   <div style={{display:'flex',gap:16,flexWrap:'wrap',alignItems:'center'}}>
    <button type="button" onClick={()=>reset()} style={{minHeight:44,padding:'8px 16px',font:'inherit'}}>Try again</button>
    <a href="/" style={{display:'inline-flex',alignItems:'center',minHeight:44,color:'#145d41'}}>Go home</a>
   </div>
  </main>
 </body></html>;
}
