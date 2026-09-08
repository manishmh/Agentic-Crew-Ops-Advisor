import type { IncomingMessage, ServerResponse } from "node:http";

/** Cheap Vercel health function; it intentionally does not initialize the graph or LLM provider. */
export default function health(request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    response.statusCode = 405;
    response.end();
    return;
  }
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.statusCode = 200;
  response.end(JSON.stringify({ status: "ok", service: "crewops-recovery-copilot" }));
}
