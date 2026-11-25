import {test,expect} from '@playwright/test';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openLocalStore} from '../../../packages/local-core/src/store.mjs';
import {createPaystackClient} from '../../../packages/payment-core/src/paystack-client.mjs';

test('synthetic verified payment through protected playback and refund',async({browser,request})=>{
 test.skip(!process.env.PAYMENT_FIXTURE_FILE,'Requires isolated synthetic fixture, never real accounts');
 const f=JSON.parse(readFileSync(process.env.PAYMENT_FIXTURE_FILE,'utf8'));
 const context=await browser.newContext({baseURL:'http://localhost:3000'});
 await context.addCookies([{name:'campus_local_session',value:f.buyer.token,url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();
 const store=openLocalStore(f.path);
 try{
  const course=store.listCourses().find(c=>c.institutionId===f.creator.user.institutionId);
  f.id=store.createDraft(f.creator.user,{courseId:course.id,title:'Synthetic browser paid work',description:'Original',previewText:'Preview',lessonText:'An independent original synthetic explanation with worked steps and discussion. '.repeat(3),rightsAttested:true,creationKey:randomUUID()}).lesson.id;
  store.setLessonPrice(f.creator.user,f.id,20000);
  let codec='structural',filename='synthetic-1s.mp4.base64';
  if(process.env.PLAYWRIGHT_VALIDATE_CODEC==='1'){
   codec=await page.evaluate(()=>{
    const video=document.createElement('video');
    if(video.canPlayType('video/mp4; codecs="avc1.42c01e"'))return 'h264';
    if(video.canPlayType('video/mp4; codecs="vp09.00.10.08"'))return 'vp9';
    return 'unsupported';
   });
   expect(['h264','vp9']).toContain(codec);
   filename=codec==='h264'?'synthetic-playable-h264.mp4.base64':'synthetic-playable-vp9.mp4.base64';
  }
  const media=Buffer.from(readFileSync(new URL('../../../packages/local-core/test/fixtures/'+filename,import.meta.url),'utf8'),'base64');
  if(codec!=='structural')expect(createHash('sha256').update(media).digest('hex')).toBe(
    codec==='h264'?'d0ff3303abf0f3d98c364ce8a6512e03b3742650e17cbf589ca4a85e4c6c0b79':'7363779f4ba238f2007a5573009b1cd4ca2310e5de3a600c8fdefde25da2f2cf');
  store.saveVideo(f.creator.user,f.id,media);
  store.submit(f.creator.user,f.id);store.review(f.admin.user,f.id,{decision:'approve',reason:'Synthetic original browser work'});
  const created=await context.request.post(`/api/local/lessons/${f.id}/orders`,{headers:{origin:'http://localhost:3000'},data:{requestKey:randomUUID()}});
  expect(created.status()).toBe(201);f.order=(await created.json()).order;
  const videoPath=`/api/local/lessons/${f.id}/video`;
  expect((await context.request.get(videoPath)).status()).toBe(402);
  // Real server adapter, synthetic PSP transport: no network and no live keys.
  const gateway=createPaystackClient({environment:'test',secretKey:'sk_test_SyntheticOnly',fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify({status:true,data:{status:'success',id:'browser_'+f.id,reference:f.order.reference,amount:20000,currency:'NGN',domain:'test',customer:{email:'buyer@example.invalid'},fees:100}})})});
  await store.reconcilePurchase(f.buyer.user,f.order.reference,gateway);
  expect(store.paymentReconciliation(f.admin.user).balanced).toBe(true);
  await page.goto(`/lessons/${f.id}`);
  await page.getByRole('button',{name:'Enable playback'}).click();
  await expect(page.locator('video')).toBeVisible();
  // The tiny ISO-BMFF security fixture is structurally valid but Chromium
  // builds may not ship an H.264 decoder. Never silently call this proof of
  // real playback: assert protected GET/range separately and disclose any
  // codec limitation, while still checking UI watermark and revocation.
  if(process.env.PLAYWRIGHT_VALIDATE_CODEC==='1'){
    // Opt-in codec validation requires a browser and media fixture with
    // matching decoder support; do not silently pass a NotSupportedError.
    expect(['h264','vp9']).toContain(codec);
    const cdp=await context.newCDPSession(page);
    try{
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:75000});
      await page.locator('video').evaluate(v=>{v.muted=true;return v.play();});
      await expect.poll(()=>page.locator('video').evaluate(v=>v.currentTime),{timeout:10000}).toBeGreaterThan(.2);
      const decoded=await page.locator('video').evaluate(v=>{v.pause();return {width:v.videoWidth,height:v.videoHeight,position:v.currentTime,duration:v.duration};});
      expect(decoded.width).toBe(64);expect(decoded.height).toBe(64);expect(decoded.duration).toBeGreaterThan(1);
      console.log('Synthetic protected playback decoded under constrained Chromium network',JSON.stringify({codec,...decoded}));
    }finally{
      await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      await cdp.detach();
    }
  }else{
    console.warn('Synthetic CI validates paid-media authorization, byte ranges, watermark and refund, NOT video codec decoding. Run a separate real Android/Chrome media acceptance.');
  }
  // Renewing an authorization must NOT remount the HTMLMediaElement or
  // reset its playback clock. The fixture's codec is verified separately.
  const previousPosition=await page.locator('video').evaluate(v=>{window.__beforeRenewVideo=v;return v.currentTime;});
  await page.getByRole('button',{name:'Renew video access'}).click();
  await expect(page.getByRole('button',{name:'Renew video access'})).toBeVisible();
  expect(await page.locator('video').evaluate(v=>window.__beforeRenewVideo===v)).toBe(true);
  if(process.env.PLAYWRIGHT_VALIDATE_CODEC==='1')expect(await page.locator('video').evaluate(v=>v.currentTime)).toBeGreaterThanOrEqual(previousPosition-.1);
  const watermark=page.getByTestId('playback-watermark');
  await expect(watermark).toBeVisible();await expect(watermark).toHaveText(/^WK-[a-f0-9]{12} · [a-f0-9]{8}$/);
  expect(await watermark.textContent()).not.toContain('@');
  const before=await watermark.getAttribute('data-position');
  await expect.poll(()=>watermark.getAttribute('data-position'),{timeout:12000}).not.toBe(before);
  const range=await context.request.get(videoPath,{headers:{range:'bytes=0-4'}});expect(range.status()).toBe(206);
  expect((await request.get('http://localhost:3000'+videoPath)).status()).toBe(401);
  const other=await browser.newContext({baseURL:'http://localhost:3000'});
  await other.addCookies([{name:'campus_local_session',value:f.other.token,url:'http://localhost:3000',httpOnly:true,sameSite:'Lax'}]);
  expect((await other.request.get(videoPath)).status()).toBe(402);await other.close();
  await page.getByRole('button',{name:'Fullscreen',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement?.querySelector('[data-testid="playback-watermark"]')))).toBe(true);
  await page.evaluate(()=>document.exitFullscreen());
  // A short-lived synthetic UI grant preserves the real server response and
  // cookie, but exercises the client timer independently of real time.
  const grantPath='**/api/local/lessons/'+f.id+'/playback-grant';
  let shortGrantRequests=0;
  await page.clock.install();
  await page.route(grantPath,async route=>{
    shortGrantRequests++;
    const response=await route.fetch();
    const grant=await response.json();
    if(response.ok())grant.expiresAt=Math.floor(Date.now()/1000)+90;
    await route.fulfill({response,json:grant});
  });
  try{
    await page.reload();
    await page.getByRole('button',{name:'Enable playback'}).click();
    await expect(page.locator('video')).toBeVisible();
    await page.locator('video').evaluate(v=>v.pause());
    await page.clock.fastForward(50000);
    expect(shortGrantRequests).toBe(1);
    await expect(page.locator('video')).toBeVisible();
    await page.clock.fastForward(45000);
    await expect(page.locator('video')).toHaveCount(0);
    await expect(page.getByText('Video access expired.',{exact:false})).toBeVisible();
    expect(shortGrantRequests).toBe(1);
  }finally{await page.unroute(grantPath);}
  store.setCreatorRestrictions(f.creator.user,f.creator.user.id,f.buyer.user.id,{view:true,comment:false,message:false});
  expect((await context.request.get(videoPath,{headers:{range:'bytes=0-4'}})).status()).toBe(403);
  await page.goto('/purchases');
  await expect(page.getByRole('heading',{name:'Access reviews'})).toBeVisible();
  await expect(page.getByText('Contact support with your case reference to request a review.',{exact:false})).toBeVisible();
  store.setCreatorRestrictions(f.creator.user,f.creator.user.id,f.buyer.user.id,{view:false,comment:false,message:false});
  store.simulatePaymentReversal(f.admin.user,f.order.reference,{kind:'refund',eventKey:'browser-refund-'+f.id,reason:'Synthetic browser refund test'});
  expect((await context.request.get(videoPath,{headers:{range:'bytes=0-4'}})).status()).toBe(402);
  const ledger=store.paymentReconciliation(f.admin.user);expect(ledger.creatorPendingKobo).toBe(0);expect(ledger.balanced).toBe(true);
 }finally{store.close();await context.close();}
});
