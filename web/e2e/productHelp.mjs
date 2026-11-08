import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const baseUrl=process.env.E2E_BASE_URL;
const account={email:process.env.E2E_EMAIL,password:process.env.E2E_PASSWORD,workspace_id:process.env.E2E_WORKSPACE_ID};
assert.ok(baseUrl && Object.values(account).every(Boolean), 'Set E2E_BASE_URL, E2E_EMAIL, E2E_PASSWORD, E2E_WORKSPACE_ID for a dedicated test account.');
const root=process.env.E2E_OUTPUT_DIR || '/tmp/product-help-e2e';
fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
const context=await browser.newContext({viewport:{width:1440,height:1100}});
const page=await context.newPage();
const login=await context.request.post(`${baseUrl}/api/auth/login`,{data:{email:account.email,password:account.password}});
assert.equal(login.status(),200);
const token=(await login.json()).access_token;
const meResponse=await context.request.get(`${baseUrl}/api/auth/me`,{headers:{Authorization:`Bearer ${token}`}});
assert.equal(meResponse.status(),200);
const me=await meResponse.json();
await page.goto(`${baseUrl}/home`);
const rows=[];
const cases=[
 {id:'ko-chat',locale:'ko',tab:'채팅',question:'Fruition 웹 검색 기본값은 어디서 켜?',expected:/AI 설정/},
 {id:'ko-task',locale:'ko',tab:'작업',question:'Fruition 웹 검색 기본값은 어디서 켜?',expected:/AI 설정/},
 {id:'en-chat',locale:'en',tab:'Chat',question:'Where do I enable web search by default in Fruition?',expected:/AI settings/i},
 {id:'en-task',locale:'en',tab:'Tasks',question:'Where do I enable web search by default in Fruition?',expected:/AI settings/i},
 {id:'ko-ambiguous',locale:'ko',tab:'채팅',question:'이 앱은 어떻게 작동해?',expected:/Fruition|프루이션/},
 {id:'en-ambiguous',locale:'en',tab:'Chat',question:'How does this app work?',expected:/Fruition/i},
];
try {
 for(const c of cases){
  console.log('START',c.id);
  await context.addCookies([{name:'fruition.locale',value:c.locale,url:baseUrl}]);
  // Each case starts with empty history; an earlier help answer would resolve "this app".
  const fixture=await context.request.post(`${baseUrl}/api/workspaces/${account.workspace_id}/chat/sessions`,{
   headers:{Authorization:`Bearer ${token}`},data:{title:`E2E ${c.id}`}
  });
  assert.ok(fixture.ok(),await fixture.text());
  const session=await fixture.json();
  const channel=c.id.endsWith('task')?'work':'chat';
  await page.evaluate(({userId,workspaceId,sessionId,channel})=>{
   localStorage.setItem('fruition.workspace_id',workspaceId);
   localStorage.setItem(`fruition.panel-sessions.v1:${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId)}`,
    JSON.stringify({channels:{[sessionId]:channel},selected:{chat:null,work:null,[channel]:sessionId}}));
  },{userId:me.id,workspaceId:account.workspace_id,sessionId:session.id,channel});
  await page.goto(`${baseUrl}/home`);
  await page.getByRole('tab',{name:c.tab,exact:true}).click();
  await page.getByRole('button',{name:`E2E ${c.id}`,exact:true}).waitFor();
  const input=page.locator('textarea');await input.fill(c.question);
  const responsePromise=page.waitForResponse(r=>r.request().method()==='POST' && /\/query\/runs$|\/agent\/turn$/.test(r.url()),{timeout:30000});
  await input.press('Enter');
  const response=await responsePromise;const accepted=await response.json();
  assert.ok(response.status()<300,JSON.stringify(accepted));
  const request=response.request().postDataJSON();
  const sessionId=request.session_id || response.url().match(/sessions\/([^/]+)/)[1];
  assert.equal(sessionId,session.id);
  const runId=accepted.request_id || accepted.requestId;
  console.log('ACCEPTED',c.id,runId);
  let answer;
  for(let i=0;i<120;i++){
   const res=await context.request.get(`${baseUrl}/api/workspaces/${account.workspace_id}/chat/sessions/${sessionId}/messages`,{headers:{Authorization:`Bearer ${token}`,'Accept-Language':c.locale}});
   assert.equal(res.status(),200,await res.text());
   const body=await res.json();const messages=Array.isArray(body)?body:(body.items||body.messages||[]);
   answer=messages.find(m=>m.role==='assistant' && m.run_id===runId);
   if(answer?.status==='failed')throw new Error(JSON.stringify(answer));
   if(answer?.status==='completed')break;
   await new Promise(r=>setTimeout(r,1000));
  }
  assert.equal(answer?.status,'completed',JSON.stringify(answer));
  assert.match(answer.content,c.expected);
  if(c.id.endsWith('task'))assert.equal(answer.action,'product_help');
  if(c.id.includes('ambiguous'))assert.match(answer.content,/\?|까요|나요/);
  await page.getByText(c.expected).first().waitFor({timeout:30000});
  await page.screenshot({path:`${root}/${c.id}-before.png`,fullPage:true});
  await page.reload();
  await page.getByRole('tab',{name:c.tab,exact:true}).click();
  await page.getByText(c.expected).first().waitFor({timeout:30000});
  await page.screenshot({path:`${root}/${c.id}-reload.png`,fullPage:true});
  rows.push({id:c.id,locale:c.locale,tab:c.tab,question:c.question,run_id:runId,session_id:sessionId,answer:answer.content,action:answer.action??null,reload_visible:true});
  fs.writeFileSync(root+'/e2e.json',JSON.stringify(rows,null,2));
  console.log('PASS',c.id,answer.action??'query',answer.content.replaceAll('\n',' ').slice(0,180));
 }
} catch(e){
 console.error(e);console.log((await page.locator('body').innerText()).slice(-4000));
 await page.screenshot({path:root+'/failure.png',fullPage:true});process.exitCode=1;
} finally{await browser.close();}
