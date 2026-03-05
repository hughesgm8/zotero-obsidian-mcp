# Purpose
Maintain a system map the user can understand. The project's status is updated regularly, while the project's specification is established in earlier vision-focused sessions and updated only when major decisions dictate changes should be made.

# Project Status

## ✅ Working Well
- Full plugin scaffolding (manifest, package.json, tsconfig, esbuild)
- TypeScript compiles with zero errors, `npm run build` produces `main.js`
- Settings tab with conditional provider fields (re-renders on dropdown change)
- MCP server manager: auto-spawn, warm-server reuse across reloads (`tryReuseExistingServer`), `stop()` keeps server alive; crash detection via `onUnexpectedExit` callback turns status dot red and shows a 10-second notice
- MCP client (JSON-RPC 2.0 over HTTP with SSE support via Node `http` module — `requestUrl` and `fetch` were tried first and failed; see ARCHITECTURAL_DECISIONS.md)
- LLM provider abstraction (Ollama, OpenRouter, Anthropic)
- Deterministic query orchestrator with always-on hybrid search: semantic + per-token keyword search run in parallel, merged via three-tier ranking (both > keyword-only > semantic-only)
- Sidebar chat view with markdown rendering, citations, copy button (copies full response including sources; user messages are text-selectable)
- Redesigned input area: unified rounded box with pills, textarea, and `@` / Send toolbar inside; action buttons in a controls bar above the input; header shows title + "Connected/Disconnected/Thinking…" status
- Save conversation to vault (floppy disk button → `Zotero Chats/YYYY-MM-DD/` folder)
- Attach active note as context (@ button → fuzzy note picker modal → chip UI; note passed separately to LLM, not to semantic search; full note content sent, no truncation; multi-note support)
- Sources citations: correctly parses markdown format returned by `zotero_get_item_metadata`
- UI layout: `ResizeObserver` in `onOpen()` fires `workspace.trigger("resize")` as soon as panel gets real dimensions (no more squash on cold open)
- GitHub Actions auto-release: every push to `main` builds and publishes a GitHub release with compiled assets, enabling BRAT installation for beta testers
- Tested end-to-end in a real Obsidian vault (confirmed working)

## 📋 Planned
- "Smart mode" for capable models that can call MCP tools themselves
- Model switching directly in the sidebar UI (currently settings-only)
- **UI polish pass**: revisit look and feel to more closely match Copilot (typography, spacing, message bubble style, overall visual consistency) — current layout is structurally correct but visual details need refinement
- Chat history: browse and reload saved conversations (design TBD)
- Chat settings panel in sidebar (future, low priority)
- More detailed and adaptive context on user's research interests to expand the "Relevance" section of paper imports

## ✅ Recently Shipped
- **Customisable summary sections** (2026-03-05): Smart Import sections (Summary, Takeaways, Questions, Relevance) are now user-configurable in Settings. Add, delete, reorder (↑/↓), and edit name + instructions per section. Prompt builder and note builder are fully dynamic. Closes GitHub issue #1.

- **Custom Z icon** (2026-03-05): Replaced `book-open` with a custom SVG Z icon registered via `addIcon()`. Closes GitHub issue #4.

- **Always-on hybrid search** (2026-03-05): Semantic search + per-token keyword search run in parallel on every query. Results merged by three-tier ranking (matched both > keyword-only > semantic-only). Fixes queries containing specific identifiers (filenames, author names, acronyms) that embedding models can't represent. `zotero_advanced_search` was investigated and abandoned — it requires the Zotero Web API (cloud); the local API rejects its `POST /searches` endpoint.

- **Smart Import** (2026-02-26): Two commands — "Import paper from Zotero with AI summary" (creates new note) and "Insert AI summary into active note" (inserts Summary, Takeaways, Questions, Relevance at cursor in open note — for enriching existing Zotero Integration notes). Files: `src/paper-importer.ts`, `src/import-modal.ts`.
- **Multi-note @ picker** (2026-02-25): Replaced paperclip button with `@` button → `FuzzySuggestModal` note picker → multiple notes attached as removable pills. Notes are passed separately to the LLM, not to semantic search (see ARCHITECTURAL_DECISIONS.md).
- **Server reuse across reloads** (2026-02-25): `stop()` no longer kills the zotero-mcp process; `tryReuseExistingServer()` detects and reattaches to a warm server on reload, making plugin toggle and "reload app" near-instant after first cold start.

