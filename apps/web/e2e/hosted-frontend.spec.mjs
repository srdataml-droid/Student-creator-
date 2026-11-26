import {test,expect} from '@playwright/test';
const BASE='http://localhost:3000',actor='11111111-1111-4111-8111-111111111111',course='22222222-2222-4222-8222-222222222222',lesson='33333333-3333-4333-8333-333333333333',order='44444444-4444-4444-8444-444444444444';
test('isolated hosted frontend exercises community, checkout, history and responsive failure states',async({browser})=>{
 const context=await browser.newContext({baseURL:BASE,viewport:{width:390,height:844}});
 const page=await context.newPage();let joined=false,posts=[],checkoutCalls=0,saved=false,enrolled=false;
 const now=Date.now(),sessions=Array.from({length:4},(_,i)=>({id:'55555555-5555-4555-8555-'+String(i+1).padStart(12,'0'),host_id:order,title:'Isolated night class '+(i+1),description:'Test fixture only',starts_at:new Date(now+3600000*(i+1)).toISOString(),ends_at:new Date(now+3600000*(i+2)).toISOString(),status:'scheduled',price_kobo:0,currency:'NGN'}));
 try{
 await page.route('**/api/hosted-auth/refresh',r=>r.fulfill({json:{accessToken:'one.two.three',userId:actor,expiresIn:3600}}));
 await page.route('**/api/account/state',r=>r.fulfill({json:{userId:actor,student:true,admin:false,profile:{displayName:'Synthetic learner'},requests:[],drafts:[]}}));
 // Browser-side contract fixtures only. Never reach a real provider or persist test data.
 await page.route('**/api/social/**',async r=>{
  const op=new URL(r.request().url()).pathname.split('/').pop();
  const body=r.request().postDataJSON();
  if(op==='bookmarks')return r.fulfill({json:saved?[{content_id:lesson,created_at:'2026-11-25T10:00:00Z'}]:[]});
  if(op==='bookmark'||op==='unbookmark'){saved=op==='bookmark';return r.fulfill({json:{bookmarked:saved,replayed:false}});}
  if(op==='availableClasses')return r.fulfill({json:body.classId?sessions.filter(c=>c.id===body.classId):sessions});
  if(op==='myCommunities')return r.fulfill({json:[{course_id:course,course:{id:course,code:'MTH101',title:'Isolated joined community',active:true}}]});
  if(op==='classes')return r.fulfill({json:[{id:lesson,host_id:order,title:'Synthetic calculus class',description:'Isolated classroom fixture',starts_at:'2026-12-01T10:00:00Z',ends_at:'2026-12-01T11:00:00Z',status:'scheduled',price_kobo:0,currency:'NGN'}]});
  if(op==='enrollClass'||op==='withdrawClass'){enrolled=op==='enrollClass';return r.fulfill({json:{id:lesson,status:enrolled?'enrolled':'withdrawn'}});}
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
 await page.goto('/');
 await page.getByRole('button',{name:'Search Student Creators',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Search Student Creators'})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog',{name:'Search Student Creators'})).toBeHidden();
 await expect(page.getByRole('complementary',{name:'Available night class'})).toContainText(sessions[0].title);
 await page.getByRole('button',{name:'Dismiss night class announcement'}).click();
 await expect(page.getByRole('complementary',{name:'Available night class'})).toHaveCount(0);
 await page.reload();
 await expect(page.getByRole('complementary',{name:'Available night class'})).toHaveCount(0);
 await page.goto('/communities');
 const preview=page.getByRole('region',{name:'Night classes'});
 await expect(preview.getByRole('link',{name:/Isolated night class/})).toHaveCount(3);
 await preview.getByRole('link',{name:/Isolated night class 1/}).click();
 await expect(page.getByRole('heading',{name:'Session details'})).toBeVisible();
 await expect(page.getByRole('heading',{name:sessions[0].title})).toBeVisible();
 await expect(page.getByRole('heading',{name:sessions[1].title})).toHaveCount(0);
 await page.getByRole('link',{name:'All night classes'}).click();
 await expect(page.getByRole('heading',{name:sessions[3].title})).toBeVisible();
 await page.getByRole('link',{name:'My communities',exact:true}).click();
 await expect(page.getByRole('link',{name:/Isolated joined community/})).toBeVisible();
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
 await page.goto('/lessons/'+lesson);
 await page.getByRole('button',{name:'Save post',exact:true}).click();
 await expect(page.getByRole('button',{name:'Remove from saved'})).toBeVisible();
 await page.goto('/saved');
 await expect(page.getByRole('link',{name:'Open saved post'})).toBeVisible();
 await page.getByRole('button',{name:'Remove saved post'}).click();
 await expect(page.getByText('No saved posts.',{exact:false})).toBeVisible();
 await page.goto('/classes');
 await expect(page.getByRole('heading',{name:'Synthetic calculus class'})).toBeVisible();
 await page.getByRole('button',{name:'Enroll',exact:true}).click();
 await expect(page.getByText('Server confirmed enrolled.')).toBeVisible();
 await page.getByRole('button',{name:'Withdraw enrollment'}).click();
 await expect(page.getByText('Server confirmed withdrawn.')).toBeVisible();
 await page.goto('/classes/'+lesson+'/room');
 await expect(page.getByRole('button',{name:'Join live class'})).toBeDisabled();
 await expect(page.getByText('Live classes require the verified SDK integrity configuration.')).toBeVisible();
 for(const width of [320,360,390,768,1280]){
  await page.setViewportSize({width,height:844});
  for(const path of ['/classes','/purchases','/saved','/communities','/communities?tab=night','/communities/'+course,'/lessons/'+lesson]){
   await page.goto(path);await expect(page.locator('main h1')).toBeVisible();
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth),{message:'Overflow at '+width+' on '+path}).toBeLessThanOrEqual(1);
  }
 }
 }finally{await context.close();}
});
