import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {randomUUID, randomBytes} from 'node:crypto';

const BASE='http://localhost:3000';
const syntheticVideo=Buffer.from(readFileSync(new URL('../../../packages/local-core/test/fixtures/synthetic-1s.mp4.base64',import.meta.url),'utf8'),'base64');
const syntheticCaptions='WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOriginal synthetic caption text.\n';

async function login(page,email,password){
  await page.goto('/sign-in');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  const loginResponse=page.waitForResponse(response=>response.url().endsWith('/api/local/auth/login')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Sign in'}).click();
  const response=await loginResponse;
  if(!response.ok()){
    const result=await response.json().catch(()=>({error:'INVALID_SERVER_RESPONSE'}));
    throw new Error(`Synthetic account login returned HTTP ${response.status()}: ${result.error||'UNKNOWN_ERROR'}`);
  }
  await expect(page).toHaveURL(/\/(manage|studio)$/, {timeout:10000});
}
async function join(page,schoolId,email,password){
  await page.goto('/join');
  await expect(page.locator('#campus')).toBeVisible();
  await page.locator('#campus').selectOption(schoolId);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button',{name:'Create account'}).click();
  await expect(page.getByRole('heading',{name:'Account created'})).toBeVisible();
}
// Focused checks for visible form control labels. This is not a full WCAG audit.
async function assertNamedFormControls(main,route){
  const unnamed=await main.locator('input:not([type=hidden]),textarea,select').evaluateAll(controls=>
    controls.filter(el=>{
      if(!el.getClientRects().length||getComputedStyle(el).visibility==='hidden')return false;
      if(['submit','reset','button','image'].includes(el.type))return false;
      const aria=el.getAttribute('aria-label')?.trim();
      const refs=(el.getAttribute('aria-labelledby')||'').split(/\\s+/).filter(Boolean);
      return !aria&&!refs.some(id=>document.getElementById(id)?.textContent?.trim())&&
        !Array.from(el.labels||[]).some(label=>label.textContent?.trim());
    }).map(el=>({tag:el.tagName,id:el.id,type:el.type})));
  expect(unnamed,`Missing control labels: ${route}`).toEqual([]);
}
async function readJson(response){
  expect(response.ok(),`HTTP ${response.status()} from ${response.url()}`).toBeTruthy();
  return response.json();
}

test('synthetic creator, moderator and viewer journey keeps media access server-enforced',async({browser,request})=>{
  // Includes two independently moderated videos and a paid buyer path in CI.
  test.setTimeout(300_000);
  const adminEmail=process.env.CI_ADMIN_EMAIL;
  const adminPassword=process.env.CI_ADMIN_PASSWORD;
  expect(adminEmail&&adminPassword,'Disposable CI administrator is required').toBeTruthy();
  const suffix=randomUUID().slice(0,8);
  const schoolName=`Browser Alpha Campus ${suffix}`;
  const creatorEmail=`creator-${suffix}@example.invalid`;
  const viewerEmail=`viewer-${suffix}@example.invalid`;
  const password=randomBytes(24).toString('base64url');
  const title=`Original campus media explanation ${suffix}`;
  const studentText='I created this original walkthrough of a fundamental concept. First identify the question, then describe the key definitions and work through a small example. Check the final result and explain where beginners commonly make mistakes.';
  const admin=await browser.newContext({baseURL:BASE});
  const creator=await browser.newContext({baseURL:BASE});
  const viewer=await browser.newContext({baseURL:BASE});
  try{
    const adminPage=await admin.newPage();
    await login(adminPage,adminEmail,adminPassword);
    await expect(adminPage.getByRole('heading',{name:'Protect the learning community.'})).toBeVisible();

    await adminPage.locator('#schoolName').fill(schoolName);
    await adminPage.getByRole('button',{name:'Add campus'}).click();
    await expect(adminPage.getByText('Campus added.')).toBeVisible();
    const {institutions}=await readJson(await admin.request.get('/api/local/institutions'));
    const schoolId=institutions.find(x=>x.name===schoolName)?.id;
    expect(schoolId).toBeTruthy();

    await adminPage.locator('#courseSchool').selectOption(schoolId);
    await adminPage.locator('#courseCode').fill('ALP 101');
    await adminPage.locator('#courseName').fill('Original Student Content');
    await adminPage.getByRole('button',{name:'Add course'}).click();
    await expect(adminPage.getByText('Course added.')).toBeVisible();
    const {courses}=await readJson(await admin.request.get('/api/local/courses'));
    const courseId=courses.find(x=>x.institutionId===schoolId&&x.code==='ALP 101')?.id;
    expect(courseId).toBeTruthy();

    const creatorPage=await creator.newPage();
    const viewerPage=await viewer.newPage();
    await join(creatorPage,schoolId,creatorEmail,password);
    await join(viewerPage,schoolId,viewerEmail,password);
    await login(creatorPage,creatorEmail,password);
    await expect(creatorPage.getByText('Your campus membership is waiting for an administrator', {exact:false})).toBeVisible();
    await login(viewerPage,viewerEmail,password);
    // An unverified account may sign in, but cannot create content, follow or review identities.
    expect((await creator.request.get('/api/local/following')).status()).toBe(403);
    expect((await creator.request.get('/api/local/admin/pending-users')).status()).toBe(403);
    const deniedDraft=await creator.request.post('/api/local/lessons/drafts',{
      data:{courseId,title:'Unverified draft should fail',description:'',previewText:'',lessonText:studentText,
        rightsAttested:true,creationKey:`unverified-browser-${suffix}-draft`},
    });
    expect(deniedDraft.status()).toBe(403);

    const {users}=await readJson(await admin.request.get('/api/local/admin/pending-users'));
    const creatorId=users.find(x=>x.email===creatorEmail)?.id;
    const viewerId=users.find(x=>x.email===viewerEmail)?.id;
    expect(creatorId).toBeTruthy();
    expect(viewerId).toBeTruthy();
    for(const email of [creatorEmail,viewerEmail]){
      await adminPage.goto('/manage');
      await adminPage.getByRole('listitem').filter({hasText:email})
        .getByRole('button',{name:'Confirm verified membership'}).click();
      await expect(adminPage.getByText('Student membership approved.')).toBeVisible();
    }

    await creatorPage.goto('/studio');
    await expect(creatorPage.locator('#course')).toBeVisible();
    await creatorPage.locator('#course').selectOption(courseId);
    await creatorPage.locator('#title').fill(title);
    await creatorPage.locator('#desc').fill('Original synthetic student-created course walkthrough');
    await creatorPage.locator('#preview').fill('A safe original concept explanation');
    await creatorPage.locator('#body').fill(studentText);
    await creatorPage.locator('input[type="checkbox"][required]').check();
    await creatorPage.getByRole('button',{name:'Save private draft'}).click();
    await expect(creatorPage.getByText('Your draft has been saved privately.',{exact:false})).toBeVisible();
    const {lessons}=await readJson(await creator.request.get('/api/local/my/lessons'));
    const lessonId=lessons.find(x=>x.title===title)?.id;
    expect(lessonId).toBeTruthy();

    // Draft video must be invisible to other viewers, including anonymous users.
    expect((await request.get(`${BASE}/api/local/lessons/${lessonId}/video`)).status()).toBe(404);
    await creatorPage.locator(`#video-${lessonId}`).setInputFiles({
      name:'synthetic-1s.mp4',mimeType:'video/mp4',buffer:syntheticVideo,
    });
    await creatorPage.getByRole('button',{name:'Upload video'}).click();
    await expect(creatorPage.getByText('Video saved privately.',{exact:false})).toBeVisible();
    await creatorPage.locator('#captions-'+lessonId).setInputFiles({
      name:'synthetic.vtt',mimeType:'text/vtt',buffer:Buffer.from(syntheticCaptions),
    });
    await creatorPage.getByRole('button',{name:'Upload captions'}).click();
    await expect(creatorPage.getByText('English captions saved privately.',{exact:false})).toBeVisible();
    expect((await request.get(`${BASE}/api/local/lessons/${lessonId}/video`)).status()).toBe(404);
    await creatorPage.getByRole('button',{name:'Submit for review'}).click();
    await expect(creatorPage.getByText('Lesson submitted.',{exact:false})).toBeVisible();

    await adminPage.goto('/manage');
    const reviewed=adminPage.getByRole('listitem').filter({hasText:title});
    await expect(reviewed).toBeVisible();
    await reviewed.locator(`#reason-${lessonId}`).fill('Verified independent original synthetic lesson for browser testing');
    await reviewed.getByRole('button',{name:'Approve'}).click();
    await expect(adminPage.getByText('Lesson approved and published.')).toBeVisible();

    // Browsing the feed must not initiate protected media downloads or grant requests.
    const eagerMediaRequests=[];
    const trackEagerMedia=req=>{
      const pathname=new URL(req.url()).pathname;
      if(pathname.startsWith(`/api/local/lessons/${lessonId}/`)&&
        /\/(video(?:\/captions)?|playback-grant)$/.test(pathname))
        eagerMediaRequests.push(pathname);
    };
    viewerPage.on('request',trackEagerMedia);
    await viewerPage.goto('/');
    const feedPost=viewerPage.getByRole('article',{name:title});
    await expect(feedPost.getByRole('heading',{name:title})).toBeVisible();
    await expect(feedPost.getByRole('button',{name:'Enable playback'})).toBeVisible();
    await expect(feedPost.locator('video')).toHaveCount(0);
    // Measure the protected, populated feed on a genuinely constrained
    // Chromium network simulation. No video grant or bytes until requested.
    const cdp=await viewer.newCDPSession(viewerPage);
    try{
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
      await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:75000});
      await viewerPage.addInitScript(()=>{
        // Synthetic browser measurement only: no telemetry request or user data.
        const vitals=window.__wk8Vitals={lcp:0,cls:0};
        let windowStart=0,last=0,cluster=0;
        try{new PerformanceObserver(list=>{
          for(const e of list.getEntries())vitals.lcp=e.startTime;
        }).observe({type:'largest-contentful-paint',buffered:true});}catch{}
        try{new PerformanceObserver(list=>{
          for(const e of list.getEntries()){
            if(e.hadRecentInput)continue;
            if(e.startTime-last>1000||e.startTime-windowStart>5000){windowStart=e.startTime;cluster=0;}
            cluster+=e.value;last=e.startTime;vitals.cls=Math.max(vitals.cls,cluster);
          }
        }).observe({type:'layout-shift',buffered:true});}catch{}
      });
      await viewerPage.setViewportSize({width:360,height:780});
      await viewerPage.reload({waitUntil:'load',timeout:45000});
      await expect(feedPost.getByRole('button',{name:'Enable playback'})).toBeVisible({timeout:15000});
      await expect.poll(()=>viewerPage.evaluate(()=>window.__wk8Vitals?.lcp||0),{timeout:10000}).toBeGreaterThan(0);
      const performance=await viewerPage.evaluate(()=>{
        const entries=[...performance.getEntriesByType('navigation'),...performance.getEntriesByType('resource')];
        return {transferredBytes:entries.reduce((n,e)=>n+(e.transferSize||0),0),domContentLoadedMs:Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd),width:document.documentElement.scrollWidth,viewport:innerWidth,lcpMs:Math.round(window.__wk8Vitals.lcp),cls:window.__wk8Vitals.cls};
      });
      console.log('browser-alpha throttled feed metrics',JSON.stringify(performance));
      expect(performance.transferredBytes).toBeGreaterThan(0);
      expect(performance.transferredBytes).toBeLessThanOrEqual(2*1024*1024);
      expect(performance.domContentLoadedMs).toBeGreaterThan(0);
      expect(performance.domContentLoadedMs).toBeLessThanOrEqual(20000);
      expect(performance.lcpMs).toBeLessThanOrEqual(8000);
      expect(performance.cls).toBeLessThanOrEqual(.25);
      expect(performance.width).toBeLessThanOrEqual(performance.viewport+1);
    }finally{
      await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      await cdp.send('Network.setCacheDisabled',{cacheDisabled:false});
      await cdp.detach();
      await viewerPage.setViewportSize({width:1280,height:800});
    }
    // A delayed following response must not overwrite a newer filter selection.
    let releaseFollowing,followingStarted;
    const followingGate=new Promise(resolve=>{releaseFollowing=resolve;});
    const followingRequest=new Promise(resolve=>{followingStarted=resolve;});
    await viewerPage.route('**/api/local/following',async route=>{
      followingStarted();
      await followingGate;
      await route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'VERIFICATION_REQUIRED'})});
    });
    try{
      await viewerPage.getByRole('button',{name:'Following',exact:true}).click();
      await followingRequest;
      await expect(viewerPage.getByText('Loading creators you follow…')).toBeVisible();
      await viewerPage.getByRole('button',{name:'For you',exact:true}).click();
      const completed=viewerPage.waitForResponse(response=>response.url().endsWith('/api/local/following'));
      releaseFollowing();
      await completed;
      await expect(feedPost).toBeVisible();
      await expect(viewerPage.locator('.feed-notice')).toHaveCount(0);
    }finally{
      releaseFollowing();
      await viewerPage.unroute('**/api/local/following');
    }

    await viewerPage.goto(`/lessons/${lessonId}`);
    viewerPage.off('request',trackEagerMedia);
    expect(eagerMediaRequests).toEqual([]);
    await expect(viewerPage.getByRole('heading',{name:title})).toBeVisible();
    await expect(viewerPage.getByRole('button',{name:'Enable playback'})).toBeVisible();
    expect((await viewer.request.get(`/api/local/lessons/${lessonId}/video`)).status()).toBe(403);
    expect((await viewer.request.get(`/api/local/lessons/${lessonId}/video/captions`)).status()).toBe(403);
    await viewerPage.getByRole('button',{name:'Enable playback'}).click();
    await expect(viewerPage.locator('video')).toBeVisible();
    await expect(viewerPage.locator('video track[kind="captions"]')).toHaveAttribute('src',`/api/local/lessons/${lessonId}/video/captions`);
    const vttResponse=await viewer.request.get(`/api/local/lessons/${lessonId}/video/captions`);
    expect(vttResponse.status()).toBe(200);
    expect(await vttResponse.text()).toBe(syntheticCaptions);
    const privateVideo=await request.get(`${BASE}/api/local/lessons/${lessonId}/video`);
    expect([401,403,404]).toContain(privateVideo.status());
    // No full-text, download or comments leakage to visitors via direct API requests.
    expect((await request.get(`${BASE}/api/local/lessons/${lessonId}`)).status()).toBe(401);
    expect((await request.get(`${BASE}/api/local/lessons/${lessonId}/notes`)).status()).toBe(401);
    expect((await request.get(`${BASE}/api/local/lessons/${lessonId}/comments`)).status()).toBe(401);
    const range=await viewer.request.get(`/api/local/lessons/${lessonId}/video`,{headers:{range:'bytes=0-4'}});
    expect(range.status()).toBe(206);
    expect(await range.body()).toEqual(syntheticVideo.subarray(0,5));

    // Paid browser journey, using one synthetic creator and viewer. No Paystack key.
    // Media-first viewer must use the exact same authenticated playback gate.
    await viewerPage.setViewportSize({width:360,height:780});
    await viewerPage.goto('/watch/'+lessonId);
    await expect(viewerPage.getByRole('heading',{name:title}).first()).toBeVisible();
    await expect(viewerPage.getByRole('navigation',{name:'Mobile navigation'})).toBeVisible();
    const watchViewport=await viewerPage.evaluate(()=>({width:window.innerWidth,scrollWidth:document.documentElement.scrollWidth}));
    expect(watchViewport.scrollWidth,'Protected Android-width viewer overflows horizontally').toBeLessThanOrEqual(watchViewport.width+1);
    const playButton=viewerPage.getByRole('button',{name:'Enable playback'});
    await expect(playButton).toBeVisible();
    await playButton.focus();await expect(playButton).toBeFocused();
    await playButton.click();
    await expect(viewerPage.locator('.watch-stage video')).toBeVisible();
    await expect(viewerPage.locator('.watch-stage video track[kind="captions"]')).toHaveAttribute('src',`/api/local/lessons/${lessonId}/video/captions`);
    await viewerPage.setViewportSize({width:1280,height:800});
    expect((await request.get(BASE+'/api/local/lessons/'+lessonId+'/video')).status()).toBe(401);
    console.log('browser-alpha: free protected-video and immersive viewer passed');
    const paidTitle='Original paid content example '+suffix;
    await creatorPage.goto('/studio');
    await creatorPage.locator('#course').selectOption(courseId);
    await creatorPage.locator('#title').fill(paidTitle);
    await creatorPage.locator('#desc').fill('Original priced synthetic video explanation');
    await creatorPage.locator('#preview').fill('Original public preview for a paid work');
    await creatorPage.locator('#body').fill(studentText);
    await creatorPage.locator('input[type="checkbox"][required]').check();
    await creatorPage.getByRole('button',{name:'Save private draft'}).click();
    await expect(creatorPage.getByText('Your draft has been saved privately.',{exact:false})).toBeVisible();
    const paidItems=await readJson(await creator.request.get('/api/local/my/lessons'));
    const paidId=paidItems.lessons.find(x=>x.title===paidTitle)?.id;
    expect(paidId).toBeTruthy();
    console.log('browser-alpha: paid creator draft created');
    await creatorPage.locator('#price-'+paidId).fill('200');
    await creatorPage.getByRole('button',{name:'Save access price'}).click();
    await expect(creatorPage.getByText('Access price saved.',{exact:false})).toBeVisible();
    await creatorPage.locator('#video-'+paidId).setInputFiles({
      name:'synthetic-paid.mp4',mimeType:'video/mp4',buffer:syntheticVideo,
    });
    await creatorPage.getByRole('button',{name:'Upload video'}).click();
    await expect(creatorPage.getByText('Video saved privately.',{exact:false})).toBeVisible();
    await creatorPage.locator('#captions-'+paidId).setInputFiles({
      name:'paid-original.vtt',mimeType:'text/vtt',buffer:Buffer.from(syntheticCaptions),
    });
    await creatorPage.getByRole('button',{name:'Upload captions'}).click();
    await expect(creatorPage.getByText('English captions saved privately.',{exact:false})).toBeVisible();
    await creatorPage.getByRole('button',{name:'Submit for review'}).click();
    console.log('browser-alpha: paid draft priced, uploaded and submitted');
    await adminPage.goto('/manage');
    const paidReview=adminPage.getByRole('listitem').filter({hasText:paidTitle});
    await expect(paidReview).toBeVisible();
    await paidReview.locator('#reason-'+paidId).fill('Approved original synthetic paid video for browser test');
    await paidReview.getByRole('button',{name:'Approve'}).click();
    await expect(adminPage.getByText('Lesson approved and published.')).toBeVisible();

    console.log('browser-alpha: paid lesson independently reviewed');
    // Direct watch requests never render paid content without buyer entitlement.
    await viewerPage.goto('/watch/'+paidId);
    await expect(viewerPage).toHaveURL(new RegExp('/lessons/'+paidId+'$'));
    await expect(viewerPage.getByRole('heading',{name:'Unlock access for ₦200'})).toBeVisible();
    expect((await viewer.request.get('/api/local/lessons/'+paidId)).status()).toBe(402);
    expect((await viewer.request.get('/api/local/lessons/'+paidId+'/notes')).status()).toBe(402);
    expect((await viewer.request.get('/api/local/lessons/'+paidId+'/comments')).status()).toBe(402);
    expect((await viewer.request.get('/api/local/lessons/'+paidId+'/video')).status()).toBe(402);
    expect((await viewer.request.get('/api/local/lessons/'+paidId+'/video/captions')).status()).toBe(402);
    expect((await viewer.request.post('/api/local/lessons/'+paidId+'/playback-grant',{data:{}})).status()).toBe(402);
    expect((await creator.request.get('/api/local/lessons/'+paidId)).status()).toBe(200);
    await viewerPage.setViewportSize({width:390,height:844});
    await viewerPage.goto('/lessons/'+paidId);
    await expect(viewerPage.getByRole('heading',{name:paidTitle})).toBeVisible();
    await expect(viewerPage.getByRole('heading',{name:'Unlock access for ₦200'})).toBeVisible();
    await expect(viewerPage.getByText('Checkout is currently unavailable.',{exact:false})).toBeVisible();
    const viewport=await viewerPage.evaluate(()=>({body:document.documentElement.scrollWidth,width:window.innerWidth}));
    expect(viewport.body,'Mobile paywall horizontal overflow').toBeLessThanOrEqual(viewport.width+1);
    console.log('browser-alpha: paid lesson paywall and mobile viewport passed');
    const buyerOrder=await viewer.request.post('/api/local/lessons/'+paidId+'/orders',{
      data:{requestKey:'browser-payment-'+suffix+'-0001'},
    });
    expect(buyerOrder.status()).toBe(201);
    const orderData=await buyerOrder.json();
    expect(orderData.order.status).toBe('pending');
    expect(orderData.order.amountKobo).toBe(20000);
    expect((await viewer.request.get('/api/local/lessons/'+paidId)).status()).toBe(402);
    expect((await viewer.request.post('/api/local/orders/'+orderData.order.reference+'/confirm',{data:{}})).status()).toBe(503);
    await viewerPage.goto('/purchases');
    await expect(viewerPage.getByText('Awaiting confirmation')).toBeVisible();
    expect((await request.get(BASE+'/api/local/my/purchases')).status()).toBe(401);
    await viewerPage.setViewportSize({width:1280,height:800});

    console.log('browser-alpha: pending buyer order and history passed');
    // Restore the free lesson context before testing comments and creator blocking.
    await viewerPage.goto('/lessons/'+lessonId);
    const comment=`Helpful original question ${suffix}`;
    await viewerPage.locator('#lesson-comment-text').fill(comment);
    await viewerPage.getByRole('button',{name:'Post comment'}).click();
    await expect(viewerPage.getByText(comment)).toBeVisible();
    // Exercise authenticated, populated content and communication routes,
    // beyond the unauthenticated route-shell sweep.
    for(const [targetPage,route] of [
      [viewerPage,'/courses/'+courseId],
      [viewerPage,'/communities/'+courseId],
      [viewerPage,'/study/'+courseId],
      [viewerPage,'/messages/'+creatorId],
      [viewerPage,'/lessons/'+lessonId],
      [viewerPage,'/watch/'+lessonId],
      [viewerPage,'/creators/'+creatorId],
      [creatorPage,'/studio'],
      [adminPage,'/manage'],
    ]){
      await targetPage.goto(route);
      const main=targetPage.getByRole('main');
      await expect(main.getByRole('heading',{level:1})).toHaveCount(1);
      await assertNamedFormControls(main,route);
      for(const width of [320,412,768]){
        await targetPage.setViewportSize({width,height:800});
        const sizes=await targetPage.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1&&getComputedStyle(el).position!=='absolute';}).slice(0,6).map(el=>({tag:el.tagName,className:String(el.className),right:Math.round(el.getBoundingClientRect().right)}))}));
        expect(sizes.document,`${route} authenticated at ${width}px: ${JSON.stringify(sizes.offenders)}`).toBeLessThanOrEqual(sizes.viewport+1);
      }
      await targetPage.setViewportSize({width:1280,height:800});
    }
    // Backgrounded conversations should not use mobile data, and a resumed
    // conversation must stop rendering prior state when its session is denied.
    const pollPage=await viewer.newPage();
    let pollReads=0,deny=false;
    await pollPage.addInitScript(()=>{
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__testVisibility||'visible'});
    });
    await pollPage.route('**/api/local/messages/'+creatorId,async route=>{
      if(route.request().method()==='GET'){
        pollReads++;
        if(deny)return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'AUTH_REQUIRED'})});
      }
      await route.continue();
    });
    try{
      await pollPage.clock.install();
      await pollPage.goto('/messages/'+creatorId);
      await expect(pollPage.getByRole('heading',{name:'Conversation'})).toBeVisible();
      await expect(pollPage.getByRole('textbox',{name:'Message (max 2,000 characters)'})).toBeVisible();
      await pollPage.evaluate(()=>{window.__testVisibility='hidden';document.dispatchEvent(new Event('visibilitychange'));});
      const hiddenReads=pollReads;
      await pollPage.clock.fastForward(30000);
      expect(pollReads).toBe(hiddenReads);
      deny=true;
      await pollPage.evaluate(()=>{window.__testVisibility='visible';document.dispatchEvent(new Event('visibilitychange'));});
      await expect(pollPage.getByText('You need to', {exact:false})).toBeVisible();
      await expect(pollPage.getByRole('textbox',{name:'Message (max 2,000 characters)'})).toHaveCount(0);
      expect(pollReads).toBe(hiddenReads+1);
    }finally{await pollPage.close();}
    await viewerPage.goto(`/creators/${creatorId}`);
    await viewerPage.getByRole('button',{name:'+ Follow creator'}).click();
    await expect(viewerPage.getByRole('button',{name:/Following/})).toBeVisible();

    // Independent permission flags: comment-only denial must not block authorized viewing.
    const commentOnly=await creator.request.post(`/api/local/creators/${creatorId}/restrictions/${viewerId}`,{
      data:{view:false,comment:true,message:false},
    });
    await readJson(commentOnly);
    expect((await viewer.request.get(`/api/local/lessons/${lessonId}/video`,{
      headers:{range:'bytes=0-4'},
    })).status()).toBe(206);
    const deniedComment=await viewer.request.post(`/api/local/lessons/${lessonId}/comments`,{
      data:{text:'This comment must be blocked',creationKey:`denied-browser-${suffix}-comment`},
    });
    expect(deniedComment.status()).toBe(403);

    // Viewing restriction must prevent direct media and full-post retrieval, not just hide UI.
    const rule=await creator.request.post(`/api/local/creators/${creatorId}/restrictions/${viewerId}`,{
      data:{view:true,comment:false,message:false},
    });
    await readJson(rule);
    expect((await viewer.request.get(`/api/local/lessons/${lessonId}/video`)).status()).toBe(403);
    expect((await viewer.request.head(`/api/local/lessons/${lessonId}/video`)).status()).toBe(403);
    expect((await viewer.request.get(`/api/local/lessons/${lessonId}/video`,{
      headers:{range:'bytes=0-4'},
    })).status()).toBe(403);
    expect((await viewer.request.get(`/api/local/lessons/${lessonId}/notes`)).status()).toBe(403);
    expect((await viewer.request.get(`/api/local/lessons/${lessonId}`)).status()).toBe(403);
    expect((await viewer.request.get(`/api/local/lessons/${lessonId}/comments`)).status()).toBe(403);
    await viewerPage.goto(`/lessons/${lessonId}`);
    await expect(viewerPage.getByText('Full posts require verified student membership',{exact:false})).toBeVisible();
    // The real local backend is tested with a secret invitation code in Node;
    // this browser-only response override tests the private-code field without
    // configuring a real invitation or exposing an email in public CI logs.
    const invitePage=await viewer.newPage();
    await invitePage.route('**/api/local/health',route=>route.fulfill({
      status:200,contentType:'application/json',body:JSON.stringify({state:'local',pilotInviteOnly:true})
    }));
    await invitePage.goto('/join');
    await expect(invitePage.locator('#inviteCode')).toBeVisible();
    await expect(invitePage.locator('#inviteCode')).toHaveAttribute('required','');
    await expect(invitePage.locator('#inviteCode')).toHaveAttribute('type','password');
    await invitePage.close();
    console.log('browser-alpha: creator moderation and revocation passed');
  }finally{
    await Promise.all([admin.close(),creator.close(),viewer.close()]);
  }
});