## ⚠️ Known Issues
- **zotero-mcp ChromaDB bug**: `chroma_client.py` line 194 uses `create_collection()` instead of `get_or_create_collection()`. When Claude Desktop's zotero-mcp processes are running simultaneously, they share `~/.config/zotero-mcp/chroma_db` and the plugin's instance fails with "Collection [zotero_library] already exists". **Workaround applied**: edited installed package at `/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/zotero_mcp/chroma_client.py` line 194. This will be overwritten by `pip upgrade`. Gabriel is considering forking zotero-mcp long-term.
- **zotero-mcp crashes after queries** (exit code 1) — likely related to the above ChromaDB issue. Plugin now shows a Notice and turns status dot red when this happens.
- Test Connection buttons not yet implemented

# Project Spec

## Description & Purpose
An Obsidian plugin that connects to the [Zotero MCP server](https://github.com/54yyyu/zotero-mcp), letting users query their vectorized Zotero library from within Obsidian. The plugin supports multiple LLM backends — Claude API, OpenRouter, and local models via Ollama — with a focus on accessibility for users who want a free, local-only option.

## Key User Stories
- As a researcher, I can ask questions about my Zotero library from within Obsidian by typing in a sidebar panel
- As a user, I can receive answers with citations to specific papers in my library
- As a user, I can copy responses (formatted as markdown) to paste into my notes
- As a user, I can configure multiple LLM backends (Claude, OpenRouter, Ollama) in settings
- As a user, I can switch between configured models directly in the sidebar UI

## Architecture

### MVP Approach
The plugin handles MCP calls directly rather than delegating tool selection to the LLM. This ensures reliability with local models that may not handle tool-calling well.

**Flow:**
1. User asks a question in sidebar
2. Plugin calls MCP server (semantic search → fetch relevant full text/metadata)
3. Plugin sends context + question to configured LLM
4. Response displayed in sidebar with copy button

### Future Enhancement
"Smart mode" for capable models (Claude, GPT-4) that can call MCP tools themselves, adapting to question type.

## Key Files
| File | Role |
|------|------|
| `src/main.ts` | Plugin entry point — lifecycle, view registration, MCP startup |
| `src/types.ts` | All shared interfaces and defaults |
| `src/settings.ts` | Settings tab UI |
| `src/mcp-server.ts` | Spawns/kills the `zotero-mcp` child process |
| `src/mcp-client.ts` | JSON-RPC 2.0 client for MCP over HTTP |
| `src/orchestrator.ts` | search → metadata → LLM pipeline |
| `src/paper-importer.ts` | Smart Import: search Zotero, fetch data, call LLM, create note |
| `src/import-modal.ts` | Smart Import: search modal UI (async search, clickable results) |
| `src/chat-view.ts` | Sidebar `ItemView` with chat UI |
| `src/llm/index.ts` | Factory that creates the right LLM provider |
| `src/llm/llm-provider.ts` | `LLMProvider` interface |
| `src/llm/ollama.ts` | Ollama via OpenAI-compatible endpoint |
| `src/llm/openrouter.ts` | OpenRouter provider |
| `src/llm/anthropic.ts` | Anthropic Messages API provider |

## Key Dependencies
- [zotero-mcp](https://github.com/54yyyu/zotero-mcp) — handles vectorization and exposes Zotero library via MCP protocol
- Obsidian Plugin API (TypeScript)

## UI Reference
Modeled after the Obsidian Copilot plugin. Target layout:
- **Header**: status dot + title (left), action buttons right-aligned (new chat `square-pen`, save `file-output`)
- **Chat area**: messages with markdown rendering and copy buttons
- **Input area**: `@` button (opens fuzzy note picker), textarea, send button; attached note pills render above input row

## Reference Documents
- GitHub repo: https://github.com/hughesgm8/zotero-obsidian-chat (public)
- Implementation plan: `Agent Configuration/changelogs/IMPLEMENTATION_PLAN_v0.1.0.md`
- Changelogs: `Agent Configuration/changelogs/2026-02-23.md`, `2026-02-24.md`, `2026-02-25.md`
