/**
 * enginegate core: a forwarding client for a running Unreal Editor.
 *
 * The editor exposes one gateway tool, `unreal`, on its own local MCP
 * endpoint (default http://127.0.0.1:3000/mcp, override with
 * UNREAL_MCP_URL). Each call made here becomes one JSON-RPC 2.0
 * `tools/call` POST for that tool with the call arguments. When
 * MCP_AUTOMATION_CAPABILITY_TOKEN is set, it is sent as the
 * `X-MCP-Capability-Token` header. The endpoint may answer with plain
 * JSON or a text/event-stream (SSE) body whose `data:` lines carry
 * JSON-RPC payloads; both are parsed.
 *
 * Argument requirements are validated locally before anything is
 * forwarded, and validation errors name the missing field. A failed
 * fetch (for example, the editor is not running) is reported with the
 * underlying error text preserved — never a fabricated result.
 * All HTTP goes through an injected FetchFn for offline testing.
 */
import type { FetchFn, GatewayOptions, GatewayResult, UnrealArgs } from "./types.js";

export const VERSION = "0.1.0";
export const DEFAULT_ENDPOINT = "http://127.0.0.1:3000/mcp";
export const TOOL_NAME = "unreal";
export const OPERATIONS = ["search", "describe", "execute", "configure"] as const;

export function endpointFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.UNREAL_MCP_URL;
  const url = typeof raw === "string" ? raw.trim() : "";
  return url || DEFAULT_ENDPOINT;
}

/** The capability token from the environment, or undefined when unset. */
export function tokenFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = env.MCP_AUTOMATION_CAPABILITY_TOKEN;
  const token = typeof raw === "string" ? raw.trim() : "";
  return token || undefined;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate a gateway argument set locally, before forwarding. Throws
 * an Error naming the missing (or invalid) field.
 */
export function validateGatewayArgs(args: Record<string, unknown>): UnrealArgs {
  const operation = args.operation;
  if (!nonEmpty(operation) || !(OPERATIONS as readonly string[]).includes(operation)) {
    throw new Error(
      `operation is required and must be one of: ${OPERATIONS.join(", ")}`,
    );
  }
  switch (operation) {
    case "search":
      if (!nonEmpty(args.query)) {
        throw new Error('query is required for operation "search"');
      }
      break;
    case "describe":
      if (!nonEmpty(args.tool)) {
        throw new Error('tool is required for operation "describe"');
      }
      break;
    case "execute":
      if (!nonEmpty(args.capability)) {
        if (!nonEmpty(args.tool)) {
          throw new Error(
            'tool is required for operation "execute" (unless capability is given)',
          );
        }
        if (!nonEmpty(args.action)) {
          throw new Error(
            'action is required for operation "execute" (unless capability is given)',
          );
        }
      }
      break;
    case "configure":
      if (!nonEmpty(args.tool) && (args.params === undefined || args.params === null)) {
        throw new Error(
          'tool or params is required for operation "configure"',
        );
      }
      break;
  }
  return args as unknown as UnrealArgs;
}

/** Keep only the documented fields, dropping undefined values. */
export function cleanArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["operation", "query", "tool", "action", "capability", "params", "consent"]) {
    if (args[key] !== undefined) out[key] = args[key];
  }
  return out;
}

export function extractJsonPayloads(body: string): unknown[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  const dataLines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line.length > 0 && line !== "[DONE]");
  const candidates = dataLines.length > 0 ? dataLines : [trimmed];
  const payloads: unknown[] = [];
  for (const candidate of candidates) {
    try {
      payloads.push(JSON.parse(candidate));
    } catch {
      // Non-JSON stream noise is ignored.
    }
  }
  return payloads;
}

export function resultFromPayload(payload: unknown): GatewayResult {
  if (payload === null || typeof payload !== "object") {
    throw new Error("Unreal Editor returned an unexpected response shape");
  }
  const obj = payload as Record<string, unknown>;
  if (obj.error !== undefined && obj.error !== null) {
    const err = obj.error as Record<string, unknown>;
    const message =
      typeof err.message === "string" ? err.message : JSON.stringify(obj.error);
    throw new Error(`Unreal Editor error: ${message}`);
  }
  const result = obj.result;
  if (typeof result === "string") return { text: result, isError: false };
  if (result !== null && typeof result === "object") {
    const r = result as Record<string, unknown>;
    const isError = r.isError === true;
    if (Array.isArray(r.content)) {
      const texts = r.content
        .filter(
          (part): part is Record<string, unknown> =>
            part !== null && typeof part === "object",
        )
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text as string);
      if (texts.length > 0) return { text: texts.join("\n"), isError };
      if (r.content.length === 0) {
        throw new Error("Unreal Editor returned an empty content list");
      }
    }
    if (isError) {
      throw new Error("Unreal Editor returned an error result with no text");
    }
    return { text: JSON.stringify(result, null, 2), isError };
  }
  throw new Error("Unreal Editor returned a response with no readable result");
}

export function parseToolResponse(body: string): GatewayResult {
  const payloads = extractJsonPayloads(body);
  if (payloads.length === 0) {
    throw new Error("Unreal Editor returned an empty or non-JSON response");
  }
  for (let i = payloads.length - 1; i >= 0; i--) {
    const payload = payloads[i] as Record<string, unknown>;
    if (payload && (payload.result !== undefined || payload.error !== undefined)) {
      return resultFromPayload(payload);
    }
  }
  return resultFromPayload(payloads[payloads.length - 1]);
}

/** Render an error with its cause chain, so ECONNREFUSED etc. survive. */
export function errorText(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  const seen = new Set<unknown>();
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      parts.push(typeof code === "string" ? `${current.message} (${code})` : current.message);
      current = (current as { cause?: unknown }).cause;
    } else if (typeof current === "object") {
      const code = (current as { code?: unknown }).code;
      const message = (current as { message?: unknown }).message;
      if (typeof code === "string") parts.push(code);
      else if (typeof message === "string") parts.push(message);
      else break;
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.filter((p) => p.length > 0).join(": ");
}

let nextRequestId = 1;

/**
 * Validate, then forward one gateway call to the editor endpoint.
 * Throws on local validation errors, connection failures, HTTP
 * errors, and JSON-RPC errors; resolves with the editor's own result
 * (including its isError flag) otherwise.
 */
export async function callUnreal(
  fetchFn: FetchFn,
  rawArgs: Record<string, unknown>,
  options: GatewayOptions = {},
): Promise<GatewayResult> {
  const args = validateGatewayArgs(rawArgs);
  const endpoint = options.endpoint ?? endpointFromEnv();
  const token = options.token ?? tokenFromEnv();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers["X-MCP-Capability-Token"] = token;
  const requestBody = JSON.stringify({
    jsonrpc: "2.0",
    id: nextRequestId++,
    method: "tools/call",
    params: { name: TOOL_NAME, arguments: cleanArgs(args as unknown as Record<string, unknown>) },
  });
  let response;
  try {
    response = await fetchFn(endpoint, { method: "POST", headers, body: requestBody });
  } catch (err) {
    throw new Error(
      `Failed to reach Unreal Editor at ${endpoint}: ${errorText(err)}`,
    );
  }
  const body = await response.text();
  if (!response.ok) {
    const detail = body.trim().slice(0, 200);
    throw new Error(
      `Unreal Editor request failed: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${detail ? `: ${detail}` : ""}`,
    );
  }
  return parseToolResponse(body);
}
