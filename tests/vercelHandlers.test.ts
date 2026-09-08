import { afterEach, describe, expect, test } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import health from "../api/health.js";
import query from "../api/crewops/query.js";

const servers: Server[] = [];

async function start(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listening address");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe("Vercel Node handlers", () => {
  test("health stays cheap and exposes only safe deployment data", async () => {
    const url = await start(health);
    const response = await fetch(url + "/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "crewops-recovery-copilot" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await fetch(url + "/api/health", { method: "POST" })).status).toBe(405);
  });

  test("query reuses the existing hardened CrewOps HTTP boundary", async () => {
    const previousProvider = process.env.CREWOPS_LLM_PROVIDER;
    process.env.CREWOPS_LLM_PROVIDER = "disabled";
    try {
      const url = await start(query);
      const response = await fetch(url + "/api/crewops/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "What happens if C-1042 reports sick?" }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, intent: { type: "SICK_CREW" }, agent: { plannerFallback: true } });
      expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
    } finally {
      if (previousProvider === undefined) delete process.env.CREWOPS_LLM_PROVIDER;
      else process.env.CREWOPS_LLM_PROVIDER = previousProvider;
    }
  });
});
