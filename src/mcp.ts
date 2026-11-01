/**
 * enginegate MCP server. One tool: `unreal`, a gateway to a running
 * Unreal Editor, forwarded to the editor's local MCP endpoint.
 *
 * Low-level Server API with an explicit inputSchema literal (the
 * McpServer+zod path injects $schema/additionalProperties and breaks
 * parity). The literal matches the documented tool spec exactly.
 * Argument validation and forwarding live in the core module; every
 * failure — local validation, an unreachable editor, an upstream
 * error — is returned as an isError result, never fabricated.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { callUnreal, endpointFromEnv, tokenFromEnv, VERSION } from "./enginegate.js";
import type { FetchFn } from "./types.js";

export const TOOLS = [
  {
    name: "unreal",
    description:
      "Gateway to a running Unreal Editor: search capabilities, describe one capability's contract, execute a capability, or configure capability groups.",
    inputSchema: {
      type: "object" as const,
      properties: {
        operation: {
          type: "string",
          enum: ["search", "describe", "execute", "configure"],
          description: "The gateway operation to perform.",
        },
        query: {
          type: "string",
          description: "Plain-words capability search, e.g. 'spawn actor'. Required for search.",
        },
        tool: {
          type: "string",
          description:
            "Internal tool name, e.g. control_actor. Required for describe and execute (unless capability is given).",
        },
        action: {
          type: "string",
          description: "Action within the tool, e.g. spawn. Required for execute (unless capability is given).",
        },
        capability: {
          type: "string",
          description: "Capability id such as control_actor.spawn; an alternative to tool+action for execute.",
        },
        params: {
          type: "object",
          description: "Parameters for the capability being executed.",
        },
        consent: {
          type: "string",
          description: "Consent grant returned by describe for destructive capabilities; required to execute those.",
        },
      },
      required: ["operation"],
    },
  },
];

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true } : {}),
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "enginegate", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name !== "unreal") {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
  try {
    const fetchFn = globalThis.fetch as unknown as FetchFn;
    const result = await callUnreal(fetchFn, (args ?? {}) as Record<string, unknown>, {
      endpoint: endpointFromEnv(),
      token: tokenFromEnv(),
    });
    return textResult(result.text, result.isError);
  } catch (err) {
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
