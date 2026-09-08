import { ENV } from "./env";
import { logger } from "./logger";

const LLM_REQUEST_TIMEOUT_MS = 90_000;

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?:
      | "audio/mpeg"
      | "audio/wav"
      | "application/pdf"
      | "audio/mp4"
      | "video/mp4";
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  /** Override API base URL (e.g., OpenRouter endpoint) */
  baseUrl?: string;
  /** Override API key (e.g., OpenRouter key) */
  apiKey?: string;
  /** Lock the request to one provider instead of selecting from environment state. */
  provider?: LLMProvider;
  /** Force a specific model, bypassing env defaults. Used by the fallback rotation. */
  modelOverride?: string;
  /** Cap retries for a caller without changing the global provider policy. */
  maxRetries?: number;
  /** Validate a provider response before accepting it. Invalid output falls through to the next model. */
  resultValidator?: (result: InvokeResult) => void;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  /** Model requested from the provider, before any provider-side routing. */
  requestedModel?: string;
  /** Model reported by the provider response, when available. */
  actualModel?: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type LLMProvider = "openai" | "openrouter";

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

export type LLMFailureCategory =
  | "temporary_rate_limit"
  | "daily_quota_exhausted"
  | "timeout"
  | "network_error"
  | "model_failed"
  | "validation_failed"
  | "configuration_error";

export interface ModelState {
  model: string;
  unavailableUntil?: number;
  reason?: "daily_quota_exhausted";
}

export interface LLMAttemptDiagnostic {
  model: string;
  requestedModel?: string;
  actualModel?: string;
  attempt?: number;
  outcome?: string;
  category: LLMFailureCategory | "unavailable";
  status?: number;
  message: string;
}

export class LLMRequestError extends Error {
  readonly status: number;
  readonly rateLimitRemaining?: number;
  readonly rateLimitReset?: string;
  readonly responseBody: string;

  constructor(options: {
    status: number;
    statusText: string;
    responseBody: string;
    rateLimitRemaining?: number;
    rateLimitReset?: string;
  }) {
    super(`LLM invoke failed: ${options.status} ${options.statusText}`);
    this.name = "LLMRequestError";
    this.status = options.status;
    this.responseBody = options.responseBody;
    this.rateLimitRemaining = options.rateLimitRemaining;
    this.rateLimitReset = options.rateLimitReset;
  }
}

export class LLMValidationError extends Error {
  readonly retryable: boolean;
  readonly outcome?: string;

  constructor(
    message = "LLM response failed validation",
    options?: { retryable?: boolean; outcome?: string }
  ) {
    super(message);
    this.name = "LLMValidationError";
    this.retryable = options?.retryable ?? false;
    this.outcome = options?.outcome;
  }
}

export class AllLLMModelsFailedError extends Error {
  readonly code = "ALL_LLM_MODELS_FAILED";
  readonly attempts: LLMAttemptDiagnostic[];

  constructor(attempts: LLMAttemptDiagnostic[]) {
    super(
      attempts.find(attempt => attempt.category === "configuration_error")
        ?.message ??
        `All usable LLM models failed (${attempts
          .map(attempt => `${attempt.model}:${attempt.category}`)
          .join(", ")})`
    );
    this.name = "AllLLMModelsFailedError";
    this.attempts = attempts;
  }
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

const llmSemaphore = new Semaphore(ENV.llmMaxConcurrency);
const modelStates = new Map<string, ModelState>();
const llmMetrics = {
  requests: 0,
  successes: 0,
  failures: 0,
  rateLimits: 0,
  dailyQuotaFailures: 0,
  fallbackUsage: 0,
};

export function getLLMMetrics() {
  return { ...llmMetrics };
}

export function parseRateLimitReset(
  value: string | undefined
): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function findNestedHeader(
  value: unknown,
  headerName: string
): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (key.toLowerCase() === headerName && nested != null)
      return String(nested);
    const found = findNestedHeader(nested, headerName);
    if (found) return found;
  }
  return undefined;
}

