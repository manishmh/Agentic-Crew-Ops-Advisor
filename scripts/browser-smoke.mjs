// Dependency-free Chromium DevTools end-to-end smoke. Start the API, Vite and
// Chromium with remote debugging before running this script.
import { mkdirSync, writeFileSync } from 'node:fs';

const debugUrl = process.env.CREWOPS_BROWSER_DEBUG_URL || 'http://127.0.0.1:9237';
const appUrl = process.env.CREWOPS_BROWSER_APP_URL || 'http://127.0.0.1:5187';
const tabs = await (await fetch(debugUrl + '/json')).json();
const tab = tabs.find(tab => tab.type === 'page');
if (!tab) throw new Error('Start a Chromium page with remote debugging enabled.');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));

let next = 0;
const pending = new Map();
const errors = [];
const calls = [];
const requestQuestions = new Map();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry?.reject(new Error('DevTools command failed: ' + message.error.message));
    else entry?.resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    const value = message.params.args.filter(arg => typeof arg.value === 'string').map(arg => arg.value).join(' ');
    if (value && !errors.includes(value)) errors.push(value);
  }
  if (message.method === 'Network.requestWillBeSent' && message.params.request.url.endsWith('/api/crewops/query')) {
    try { requestQuestions.set(message.params.requestId, JSON.parse(message.params.request.postData).question); } catch { requestQuestions.set(message.params.requestId, undefined); }
  }
  if (message.method === 'Network.responseReceived' && message.params.response.url.endsWith('/api/crewops/query')) {
    calls.push({ status: message.params.response.status, question: requestQuestions.get(message.params.requestId) });
  }
});
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error('Browser evaluation failed: ' + result.exceptionDetails.text);
  return result.result?.value;
};
const waitFor = async (expression, timeout = 45000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Browser assertion timed out: ' + expression);
};
const click = async selector => { await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
const setInput = async (selector, value) => evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('input', { bubbles: true })); element.focus(); return element.value; })()`);
const enter = async () => { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); };
const assert = async (expression, label) => { if (!await evaluate(expression)) throw new Error(label); process.stdout.write('PASS ' + label + '\n'); };
const screenshot = async name => { const data = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync('artifacts/' + name + '.png', Buffer.from(data.data, 'base64')); };
const expectCall = (index, question, status = 200) => {
  const call = calls[index];
  if (!call || call.question !== question || call.status !== status) throw new Error(`Unexpected API call ${index}: ${JSON.stringify(call)}`);
  process.stdout.write(`PASS live API ${status}: ${question}\n`);
};
const waitResult = id => waitFor(`!!document.querySelector('[data-testid="scenario-result-${id}"]')`);

mkdirSync('artifacts', { recursive: true });
try {
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Runtime.discardConsoleEntries'); errors.length = 0;
  await cdp('Page.navigate', { url: appUrl });
  await waitFor('!!document.querySelector(".project-overview")');
  await assert('document.body.innerText.includes("CrewOps Recovery Copilot") && !/dcortex|demo mode|read-only preview|demo snapshot/i.test(document.body.innerText)', 'independent public intro has no prototype labels');
  await click('.project-actions .button:not(.primary)');
  await assert('document.querySelector("dialog[open]").textContent.includes("Deterministic controller")', 'Architecture opens from intro');
  await click('[aria-label="Close dialog"]');

  // Flow 1: public entry -> central sick-crew card -> live result.
  await click('.project-actions .primary');
  await waitFor('!!document.querySelector(".empty-copilot")');
  await click('[data-testid="workspace-scenario-sick"]');
  await waitResult('sick');
  expectCall(0, 'What happens if C-1042 reports sick?');
  await assert('document.querySelector(".analysis-history").textContent.includes("C-1042")', 'successful scenario updates session history');

  // Flow 6: evidence drawer.
  await click('[data-testid="decision-evidence-button"]');
  await waitFor('!!document.querySelector("dialog[open]")');
  await assert('/decision evidence/i.test(document.querySelector("dialog").textContent) && document.querySelector("dialog").textContent.includes("AGENT TRACE")', 'Evidence Drawer renders decision evidence and agent trace');
  await click('[aria-label="Close dialog"]');

  // Flow 2: New Analysis scenario selection.
  await click('[data-testid="new-analysis"]');
  await click('[data-testid="new-analysis-delay"]');
  await waitResult('delay');
  expectCall(1, 'Delay DX412 by 90 minutes');

  // Flow 3: sidebar scenario entry.
  await click('[data-testid="sidebar-scenario-closure"]');
  await waitResult('closure');
  expectCall(2, 'Close HYD from 05:00–09:00 UTC');

  // Flow 4: blank analysis and typed Enter.
  await click('[data-testid="new-analysis"]');
  await click('[data-testid="new-analysis-blank"]');
  await assert('!document.querySelector(".operator-query") && document.querySelector("textarea").value === "" && document.activeElement === document.querySelector("textarea")', 'Blank New Analysis resets and focuses without submitting');
  await setInput('textarea[aria-label="CrewOps command"]', "What happens if C-5417's recurrent training expires?");
  await enter();
  await waitResult('certification');
  expectCall(3, "What happens if C-5417's recurrent training expires?");

  // Flow 5: joint recovery through New Analysis.
  await click('[data-testid="new-analysis"]');
  await click('[data-testid="new-analysis-multi"]');
  await waitResult('multi');
  expectCall(4, 'C-3940 and C-1938 report sick on 2026-09-18');

  // Flow 8: unsupported request via Send, followed by a valid recovery.
  await click('[data-testid="new-analysis"]');
  await click('[data-testid="new-analysis-blank"]');
  await setInput('textarea[aria-label="CrewOps command"]', 'Swap the aircraft on DX412.');
  await click('button[aria-label="Send query"]');
  await waitFor('document.querySelector("[role=alert]")?.textContent.includes("Unsupported request")');
  expectCall(5, 'Swap the aircraft on DX412.', 422);
  await assert('!document.querySelector("textarea").disabled && document.querySelector("textarea").value.includes("Swap the aircraft")', 'error keeps input editable for recovery');
  await setInput('textarea[aria-label="CrewOps command"]', 'What happens if C-1042 reports sick?');
  await enter();
  await waitResult('sick');
  expectCall(6, 'What happens if C-1042 reports sick?');
  await assert('document.querySelectorAll(".analysis-history > button").length === 7', 'all completed and failed requests remain selectable in session history');
  await evaluate(`([...document.querySelectorAll('.analysis-history > button')].find(button => button.textContent.includes('Delay DX412'))).click()`);
  await waitResult('delay');
  await assert('document.querySelector(".operator-query").textContent.includes("Delay DX412")', 'session history restores a completed analysis without another API call');

  // Workspace navigation retains the analysis state.
  await evaluate(`([...document.querySelectorAll('.workspace-nav button')].find(button => button.textContent.includes('Dashboard'))).click()`);
  await waitFor('document.body.innerText.includes("Operations overview")');
  await evaluate(`([...document.querySelectorAll('.workspace-nav button')].find(button => button.textContent.includes('Timeline'))).click()`);
  await waitFor('document.body.innerText.includes("Flight timeline")');
  await evaluate(`([...document.querySelectorAll('.workspace-nav button')].find(button => button.textContent.includes('Day Brief'))).click()`);
  await waitFor('document.body.innerText.includes("Your shift, in focus.")');
  await evaluate(`([...document.querySelectorAll('.workspace-nav button')].find(button => button.textContent.includes('CrewOps AI'))).click()`);
  await waitResult('delay');
  await assert('document.querySelector(".operator-query").textContent.includes("Delay DX412")', 'workspace tabs preserve the selected analysis');
  await click('.copilot-header .text-link');
  await waitFor('!!document.querySelector("dialog[open]")');
  await assert('document.querySelector("dialog").textContent.includes("Operational network")', 'Network view opens meaningful content');
  await click('[aria-label="Close dialog"]');

  // Flow 7: architecture from inside the workspace.
  await click('.public-workspace-bar button:last-child');
  await waitFor('!!document.querySelector("dialog[open]")');
  await assert('document.querySelector("dialog").textContent.includes("Deterministic parser fallback")', 'Architecture shows fallback path');
  await click('[aria-label="Close dialog"]');

  await assert('!/demo mode|read-only preview|demo snapshot|local demo mocks|demo operator/i.test(document.body.innerText)', 'workspace has no public prototype-mode copy');
  await screenshot('portfolio-end-to-end');

  for (const width of [1440, 1280, 1024, 768]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await assert(`document.documentElement.scrollWidth <= ${width}`, `workspace fits ${width}px`);
    await click('.public-workspace-bar button:last-child');
    await assert(`document.querySelector('dialog').getBoundingClientRect().right <= ${width} && document.querySelector('dialog').getBoundingClientRect().left >= 0`, `Architecture fits ${width}px`);
    await click('[aria-label="Close dialog"]');
    if (width === 768) {
      await assert('getComputedStyle(document.querySelector(".quick-scenarios")).display === "flex" && getComputedStyle(document.querySelector(".mobile-analysis-action")).display === "block"', 'small-screen scenarios and New Analysis remain available');
    }
  }
  if (errors.length) throw new Error('Console/runtime errors: ' + errors.join(', '));
  process.stdout.write(`PASS no console/runtime errors; verified ${calls.length} real API requests\n`);
} finally {
  ws.close();
}
