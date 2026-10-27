import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',timeout:45000,expect:{timeout:15000},fullyParallel:false,workers:2,
  use:{baseURL:'http://127.0.0.1:5173',trace:'retain-on-failure'},
  projects:[
    {name:'chromium',use:{...devices['Desktop Chrome'],viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
    {name:'webkit',use:{...devices['iPhone 13'],defaultBrowserType:'webkit',viewport:{width:390,height:844}}},
  ],
  webServer:[
    {command:'npm run dev -- --port 5173',url:'http://127.0.0.1:5173',reuseExistingServer:true,timeout:120000},
    {command:'node scripts/serve-test.mjs',url:'http://127.0.0.1:4174/itimonittou/',reuseExistingServer:true,timeout:120000},
  ],
});