function resetTimestampFromError(error: unknown): number | undefined {
  if (!(error instanceof LLMRequestError)) return undefined;
  const direct = parseRateLimitReset(error.rateLimitReset);
  if (direct) return direct;
  try {
    return parseRateLimitReset(
      findNestedHeader(JSON.parse(error.responseBody), "x-ratelimit-reset")
    );
  } catch {
    const unescaped = error.responseBody.replace(/\\"/g, '"');
    const match = unescaped.match(
      /x-ratelimit-reset["']?\s*[:=]\s*["']?([^,"'\s}]+)/i
    );
    return parseRateLimitReset(match?.[1]);
  }
}

export function getModelState(model: string, now = Date.now()): ModelState {
  const state = modelStates.get(model);
  if (state?.unavailableUntil && state.unavailableUntil <= now) {
    modelStates.delete(model);
    return { model };
  }
  return state ? { ...state } : { model };
}

export function resetLLMRuntimeStateForTests(): void {
  modelStates.clear();
  Object.keys(llmMetrics).forEach(key => {
    llmMetrics[key as keyof typeof llmMetrics] = 0;
  });
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]")
    .slice(0, 300);
}

export function classifyLLMFailure(error: unknown): LLMFailureCategory {
  if (error instanceof LLMValidationError) return "validation_failed";

  if (
    error instanceof Error &&
    /No (?:OpenAI|OpenRouter) API key configured\. Set [A-Z_]+\./.test(
      error.message
    )
  ) {
    return "configuration_error";
  }

  const status = (error as { status?: number } | undefined)?.status;
  const requestError = error instanceof LLMRequestError ? error : undefined;
  const text =
    `${safeErrorMessage(error)} ${requestError?.responseBody ?? ""}`.toLowerCase();
  const remainingIsZero = requestError?.rateLimitRemaining === 0;
  const dailyQuotaSignal =
    remainingIsZero ||
    /free[-_ ]?models?[-_ ]?per[-_ ]?day/.test(text) ||
    /openrouter[-_ ]?free[-_ ]?tier[-_ ]?daily/.test(text) ||
    /daily\s+(?:rate\s+)?limit/.test(text) ||
    /daily\s+quota/.test(text) ||
    /quota[^.]{0,40}(?:day|daily|reset)/.test(text) ||
    /x-ratelimit-remaining["']?\s*[:=]\s*["']?0\b/.test(
      text.replace(/\\"/g, '"')
    );

  if (status === 429 && dailyQuotaSignal) return "daily_quota_exhausted";
  if (status === 429) return "temporary_rate_limit";
  if (
    error instanceof Error &&
    (error.name === "AbortError" ||
      /timeout|timed out|deadline exceeded/i.test(error.message))
  ) {
    return "timeout";
  }
  if (
    error instanceof TypeError ||
    (error instanceof Error &&
      /fetch failed|network|econnreset|enotfound|eai_again|socket hang up/i.test(
        error.message
      ))
  ) {
    return "network_error";
  }
  return "model_failed";
}

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");

    return {
      role,
      name,
      tool_call_id,
      content,
    };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  // If there's only text content, collapse to a single string for compatibility
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text,
    };
  }

  return {
    role,
    name,
    content: contentParts,
  };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }

    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

const resolveApiUrl = (overrideBaseUrl?: string, provider?: LLMProvider) => {
  if (provider === "openai") {
    return "https://api.openai.com/v1/chat/completions";
  }
  if (provider === "openrouter") {
    const base = (overrideBaseUrl || ENV.openrouterBaseUrl).replace(/\/+$/, "");
    return `${base}/chat/completions`;
  }
  if (overrideBaseUrl) {
    const base = overrideBaseUrl.replace(/\/+$/, "");
    return `${base}/chat/completions`;
  }
  if (ENV.openaiApiKey) {
    return "https://api.openai.com/v1/chat/completions";
  }
  const base = ENV.openrouterBaseUrl.replace(/\/+$/, "");
  return `${base}/chat/completions`;
};