test('mobile shell communicates offline state and recovers without replaying actions', async ({browser}) => {
  const context = await browser.newContext({baseURL: BASE, viewport: {width: 360, height: 780}});
  try {
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('navigation', {name: 'Mobile navigation'})).toBeVisible();
    const offline = page.getByText("You're offline.", {exact: false});
    await expect(offline).toHaveCount(0);
    await context.setOffline(true);
    await expect(offline).toBeVisible();
    await context.setOffline(false);
    await expect(offline).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', {name:'Skip to content'})).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    await expect(page.getByRole('main')).toBeFocused();
    const width = await page.evaluate(() => ({viewport: window.innerWidth, document: document.documentElement.scrollWidth}));
    expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
  } finally {
    await context.close();
  }
});


test('mobile navigation announces the current route and supports small screens',async({browser})=>{
  const context=await browser.newContext({baseURL:BASE,viewport:{width:320,height:740}});
  try{
    const page=await context.newPage();
    await page.goto('/');
    const nav=page.getByRole('navigation',{name:'Mobile navigation'});
    await expect(nav.getByRole('link',{name:'Home'})).toHaveAttribute('aria-current','page');
    await expect(nav.locator('[aria-current]')).toHaveCount(1);
    await nav.getByRole('link',{name:'Explore'}).click();
    await expect(page).toHaveURL(/\/search$/);
    await expect(nav.getByRole('link',{name:'Explore'})).toHaveAttribute('aria-current','page');
    await expect(nav.locator('[aria-current]')).toHaveCount(1);
    const sizes=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1&&getComputedStyle(el).position!=='absolute';}).slice(0,10).map(el=>({tag:el.tagName,className:String(el.className),right:Math.round(el.getBoundingClientRect().right)}))}));
    expect(sizes.document,JSON.stringify(sizes.offenders)).toBeLessThanOrEqual(sizes.viewport+1);
    await page.setViewportSize({width:1280,height:800});
    await expect(nav).not.toBeVisible();
  }finally{await context.close();}
});

