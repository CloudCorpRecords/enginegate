# enginegate

enginegate gives an agent a single doorway into a running Unreal
Editor. Instead of a long list of editor tools, it exposes one
gateway tool, `unreal`, with four operations: search the editor's
capabilities in plain words, read one capability's contract before
using it, execute a capability, and configure which capability
groups are enabled.

Every call is forwarded to the editor's own local MCP endpoint, so
enginegate only works while an editor with that endpoint is running.
When it is not, calls come back as errors carrying the underlying
connection problem — enginegate never invents an editor result.

## Install

```bash
npx @reneturcios/enginegate call '{"operation":"search","query":"spawn actor"}'
```

Or run the container image:

```bash
docker run -i ghcr.io/cloudcorprecords/enginegate
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead.

## Configuration

| Environment variable | Meaning |
| --- | --- |
| `UNREAL_MCP_URL` | The editor's MCP endpoint. Default: `http://127.0.0.1:3000/mcp` |
| `MCP_AUTOMATION_CAPABILITY_TOKEN` | When set, sent on every forwarded call as the `X-MCP-Capability-Token` header. |

## CLI

```bash
# Search capabilities in plain words
enginegate call '{"operation":"search","query":"spawn actor"}'

# Read one internal tool's contract
enginegate call '{"operation":"describe","tool":"control_actor"}'

# Execute a capability by tool + action, or by capability id
enginegate call '{"operation":"execute","tool":"control_actor","action":"spawn","params":{"class":"PointLight"}}'
enginegate call '{"operation":"execute","capability":"control_actor.spawn","params":{"class":"PointLight"}}'

# Configure capability groups
enginegate call '{"operation":"configure","tool":"control_actor","params":{"enabled":true}}'

enginegate --version
```

Exit codes: `0` on success, `1` when a call fails validation or the
editor cannot be reached or returns an error, `2` for usage errors.

Argument requirements are checked before anything is forwarded, and
the error names the missing field:

- `search` requires `query`
- `describe` requires `tool`
- `execute` requires `tool` + `action`, or `capability`
- `configure` requires `tool` or `params`

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/enginegate mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "enginegate": {
      "command": "npx",
      "args": ["-y", "@reneturcios/enginegate", "mcp"]
    }
  }
}
```

### Tools

| Tool | Input | What it does |
| --- | --- | --- |
| `unreal` | `operation` (required; one of `search`, `describe`, `execute`, `configure`), plus per-operation fields: `query`, `tool`, `action`, `capability`, `params`, `consent` | Forwards the call to the running editor's gateway. `describe` returns a capability's contract — including a consent grant for destructive capabilities, which must be passed back as `consent` to `execute` them. |

Forwarded calls are JSON-RPC `tools/call` requests for the tool name
`unreal`. The editor endpoint may answer with a plain JSON body or a
server-sent-events stream; both are parsed, and the editor's own
result text (and error flag) is what the caller receives.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.
