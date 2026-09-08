export interface ServerConfig {
  rateLimit: number;
  rateWindowMs: number;
  maxBodyBytes: number;
  allowedOrigin?: string;
  trustProxy: boolean;
}
export interface ListenConfig {
  port: number;
  host: string;
}
export function positiveInteger(env: NodeJS.ProcessEnv, key: string, fallback: number, max = 1_000_000_000): number {
  if (!env[key]) return fallback;
  const value = Number(env[key]);
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) throw new Error(`Invalid configuration: ${key} must be a positive integer up to ${max}.`);
  return value;
}
export function serverConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  if (env.CREWOPS_LLM_PROVIDER && !['openai', 'disabled'].includes(env.CREWOPS_LLM_PROVIDER.trim().toLowerCase())) throw new Error('Invalid configuration: CREWOPS_LLM_PROVIDER must be openai or disabled.');
  if (env.CREWOPS_LLM_BASE_URL) {
    let valid = false;
    try { const url = new URL(env.CREWOPS_LLM_BASE_URL); valid = (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) && !url.username && !url.password && !url.search && !url.hash; } catch { /* no URL contents in error */ }
    if (!valid) throw new Error('Invalid configuration: CREWOPS_LLM_BASE_URL must be HTTPS (or local HTTP), without credentials, query or fragment.');
  }
  const allowedOrigin = env.CREWOPS_ALLOWED_ORIGIN?.trim() || undefined;
  if (allowedOrigin) {
    let valid = false;
    try { const url = new URL(allowedOrigin); valid = ["http:", "https:"].includes(url.protocol) && url.origin === allowedOrigin; } catch { /* report only variable name */ }
    if (!valid) throw new Error("Invalid configuration: CREWOPS_ALLOWED_ORIGIN must be an exact HTTP(S) origin.");
  }
  if (env.CREWOPS_TRUST_PROXY && !["true", "false"].includes(env.CREWOPS_TRUST_PROXY)) throw new Error("Invalid configuration: CREWOPS_TRUST_PROXY must be true or false.");
  return {
    rateLimit: positiveInteger(env, "CREWOPS_RATE_LIMIT", 20, 10000),
    rateWindowMs: positiveInteger(env, "CREWOPS_RATE_WINDOW_MS", 600_000),
    maxBodyBytes: positiveInteger(env, "CREWOPS_MAX_BODY_BYTES", 4096, 65536),
    allowedOrigin, trustProxy: env.CREWOPS_TRUST_PROXY === "true",
  };
}
/** Railway and other Node hosts provide PORT; local development keeps CREWOPS_PORT. */
export function listenConfig(env: NodeJS.ProcessEnv = process.env): ListenConfig {
  const usesPlatformPort = Boolean(env.PORT);
  return {
    port: positiveInteger(env, usesPlatformPort ? "PORT" : "CREWOPS_PORT", 8080, 65535),
    host: env.CREWOPS_HOST || (usesPlatformPort ? "0.0.0.0" : "127.0.0.1"),
  };
}
/** Per-server fixed window; bounded cardinality prevents unbounded IP storage. */
export function createRateLimiter(config: ServerConfig, now: () => number = Date.now) {
  const clients = new Map<string, { count: number; reset: number }>();
  return (client: string): number => {
    const time = now();
    for (const [key, entry] of clients) if (entry.reset <= time) clients.delete(key);
    let entry = clients.get(client);
    if (!entry) {
      if (clients.size >= 10000) return Math.ceil(config.rateWindowMs / 1000);
      entry = { count: 0, reset: time + config.rateWindowMs }; clients.set(client, entry);
    }
    entry.count += 1;
    return entry.count > config.rateLimit ? Math.max(1, Math.ceil((entry.reset - time) / 1000)) : 0;
  };
}
