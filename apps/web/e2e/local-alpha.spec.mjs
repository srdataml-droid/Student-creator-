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

    await viewerPage.goto('/');
    await expect(viewerPage.getByRole('heading',{name:title})).toBeVisible();
    await viewerPage.goto(`/lessons/${lessonId}`);
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
