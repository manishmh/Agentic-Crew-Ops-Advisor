export interface StructuredGenerationRequest {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

export interface TextGenerationRequest {
  system: string;
  user: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generateStructured(request: StructuredGenerationRequest): Promise<unknown>;
  generateText(request: TextGenerationRequest): Promise<string>;
}

export interface ProviderDiagnostic {
  phase?: "response_parse";
  kind: "http" | "timeout" | "network" | "response" | "output_shape";
  status?: number;
  code?: string;
  type?: string;
  message: string;
}

/** Safe to print in CLI evaluation output; it intentionally has no request data. */
export class ProviderRequestError extends Error {
  constructor(readonly diagnostic: ProviderDiagnostic) {
    super(diagnostic.message);
    this.name = "ProviderRequestError";
  }
}

interface OpenAiProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class OpenAiResponsesProvider implements LlmProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAiProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    // CREWOPS_LLM_BASE_URL is the API root, not an endpoint. Normalize an
    // accidental trailing slash or endpoint suffix so /responses is joined once.
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").trim().replace(/\/+$/, "").replace(/\/responses$/, "");
    this.timeoutMs = options.timeoutMs ?? 12_000;
  }

  private async request(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw new ProviderRequestError({ kind: "timeout", message: `OpenAI Responses request timed out after ${this.timeoutMs}ms.` });
        throw new ProviderRequestError({ kind: "network", message: error instanceof Error ? `OpenAI network request failed: ${error.message}` : "OpenAI network request failed." });
      }
      if (!response.ok) {
        let payload: unknown;
        try { payload = await response.json(); } catch { /* Non-JSON proxy/server error. */ }
        const error = typeof payload === "object" && payload !== null && typeof (payload as { error?: unknown }).error === "object" && (payload as { error?: unknown }).error !== null
          ? (payload as { error: Record<string, unknown> }).error : undefined;
        throw new ProviderRequestError({
          kind: "http", status: response.status,
          code: typeof error?.code === "string" ? error.code : undefined,
          type: typeof error?.type === "string" ? error.type : undefined,
          message: typeof error?.message === "string" ? error.message : `OpenAI Responses request failed (${response.status}).`,
        });
      }
      const payload: unknown = await response.json();
      if (typeof payload !== "object" || payload === null) throw new ProviderRequestError({ kind: "response", message: "OpenAI Responses returned malformed JSON." });
      return payload as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  }

  private outputText(payload: Record<string, unknown>): string {
    if (typeof payload.output_text === "string") return payload.output_text;
    const output = Array.isArray(payload.output) ? payload.output : [];
    const texts: string[] = [];
    for (const item of output) {
      // Responses providers may emit reasoning/tool items before the assistant
      // message. Only assistant message output_text parts are model text.
      if (typeof item !== "object" || item === null || (item as { type?: unknown }).type !== "message" || !Array.isArray((item as { content?: unknown }).content)) continue;
      for (const content of (item as { content: unknown[] }).content) {
        if (typeof content === "object" && content !== null && (content as { type?: unknown }).type === "output_text" && typeof (content as { text?: unknown }).text === "string") texts.push((content as { text: string }).text);
      }
    }
    if (texts.length > 0) return texts.join("");
    throw new ProviderRequestError({ phase: "response_parse", kind: "output_shape", message: "Responses output contained no assistant output_text content." });
  }

  async generateStructured(request: StructuredGenerationRequest): Promise<unknown> {
    const payload = await this.request({ model: this.model, instructions: request.system, input: request.user, text: { format: { type: "json_schema", name: request.schemaName, strict: true, schema: request.schema } } });
    try { return JSON.parse(this.outputText(payload)); }
    catch (error) {
      if (error instanceof ProviderRequestError) throw error;
      throw new ProviderRequestError({ phase: "response_parse", kind: "response", code: "invalid_json", message: "Responses structured output was not valid JSON." });
    }
  }

  async generateText(request: TextGenerationRequest): Promise<string> {
    return this.outputText(await this.request({ model: this.model, instructions: request.system, input: request.user }));
  }
}

export function createLlmProviderFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider | undefined {
  const provider = env.CREWOPS_LLM_PROVIDER?.trim().toLowerCase();
  const apiKey = env.CREWOPS_LLM_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  if (!provider || provider === "disabled" || !apiKey) return undefined;
  if (provider !== "openai") return undefined;
  const configuredTimeout = env.CREWOPS_LLM_TIMEOUT_MS ? Number(env.CREWOPS_LLM_TIMEOUT_MS) : undefined;
  const timeoutMs = configuredTimeout !== undefined && Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : undefined;
  return new OpenAiResponsesProvider({ apiKey, model: env.CREWOPS_LLM_MODEL?.trim() || "gpt-5-mini", baseUrl: env.CREWOPS_LLM_BASE_URL?.trim() || undefined, timeoutMs });
}
