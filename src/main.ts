import { Notice, Plugin, addIcon } from "obsidian";
import type { Editor } from "obsidian";
import type { CachedChat, ChatMessage, ZoteroMCPSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { ZoteroMCPSettingTab } from "./settings";
import { MCPServerManager } from "./mcp-server";
import { MCPClient } from "./mcp-client";
import { createLLMProvider } from "./llm/index";
import { Orchestrator } from "./orchestrator";
import { ZoteroChatView, VIEW_TYPE_ZOTERO_CHAT } from "./chat-view";
import { PaperImporter } from "./paper-importer";
import { ImportModal } from "./import-modal";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export default class ZoteroMCPChatPlugin extends Plugin {
	settings!: ZoteroMCPSettings;
	public chatHistory: CachedChat[] = [];
	private mcpServer: MCPServerManager | null = null;
	private mcpClient: MCPClient | null = null;
	private orchestrator: Orchestrator | null = null;

	async onload(): Promise<void> {
		console.log("Loading Zotero MCP Chat plugin");

		await this.loadSettings();

		// Register custom Z icon (Zotero branding)
		addIcon("zotero-chat", `<line x1="22" y1="15" x2="78" y2="15" stroke="currentColor" stroke-width="20" stroke-linecap="round"/><line x1="78" y1="15" x2="22" y2="85" stroke="currentColor" stroke-width="20" stroke-linecap="round"/><line x1="22" y1="85" x2="78" y2="85" stroke="currentColor" stroke-width="20" stroke-linecap="round"/>`);

		// Register the chat view
		this.registerView(VIEW_TYPE_ZOTERO_CHAT, (leaf) => {
			return new ZoteroChatView(leaf, this);
		});

		// Ribbon icon
		this.addRibbonIcon("zotero-chat", "Open Zotero Chat", () => {
			this.activateChatView();
		});

		// Command to open chat
		this.addCommand({
			id: "open-zotero-chat",
			name: "Open Zotero Chat",
			callback: () => {
				this.activateChatView();
			},
		});

		// Command to import paper
		this.addCommand({
			id: "import-paper-from-zotero",
			name: "Import paper from Zotero with AI summary",
			callback: () => {
				if (!this.mcpClient) {
					new Notice(
						"Zotero Chat: The Zotero server is not running. Please check your settings.",
						8000
					);
					return;
				}
				const llm = createLLMProvider(this.settings);
				const importer = new PaperImporter(
					this.app,
					this.mcpClient,
					llm,
					this.settings
				);
				new ImportModal(this.app, importer).open();
			},
		});

		// Command to insert AI summary into the active note
		this.addCommand({
			id: "insert-ai-summary-into-note",
			name: "Insert AI summary into active note",
			editorCallback: (editor: Editor) => {
				if (!this.mcpClient) {
					new Notice(
						"Zotero Chat: The Zotero server is not running. Please check your settings.",
						8000
					);
					return;
				}
				const llm = createLLMProvider(this.settings);
				const importer = new PaperImporter(
					this.app,
					this.mcpClient,
					llm,
					this.settings
				);
				new ImportModal(this.app, importer, {
					title: "Insert AI summary into active note",
					onSelect: async (source) => {
						const loadingNotice = new Notice(
							`Generating summary for "${source.title}"… This may take 20–30 seconds.`,
							0
						);
						try {
							const markdown = await importer.generateSummaryMarkdown(source);
							editor.replaceSelection(markdown);
							loadingNotice.hide();
							new Notice("Summary inserted.");
						} catch (err) {
							loadingNotice.hide();
							throw err;
						}
					},
				}).open();
			},
		});

		// Settings tab
		this.addSettingTab(new ZoteroMCPSettingTab(this.app, this));

		// Start MCP server in background
		await this.startMCPServer();
	}

	async onunload(): Promise<void> {
		console.log("Unloading Zotero MCP Chat plugin");

		if (this.mcpClient) {
			await this.mcpClient.close();
			this.mcpClient = null;
		}

		if (this.mcpServer) {
			this.mcpServer.stop();
			this.mcpServer = null;
		}

		this.orchestrator = null;
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) ?? {};
		// Backward compat: old format stored settings at root; new format nests them under `settings`
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings ?? data);
		this.chatHistory = (data.chatHistory ?? []).filter(
			(c: CachedChat) => Date.now() - c.cachedAt < THIRTY_DAYS_MS
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData({ settings: this.settings, chatHistory: this.chatHistory });
		// Recreate orchestrator with new settings when settings change
		this.rebuildOrchestrator();
	}

	async saveChatHistory(): Promise<void> {
		await this.saveData({ settings: this.settings, chatHistory: this.chatHistory });
	}

	addToChatHistory(messages: ChatMessage[]): void {
		const firstUser = messages.find((m) => m.role === "user");
		if (!firstUser) return;
		const entry: CachedChat = {
			id: Date.now().toString(),
			title: firstUser.content.slice(0, 60),
			messages: [...messages],
			cachedAt: Date.now(),
		};
		this.chatHistory.unshift(entry);
		this.saveChatHistory();
	}

	updateChatHistoryEntry(id: string, patch: Partial<Pick<CachedChat, "title" | "savedFilePath">>): void {
		const entry = this.chatHistory.find((c) => c.id === id);
		if (entry) {
			Object.assign(entry, patch);
			this.saveChatHistory();
		}
	}

	deleteChatHistoryEntry(id: string): void {
		this.chatHistory = this.chatHistory.filter((c) => c.id !== id);
		this.saveChatHistory();
	}

	pruneExpiredChatHistory(): void {
		const before = this.chatHistory.length;
		this.chatHistory = this.chatHistory.filter(
			(c) => Date.now() - c.cachedAt < THIRTY_DAYS_MS
		);
		if (this.chatHistory.length !== before) {
			this.saveChatHistory();
		}
	}

	isMCPRunning(): boolean {
		return this.mcpServer?.isRunning() ?? false;
	}

	getOrchestrator(): Orchestrator | null {
		return this.orchestrator;
	}

	getMCPClient(): MCPClient | null {
		return this.mcpClient;
	}

	private async startMCPServer(): Promise<void> {
		try {
			this.mcpServer = new MCPServerManager(
				this.settings.mcpExecutablePath,
				this.settings.mcpServerPort
			);

			this.mcpServer.onUnexpectedExit = () => {
				// Log last stderr lines so the Python traceback is visible in
				// the Obsidian developer console (Cmd+Option+I → Console tab)
				const stderrLines = this.mcpServer?.getStderrLog() ?? [];
				if (stderrLines.length > 0) {
					console.error("zotero-mcp stderr before crash:\n" + stderrLines.join("\n"));
				}
				new Notice(
					"Zotero Chat: The Zotero server stopped unexpectedly. Disable and re-enable the plugin to restart it.",
					10000
				);
				// Turn the status dot red in any open chat views
				for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ZOTERO_CHAT)) {
					const v = leaf.view as ZoteroChatView;
					if (typeof v.updateStatus === "function") v.updateStatus();
				}
			};

			await this.mcpServer.start();

			// Initialize MCP client
			this.mcpClient = new MCPClient(this.mcpServer.getBaseUrl());
			await this.mcpClient.initialize();

			// Build orchestrator
			this.rebuildOrchestrator();

			new Notice("Zotero MCP Chat: Server connected");

			// Update the status dot in any already-open chat views and trigger
			// a layout refresh so the panel renders at the correct size.
			for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ZOTERO_CHAT)) {
				const v = leaf.view as ZoteroChatView;
				if (typeof v.updateStatus === "function") v.updateStatus();
			}
			this.app.workspace.trigger("resize");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error("Failed to start MCP server:", msg);
			new Notice(
				`Zotero MCP Chat: Could not connect to the Zotero MCP server. ${msg}`,
				10000
			);
		}
	}

	private rebuildOrchestrator(): void {
		if (!this.mcpClient) return;
		const llm = createLLMProvider(this.settings);
		this.orchestrator = new Orchestrator(
			this.mcpClient,
			llm,
			this.settings
		);
	}

	private async activateChatView(): Promise<void> {
		const existing =
			this.app.workspace.getLeavesOfType(VIEW_TYPE_ZOTERO_CHAT);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE_ZOTERO_CHAT,
				active: true,
			});
			this.app.workspace.revealLeaf(leaf);
		}
	}
}
