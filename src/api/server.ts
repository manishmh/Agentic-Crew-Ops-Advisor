import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOperationalGraph } from "../data/loader.js";
import { createCrewOpsQueryService } from "./crewopsQuery.js";
import { createAgentCrewOpsQueryService } from "../agent/service.js";
import { createLlmProviderFromEnv, type LlmProvider } from "../agent/provider.js";

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

export function createCrewOpsServer(dataDir = resolve(process.cwd(), "data"), provider: LlmProvider | undefined = createLlmProviderFromEnv()) {
  const { graph } = loadOperationalGraph(dataDir);
  const service = createAgentCrewOpsQueryService(graph, provider, createCrewOpsQueryService(graph));
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") return json(response, 200, { ok: true });
    if (request.method !== "POST" || request.url !== "/api/crewops/query") {
      return json(response, 404, { success: false, error: { code: "NOT_FOUND", message: "Route not found" } });
    }
    try {
      const result = await service.query((await readJson(request)) as { question: string });
      return json(response, result.success ? 200 : 422, result);
    } catch {
      return json(response, 400, { success: false, error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON." } });
    }
  });
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const port = Number(process.env.CREWOPS_PORT ?? 8787);
  createCrewOpsServer(process.env.CREWOPS_DATA_DIR ?? resolve(process.cwd(), "data")).listen(port, "127.0.0.1", () => {
    console.log(`CrewOps API listening on http://127.0.0.1:${port}`);
  });
}
