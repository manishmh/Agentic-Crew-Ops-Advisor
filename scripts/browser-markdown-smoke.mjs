// One-request credentialed browser check for model-answer Markdown rendering.
const tabs = await (await fetch(process.env.CREWOPS_BROWSER_DEBUG_URL || 'http://127.0.0.1:9238/json')).json();
const page = tabs.find(tab => tab.type === 'page');
if (!page) throw new Error('No Chromium page available.');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request?.reject(new Error(message.error.message));
    else request?.resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
};
const waitFor = async expression => {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for ' + expression);
};
try {
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Page.navigate', { url: process.env.CREWOPS_BROWSER_APP_URL || 'http://127.0.0.1:5188' });
  await waitFor('!!document.querySelector(".project-actions .primary")');
  await evaluate('document.querySelector(".project-actions .primary").click()');
  await waitFor('!!document.querySelector("[data-testid=workspace-scenario-delay]")');
  await evaluate('document.querySelector("[data-testid=workspace-scenario-delay]").click()');
  await waitFor('!!document.querySelector("[data-testid=scenario-result-delay]")');
  const result = await evaluate(`(() => {
    const answer = document.querySelector('[data-testid=natural-language-answer]');
    return {
      exists: Boolean(answer),
      literalMarkers: answer?.textContent.includes('**') ?? true,
      labels: [...(answer?.querySelectorAll('strong') ?? [])].map(node => node.textContent),
      aiPlanned: document.querySelector('[data-testid=scenario-result-delay]')?.textContent.includes('AI PLANNED') ?? false,
    };
  })()`);
  if (!result.exists || result.literalMarkers || result.labels.length === 0 || !result.aiPlanned || errors.length) throw new Error('Markdown browser assertion failed: ' + JSON.stringify({ ...result, errors }));
  console.log('PASS credentialed DELAY explanation rendered bold labels with no literal ** markers: ' + result.labels.join(', '));
} finally {
  ws.close();
}
