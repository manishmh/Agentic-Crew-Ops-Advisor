// Live Chromium verification for the first-visit CrewOps walkthrough.
const debugUrl = process.env.CREWOPS_BROWSER_DEBUG_URL || 'http://127.0.0.1:9237';
const appUrl = process.env.CREWOPS_BROWSER_APP_URL || 'http://127.0.0.1:5173';
const tabs = await (await fetch(debugUrl + '/json')).json();
const tab = tabs.find(item => item.type === 'page');
if (!tab) throw new Error('Start a Chromium page with remote debugging enabled.');
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));

let nextId = 0;
const pending = new Map();
const browserErrors = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request?.reject(new Error(message.error.message));
    else request?.resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    const text = message.params.args.map(item => item.value).filter(Boolean).join(' ');
    if (text) browserErrors.push(text);
  }
});

const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(`Browser evaluation failed: ${result.exceptionDetails.text}`);
  return result.result?.value;
};
const waitFor = async (expression, timeout = 45000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error(`Timed out: ${expression}`);
};
const assert = async (expression, label) => {
  if (!await evaluate(expression)) throw new Error(label);
  process.stdout.write(`PASS ${label}\n`);
};
const click = async selector => {
  await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
};
const clickText = async (selector, text) => {
  await waitFor(`[...document.querySelectorAll(${JSON.stringify(selector)})].some(item => item.textContent.includes(${JSON.stringify(text)}))`);
  await evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(item => item.textContent.includes(${JSON.stringify(text)})).click()`);
};
const pressEscape = async () => {
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
};
const completeTour = async () => {
  const titles = [];
  for (let index = 0; index < 8; index += 1) {
    await waitFor('!!document.querySelector(".driver-popover")');
    titles.push(await evaluate('document.querySelector(".driver-popover-title").textContent'));
    const done = await evaluate('document.querySelector(".driver-popover-next-btn").textContent.includes("Start exploring")');
    await click('.driver-popover-next-btn');
    if (done) return titles;
  }
  throw new Error('Tour did not complete within seven steps.');
};

try {
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: appUrl });
  await waitFor('!!document.querySelector(".project-overview")');
  await evaluate('localStorage.clear()');
  await click('.project-actions .primary');
  await waitFor('!!document.querySelector("dialog.crewops-welcome[open]")');
  await assert('document.querySelector(".crewops-welcome").textContent.includes("Deterministic code decides legality")', 'first visit shows the compact value proposition');
  await clickText('button', 'Take 60-second tour');
  const firstTitles = await completeTour();
  if (firstTitles.length !== 5) throw new Error(`Expected five fresh-state steps, received ${firstTitles.length}`);
  await assert('localStorage.getItem("crewops:onboarding:v1") === "completed"', 'completion writes the versioned completed state');
  await waitFor('document.activeElement === document.querySelector("textarea")');
  await assert('document.activeElement === document.querySelector("textarea")', 'completion focuses the query input');
  await cdp('Page.reload');
  await waitFor('!!document.querySelector(".project-overview")');
  await click('.project-actions .primary');
  await assert('!document.querySelector("dialog.crewops-welcome[open]")', 'completed visitor does not see the welcome again');
  await clickText('button', 'How this works');
  await waitFor('!!document.querySelector(".driver-popover")');
  await pressEscape();
  await waitFor('!document.querySelector(".driver-popover")');
  await assert('!document.documentElement.classList.contains("driver-active") && document.body.style.overflow === ""', 'Escape closes cleanly without scroll or overlay state');

  await evaluate('localStorage.clear()');
  await cdp('Page.reload');
  await waitFor('!!document.querySelector(".project-overview")');
  await click('.project-actions .primary');
  await clickText('button', 'Explore myself');
  await assert('localStorage.getItem("crewops:onboarding:v1") === "skipped"', 'Explore myself records skipped');
  await cdp('Page.reload');
  await waitFor('!!document.querySelector(".project-overview")');
  await click('.project-actions .primary');
  await assert('!document.querySelector("dialog.crewops-welcome[open]")', 'skipped visitor does not see the welcome again');

  await click('[data-testid="workspace-scenario-sick"]');
  await waitFor('!!document.querySelector("[data-testid=scenario-result-sick]")');
  await clickText('button', 'How this works');
  const resultTitles = await completeTour();
  if (!resultTitles.includes('Evidence-backed recovery') || !resultTitles.includes('Inspect the decision')) {
    throw new Error(`Result tour omitted optional evidence steps: ${resultTitles.join(', ')}`);
  }
  await waitFor('document.activeElement === document.querySelector("textarea")');
  await assert('document.activeElement === document.querySelector("textarea")', 'result tour completion returns focus to the query input');

  for (const width of [1440, 1280, 1024, 768]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await clickText('button', 'How this works');
    for (let step = 0; step < 7; step += 1) {
      await waitFor('!!document.querySelector(".driver-popover")');
      await assert(`(() => { const box = document.querySelector('.driver-popover').getBoundingClientRect(); return box.left >= 0 && box.right <= ${width} && box.top >= 0 && box.bottom <= 1000; })()`, `tour popover stays on-screen at ${width}px, step ${step + 1}`);
      await assert(`document.documentElement.scrollWidth <= ${width}`, `tour creates no horizontal overflow at ${width}px, step ${step + 1}`);
      const done = await evaluate('document.querySelector(".driver-popover-next-btn").textContent.includes("Start exploring")');
      await click('.driver-popover-next-btn');
      if (done) break;
    }
  }
  if (browserErrors.length) throw new Error(`Console/runtime errors: ${browserErrors.join(' | ')}`);
  process.stdout.write('PASS live onboarding flow completed without console errors\n');
} finally {
  socket.close();
}
