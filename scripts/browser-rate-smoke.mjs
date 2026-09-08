// Requires an isolated API on 8790 with limit=1 and the app origin allowed.
const tabs = await (await fetch('http://127.0.0.1:9237/json')).json();
const ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
const result = new Promise((resolve, reject) => ws.addEventListener('message', event => {
  const data = JSON.parse(event.data);
  if (data.id !== 1) return;
  if (data.error || data.result.exceptionDetails) reject(new Error('Rate-limit browser request failed'));
  else resolve(data.result.result.value);
}));
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, awaitPromise: true, expression: `(async () => {
  const results = [];
  for (let index = 0; index < 2; index++) {
    const response = await fetch('http://127.0.0.1:8790/api/crewops/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const body = await response.json(); results.push({ status: response.status, code: body.error.code });
  }
  return results;
})()` } }));
try {
  const value = await result;
  if (JSON.stringify(value) !== JSON.stringify([{ status: 400, code: 'INVALID_REQUEST' }, { status: 429, code: 'RATE_LIMITED' }])) throw new Error('Rate-limit assertion failed');
  console.log('PASS browser receives safe 429 from isolated limiter; no provider calls.');
} finally { ws.close(); }
