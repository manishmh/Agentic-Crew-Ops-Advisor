import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { createCrewOpsServer } from "../../src/api/server.js";

let application: ReturnType<typeof createCrewOpsServer> | undefined;

function dataDirectory(): string {
  return resolve(process.cwd(), process.env.CREWOPS_DATA_DIR || "data");
}

function crewOpsApplication(): ReturnType<typeof createCrewOpsServer> {
  application ??= createCrewOpsServer(dataDirectory());
  return application;
}

/**
 * Vercel's Node runtime supplies standard IncomingMessage/ServerResponse
 * objects, so the existing hardened HTTP boundary remains the authority.
 */
export default function query(request: IncomingMessage, response: ServerResponse): void {
  try {
    crewOpsApplication().emit("request", request, response);
  } catch {
    response.statusCode = 500;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.end(JSON.stringify({ success: false, error: { code: "INTERNAL_ERROR", message: "The analysis service is temporarily unavailable. Please try again." } }));
  }
}
