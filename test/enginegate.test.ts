import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  callUnreal,
  endpointFromEnv,
  parseToolResponse,
  tokenFromEnv,
  validateGatewayArgs,
} from "../src/enginegate.js";
import type { FetchFn, HttpResponse } from "../src/types.js";

interface RecordedCall {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

function jsonResponse(body: unknown, ok = true, status = 200): HttpResponse {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Internal Server Error",
    headers: { get: () => null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function rpcResult(text: string, isError = false) {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) },
  };
}

/** A fake FetchFn that records the call and replies with `reply`. */
function fakeFetch(reply: HttpResponse, calls: RecordedCall[]): FetchFn {
  return async (url, init) => {
    calls.push({ url, init });
    return reply;
  };
}

describe("endpoint and token from env", () => {
  it("defaults to the local editor endpoint and no token", () => {
    assert.equal(endpointFromEnv({}), "http://127.0.0.1:3000/mcp");
    assert.equal(tokenFromEnv({}), undefined);
  });

  it("honours UNREAL_MCP_URL and MCP_AUTOMATION_CAPABILITY_TOKEN", () => {
    assert.equal(
      endpointFromEnv({ UNREAL_MCP_URL: " http://localhost:9999/mcp " }),
      "http://localhost:9999/mcp",
    );
    assert.equal(
      tokenFromEnv({ MCP_AUTOMATION_CAPABILITY_TOKEN: "tok-123" }),
      "tok-123",
    );
    assert.equal(tokenFromEnv({ MCP_AUTOMATION_CAPABILITY_TOKEN: "  " }), undefined);
  });
});

describe("validateGatewayArgs", () => {
  it("rejects a missing or unknown operation, naming operation", () => {
    assert.throws(() => validateGatewayArgs({}), /operation/);
    assert.throws(() => validateGatewayArgs({ operation: "explode" }), /operation/);
  });

  it("search requires query", () => {
    assert.throws(() => validateGatewayArgs({ operation: "search" }), /query/);
    assert.equal(
      validateGatewayArgs({ operation: "search", query: "spawn actor" }).operation,
      "search",
    );
  });

  it("describe requires tool", () => {
    assert.throws(() => validateGatewayArgs({ operation: "describe" }), /tool/);
  });

  it("execute requires tool+action, naming the missing field", () => {
    assert.throws(() => validateGatewayArgs({ operation: "execute" }), /tool/);
    assert.throws(
      () => validateGatewayArgs({ operation: "execute", tool: "control_actor" }),
      /action/,
    );
  });

  it("execute accepts capability alone as the tool+action alternative", () => {
    const ok = validateGatewayArgs({
      operation: "execute",
      capability: "control_actor.spawn",
    });
    assert.equal(ok.capability, "control_actor.spawn");
  });

  it("configure requires tool or params", () => {
    assert.throws(() => validateGatewayArgs({ operation: "configure" }), /tool or params/);
    assert.equal(
      validateGatewayArgs({ operation: "configure", params: { group: "actors" } }).operation,
      "configure",
    );
    assert.equal(
      validateGatewayArgs({ operation: "configure", tool: "control_actor" }).operation,
      "configure",
    );
  });
});

