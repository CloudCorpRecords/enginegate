# enginegate — Build Report

Tranche #101+ Batch 1, MCP Rebuild 1000 program. Clean-room rebuild of
ChiR24/Unreal_mcp (candidate `ai.smithery/ChiR24-unreal_mcp`, rank 11,
983 stars), built from the current documented surface only: the repo
README's "The unreal tool" section (retrieved 2026-10-26). The
registry-listed 0.4.x line exposed 23 direct tools, but those are
superseded upstream; the current 0.6 line documents exactly one
gateway tool, and that is what was built. Local build only — nothing
pushed or published.

Identity: repo `enginegate`, npm `@reneturcios/enginegate`,
MCP name `io.github.CloudCorpRecords/enginegate`, version `0.1.0`.
Build dir: `~/workspace/mcp-rebuild-100/builds/enginegate/`.

## Fixture (written first)

`~/workspace/mcp-rebuild-100/harness/fixtures/unreal_mcp-tools-original.json`
— docs-derived (not hand-probed), 1 tool: `unreal`, with the exact
`_source` note recording that the 0.4.x line's 23 direct tools are
superseded and not the fixture.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `enginegate: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Gateway to a running Unreal Editor:
  search, describe, execute, and configure capabilities." = **90
  chars** (≤100 ✓); npm entry carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/enginegate:0.1.0` carries **no** `version`
  field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/enginegate"`
- `tsconfig.json` (318 bytes, fleet-identical), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/types.ts`, `src/enginegate.ts` (core,
  `VERSION = "0.1.0"`), `src/mcp.ts`, `src/cli.ts`
- `test/enginegate.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (image name and smoke-test server name adapted to enginegate)

## Implementation notes

- One tool, `unreal`: operations `search` / `describe` / `execute` /
  `configure`. `src/mcp.ts` uses the SDK's low-level `Server` API with
  an explicit inputSchema literal exactly as the fixture — not
  McpServer+zod (whose schema conversion injects `$schema` /
  `additionalProperties` keys absent from the spec and breaks parity).
- Core `src/enginegate.ts` is a forwarding client: it builds a
  JSON-RPC 2.0 `tools/call` request for name `unreal` with the call
  arguments and POSTs it via an injectable `FetchFn` to
  `UNREAL_MCP_URL` (default `http://127.0.0.1:3000/mcp`). When
  `MCP_AUTOMATION_CAPABILITY_TOKEN` is set, it is sent as the
  `X-MCP-Capability-Token` header. Plain-JSON and SSE (`data:`)
  response bodies are both parsed; the editor's own result text and
  isError flag are what the caller receives (response-parsing pattern
  adapted from the codehost-remote build's mechanics).
- Local validation runs BEFORE forwarding, and violations are local
  isError results naming the missing field: `operation` must be in
  the enum; `search` requires `query`; `describe` requires `tool`;
  `execute` requires (`tool` + `action`) or `capability`;
  `configure` requires `tool` or `params`.
- A failed fetch returns an honest isError carrying the underlying
  error text (the cause chain is rendered, so `ECONNREFUSED` survives
  Node's `fetch failed` wrapper) — never a fabricated result.
- CLI: `enginegate call '<json args>'` mirrors the tool; `--version`
  prints `0.1.0`; unknown command exits 2 with Usage (verified).

## Verification (exact outputs, all foreground)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo exit=$?
tsc exit=0
```
`dist/` produced (cli.js, enginegate.js, mcp.js, index.js, types.js,
plus .d.ts/.js.map). `node_modules` is a `cp -a` copy of clockport's
(the copy logged ownership-preservation warnings; the tree was
verified functional — tsc 5.9.3 and tsx 4.23.15 run from it).

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 18
ℹ pass 18
ℹ fail 0
```
18 tests, fake FetchFn only, no network. Covers: default endpoint and
env overrides (`UNREAL_MCP_URL`, token), asserted request URL,
`X-MCP-Capability-Token` header present when set and absent when not,
JSON-RPC body shape (method `tools/call`, name `unreal`, arguments
forwarded), plain-JSON parsing, SSE (`data:`) parsing, the editor's
isError flag preserved, JSON-RPC error payload surfaced, HTTP 500
surfaced, every local validation rule (missing `operation`, `query`,
`tool`, `action`; `capability` accepted as the execute alternative;
`tool`-or-`params` for configure) with fetch never called on a
violation, and the honest connection-failure error carrying
`ECONNREFUSED`.

### 3. Parity
```
$ python3 harness/parity.py \
    --original harness/fixtures/unreal_mcp-tools-original.json \
    --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/enginegate/dist/cli.js mcp" \
    --out ~/workspace/mcp-rebuild-100/builds/enginegate/parity-out
verdict=PASS parity_pct=100.0 original_tools=1 rebuild_tools=1 missing=[] extra=[] schema_diffs=[]
(exit 0)
```

### 4. Live check (stdio, no editor running)
`initialize` → `serverInfo {"name":"enginegate","version":"0.1.0"}`.
`tools/call` `unreal` with `{"operation":"search","query":"spawn actor"}`
returned, exactly:

```
{"content": [{"type": "text", "text": "Failed to reach Unreal Editor at http://127.0.0.1:3000/mcp: fetch failed: connect ECONNREFUSED 127.0.0.1:3000 (ECONNREFUSED)"}], "isError": true}
```

That is the expected honest result: no editor is running in this
environment, so the call fails with the real connection error. No
live editor behaviour is claimed anywhere in this build.

## Lockfile

**Clean lockfile generated via Route 3** (LOCKFILE-ROUTE.md): only
`package.json` was copied to a fresh `/tmp/enginegate-lock/`, then
`npm install --package-lock-only --ignore-scripts --offline` produced
a `package-lock.json` that parses, has `name ==
"@reneturcios/enginegate"` (top-level and root package), version
0.1.0, lockfileVersion 3, 128 package entries, and no `node_modules`
created. That verified clean lockfile is the one in this build dir —
it is not a copied/edited fleet lockfile.

## Honest gaps

- No live Unreal Editor exists in this environment, so forwarding is
  proven against fake FetchFn responses only (plain-JSON and SSE);
  no live editor call was made or claimed.
- Capability-token file discovery via `UE_PROJECT_PATH` is **not
  implemented** — the capability token is read from the
  `MCP_AUTOMATION_CAPABILITY_TOKEN` environment variable only.
- Protocol-version negotiation of the native editor route is not
  reproduced: enginegate POSTs a bare JSON-RPC `tools/call` without an
  MCP `initialize` handshake against the editor endpoint, matching
  the stateless forwarding pattern used by the fleet's other
  forwarding rebuilds; whether the real editor endpoint requires a
  handshake/session is a first check for a future live smoke with an
  editor actually running.
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.
- mcpaudit / mcpvet / shipcheck not yet run — pre-publish gate.
