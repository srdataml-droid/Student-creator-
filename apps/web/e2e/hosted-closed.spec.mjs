import {test,expect} from '@playwright/test';
test('hosted account UI uses hosted routes and refuses unapproved runtime',async({browser})=>{
 const context=await browser.newContext({baseURL:'http://localhost:3101',viewport:{width:360,height:780}});
 try{
  const page=await context.newPage();
  const localRequests=[];page.on('request',r=>{if(r.url().includes('/api/local/'))localRequests.push(r.url());});
  await page.goto('/sign-in');
  await expect(page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();
  await page.locator('#email').fill('fixture@example.invalid');await page.locator('#password').fill('synthetic-only-password');
  const rejected=page.waitForResponse(r=>r.url().endsWith('/api/hosted-auth/sign-in')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  expect((await rejected).status()).toBe(503);
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(361);
  await page.goto('/join');
  await expect(page.locator('#inviteCode')).toBeVisible();await expect(page.locator('#campus')).toHaveCount(0);
  await page.goto('/recover-account');
  await expect(page.getByRole('button',{name:'Request code'})).toBeVisible();
  await page.goto('/hosted-account');
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  expect(localRequests).toEqual([]);
  expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]);
 }finally{await context.close();}
});