describe("callUnreal forwarding", () => {
  it("POSTs a JSON-RPC tools/call for 'unreal' to the default URL", async () => {
    const calls: RecordedCall[] = [];
    const result = await callUnreal(
      fakeFetch(jsonResponse(rpcResult("2 capabilities found")), calls),
      { operation: "search", query: "spawn actor" },
      { endpoint: "http://127.0.0.1:3000/mcp", token: undefined },
    );
    assert.equal(result.text, "2 capabilities found");
    assert.equal(result.isError, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:3000/mcp");
    assert.equal(calls[0].init?.method, "POST");
    const body = JSON.parse(calls[0].init?.body ?? "{}");
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.method, "tools/call");
    assert.equal(body.params.name, "unreal");
    assert.deepEqual(body.params.arguments, {
      operation: "search",
      query: "spawn actor",
    });
    // No token configured: the header must be absent.
    assert.equal(calls[0].init?.headers?.["X-MCP-Capability-Token"], undefined);
  });

  it("sends X-MCP-Capability-Token when a token is configured", async () => {
    const calls: RecordedCall[] = [];
    await callUnreal(
      fakeFetch(jsonResponse(rpcResult("ok")), calls),
      { operation: "describe", tool: "control_actor" },
      { endpoint: "http://127.0.0.1:3000/mcp", token: "cap-token-9" },
    );
    assert.equal(calls[0].init?.headers?.["X-MCP-Capability-Token"], "cap-token-9");
  });

  it("validates locally and never calls fetch on a violation", async () => {
    const calls: RecordedCall[] = [];
    await assert.rejects(
      callUnreal(fakeFetch(jsonResponse(rpcResult("nope")), calls), {
        operation: "search",
      }),
      /query/,
    );
    assert.equal(calls.length, 0);
  });

  it("parses an SSE (data:) response body", async () => {
    const sse =
      "event: message\n" +
      `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1 })}\n\n` +
      "event: message\n" +
      `data: ${JSON.stringify(rpcResult("sse result text"))}\n\n`;
    const calls: RecordedCall[] = [];
    const result = await callUnreal(
      fakeFetch(jsonResponse(sse), calls),
      { operation: "search", query: "spawn actor" },
      { endpoint: "http://127.0.0.1:3000/mcp" },
    );
    assert.equal(result.text, "sse result text");
  });

  it("preserves the editor's own isError flag on a result", async () => {
    const calls: RecordedCall[] = [];
    const result = await callUnreal(
      fakeFetch(jsonResponse(rpcResult("capability disabled", true)), calls),
      { operation: "execute", capability: "control_actor.spawn" },
      { endpoint: "http://127.0.0.1:3000/mcp" },
    );
    assert.equal(result.text, "capability disabled");
    assert.equal(result.isError, true);
  });

  it("surfaces a JSON-RPC error payload as an error naming its message", async () => {
    const calls: RecordedCall[] = [];
    await assert.rejects(
      callUnreal(
        fakeFetch(
          jsonResponse({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "method gone" } }),
          calls,
        ),
        { operation: "search", query: "spawn actor" },
        { endpoint: "http://127.0.0.1:3000/mcp" },
      ),
      /method gone/,
    );
  });

  it("reports a failed fetch honestly, carrying the underlying error text", async () => {
    const failing: FetchFn = async () => {
      const cause = new Error("connect ECONNREFUSED 127.0.0.1:3000");
      (cause as { code?: string }).code = "ECONNREFUSED";
      const err = new Error("fetch failed");
      (err as { cause?: unknown }).cause = cause;
      throw err;
    };
    await assert.rejects(
      callUnreal(failing, { operation: "search", query: "spawn actor" }, {
        endpoint: "http://127.0.0.1:3000/mcp",
      }),
      (err: unknown) => {
        const text = err instanceof Error ? err.message : String(err);
        assert.match(text, /Failed to reach Unreal Editor/);
        assert.match(text, /ECONNREFUSED/);
        return true;
      },
    );
  });

  it("reports a non-OK HTTP status with the status code", async () => {
    const calls: RecordedCall[] = [];
    await assert.rejects(
      callUnreal(
        fakeFetch(jsonResponse("boom", false, 500), calls),
        { operation: "search", query: "spawn actor" },
        { endpoint: "http://127.0.0.1:3000/mcp" },
      ),
      /HTTP 500/,
    );
  });
});

describe("parseToolResponse", () => {
  it("parses a plain-JSON body whose result has no content list", () => {
    const r = parseToolResponse(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { count: 3 } }),
    );
    assert.match(r.text, /"count": 3/);
    assert.equal(r.isError, false);
  });

  it("throws on an empty body instead of fabricating a result", () => {
    assert.throws(() => parseToolResponse(""), /empty or non-JSON/);
    assert.throws(() => parseToolResponse("not json at all"), /empty or non-JSON/);
  });
});
