import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
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
  store.saveVideo(f.creator.user,f.id,Buffer.from(readFileSync(new URL('../../../packages/local-core/test/fixtures/synthetic-1s.mp4.base64',import.meta.url),'utf8'),'base64'));
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
    await page.locator('video').evaluate(v=>{v.muted=true;return v.play();});
    await expect.poll(()=>page.locator('video').evaluate(v=>v.currentTime)).toBeGreaterThan(0);
  }else{
    console.warn('Synthetic CI validates paid-media authorization, byte ranges, watermark and refund, NOT video codec decoding. Run a separate real Android/Chrome media acceptance.');
  }
  // Renewing an authorization must NOT remount the HTMLMediaElement or
  // reset its playback clock. The fixture's codec is verified separately.
  await page.locator('video').evaluate(v=>{window.__beforeRenewVideo=v;});
  await page.getByRole('button',{name:'Renew video access'}).click();
  await expect(page.getByRole('button',{name:'Renew video access'})).toBeVisible();
  expect(await page.locator('video').evaluate(v=>window.__beforeRenewVideo===v)).toBe(true);
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
  store.setCreatorRestrictions(f.creator.user,f.creator.user.id,f.buyer.user.id,{view:true,comment:false,message:false});
  expect((await context.request.get(videoPath,{headers:{range:'bytes=0-4'}})).status()).toBe(403);
  await page.goto('/purchases');
  await expect(page.getByRole('heading',{name:'Access reviews'})).toBeVisible();
  await expect(page.getByText('Ask the platform operator to review this case reference.',{exact:false})).toBeVisible();
  store.setCreatorRestrictions(f.creator.user,f.creator.user.id,f.buyer.user.id,{view:false,comment:false,message:false});
  store.simulatePaymentReversal(f.admin.user,f.order.reference,{kind:'refund',eventKey:'browser-refund-'+f.id,reason:'Synthetic browser refund test'});
  expect((await context.request.get(videoPath,{headers:{range:'bytes=0-4'}})).status()).toBe(402);
  const ledger=store.paymentReconciliation(f.admin.user);expect(ledger.creatorPendingKobo).toBe(0);expect(ledger.balanced).toBe(true);
 }finally{store.close();await context.close();}
});
