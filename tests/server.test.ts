import { afterEach, describe, expect, test } from "vitest";
import { request as httpRequest, type Server } from "node:http";
import { createCrewOpsServer, type RequestLog } from "../src/api/server.js";
import { serverConfig } from "../src/api/config.js";
import type { LlmProvider } from "../src/agent/provider.js";

const servers: Server[] = [];
async function start(options: Parameters<typeof createCrewOpsServer>[2] = {}, provider?: LlmProvider) {
  const server = createCrewOpsServer(undefined, provider, { log: () => {}, ...options }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No address");
  return `http://127.0.0.1:${address.port}`;
}
const post = (url: string, body = JSON.stringify({ question: "C-1042 reports sick" }), headers = {}) => fetch(url + "/api/crewops/query", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });

describe("Public HTTP boundary", () => {
  test("cheap health and request IDs expose only safe fields", async () => {
    const logs: RequestLog[] = []; const url = await start({ log: entry => logs.push(entry) });
    const response = await fetch(url + "/health");
    expect(await response.json()).toEqual({ status: "ok", service: "crewops-recovery-copilot" });
    expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
    expect(logs[0]).toMatchObject({ requestId: response.headers.get("x-request-id"), status: 200 });
    expect(JSON.stringify(logs)).not.toMatch(/authorization|apiKey|question|\/home\//i);
  });
  test("limits per client, resets by time, and isolates server instances", async () => {
    let now = 100; const config = { ...serverConfig({}), rateLimit: 1, rateWindowMs: 1000 };
    const first = await start({ config, now: () => now }); const other = await start({ config, now: () => now });
    expect((await post(first, '{}')).status).toBe(400);
    const limited = await post(first, '{}', { "x-forwarded-for": "1.2.3.4" });
    expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("1");
    expect(await limited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect((await post(other, '{}')).status).toBe(400);
    now = 1100; expect((await post(first, '{}')).status).toBe(400);
  });
  test("trusted proxy clients remain separate only when explicitly configured", async () => {
    const url = await start({ config: { ...serverConfig({}), rateLimit: 1, trustProxy: true } });
    expect((await post(url, '{}', { 'x-forwarded-for': '1.2.3.4' })).status).toBe(400);
    expect((await post(url, '{}', { 'x-forwarded-for': '1.2.3.5' })).status).toBe(400);
    expect((await post(url, '{}', { 'x-forwarded-for': '1.2.3.4' })).status).toBe(429);
  });
  test("rejects oversized content-length and chunked bodies before provider use", async () => {
    let calls = 0; const provider: LlmProvider = { name: 'fake', model: 'test', async generateStructured() { calls++; return {}; }, async generateText() { calls++; return ''; } };
    const url = await start({ config: { ...serverConfig({}), maxBodyBytes: 100 } }, provider);
    expect((await post(url, JSON.stringify({ question: 'x'.repeat(200) }))).status).toBe(413);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(url + '/api/crewops/query', { method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.write('x'.repeat(200)); req.end();
    });
    expect(status).toBe(413); expect(calls).toBe(0);
  });
  test.each(['{', 'null', '[]', '{}', '{"question":42}', '{"question":""}'])("rejects malformed payload %s", async body => {
    const response = await post(await start(), body); expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'INVALID_REQUEST' } });
  });
  test("allows only configured CORS origin and content-type headers", async () => {
    const url = await start({ config: { ...serverConfig({}), allowedOrigin: 'https://demo.example' } });
    const allowed = await post(url, '{}', { origin: 'https://demo.example' });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://demo.example');
    expect((await post(url, '{}', { origin: 'https://other.example' })).status).toBe(403);
    expect((await fetch(url + '/api/crewops/query', { method: 'OPTIONS', headers: { origin: 'https://demo.example' } })).status).toBe(204);
  });
  test("provider failure retains deterministic result and never exposes errors or prompt in logs", async () => {
    const logs: RequestLog[] = [];
    const provider: LlmProvider = { name: 'fake', model: 'test', async generateStructured() { throw new Error('secret-value /private/path'); }, async generateText() { throw new Error('secret-value'); } };
    const result = await post(await start({ log: entry => logs.push(entry) }, provider));
    const body = await result.json();
    expect(result.status).toBe(200); expect(body).toMatchObject({ success: true, agent: { plannerFallback: true } });
    expect(body.naturalLanguageAnswer).toBe(body.summary);
    expect(JSON.stringify([body, logs])).not.toMatch(/secret-value|\/private\/path|authorization/i);
    expect(logs[0]).toMatchObject({ event: 'SICK_CREW', plannerFallback: true, providerUsed: true });
  });
  test("configuration rejects invalid values without echoing their contents", () => {
    for (const env of [{ CREWOPS_RATE_LIMIT: '-1' }, { CREWOPS_MAX_BODY_BYTES: 'NaN' }, { CREWOPS_ALLOWED_ORIGIN: 'secret-value' }, { CREWOPS_TRUST_PROXY: 'yes' }, { CREWOPS_LLM_BASE_URL: 'https://secret-value@example.com/v1' }, { CREWOPS_LLM_PROVIDER: 'secret-value' }]) {
      expect(() => serverConfig(env)).toThrow(/Invalid configuration:/);
      try { serverConfig(env); } catch (error) { expect(String(error)).not.toContain('secret-value'); }
    }
  });
});
