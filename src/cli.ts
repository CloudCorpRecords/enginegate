#!/usr/bin/env node
/**
 * enginegate CLI.
 *
 *   enginegate call '<json args>'   forward one `unreal` gateway call
 *   enginegate mcp
 *   enginegate --version
 *
 * The editor endpoint comes from UNREAL_MCP_URL (default
 * http://127.0.0.1:3000/mcp); MCP_AUTOMATION_CAPABILITY_TOKEN, when
 * set, is sent as the X-MCP-Capability-Token header.
 * Exit codes: 0 success, 1 call/validation error, 2 usage error.
 */
import { callUnreal, endpointFromEnv, tokenFromEnv, VERSION } from "./enginegate.js";
import type { FetchFn } from "./types.js";

function usage(): never {
  console.error(`Usage:
  enginegate call '<json args>'   e.g. enginegate call '{"operation":"search","query":"spawn actor"}'
  enginegate mcp
  enginegate --version`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (cmd !== "call") usage();
  let args: Record<string, unknown> = {};
  const raw = rest.join(" ").trim();
  if (raw) {
    try {
      args = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      console.error("error: args must be a JSON object");
      process.exit(1);
    }
  }
  try {
    const fetchFn = globalThis.fetch as unknown as FetchFn;
    const result = await callUnreal(fetchFn, args, {
      endpoint: endpointFromEnv(),
      token: tokenFromEnv(),
    });
    console.log(result.text);
    if (result.isError) process.exit(1);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
