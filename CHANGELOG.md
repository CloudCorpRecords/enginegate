# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- MCP server (`enginegate mcp`, stdio) with one tool, `unreal`: a
  gateway to a running Unreal Editor with four operations —
  `search` (plain-words capability search), `describe` (one
  capability's contract), `execute` (run a capability, with a consent
  grant for destructive ones), and `configure` (capability groups).
- Calls are forwarded as JSON-RPC `tools/call` requests to the
  editor's local MCP endpoint (`UNREAL_MCP_URL`, default
  `http://127.0.0.1:3000/mcp`); plain-JSON and SSE responses are both
  parsed. When `MCP_AUTOMATION_CAPABILITY_TOKEN` is set it is sent as
  the `X-MCP-Capability-Token` header.
- Argument requirements are validated locally before forwarding, and
  an unreachable editor is reported as an error carrying the
  underlying connection error — never a fabricated result.
- CLI: `enginegate call '<json args>'` mirrors the tool; `--version`
  prints the version; unknown commands exit 2.
