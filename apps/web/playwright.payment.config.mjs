/** Run only against an isolated local server and synthetic fixture. */
export default {
 testDir:'./e2e',
 testMatch:'paid-media.spec.mjs',
 timeout:60000,
 use:{baseURL:'http://localhost:3000',headless:true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']}}:{})},
};