test('missing page has a keyboard-reachable recovery route',async({browser})=>{
  const context=await browser.newContext({baseURL:BASE,viewport:{width:360,height:780}});
  try{
    const page=await context.newPage();
    const response=await page.goto('/not-a-student-creators-route');
    expect(response.status()).toBe(404);
    const main=page.getByRole('main');
    await expect(main.getByRole('heading',{name:'This page is unavailable.'})).toBeVisible();
    const home=main.getByRole('link',{name:'Go home'});
    await home.focus();
    await expect(home).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(BASE+'/');
    await expect(page.getByRole('heading',{name:'The student feed',exact:false})).toBeVisible();
  }finally{await context.close();}
});

test('registration read failure can be retried without submitting registration',async({browser})=>{
  const context=await browser.newContext({baseURL:BASE,viewport:{width:360,height:780}});
  try{
    const page=await context.newPage();
    let institutionReads=0,registrationWrites=0;
    await page.route('**/api/local/institutions',async route=>{
      institutionReads++;
      if(institutionReads===1)return route.abort('failed');
      return route.continue();
    });
    await page.route('**/api/local/auth/register',async route=>{
      registrationWrites++;
      return route.abort('blockedbyclient');
    });
    await page.goto('/join');
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Campus registration is temporarily unavailable');
    await page.getByRole('button',{name:'Retry loading campuses'}).click();
    await expect(page.locator('#campus')).toBeVisible();
    expect(institutionReads).toBe(2);
    expect(registrationWrites).toBe(0);
  }finally{await context.close();}
});