const assertApiKey = (overrideKey?: string, provider?: LLMProvider) => {
  const key =
    overrideKey ||
    (provider === "openai"
      ? ENV.openaiApiKey
      : provider === "openrouter"
        ? ENV.openrouterApiKey
        : ENV.openaiApiKey || ENV.openrouterApiKey);
  if (!key) {
    throw new Error(
      provider === "openai"
        ? "No OpenAI API key configured. Set OPENAI_API_KEY."
        : provider === "openrouter"
          ? "No OpenRouter API key configured. Set OPENROUTER_API_KEY."
          : "No API key configured. Set OPENAI_API_KEY or OPENROUTER_API_KEY."
    );
  }
  return key;
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const apiKey = assertApiKey(params.apiKey, params.provider);

  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
    baseUrl,
  } = params;

  const useOpenRouter = Boolean(
    params.provider === "openrouter" ||
      (params.provider !== "openai" &&
        (baseUrl || (!ENV.openaiApiKey && !!ENV.openrouterApiKey)))
  );
  const model =
    params.modelOverride ??
    (useOpenRouter ? ENV.openrouterModel : ENV.openaiModel);

  const payload: Record<string, unknown> = {
    model,
    messages: messages.map(normalizeMessage),
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }

  const maxTokens = params.maxTokens ?? params.max_tokens ?? 32768;
  payload[useOpenRouter ? "max_tokens" : "max_completion_tokens"] = maxTokens;

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };

  if (useOpenRouter) {
    headers["HTTP-Referer"] = ENV.appUrl;
    headers["X-Title"] = "Shopify Price Intelligence";
  }

  return llmSemaphore.run(async () => {
    llmMetrics.requests++;
    try {
      const response = await fetch(resolveApiUrl(baseUrl, params.provider), {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        // The pipeline runs unattended on a cron. Without this, one hung
        // connection stalls the whole run indefinitely.
        signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const responseBody = (await response.text()).slice(0, 4000);
        const remainingHeader = response.headers.get("x-ratelimit-remaining");
        const remaining =
          remainingHeader == null ? undefined : Number(remainingHeader);
        throw new LLMRequestError({
          status: response.status,
          statusText: response.statusText,
          responseBody,
          rateLimitRemaining: Number.isFinite(remaining)
            ? remaining
            : undefined,
          rateLimitReset:
            response.headers.get("x-ratelimit-reset") ?? undefined,
        });
      }

      const result = (await response.json()) as InvokeResult;
      const actualModel =
        typeof result.model === "string" && result.model.length > 0
          ? result.model
          : undefined;
      llmMetrics.successes++;
      return {
        ...result,
        model: actualModel ?? model,
        requestedModel: model,
        actualModel,
      };
    } catch (error) {
      llmMetrics.failures++;
      throw error;
    }
  });
}

/**
 * Try each configured model in turn before giving up, so one unavailable model
 * does not stall a run. Set OPENAI_MODELS or OPENROUTER_MODELS to a
 * comma-separated list to control the order for the selected provider.
 */
