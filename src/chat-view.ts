import {
	App,
	FuzzySuggestModal,
	ItemView,
	MarkdownRenderer,
	Notice,
	TFile,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import type ZoteroMCPChatPlugin from "./main";
import type { ChatMessage } from "./types";

export const VIEW_TYPE_ZOTERO_CHAT = "zotero-mcp-chat-view";

// Fuzzy note picker — opens Obsidian's built-in search modal over vault files
class NotePicker extends FuzzySuggestModal<TFile> {
	private onSelect: (file: TFile) => void;

	constructor(app: App, onSelect: (file: TFile) => void) {
		super(app);
		this.onSelect = onSelect;
		this.setPlaceholder("Search for a note to attach...");
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onSelect(file);
	}
}

export class ZoteroChatView extends ItemView {
	plugin: ZoteroMCPChatPlugin;
	private messages: ChatMessage[] = [];
	private messageListEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendBtnEl!: HTMLButtonElement;
	private statusEl!: HTMLElement;
	private statusTextEl!: HTMLElement;
	private isLoading = false;
	private attachedNotes: Array<{ name: string; path: string; content: string }> = [];
	private attachmentChipEl!: HTMLElement;
	private sizeObserver: ResizeObserver | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ZoteroMCPChatPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_ZOTERO_CHAT;
	}

	getDisplayText(): string {
		return "Zotero Chat";
	}

	getIcon(): string {
		return "zotero-chat";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("zotero-chat-container");

		// Header — title left, status right
		const header = container.createDiv({ cls: "zotero-chat-header" });
		header.createSpan({ text: "Zotero Chat", cls: "zotero-chat-title" });
		const statusWrapper = header.createDiv({ cls: "zotero-chat-status-wrapper" });
		this.statusEl = statusWrapper.createSpan({ cls: "zotero-chat-status-dot" });
		this.statusTextEl = statusWrapper.createSpan({ cls: "zotero-chat-status-text" });

		// Message list
		this.messageListEl = container.createDiv({ cls: "zotero-chat-messages" });

		// Welcome message
		this.renderWelcome();

		// Controls bar — between messages and input
		const controlsBar = container.createDiv({ cls: "zotero-chat-controls-bar" });
		const newChatBtn = controlsBar.createEl("button", {
			cls: "zotero-chat-new-btn clickable-icon",
			attr: { "aria-label": "New chat" },
		});
		setIcon(newChatBtn, "square-pen");
		newChatBtn.addEventListener("click", () => this.clearChat());
		const saveBtn = controlsBar.createEl("button", {
			cls: "zotero-chat-save-btn clickable-icon",
			attr: { "aria-label": "Save conversation" },
		});
		setIcon(saveBtn, "file-output");
		saveBtn.addEventListener("click", () => this.saveConversation());

		// Input area — unified box containing pills, textarea, and toolbar
		const inputArea = container.createDiv({ cls: "zotero-chat-input-area" });
		const inputBox = inputArea.createDiv({ cls: "zotero-chat-input-box" });

		this.attachmentChipEl = inputBox.createDiv({ cls: "zotero-chat-pills-row" });
		this.attachmentChipEl.style.display = "none";

		this.inputEl = inputBox.createEl("textarea", {
			cls: "zotero-chat-input",
			attr: { placeholder: "Ask about your Zotero library...", rows: "2" },
		});
		this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.handleSend();
			}
		});

		const inputToolbar = inputBox.createDiv({ cls: "zotero-chat-input-toolbar" });
		const atBtn = inputToolbar.createEl("button", {
			cls: "zotero-chat-at-btn clickable-icon",
			attr: { "aria-label": "Attach a note" },
		});
		setIcon(atBtn, "at-sign");
		atBtn.addEventListener("click", () => {
			new NotePicker(this.app, (file) => this.attachNote(file)).open();
		});
		this.sendBtnEl = inputToolbar.createEl("button", {
			cls: "zotero-chat-send-btn",
			text: "Send",
		});
		this.sendBtnEl.addEventListener("click", () => this.handleSend());

		this.updateStatus();

		// Obsidian may not have finalised sidebar dimensions when onOpen() runs,
		// so height:100% on the container resolves to 0 until a layout pass
		// completes. Watch for the panel getting its real size, then trigger a
		// workspace resize once — this is the same event that fixes it when the
		// server connects, just fired at the right moment instead of 30s later.
		const panelEl = this.containerEl.children[1] as HTMLElement;
		this.sizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				if (entry.contentRect.height > 0) {
					this.sizeObserver?.disconnect();
					this.sizeObserver = null;
					this.app.workspace.trigger("resize");
					break;
				}
			}
		});
		this.sizeObserver.observe(panelEl);
	}

	async onClose(): Promise<void> {
		this.sizeObserver?.disconnect();
		this.sizeObserver = null;
	}

	private renderWelcome(): void {
		const welcome = this.messageListEl.createDiv({
			cls: "zotero-chat-welcome",
		});
		welcome.createEl("p", {
			text: "Ask questions about papers in your Zotero library. The plugin will search your library and provide cited answers.",
		});
	}

	private async handleSend(): Promise<void> {
		const rawQuestion = this.inputEl.value.trim();
		if (!rawQuestion || this.isLoading) return;

		this.inputEl.value = "";
		this.setLoading(true);

		// Snapshot the attached notes and clear chips immediately so the user
		// can start composing the next message while this one is in flight.
		const notesSnapshot = [...this.attachedNotes];
		this.attachedNotes = [];
		this.renderAttachmentChips();

		// Record attached note paths for the save feature (multiple notes supported).
		const userMsg: ChatMessage & { attachedNotePaths?: string[] } = {
			role: "user",
			content: rawQuestion,
			timestamp: Date.now(),
			...(notesSnapshot.length > 0
				? { attachedNotePaths: notesSnapshot.map((n) => n.path) }
				: {}),
		};
		this.messages.push(userMsg);
		this.renderMessage(userMsg);
		this.scrollToBottom();

		try {
			const orchestrator = this.plugin.getOrchestrator();
			if (!orchestrator) {
				throw new Error(
					"Plugin not ready. Check that the MCP server is running."
				);
			}

			const result = await orchestrator.query(
				rawQuestion,
				this.messages.slice(0, -1),
				notesSnapshot.length > 0 ? notesSnapshot : undefined
			);

			const assistantMsg: ChatMessage = {
				role: "assistant",
				content: result.content,
				sources: result.sources,
				timestamp: Date.now(),
			};
			this.messages.push(assistantMsg);
			this.renderMessage(assistantMsg);
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			const assistantMsg: ChatMessage = {
				role: "assistant",
				content: `**Error:** ${errorMsg}`,
				timestamp: Date.now(),
			};
			this.messages.push(assistantMsg);
			this.renderMessage(assistantMsg);
		}

		this.setLoading(false);
		this.scrollToBottom();
	}

	private renderMessage(msg: ChatMessage): void {
		const wrapper = this.messageListEl.createDiv({
			cls: `zotero-chat-message zotero-chat-message-${msg.role}`,
		});

		const contentEl = wrapper.createDiv({
			cls: "zotero-chat-message-content",
		});

		if (msg.role === "assistant") {
			// Render markdown for assistant messages
			MarkdownRenderer.render(
				this.app,
				msg.content,
				contentEl,
				"",
				this
			);

			// Sources list
			if (msg.sources && msg.sources.length > 0) {
				const details = wrapper.createEl("details", {
					cls: "zotero-chat-sources",
				});
				details.createEl("summary", {
					text: `Sources (${msg.sources.length})`,
				});
				const list = details.createEl("ul");
				for (const src of msg.sources) {
					const li = list.createEl("li");
					li.createEl("span", {
						text: `${src.title} — ${src.authors || "Unknown"} (${src.year})`,
					});
				}
			}

			// Copy button
			const actions = wrapper.createDiv({
				cls: "zotero-chat-message-actions",
			});
			const copyBtn = actions.createEl("button", {
				cls: "zotero-chat-copy-btn clickable-icon",
				attr: { "aria-label": "Copy response" },
			});
			setIcon(copyBtn, "copy");
			copyBtn.addEventListener("click", () => {
				let text = msg.content;
				if (msg.sources && msg.sources.length > 0) {
					text += "\n\n**Sources:**\n";
					for (const src of msg.sources) {
						text += `- ${src.title} — ${src.authors || "Unknown"} (${src.year})\n`;
					}
				}
				navigator.clipboard.writeText(text);
				new Notice("Copied to clipboard");
			});
		} else {
			// Plain text for user messages
			contentEl.setText(msg.content);
		}
	}

	private clearChat(): void {
		this.messages = [];
		this.messageListEl.empty();
		this.renderWelcome();
	}

	private setLoading(loading: boolean): void {
		this.isLoading = loading;
		this.sendBtnEl.disabled = loading;
		this.inputEl.disabled = loading;

		if (loading) {
			this.sendBtnEl.setText("...");
			// Add loading indicator
			const loadingEl = this.messageListEl.createDiv({
				cls: "zotero-chat-loading",
			});
			loadingEl.createSpan({ text: "Searching library and thinking..." });
		} else {
			this.sendBtnEl.setText("Send");
			// Remove loading indicator
			const loadingEl =
				this.messageListEl.querySelector(".zotero-chat-loading");
			loadingEl?.remove();
		}

		this.updateStatus();
	}

	updateStatus(): void {
		if (!this.statusEl) return;

		this.statusEl.removeClass("status-green", "status-yellow", "status-red");

		if (this.isLoading) {
			this.statusEl.addClass("status-yellow");
			this.statusTextEl?.setText("Thinking…");
		} else if (this.plugin.isMCPRunning()) {
			this.statusEl.addClass("status-green");
			this.statusTextEl?.setText("Connected");
		} else {
			this.statusEl.addClass("status-red");
			this.statusTextEl?.setText("Disconnected");
		}
	}

	private scrollToBottom(): void {
		this.messageListEl.scrollTop = this.messageListEl.scrollHeight;
	}

	private async saveConversation(): Promise<void> {
		const userMessages = this.messages.filter((m) => m.role === "user");
		if (userMessages.length === 0) {
			new Notice("Nothing to save yet");
			return;
		}

		const now = new Date();
		const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
		const timeStr = now.toTimeString().slice(0, 8);  // HH:MM:SS
		const fileSafeTime = timeStr.replace(/:/g, "-"); // HH-MM-SS

		const firstUserMsg = userMessages[0].content;
		const sanitized = firstUserMsg
			.slice(0, 40)
			.replace(/[\\/:*?"<>|#^[\]]/g, "")
			.trim();

		const folderRoot = (this.plugin.settings.saveFolder || "Zotero Chats").trim();
		const dateFolder = `${folderRoot}/${dateStr}`;
		const filename = `${fileSafeTime} - ${sanitized}.md`;
		const fullPath = `${dateFolder}/${filename}`;

		if (!this.app.vault.getAbstractFileByPath(folderRoot)) {
			await this.app.vault.createFolder(folderRoot);
		}
		if (!this.app.vault.getAbstractFileByPath(dateFolder)) {
			await this.app.vault.createFolder(dateFolder);
		}

		const title = firstUserMsg.slice(0, 60);
		const savedAt = `${dateStr} at ${timeStr}`;

		let md = `---\ndate: ${dateStr}\ntags: [zotero-chat]\n---\n\n`;
		md += `# ${title}\n\n`;
		md += `*Saved: ${savedAt}*\n\n---\n\n`;

		for (const msg of this.messages) {
			if (msg.role === "user") {
				md += `**You:** ${msg.content}\n`;
				const paths = (msg as ChatMessage & { attachedNotePaths?: string[] }).attachedNotePaths;
				if (paths && paths.length > 0) {
					md += `\n*📎 Attached: ${paths.map((p) => `[[${p}]]`).join(", ")}*\n`;
				}
				md += "\n";
			} else {
				md += `**Zotero Assistant:** ${msg.content}\n`;
				if (msg.sources && msg.sources.length > 0) {
					md += "\n**Sources:**\n";
					for (const src of msg.sources) {
						md += `- ${src.title} — ${src.authors || "Unknown"} (${src.year})\n`;
					}
				}
				md += "\n---\n\n";
			}
		}

		await this.app.vault.create(fullPath, md);
		new Notice(`Saved to ${fullPath}`);
	}

	private async attachNote(file: TFile): Promise<void> {
		// Prevent attaching the same note twice
		if (this.attachedNotes.some((n) => n.path === file.path)) {
			new Notice(`"${file.basename}" is already attached`);
			return;
		}
		const content = await this.app.vault.read(file);
		this.attachedNotes.push({ name: file.basename, path: file.path, content });
		this.renderAttachmentChips();
	}

	private renderAttachmentChips(): void {
		this.attachmentChipEl.empty();
		if (this.attachedNotes.length === 0) {
			this.attachmentChipEl.style.display = "none";
			return;
		}
		this.attachmentChipEl.style.display = "flex";
		for (let i = 0; i < this.attachedNotes.length; i++) {
			const note = this.attachedNotes[i];
			const chip = this.attachmentChipEl.createDiv({
				cls: "zotero-chat-attachment-chip",
			});
			chip.createSpan({ text: note.name });
			const removeBtn = chip.createEl("button", {
				cls: "zotero-chat-attachment-remove clickable-icon",
				attr: { "aria-label": `Remove ${note.name}` },
			});
			setIcon(removeBtn, "x");
			removeBtn.addEventListener("click", () => {
				this.attachedNotes.splice(i, 1);
				this.renderAttachmentChips();
			});
		}
	}
}
