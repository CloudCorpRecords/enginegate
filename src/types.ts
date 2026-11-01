/**
 * enginegate types.
 *
 * The gateway has exactly one tool, `unreal`, whose arguments are a
 * single operation plus the fields that operation needs. HTTP access
 * to the editor's local MCP endpoint is described by a minimal
 * response surface so tests can inject a fake fetch.
 */

export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: string;
  },
) => Promise<HttpResponse>;

export type GatewayOperation = "search" | "describe" | "execute" | "configure";

/** Arguments of the single `unreal` tool, as documented upstream. */
export interface UnrealArgs {
  operation: GatewayOperation;
  /** Plain-words capability search. Required for search. */
  query?: string;
  /** Internal tool name, e.g. control_actor. */
  tool?: string;
  /** Action within the tool, e.g. spawn. */
  action?: string;
  /** Capability id such as control_actor.spawn; alternative to tool+action for execute. */
  capability?: string;
  /** Parameters for the capability being executed. */
  params?: Record<string, unknown>;
  /** Consent grant returned by describe for destructive capabilities. */
  consent?: string;
}

export interface GatewayOptions {
  /** Editor MCP endpoint; defaults to endpointFromEnv(). */
  endpoint?: string;
  /** Capability token; sent as X-MCP-Capability-Token when set. */
  token?: string;
}

export interface GatewayResult {
  /** Text extracted from the editor's tool result. */
  text: string;
  /** True when the editor itself returned an error result. */
  isError: boolean;
}
