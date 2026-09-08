import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOperationalGraph } from "../data/loader.js";
import { createCrewOpsQueryService } from "./crewopsQuery.js";
import { createAgentCrewOpsQueryService } from "../agent/service.js";
import { createLlmProviderFromEnv, type LlmProvider } from "../agent/provider.js";
import { createRateLimiter, positiveInteger, serverConfig, type ServerConfig } from "./config.js";

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
class BodyTooLarge extends Error {}
function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []; let bytes = 0; let oversized = false;
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (oversized) return;
      if (bytes > maxBytes) { oversized = true; chunks.length = 0; reject(new BodyTooLarge()); return; }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (oversized) return;
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new Error("Invalid JSON")); }
    });
    request.on("error", reject);
    request.on("aborted", () => reject(new Error("Request aborted")));
  });
}
export interface RequestLog { requestId: string; event: string; status: number; durationMs: number; plannerFallback?: boolean; providerUsed?: boolean; }
interface ServerOptions { config?: ServerConfig; now?: () => number; log?: (entry: RequestLog) => void; }

export function createCrewOpsServer(dataDir = resolve(process.cwd(), "data"), provider: LlmProvider | undefined = createLlmProviderFromEnv(), options: ServerOptions = {}) {
  const config = options.config ?? serverConfig();
  const limit = createRateLimiter(config, options.now);
  const log = options.log ?? ((entry: RequestLog) => console.info(JSON.stringify(entry)));
  const { graph } = loadOperationalGraph(dataDir);
  const service = createAgentCrewOpsQueryService(graph, provider, createCrewOpsQueryService(graph));
  const server = createServer(async (request, response) => {
    const started = performance.now();
    const entry: RequestLog = { requestId: randomUUID(), event: "request", status: 0, durationMs: 0 };
    response.setHeader("x-request-id", entry.requestId);
    response.setHeader("x-content-type-options", "nosniff");
    response.on("finish", () => { entry.status = response.statusCode; entry.durationMs = Math.round(performance.now() - started); log(entry); });
    const fail = (status: number, code: string, message: string) => json(response, status, { success: false, error: { code, message } });
    if (request.method === "GET" && request.url === "/health") return json(response, 200, { status: "ok", service: "crewops-recovery-copilot" });
    const origin = request.headers.origin;
    if (origin && config.allowedOrigin === origin) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "Origin");
      response.setHeader("access-control-allow-methods", "POST, OPTIONS");
      response.setHeader("access-control-allow-headers", "Content-Type");
      response.setHeader("access-control-expose-headers", "X-Request-ID, Retry-After");
    } else if (origin && (config.allowedOrigin || request.headers["sec-fetch-site"] === "cross-site")) return fail(403, "ORIGIN_NOT_ALLOWED", "This origin is not allowed.");
    if (request.method === "OPTIONS" && request.url === "/api/crewops/query" && origin === config.allowedOrigin && origin) { response.writeHead(204); response.end(); return; }
    if (request.method !== "POST" || request.url !== "/api/crewops/query") return fail(404, "NOT_FOUND", "Route not found.");
    const forwarded = request.headers["x-forwarded-for"];
    // Enable only behind a proxy that overwrites this header with one client IP.
    const client = config.trustProxy && typeof forwarded === "string" && isIP(forwarded.trim()) ? forwarded.trim() : request.socket.remoteAddress ?? "unknown";
    const retry = limit(client);
    if (retry) { response.setHeader("retry-after", retry); return fail(429, "RATE_LIMITED", "Too many requests. Try again in a few minutes."); }
    if (Number(request.headers["content-length"]) > config.maxBodyBytes) return fail(413, "INPUT_TOO_LARGE", "Your request is too long. Please shorten it and try again.");
    if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") return fail(415, "INVALID_REQUEST", "Send a JSON request with a question.");
    let body: unknown;
    try { body = await readJson(request, config.maxBodyBytes); }
    catch (error) { return error instanceof BodyTooLarge ? fail(413, "INPUT_TOO_LARGE", "Your request is too long. Please shorten it and try again.") : fail(400, "INVALID_REQUEST", "Request body must be valid JSON."); }
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as { question?: unknown }).question !== "string" || !(body as { question: string }).question.trim()) return fail(400, "INVALID_REQUEST", "Enter a question or choose a live scenario.");
    try {
      const result = await service.query({ question: (body as { question: string }).question });
      entry.event = result.success ? result.intent.type : result.error.code;
      entry.plannerFallback = result.agent.plannerFallback; entry.providerUsed = result.agent.plannerUsed;
      if (!result.success && result.error.code === "ANALYSIS_FAILED") return fail(422, "ANALYSIS_FAILED", "This scenario could not be analyzed. Try one of the guided scenarios.");
      return json(response, result.success ? 200 : 422, result);
    } catch { return fail(500, "INTERNAL_ERROR", "The analysis service is temporarily unavailable. Please try again."); }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const port = positiveInteger(process.env, "CREWOPS_PORT", 8080, 65535);
    const host = process.env.CREWOPS_HOST || "127.0.0.1";
    createCrewOpsServer(process.env.CREWOPS_DATA_DIR ?? resolve(process.cwd(), "data")).listen(port, host, () => console.info(JSON.stringify({ event: "listening", service: "crewops-recovery-copilot", port })));
  } catch (error) {
    console.error(error instanceof Error && error.message.startsWith("Invalid configuration:") ? error.message : "Startup failed. Check server configuration and dataset availability.");
    process.exitCode = 1;
  }
}
