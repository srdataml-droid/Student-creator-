import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {randomUUID, randomBytes} from 'node:crypto';

const BASE='http://127.0.0.1:3000';
const syntheticVideo=Buffer.from(readFileSync(new URL('../../../packages/local-core/test/fixtures/synthetic-1s.mp4.base64',import.meta.url),'utf8'),'base64');

async function login(page,email,password){
  await page.goto('/sign-in');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button',{name:'Sign in'}).click();
  await expect(page).toHaveURL(/\/(manage|studio)$/);
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
  expect(response.ok(),\`HTTP \${response.status()} from \${response.url()}\`).toBeTruthy();
  return response.json();
}

test('synthetic creator, moderator and viewer journey keeps media access server-enforced',async({browser,request})=>{
  test.setTimeout(150_000);
  const adminEmail=process.env.CI_ADMIN_EMAIL;
  const adminPassword=process.env.CI_ADMIN_PASSWORD;
  expect(adminEmail&&adminPassword,'Disposable CI administrator is required').toBeTruthy();
  const suffix=randomUUID().slice(0,8);
  const schoolName=\`Browser Alpha Campus \${suffix}\`;
  const creatorEmail=\`creator-\${suffix}@example.invalid\`;
  const viewerEmail=\`viewer-\${suffix}@example.invalid\`;
  const password=randomBytes(24).toString('base64url');
  const title=\`Original campus media explanation \${suffix}\`;
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
    expect((await request.get(\`\${BASE}/api/local/lessons/\${lessonId}/video\`)).status()).toBe(404);
    await creatorPage.locator(\`#video-\${lessonId}\`).setInputFiles({
      name:'synthetic-1s.mp4',mimeType:'video/mp4',buffer:syntheticVideo,
    });
    await creatorPage.getByRole('button',{name:'Upload video'}).click();
    await expect(creatorPage.getByText('Video saved privately.',{exact:false})).toBeVisible();
    expect((await request.get(\`\${BASE}/api/local/lessons/\${lessonId}/video\`)).status()).toBe(404);
    await creatorPage.getByRole('button',{name:'Submit for review'}).click();
    await expect(creatorPage.getByText('Lesson submitted.',{exact:false})).toBeVisible();

    await adminPage.goto('/manage');
    const reviewed=adminPage.getByRole('listitem').filter({hasText:title});
    await expect(reviewed).toBeVisible();
    await reviewed.locator(\`#reason-\${lessonId}\`).fill('Verified independent original synthetic lesson for browser testing');
    await reviewed.getByRole('button',{name:'Approve'}).click();
    await expect(adminPage.getByText('Lesson approved and published.')).toBeVisible();

    await viewerPage.goto('/');
    await expect(viewerPage.getByRole('heading',{name:title})).toBeVisible();
    await viewerPage.goto(\`/lessons/\${lessonId}\`);
    await expect(viewerPage.getByRole('heading',{name:title})).toBeVisible();
    const privateVideo=await request.get(\`\${BASE}/api/local/lessons/\${lessonId}/video\`);
    expect([401,403,404]).toContain(privateVideo.status());
    const range=await viewer.request.get(\`/api/local/lessons/\${lessonId}/video\`,{headers:{range:'bytes=0-4'}});
    expect(range.status()).toBe(206);
    expect(await range.body()).toEqual(syntheticVideo.subarray(0,5));

    const comment=\`Helpful original question \${suffix}\`;
    await viewerPage.locator('#lesson-comment-text').fill(comment);
    await viewerPage.getByRole('button',{name:'Post comment'}).click();
    await expect(viewerPage.getByText(comment)).toBeVisible();
    await viewerPage.goto(\`/creators/\${creatorId}\`);
    await viewerPage.getByRole('button',{name:'+ Follow creator'}).click();
    await expect(viewerPage.getByRole('button',{name:/Following/})).toBeVisible();

    // Creator restriction must prevent direct media and full-post retrieval, not just hide UI.
    const rule=await creator.request.post(\`/api/local/creators/\${creatorId}/restrictions/\${viewerId}\`,{
      data:{view:true,comment:false,message:false},
    });
    await readJson(rule);
    expect((await viewer.request.get(\`/api/local/lessons/\${lessonId}/video\`)).status()).toBe(403);
    expect((await viewer.request.get(\`/api/local/lessons/\${lessonId}/comments\`)).status()).toBe(403);
    await viewerPage.goto(\`/lessons/\${lessonId}\`);
    await expect(viewerPage.getByText('Full posts require verified student membership',{exact:false})).toBeVisible();
  }finally{
    await Promise.all([admin.close(),creator.close(),viewer.close()]);
  }
});
