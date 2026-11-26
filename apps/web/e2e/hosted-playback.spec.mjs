import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
if(process.env.PLAYWRIGHT_CHROME==='1')test.use({channel:'chrome'});
const actor='11111111-1111-4111-8111-111111111111',lesson='22222222-2222-4222-8222-222222222222';
test('authorized HLS fixture loads real media and tears down on route change',async({browser})=>{
 const dir=process.env.HLS_FIXTURE_DIR;
 if(!dir)throw Error('HLS_FIXTURE_DIR required');
 const context=await browser.newContext({baseURL:'http://localhost:3000',viewport:{width:390,height:844}});
 const page=await context.newPage();let requests=0;
 try{
 await page.route('**/api/hosted-auth/refresh',r=>r.fulfill({json:{accessToken:'one.two.three',userId:actor,expiresIn:3600}}));
 await page.route('**/api/account/state',r=>r.fulfill({json:{userId:actor,student:true,admin:false,requests:[],drafts:[]}}));
 await page.route('**/api/social/bookmarks',r=>r.fulfill({json:[]}));
 await page.route('**/api/lessons/**/mux-playback',r=>r.fulfill({json:{url:'https://stream.mux.com/synthetic123.m3u8?token=one.two.three',expiresAt:Math.floor(Date.now()/1000)+45}}));
 await page.route('https://stream.mux.com/**',async r=>{
  const url=new URL(r.request().url());let filename=url.pathname.slice(1);
  if(filename==='synthetic123.m3u8')filename='index.m3u8';
  if(!/^(index\.m3u8|segment[0-9]+\.ts)$/.test(filename))return r.abort();
  requests++;
  return r.fulfill({status:200,body:await readFile(join(dir,filename)),headers:{'access-control-allow-origin':'*','content-type':filename.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t','cache-control':'no-store'}});
 });
 await page.goto('/lessons/'+lesson);
 await page.getByRole('button',{name:'Play video',exact:true}).click();
 await expect(page.locator('video')).toBeVisible();
 await expect.poll(()=>requests,{timeout:15000}).toBeGreaterThan(1);
 await page.locator('video').evaluate(v=>{v.muted=true;void v.play().catch(()=>{});});
 await expect.poll(()=>page.locator('video').evaluate(v=>({ready:v.readyState,error:v.error?.code??null})),{timeout:20000}).toMatchObject({ready:expect.any(Number),error:null});
 await expect.poll(()=>page.locator('video').evaluate(v=>v.currentTime),{timeout:20000}).toBeGreaterThan(0);
 await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState)).toBeGreaterThanOrEqual(2);
 await page.goto('/saved');
 await expect(page.locator('video')).toHaveCount(0);
 expect(await page.evaluate(()=>Object.entries(localStorage).some(([k,v])=>k.includes('token')||v.includes('one.two.three')))).toBe(false);
 }finally{await context.close();}
});