test('touch-enabled mobile Chromium keeps navigation usable in portrait and landscape',async({browser})=>{
  // This is a desktop-hosted browser simulation, not an Android emulator/device.
  const context=await browser.newContext({baseURL:BASE,viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:2.625,reducedMotion:'reduce'});
  try{
    const page=await context.newPage();
    await page.goto('/');
    const nav=page.getByRole('navigation',{name:'Mobile navigation'});
    await expect(nav).toBeVisible();
    const explore=nav.getByRole('link',{name:'Explore'});
    const bounds=await explore.boundingBox();
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    await explore.tap();
    await expect(page).toHaveURL(new RegExp('/search$'));
    await expect(page.getByRole('heading',{name:'Search approved lessons.'})).toBeVisible();
    for(const viewport of [{width:412,height:915},{width:915,height:412}]){
      await page.setViewportSize(viewport);
      const sizes=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
      expect(sizes.document).toBeLessThanOrEqual(sizes.viewport+1);
    }
    // Wider landscape falls back to the existing sidebar, not a second mobile shell.
    await expect(nav).not.toBeVisible();
    await expect(page.getByRole('link',{name:'Student Creators home'})).toBeVisible();
  }finally{await context.close();}
});


test('public and gated page shells reflow at phone, tablet and desktop widths',async({browser})=>{
  test.setTimeout(120000);
  const context=await browser.newContext({baseURL:BASE,viewport:{width:320,height:740}});
  try{
    const page=await context.newPage();
    const routes=['/','/search','/join','/sign-in','/recover-account','/account-security','/studio','/saved','/messages','/purchases','/verification','/manage'];
    for(const route of routes){
      await page.goto(route);
      const main=page.getByRole('main');
      await expect(main,`main landmark: ${route}`).toBeVisible();
      await expect(main).toHaveAttribute('id','main');
      await expect(main.getByRole('heading',{level:1}),`primary heading: ${route}`).toHaveCount(1);
      await assertNamedFormControls(main,route);
      for(const width of [320,360,412,768,1280]){
        await page.setViewportSize({width,height:800});
        const sizes=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1&&getComputedStyle(el).position!=='absolute';}).slice(0,6).map(el=>({tag:el.tagName,className:String(el.className),right:Math.round(el.getBoundingClientRect().right)}))}));
        expect(sizes.document,`${route} at ${width}px: ${JSON.stringify(sizes.offenders)}`).toBeLessThanOrEqual(sizes.viewport+1);
      }
    }
    await page.setViewportSize({width:320,height:740});
    await page.goto('/');
    const accountNav=page.getByRole('navigation',{name:'Account and saved posts'});
    await expect(accountNav).toBeVisible();
    await accountNav.getByRole('link',{name:'Sign in'}).focus();
    await expect(accountNav.getByRole('link',{name:'Sign in'})).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp('/sign-in$'));
  }finally{await context.close();}
});


test('release liveness endpoint is non-cacheable and exposes no provider configuration',async({request})=>{
  const response=await request.get(BASE+'/api/health');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['set-cookie']).toBeUndefined();
  expect(await response.json()).toEqual({status:'serving',environment:'local',revision:null});
});
