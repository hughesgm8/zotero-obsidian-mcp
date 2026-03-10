# Architectural Decisions

## Decision: Fixed popover (position: fixed, document.body) for chat history — *2026-03-10*

### Why This Matters
The history panel needed to feel like part of the sidebar, not a disruptive app-level interruption. Getting this wrong made the feature feel out of place.

### Options We Considered
1. **Obsidian `Modal`**: Easy to implement, but opens center-screen — jarring for sidebar-confined functionality
2. **Absolute div inside sidebar container**: Clean containment, but the sidebar has `overflow: hidden`, which clips any child that escapes the scroll area
3. **`position: fixed` div appended to `document.body`**: Escapes all overflow clipping, positions freely relative to the viewport, dismissed via click-outside listener

### Why We Chose This
- Matches Copilot's `ChatHistoryPopover` (Radix UI, `side="top" align="end"`) in behavior and feel
- `position: fixed` + `getBoundingClientRect()` anchors it precisely above the trigger button without being clipped
- `document.body` append avoids any z-index or overflow fight with the sidebar layout
- Click-outside listener (deferred via `setTimeout` to avoid immediate self-close) handles dismissal cleanly

### What Could Change
If Obsidian exposes a stable `Popover` API in the future, we could migrate to that for better integration with theme layering. For now, custom fixed positioning is the most reliable option.

---

## Decision: Deterministic orchestration instead of LLM tool-calling

### Why This Matters
The plugin works reliably with local models (DeepSeek via Ollama) that can't do tool-calling, making it accessible to users without paid API access.

### Options We Considered
1. **Deterministic pipeline (search → metadata → LLM)**: Good for reliability with any model, bad for flexibility — the LLM can't decide to search differently
2. **Let the LLM call MCP tools**: Good for smart models that can adapt their search strategy, bad for local models that fail at tool-calling

### Why We Chose This
- Local model support is a first-class concern, not an afterthought
- Fixed pipeline is predictable and debuggable
- MVP doesn't need adaptive search — hybrid search (see below) covers the main failure case

### What Could Change
If we add "Smart mode" for capable models (Claude, GPT-4), we'd let those models call tools directly while keeping the deterministic pipeline as the default.

---

## Decision: Always-on hybrid search with three-tier ranking — *2026-03-05*

### Why This Matters
Semantic search alone fails for queries containing specific identifiers (filenames like "AGENTS.md", author names, acronyms) that embedding models can't represent. These are exactly the queries where users most need precision.

### Options We Considered
1. **Semantic only**: Simple, but misses specific-identifier queries entirely.
2. **LLM keyword extraction + `zotero_search_items`**: LLM extracts keywords, passed as a single multi-word query. Fails because `zotero_search_items` uses AND logic — multi-word queries require every word to appear in the paper title/creator/year.
3. **`zotero_advanced_search` with OR logic**: Correct semantics, but uses `POST /api/users/0/searches` (saved search creation) which the local Zotero API (port 23119) does not support. Only works with the Zotero Web API (cloud + API key). Abandoned.
4. **Per-token parallel `zotero_search_items`**: Split question into tokens (≥3 chars), fire one `zotero_search_items` call per token in parallel. Single-word queries can't fail AND-logic. Confirmed working via direct API test.

### Why We Chose This
- The local Zotero API supports single-word searches reliably
- Claude Desktop handles these queries well because Claude the LLM naturally extracts single keywords — our deterministic pipeline replicates that behaviour explicitly
- Parallel calls add minimal latency (all fire simultaneously, semantic search runs at the same time)

### Three-Tier Ranking
Results are merged in confidence order:
- **Tier 1** — in both semantic AND keyword results (semantic rank preserved): highest confidence
- **Tier 2** — keyword-only: specific identifier/author matches that semantics missed
- **Tier 3** — semantic-only: conceptually related, no keyword hit

This ensures a perfect keyword match (e.g. "AGENTS" → AGENTS.md paper) is never buried behind 10 unrelated semantic results.

### What Could Change
If the local Zotero API ever supports saved searches, `zotero_advanced_search` could replace the per-token approach with a single request. Unlikely — the local API is a partial subset of the Web API and saved search creation has never been supported.

---

## Decision: Custom MCP client using Node.js `http` module — *2026-02-23*

### Why This Matters
The plugin runs inside Obsidian's Electron renderer, which has CORS restrictions and SSE streaming limitations that ruled out the obvious HTTP options one by one.

### Options We Considered
1. **Obsidian's `requestUrl`**: Good for CORS bypass (it's Obsidian's own API), bad because it buffers the full response before returning — SSE streams never close, so every request hung indefinitely.
2. **Browser `fetch` API**: Good for streaming SSE natively, bad because Obsidian's Electron renderer enforces CORS — `app://obsidian.md` origin is rejected by the local zotero-mcp server.
3. **Node.js `http` module**: Good for both — runs outside the browser sandbox (no CORS) and gives full control over SSE streams. Slight risk if Obsidian ever sandboxes Node modules more aggressively.
4. **MCP TypeScript SDK**: Good for full protocol support and future upgrades, bad because it depends on Node.js `http`/`https` modules that Obsidian's renderer doesn't expose.

### Why We Chose This
- Both `requestUrl` and `fetch` were tried and failed in sequence (see options above); Node.js `http` was the only path that handled both CORS and SSE correctly
- MCP over streamable-http is just JSON-RPC POSTs — simple enough to implement in ~150 lines without a framework
- No external dependencies to manage or break

