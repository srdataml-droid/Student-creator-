import {test,expect} from '@playwright/test';
const BASE='http://localhost:3000',actor='11111111-1111-4111-8111-111111111111',course='22222222-2222-4222-8222-222222222222',lesson='33333333-3333-4333-8333-333333333333',order='44444444-4444-4444-8444-444444444444';
test('isolated hosted frontend exercises community, checkout, history and responsive failure states',async({browser})=>{
 const context=await browser.newContext({baseURL:BASE,viewport:{width:390,height:844}});
 const page=await context.newPage();let joined=false,posts=[],checkoutCalls=0,saved=false,enrolled=false,commentReply=null,liked=false,followed=false;
 const now=Date.parse('2026-11-26T20:00:00Z'),sessions=Array.from({length:4},(_,i)=>({id:'55555555-5555-4555-8555-'+String(i+1).padStart(12,'0'),host_id:order,title:'Isolated night class '+(i+1),description:'Test fixture only',starts_at:new Date(now+3600000*(i===0?-1:i+1)).toISOString(),ends_at:new Date(now+3600000*(i===0?1:i+2)).toISOString(),status:i===0?'room_open':'scheduled',price_kobo:0,currency:'NGN'}));
 try{
 await page.clock.setFixedTime(new Date(now));
 await page.route('**/api/hosted-auth/refresh',r=>r.fulfill({json:{accessToken:'one.two.three',userId:actor,expiresIn:3600}}));
 await page.route('**/api/account/state',r=>r.fulfill({json:{userId:actor,student:true,admin:false,profile:{displayName:'Synthetic learner',institutionId:course},requests:[],drafts:[]}}));
 // Browser-side contract fixtures only. Never reach a real provider or persist test data.
 await page.route('**/api/social/**',async r=>{
  const op=new URL(r.request().url()).pathname.split('/').pop();
  const body=r.request().postDataJSON();
  if(op==='comments')return r.fulfill({json:[{id:order,content_id:lesson,author_id:course,parent_id:null,body:'Original fixture comment',created_at:'2026-11-25T10:00:00Z'}]});
  if(op==='myLikes'||op==='isLiked')return r.fulfill({json:liked?[{content_id:lesson}]:[]});
  if(op==='like'||op==='unlike'){expect(body.contentId).toBe(lesson);liked=op==='like';return r.fulfill({json:{liked}});}
  if(op==='isFollowing')return r.fulfill({json:followed?[{creator_id:order}]:[]});
  if(op==='follow'||op==='unfollow'){expect(body.creatorId).toBe(order);followed=op==='follow';return r.fulfill({json:{following:followed}});}
  if(op==='comment'){commentReply=body.replyTo;return r.fulfill({json:{id:lesson,replayed:false}});}
  if(op==='feed'){if(body.institutionId)expect(body.institutionId).toBe(course);return r.fulfill({json:[{id:lesson,creatorId:order,title:'Isolated original content',displayName:'Test creator',institutionName:'Test campus',courseCode:'MTH101',previewText:'Fixture only',priceKobo:30000,following:false}]});}
  if(op==='bookmarks'||op==='isBookmarked')return r.fulfill({json:saved?[{content_id:lesson,created_at:'2026-11-25T10:00:00Z'}]:[]});
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
 await page.route('**/api/discovery?ids=*',r=>{expect(new URL(r.request().url()).searchParams.get('ids')).toBe(lesson);return r.fulfill({json:{items:[{id:lesson,title:'Isolated original content',displayName:'Test creator',courseCode:'MTH101'}],page:1,hasNext:false}});});
 await page.route('**/api/account/purchases',r=>r.fulfill({json:{orders:[{id:order,contentId:lesson,amountKobo:20000,currency:'NGN',environment:'test',status:'pending',createdAt:'2026-11-25T10:00:00Z',accessRecorded:false}],truncated:false}}));
 await page.route('**/api/account/checkout-quote/**',r=>r.fulfill({json:{priceKobo:30000,currency:'NGN',accessAvailable:false}}));
 await page.route('**/api/lessons/**/hosted-checkout',r=>{checkoutCalls++;expect(r.request().headers()['idempotency-key']).toMatch(/^[A-Za-z0-9_-]{16,128}$/);expect(r.request().postData()).toBeNull();return r.fulfill({json:{orderId:order,authorizationUrl:'https://checkout.paystack.com/isolated-browser-fixture'}});});
 await page.addInitScript(({actor,lesson})=>{localStorage.setItem('student-creators:resume:'+actor+':'+lesson,'65');Object.defineProperty(navigator,'share',{value:undefined,configurable:true});},{actor,lesson});
 await page.goto('/');
 await expect(page.getByRole('region',{name:'Continue watching'}).getByRole('link')).toContainText('Resume at 1:05');
 await page.getByRole('button',{name:'Your campus',exact:true}).click();
 await expect(page.getByRole('button',{name:'Your campus',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('link',{name:'Isolated original content',exact:true})).toBeVisible();
 const card=page.locator('.watch-card').filter({has:page.getByRole('link',{name:'Isolated original content',exact:true})});
 await card.getByRole('button',{name:'Like',exact:true}).click();
 await expect(card.getByRole('button',{name:'Liked',exact:true})).toHaveAttribute('aria-pressed','true');
 await card.getByRole('button',{name:'Liked',exact:true}).click();
 await expect(card.getByRole('button',{name:'Like',exact:true})).toHaveAttribute('aria-pressed','false');
 await card.getByRole('button',{name:'Follow',exact:true}).click();
 await expect(card.getByRole('button',{name:'Following',exact:true})).toHaveAttribute('aria-pressed','true');
 await card.getByRole('button',{name:'Save',exact:true}).click();
 await expect(card.getByRole('button',{name:'Saved',exact:true})).toHaveAttribute('aria-pressed','true');
 await card.getByRole('button',{name:'Saved',exact:true}).click();
 await expect(card.getByRole('button',{name:'Save',exact:true})).toHaveAttribute('aria-pressed','false');
 await card.getByRole('button',{name:/Pay ₦[\d,]+ to watch/}).click();
 const access=page.getByRole('dialog',{name:'Viewing access'});
 await expect(access).toContainText('₦300');
 await expect(access.getByRole('button',{name:'Request test checkout'})).toBeEnabled();
 expect(checkoutCalls).toBe(0);
 await access.getByRole('button',{name:'Close',exact:true}).click();
 await card.getByRole('button',{name:'Share',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Content page link'})).toHaveValue(BASE+'/lessons/'+lesson);
 await page.goto('/create');
 await expect(page.getByRole('link',{name:/Upload a video/})).toHaveAttribute('href','/studio?format=video#studio-create');
 await expect(page.getByRole('link',{name:/Create a short/})).toHaveAttribute('href','/studio?format=short#studio-create');
 await expect(page.getByRole('link',{name:/Go live/})).toHaveAttribute('href','/classes');
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
 await page.goto('/search?q=Python&courseId='+course);
 await expect(page.getByLabel('Search published content')).toHaveValue('Python');
 await expect(page.locator('.viewer-search-page .watch-catalog')).toBeVisible();
 await page.goto('/lessons/'+lesson);
 await expect(page.getByRole('region',{name:'Video player'})).toBeVisible();
 await expect(page.getByRole('complementary',{name:'Related videos'})).toBeVisible();
 const mobilePlayer=await page.locator('.watch-player-frame').boundingBox();
 expect(mobilePlayer.width).toBeGreaterThanOrEqual(388);
 expect(Math.abs(mobilePlayer.width/mobilePlayer.height-16/9)).toBeLessThan(.04);
 await page.setViewportSize({width:1280,height:800});
 const primary=await page.locator('.viewer-watch-primary').boundingBox(),rail=await page.locator('.viewer-related').boundingBox();
 expect(rail.x).toBeGreaterThan(primary.x+primary.width);
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Load discussion and likes'}).click();
 await page.getByRole('button',{name:'Reply',exact:true}).click();
 await page.getByLabel('Your reply',{exact:true}).fill('Reply from browser acceptance');
 await page.getByRole('button',{name:'Post comment'}).click();
 await expect(page.getByText('Comment accepted.')).toBeVisible();
 expect(commentReply).toBe(order);
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
 await expect(page.getByRole('region',{name:'Saved content'}).getByRole('link',{name:/Isolated original content/})).toBeVisible();
 await page.getByRole('button',{name:'Remove saved post'}).click();
 await expect(page.getByRole('heading',{name:'No saved posts yet'})).toBeVisible();
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
  for(const path of ['/create','/classes','/purchases','/saved','/communities','/communities?tab=night','/communities/'+course,'/lessons/'+lesson]){
   await page.goto(path);await expect(page.locator('main h1')).toBeVisible();
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth),{message:'Overflow at '+width+' on '+path}).toBeLessThanOrEqual(1);
  }
 }
 }finally{await context.close();}
});

test('public home retains content layout when account refresh is unavailable',async({browser})=>{const context=await browser.newContext({baseURL:BASE,viewport:{width:390,height:844}});try{const page=await context.newPage();await page.route('**/api/hosted-auth/refresh',r=>r.fulfill({status:503,json:{error:'HOSTED_AUTH_UNAVAILABLE'}}));await page.goto('/');await expect(page.getByRole('heading',{name:'Recommended for you'})).toBeVisible();await expect(page.getByRole('region',{name:'Empty content spaces'})).toHaveCount(0);await expect(page.getByRole('complementary',{name:'Available night class'})).toHaveCount(0);await expect(page.getByRole('link',{name:'Shorts',exact:true}).first()).toBeVisible();await expect(page.locator('.official-poster video')).toBeVisible();await expect(page.getByRole('button',{name:'Play Worthkind introduction'})).toBeVisible();await expect(page.locator('.watch-card-info').first()).toContainText('Official introduction');await expect(page.locator('.watch-duration')).toHaveText('0:03');for(const width of [320,360,390,768,1280]){await page.setViewportSize({width,height:844});const bounds=await page.locator('.official-poster').evaluate(el=>{const b=el.getBoundingClientRect();return {width:b.width,height:b.height,overflow:document.documentElement.scrollWidth-window.innerWidth};});expect(Math.abs(bounds.width/bounds.height-16/9)).toBeLessThan(0.04);expect(bounds.overflow).toBeLessThanOrEqual(1);if(width<=390)expect(bounds.width).toBeGreaterThanOrEqual(width-2);}await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Play Worthkind introduction'}).click();await expect.poll(()=>page.locator('.official-poster video').evaluate(v=>v.currentTime),{timeout:15000}).toBeGreaterThan(0);const media=await page.request.get('/api/platform-intro');expect(media.ok()).toBeTruthy();expect(media.headers()['content-type']).toBe('video/mp4');expect((await media.body()).length).toBe(1648);const fallback=await page.request.get('/api/platform-intro?format=webm');expect(fallback.ok()).toBeTruthy();expect(fallback.headers()['content-type']).toBe('video/webm');expect((await fallback.body()).length).toBe(3049);await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('link',{name:'Shorts'}).click();await expect(page.getByRole('heading',{name:'Shorts',exact:true})).toBeAttached();await expect(page.getByRole('region',{name:'Short video'}).locator('video')).toBeVisible();await expect(page.getByRole('link',{name:'Explore videos'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Like',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Follow',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Share',exact:true})).toBeEnabled();for(const [width,height] of [[320,568],[390,844],[681,684],[1280,800]]){await page.setViewportSize({width,height});const b=await page.locator('.shorts-portrait').evaluate(e=>{const x=e.getBoundingClientRect();return {w:x.width,h:x.height,overflow:document.documentElement.scrollWidth-innerWidth};});expect(Math.abs(b.w/b.h-9/16)).toBeLessThan(.04);expect(b.w).toBeLessThan(width);expect(b.overflow).toBeLessThanOrEqual(1);}await page.setViewportSize({width:390,height:844});await page.goto('/account-security');await expect(page.getByRole('heading',{name:'Settings'})).toBeVisible();await page.getByRole('button',{name:'Light',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-appearance','light');await page.reload();await expect(page.locator('html')).toHaveAttribute('data-appearance','light');await page.getByRole('button',{name:'Dark',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-appearance','dark');await page.goto('/communities?tab=assignments');await expect(page.getByRole('heading',{name:'Assignments'})).toBeVisible();}finally{await context.close();}});

test('guest community overview exposes public metadata without private discussion requests',async({browser})=>{
 const context=await browser.newContext({baseURL:BASE,viewport:{width:390,height:844}});
 try{
  const page=await context.newPage();let privateCalls=0;
  await page.route('**/api/hosted-auth/refresh',r=>r.fulfill({status:503,json:{error:'HOSTED_AUTH_UNAVAILABLE'}}));
  await page.route('**/api/social/**',r=>{privateCalls++;return r.fulfill({status:401,json:{error:'UNAUTHORIZED'}});});
  await page.route('**/api/public-communities/'+course,r=>r.fulfill({json:{id:course,title:'Public calculus community',code:'MTH101'}}));
  await page.goto('/communities/'+course);
  await expect(page.getByRole('heading',{name:'Public calculus community'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Sign in to join'})).toHaveAttribute('href','/sign-in');
  await expect(page.getByRole('link',{name:'Browse course videos'})).toHaveAttribute('href','/courses/'+course);
  await expect(page.getByRole('button',{name:'Post to class'})).toHaveCount(0);
  expect(privateCalls).toBe(0);
 }finally{await context.close();}
});

test('Create mirrors the six Brilliant entry points without falsely enabling unsupported publishing',async({browser})=>{const context=await browser.newContext({baseURL:BASE,viewport:{width:390,height:844}});try{const page=await context.newPage();await page.route('**/api/hosted-auth/refresh',r=>r.fulfill({status:401,json:{error:'AUTH_REQUIRED'}}));await page.goto('/create');const rows=page.locator('.create-options > li');await expect(rows).toHaveCount(6);await expect(rows.nth(0)).toContainText('Upload a video');await expect(rows.nth(1)).toContainText('Create a short');await expect(rows.nth(2).locator('[aria-disabled=true]')).toContainText('Photo or text post');await expect(rows.nth(3)).toContainText('Go live');await expect(rows.nth(4)).toContainText('Your drafts');await expect(rows.nth(5)).toContainText('Creator studio');const first=await rows.nth(0).boundingBox(),second=await rows.nth(1).boundingBox(),tile=await rows.nth(0).locator('.community-preview-symbol').boundingBox();expect(first).not.toBeNull();expect(second).not.toBeNull();expect(tile).not.toBeNull();expect(Math.abs(second.y-first.y-84)).toBeLessThanOrEqual(1);expect(Math.abs(tile.width-46)).toBeLessThanOrEqual(1);expect(Math.abs(tile.height-46)).toBeLessThanOrEqual(1);await expect(rows.nth(0).getByRole('link')).toHaveAttribute('href','/sign-in');}finally{await context.close();}});

test('Brilliant gallery keeps mobile navigation compact and desktop Community split into columns',async({browser})=>{
 const context=await browser.newContext({baseURL:BASE,viewport:{width:390,height:844}});
 try{
  const page=await context.newPage();
  await page.route('**/api/hosted-auth/refresh',r=>r.fulfill({status:401,json:{error:'AUTH_REQUIRED'}}));
  await page.goto('/communities');
  const header=page.locator('.modern-header[data-hosted=true]');
  await expect(header.locator('.mobile-section-title')).toBeVisible();
  await expect(header.locator('.mobile-section-default')).toHaveText('Community');
  await expect(header.getByRole('button',{name:'Search Student Creators'})).toBeVisible();
  await expect(header.getByRole('link',{name:'Notifications'})).toBeVisible();
  await header.getByRole('button',{name:'Account and navigation menu'}).click();
  await expect(header.getByRole('navigation',{name:'Account menu'}).getByRole('link',{name:'Join Student Creators'})).toBeVisible();
  await page.keyboard.press('Escape');
  const tabs=page.getByRole('navigation',{name:'Mobile navigation'});
  await expect(tabs.getByRole('link')).toHaveCount(5);
  const geometry=await tabs.evaluate(e=>({height:e.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth-innerWidth}));
  expect(geometry.height).toBeGreaterThanOrEqual(74);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  await page.goto('/communities?tab=night');
  await expect(header.locator('.mobile-night-title')).toBeVisible();
  await page.goto('/create');
  await expect(header.locator('.mobile-section-default')).toHaveText('Create');
  await page.goto('/messages');
  await expect(header.locator('.mobile-section-default')).toHaveText('Inbox');
  await page.setViewportSize({width:1280,height:800});
  await page.goto('/communities');
  const publicBox=await page.getByRole('region',{name:'Public communities'}).boundingBox();
  const nightBox=await page.getByRole('region',{name:'Night classes'}).boundingBox();
  expect(publicBox).not.toBeNull();expect(nightBox).not.toBeNull();
  expect(nightBox.x).toBeGreaterThan(publicBox.x+publicBox.width);
  expect(Math.abs(nightBox.y-publicBox.y)).toBeLessThanOrEqual(2);
 }finally{await context.close();}
});