export async function invokeLLMWithFallback(
  params: InvokeParams
): Promise<InvokeResult> {
  const useOpenRouter = Boolean(
    params.provider === "openrouter" ||
      (params.provider !== "openai" &&
        (params.baseUrl || (!ENV.openaiApiKey && !!ENV.openrouterApiKey)))
  );
  const configuredCandidates = params.modelOverride
    ? [params.modelOverride]
    : useOpenRouter
      ? ENV.openrouterModels.length
        ? ENV.openrouterModels
        : [ENV.openrouterModel]
      : ENV.openaiModels.length
        ? ENV.openaiModels
        : [ENV.openaiModel];
  const candidates = Array.from(new Set(configuredCandidates));
  const diagnostics: LLMAttemptDiagnostic[] = [];
  let attemptedModelCount = 0;

  const configuredApiKey =
    params.apiKey || (useOpenRouter ? ENV.openrouterApiKey : ENV.openaiApiKey);
  if (!configuredApiKey) {
    const keyName = useOpenRouter ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY";
    const message = `AI extraction unavailable: ${keyName} is not configured`;
    throw new AllLLMModelsFailedError(
      candidates.map(model => ({
        model,
        category: "configuration_error" as const,
        message,
      }))
    );
  }

  for (const model of candidates) {
    const now = Date.now();
    const state = getModelState(model, now);
    if (state.unavailableUntil && state.unavailableUntil > now) {
      diagnostics.push({
        model,
        category: "unavailable",
        message: `unavailable until ${new Date(state.unavailableUntil).toISOString()}`,
      });
      logger.warn(
        {
          model,
          reason: state.reason,
          resetAt: new Date(state.unavailableUntil).toISOString(),
          action: "skipping_model",
        },
        "LLM model unavailable"
      );
      continue;
    }

    if (attemptedModelCount > 0 || diagnostics.length > 0) {
      llmMetrics.fallbackUsage++;
      logger.info({ model, reason: "previous_model_failed" }, "LLM fallback");
    }
    attemptedModelCount++;

    const maxRetries = Math.max(
      0,
      Math.min(ENV.llmMaxRetries, params.maxRetries ?? ENV.llmMaxRetries)
    );
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let result: InvokeResult | undefined;
      try {
        result = await invokeLLM({ ...params, modelOverride: model });
        params.resultValidator?.(result);
        return result;
      } catch (error) {
        const category = classifyLLMFailure(error);
        const status = (error as { status?: number } | undefined)?.status;
        diagnostics.push({
          model,
          requestedModel: model,
          actualModel: result?.actualModel,
          attempt: attempt + 1,
          outcome:
            error instanceof LLMValidationError ? error.outcome : undefined,
          category,
          status,
          message: safeErrorMessage(error),
        });

        if (category === "daily_quota_exhausted") {
          llmMetrics.rateLimits++;
          llmMetrics.dailyQuotaFailures++;
          const headerReset = resetTimestampFromError(error);
          const resetAt =
            headerReset && headerReset > now
              ? headerReset
              : now + ENV.llmQuotaFallbackCooldownMs;
          modelStates.set(model, {
            model,
            unavailableUntil: resetAt,
            reason: "daily_quota_exhausted",
          });
          logger.warn(
            {
              model,
              reason: "daily_quota_exhausted",
              resetAt: new Date(resetAt).toISOString(),
              action: "skipping_model",
            },
            "LLM model quota exhausted"
          );
          break;
        }

        if (category === "temporary_rate_limit") {
          llmMetrics.rateLimits++;
          if (attempt < maxRetries) {
            const waitMs = ENV.llmBackoffBaseMs * Math.pow(2, attempt);
            logger.warn(
              { model, attempt: attempt + 1, waitMs, reason: category },
              "LLM temporarily rate limited"
            );
            await new Promise(resolve => setTimeout(resolve, waitMs));
            continue;
          }
        }

        if (
          category === "validation_failed" &&
          error instanceof LLMValidationError &&
          (error.outcome === "AI_PRODUCT_FOUND_VALIDATION_REJECTED" ||
            error.outcome === "AI_PRICE_AMBIGUOUS")
        ) {
          throw new AllLLMModelsFailedError(diagnostics);
        }

        if (
          category === "validation_failed" &&
          error instanceof LLMValidationError &&
          error.retryable &&
          attempt < maxRetries
        ) {
          const waitMs = ENV.llmBackoffBaseMs * Math.pow(2, attempt);
          logger.warn(
            {
              model,
              attempt: attempt + 1,
              waitMs,
              reason: error.outcome ?? "structured_output_format",
            },
            "LLM structured output retry"
          );
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }

        // Provider/model failures and malformed model output are not made more
        // reliable by repeating the same request. Move to the next model.
        break;
      }
    }
  }

  logger.error(
    {
      models: candidates,
      failures: diagnostics.map(({ model, category, status }) => ({
        model,
        category,
        status,
      })),
    },
    "All LLM extraction models failed"
  );
  throw new AllLLMModelsFailedError(diagnostics);
}