### What Could Change
If the MCP SDK adds Electron/browser support, switching would give us automatic protocol upgrades and better error handling. If Obsidian tightens its Node.js sandbox, we'd need to revisit — the most likely fallback would be a companion native app that proxies requests.

---

## Decision: Plugin spawns zotero-mcp as a child process

### Why This Matters
Users don't need to manually start a server in a terminal before using the plugin — it just works.

### Options We Considered
1. **Auto-spawn on plugin load**: Good for UX (zero setup), bad if the user wants to manage the server themselves
2. **Require manual server start**: Good for control, bad for accessibility — adds a step most users won't understand
3. **Connect to an already-running server**: Good for advanced users, bad for the default experience

### Why We Chose This
- "It just works" matters for a plugin aimed at researchers, not developers
- The process is killed cleanly on plugin unload
- Settings still let users point to a custom executable path if needed

### What Could Change
If users want to share a single zotero-mcp instance across apps (e.g., Claude Desktop + Obsidian), we'd add a "connect to existing server" mode alongside the auto-spawn default.

---

## Decision: Edit installed zotero-mcp package directly (not fork — yet)

### Why This Matters
zotero-mcp has a bug in `chroma_client.py` where `create_collection()` is called in an `except` block instead of `get_or_create_collection()`. When Claude Desktop's zotero-mcp instances are running alongside the plugin's instance, they share the same `~/.config/zotero-mcp/chroma_db` directory. The second instance to call the tool always fails with "Collection [zotero_library] already exists".

### Options We Considered
1. **Edit installed package**: Quick fix, works immediately, but silently overwritten on `pip upgrade`
2. **Fork and maintain zotero-mcp**: Full control, permanent fix, slightly more setup. Updates from upstream are optional and cherry-picked. Only real reason to pull upstream is if Zotero's API changes.
3. **Contribute fix upstream**: Correct long-term move but not guaranteed to be merged quickly; upstream appears primarily maintained for Claude Desktop (stdio transport), not HTTP transport

### Why We Chose This (for now)
Edit the installed package to unblock immediately. Gabriel is considering forking zotero-mcp for longer-term maintenance — the project's priorities aren't fully aligned with our plugin's usage (HTTP transport, multi-instance scenarios).

### What Could Change
Gabriel forks zotero-mcp and installs it with `pip install -e /path/to/fork`. This makes the fix permanent and gives full control over future changes without depending on upstream.

---

## Decision: zotero-mcp HTTP transport is our primary concern; Claude Desktop uses stdio

### Why This Matters
The plugin spawns zotero-mcp with `--transport streamable-http`. Claude Desktop uses stdio. Both point at the same `~/.config/zotero-mcp/chroma_db`. When both apps run simultaneously, they race on ChromaDB collection creation — a bug masked in Claude Desktop's usage because stdio sessions are isolated.

### Implication
Bugs in zotero-mcp's HTTP transport path are unlikely to be caught or fixed by the upstream maintainer. We should treat zotero-mcp as a dependency we may need to patch or fork.

---

## Decision: Server survives plugin reloads (`stop()` does not kill the process) — *2026-02-25*

### Why This Matters
Obsidian's "reload app without saving" is a soft renderer reload — child processes spawned by the plugin survive it. If `stop()` kills the server, every reload forces a 30–60 second cold start while ChromaDB reloads.

### Options We Considered
1. **Kill on stop, respawn on start**: Simple lifecycle, predictable, but forces a cold start on every reload or plugin toggle — painful during development and for users who reload Obsidian often.
2. **Keep server alive, reattach on start**: `stop()` drops the process reference without sending SIGTERM; `start()` calls `tryReuseExistingServer()` to detect and reuse a warm server. Near-instant reconnection after reloads.

### Why We Chose This
- Cold-start latency (30–60s) is the biggest UX pain point during development; eliminating it makes iteration much faster
- The server process is cheap to leave running — it's idle when not handling requests
- `tryReuseExistingServer()` falls back to a fresh spawn if the warm server is gone or unresponsive

### What Could Change
If users report confusion about the server running after they "disabled" the plugin, we'd add a setting to control this. The current tradeoff favors developer UX; power users who want a clean stop can restart Obsidian.

---

## Decision: Attached notes are passed to the LLM only, not to semantic search — *2026-02-25*

### Why This Matters
The orchestrator pipeline has two distinct consumers of user input: the MCP server (semantic search) and the LLM (answer generation). These need different inputs.

### Options We Considered
1. **Prepend note content to the search query**: Simple, single pipeline input — but passing a 17K-character note as a vector search query produces irrelevant results and caused HTTP 500 errors from the MCP server.
2. **Pass raw question to search, note as separate LLM context**: Search gets a clean query; the LLM gets both the question and the note content as separate inputs assembled in `buildMessages()`.

### Why We Chose This
- Semantic search works best on short, focused queries — the user's question, not their notes
- Notes are context for interpretation and synthesis, which is the LLM's job, not the search index's
- Separating the inputs also prevents notes from bloating the MCP request

### What Could Change
If users want to search their notes alongside Zotero (e.g., "find papers related to what I'm writing"), we could add a separate note-aware search step, but that's a distinct feature from passing notes as LLM context.
