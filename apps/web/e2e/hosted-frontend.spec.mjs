import {test,expect} from '@playwright/test';
const BASE='http://localhost:3000',actor='11111111-1111-4111-8111-111111111111',course='22222222-2222-4222-8222-222222222222',lesson='33333333-3333-4333-8333-333333333333',order='44444444-4444-4444-8444-444444444444';
test('isolated hosted frontend exercises community, checkout, history and responsive failure states',async({browser})=>{
 const context=await browser.newContext({baseURL:BASE,viewport:{width:390,height:844}});
 const page=await context.newPage();let joined=false,posts=[],checkoutCalls=0;
 try{
 await page.route('**/api/hosted-auth/refresh',r=>r.fulfill({json:{accessToken:'one.two.three',userId:actor,expiresIn:3600}}));
 // Browser-side contract fixtures only. Never reach a real provider or persist test data.
 await page.route('**/api/social/**',async r=>{
  const op=new URL(r.request().url()).pathname.split('/').pop();
  const body=r.request().postDataJSON();
  if(body.courseId!==course)return r.fulfill({status:403,json:{error:'FORBIDDEN'}});
  if(op==='joinCommunity')joined=true;
  if(op==='leaveCommunity')joined=false;
  if(op==='communityPost'){posts.push({id:lesson,course_id:course,parent_id:null,body:body.text,created_at:'2026-11-25T10:00:00Z'});return r.fulfill({json:{id:lesson,replayed:false}});}
  if(op==='communityPosts')return r.fulfill({json:joined?posts:[]});
  return r.fulfill({json:{joined,memberCount:joined?1:0,canModerate:false}});
 });
 await page.route('**/api/account/purchases',r=>r.fulfill({json:{orders:[{id:order,contentId:lesson,amountKobo:20000,currency:'NGN',environment:'test',status:'pending',createdAt:'2026-11-25T10:00:00Z',accessRecorded:false}],truncated:false}}));
 await page.route('**/api/account/checkout-quote/**',r=>r.fulfill({json:{priceKobo:20000,currency:'NGN'}}));
 await page.route('**/api/lessons/**/hosted-checkout',r=>{checkoutCalls++;expect(r.request().headers()['idempotency-key']).toMatch(/^[A-Za-z0-9_-]{16,128}$/);expect(r.request().postData()).toBeNull();return r.fulfill({json:{orderId:order,authorizationUrl:'https://checkout.paystack.com/isolated-browser-fixture'}});});
 await page.goto('/communities/'+course);
 await page.getByRole('button',{name:'Join discussion'}).click();
 await expect(page.getByRole('button',{name:'Leave discussion'})).toBeVisible();
 await page.getByLabel('Start a discussion').fill('Original isolated question');
 await page.getByRole('button',{name:'Post to class'}).click();
 await expect(page.getByText('Original isolated question',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Leave discussion'}).click();
 await expect(page.getByRole('button',{name:'Join discussion'})).toBeVisible();
 await expect(page.getByText('Original isolated question',{exact:true})).toHaveCount(0);
 await page.goto('/lessons/'+lesson);
 await expect(page.getByRole('button',{name:'Request test checkout'})).toBeDisabled();
 await page.getByRole('button',{name:'Check current access price'}).click();
 await expect(page.getByRole('button',{name:'Request test checkout'})).toBeEnabled();
 await page.getByRole('button',{name:'Request test checkout'}).click();
 await expect(page.getByRole('link',{name:'Continue to Paystack test checkout'})).toHaveAttribute('href','https://checkout.paystack.com/isolated-browser-fixture');
 expect(checkoutCalls).toBe(1);
 await page.goto('/purchases');
 await expect(page.getByText('No active access record returned.')).toBeVisible();
 await expect(page.getByText('Test order (no real funds) · pending')).toBeVisible();
 await page.goto('/classes');
 await page.getByLabel('Class ID').fill(lesson);
 await expect(page.getByRole('button',{name:'Join live class'})).toBeDisabled();
 await expect(page.getByText('Live classes require the verified SDK integrity configuration.')).toBeVisible();
 for(const width of [320,360,390,768,1280]){
  await page.setViewportSize({width,height:844});
  for(const path of ['/classes','/purchases','/communities/'+course,'/lessons/'+lesson]){
   await page.goto(path);await expect(page.locator('main h1')).toBeVisible();
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
  }
 }
 }finally{await context.close();}
});
