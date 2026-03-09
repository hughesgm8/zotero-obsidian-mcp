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
import type { CachedChat, ChatMessage } from "./types";

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
	private historyPopoverEl: HTMLElement | null = null;
	private historyClickOutside: ((e: MouseEvent) => void) | null = null;

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
		const historyBtn = controlsBar.createEl("button", {
			cls: "zotero-chat-history-btn clickable-icon",
			attr: { "aria-label": "Chat history" },
		});
		setIcon(historyBtn, "history");
		historyBtn.addEventListener("click", () => this.toggleHistoryPopover(historyBtn));
		const saveBtn = controlsBar.createEl("button", {
			cls: "zotero-chat-save-btn clickable-icon",
			attr: { "aria-label": "Save conversation" },
		});
		setIcon(saveBtn, "download");
		saveBtn.addEventListener("click", () => this.saveConversation());
		const newChatBtn = controlsBar.createEl("button", {
			cls: "zotero-chat-new-btn clickable-icon",
			attr: { "aria-label": "New chat" },
		});
		setIcon(newChatBtn, "square-pen");
		newChatBtn.addEventListener("click", () => this.clearChat());

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
		if (this.messages.length > 0) {
			this.plugin.addToChatHistory(this.messages);
		}
		this.hideHistoryPopover();
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
		if (this.messages.length > 0) {
			this.plugin.addToChatHistory(this.messages);
			new Notice("Chat saved to history", 3000);
		}
		this.messages = [];
		this.messageListEl.empty();
		this.renderWelcome();
	}

	// ── History popover ───────────────────────────────────────────────────────

	private toggleHistoryPopover(anchor: HTMLElement): void {
		if (this.historyPopoverEl) {
			this.hideHistoryPopover();
		} else {
			this.showHistoryPopover(anchor);
		}
	}

	private showHistoryPopover(anchor: HTMLElement): void {
		this.plugin.pruneExpiredChatHistory();

		const popover = document.createElement("div");
		popover.className = "zotero-chat-history-popover";

		// Position: above the anchor button, right-aligned (Copilot: side="top" align="end")
		const rect = anchor.getBoundingClientRect();
		popover.style.bottom = `${window.innerHeight - rect.top + 6}px`;
		popover.style.right  = `${window.innerWidth - rect.right}px`;

		// Header
		const header = popover.createDiv({ cls: "zotero-chat-history-popover-header" });
		header.createSpan({ text: "Chat History", cls: "zotero-chat-history-popover-title" });
		header.createSpan({ text: "Deleted after 30 days", cls: "zotero-chat-history-popover-subtitle" });

		// List
		const listEl = popover.createDiv({ cls: "zotero-chat-history-popover-list" });
		this.buildHistoryList(listEl);

		document.body.appendChild(popover);
		this.historyPopoverEl = popover;

		// Dismiss on click outside
		const handler = (e: MouseEvent): void => {
			if (!popover.contains(e.target as Node) && e.target !== anchor) {
				this.hideHistoryPopover();
			}
		};
		// Use setTimeout so the current click that opened it doesn't immediately close it
		setTimeout(() => document.addEventListener("mousedown", handler), 0);
		this.historyClickOutside = handler;
	}

	private hideHistoryPopover(): void {
		this.historyPopoverEl?.remove();
		this.historyPopoverEl = null;
		if (this.historyClickOutside) {
			document.removeEventListener("mousedown", this.historyClickOutside);
			this.historyClickOutside = null;
		}
	}

	private buildHistoryList(listEl: HTMLElement): void {
		listEl.empty();
		const history = this.plugin.chatHistory;
		if (history.length === 0) {
			listEl.createEl("p", {
				text: "No chat history yet. Conversations are automatically saved here when you start a new chat.",
				cls: "zotero-chat-history-empty",
			});
			return;
		}
		for (const entry of history) {
			this.renderHistoryItem(listEl, entry);
		}
	}

	private renderHistoryItem(listEl: HTMLElement, entry: CachedChat): void {
		const row = listEl.createDiv({ cls: "zotero-chat-history-item" });

		// Text group: title + date
		const textGroup = row.createDiv({ cls: "zotero-chat-history-text" });
		const titleEl = textGroup.createSpan({ text: entry.title, cls: "zotero-chat-history-title" });
		const date = new Date(entry.cachedAt);
		const dateStr = date.toLocaleDateString(undefined, {
			month: "short", day: "numeric", year: "numeric",
		});
		textGroup.createSpan({ text: dateStr, cls: "zotero-chat-history-date" });

		// Action buttons (revealed on hover via CSS)
		const actionsEl = row.createDiv({ cls: "zotero-chat-history-actions" });

		// Open source file
		const openBtn = actionsEl.createEl("button", {
			cls: "zotero-chat-history-action clickable-icon",
			attr: { "aria-label": "Open source file" },
		});
		setIcon(openBtn, "arrow-up-right");
		openBtn.addEventListener("click", async (e) => {
			e.stopPropagation();
			await this.openHistoryEntry(entry, listEl);
		});

		// Edit title
		const editBtn = actionsEl.createEl("button", {
			cls: "zotero-chat-history-action clickable-icon",
			attr: { "aria-label": "Edit chat title" },
		});
		setIcon(editBtn, "pencil");
		editBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.editHistoryTitle(entry, titleEl);
		});

		// Delete (two-click confirm, like Copilot)
		const deleteBtn = actionsEl.createEl("button", {
			cls: "zotero-chat-history-action zotero-chat-history-delete clickable-icon",
			attr: { "aria-label": "Delete chat" },
		});
		setIcon(deleteBtn, "trash-2");
		let confirmTimeout: ReturnType<typeof setTimeout> | null = null;
		deleteBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			if (deleteBtn.hasClass("zotero-chat-history-delete-confirm")) {
				// Second click — confirm delete
				if (confirmTimeout) clearTimeout(confirmTimeout);
				this.plugin.deleteChatHistoryEntry(entry.id);
				row.remove();
				if (this.plugin.chatHistory.length === 0 && this.historyPopoverEl) {
					this.buildHistoryList(
						this.historyPopoverEl.querySelector(".zotero-chat-history-popover-list") as HTMLElement
					);
				}
			} else {
				// First click — enter confirm state
				deleteBtn.addClass("zotero-chat-history-delete-confirm");
				confirmTimeout = setTimeout(() => {
					deleteBtn.removeClass("zotero-chat-history-delete-confirm");
					confirmTimeout = null;
				}, 3000);
			}
		});
	}

	private async openHistoryEntry(entry: CachedChat, listEl: HTMLElement): Promise<void> {
		let filePath = entry.savedFilePath;
		if (!filePath || !this.app.vault.getAbstractFileByPath(filePath)) {
			filePath = await this.saveConversation(entry.messages);
			if (filePath) {
				this.plugin.updateChatHistoryEntry(entry.id, { savedFilePath: filePath });
				// Refresh list so the entry shows as saved
				this.buildHistoryList(listEl);
			}
		}
		if (filePath) {
			const file = this.app.vault.getAbstractFileByPath(filePath) as TFile;
			if (file) {
				await this.app.workspace.getLeaf(false).openFile(file);
				this.hideHistoryPopover();
			}
		}
	}

	private editHistoryTitle(entry: CachedChat, titleEl: HTMLSpanElement): void {
		const input = document.createElement("input");
		input.type = "text";
		input.value = entry.title;
		input.className = "zotero-chat-history-title-input";
		titleEl.replaceWith(input);
		input.focus();
		input.select();

		let committed = false;
		const commit = (): void => {
			if (committed) return;
			committed = true;
			const newTitle = input.value.trim() || entry.title;
			this.plugin.updateChatHistoryEntry(entry.id, { title: newTitle });
			const newSpan = document.createElement("span");
			newSpan.className = "zotero-chat-history-title";
			newSpan.textContent = newTitle;
			input.replaceWith(newSpan);
		};
		const cancel = (): void => {
			if (committed) return;
			committed = true;
			input.replaceWith(titleEl);
		};
		input.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter") { e.preventDefault(); commit(); }
			else if (e.key === "Escape") { e.preventDefault(); cancel(); }
		});
		input.addEventListener("blur", commit);
	}

	// ── Utility ───────────────────────────────────────────────────────────────

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

	async saveConversation(messages?: ChatMessage[]): Promise<string | undefined> {
		const source = messages ?? this.messages;
		const userMessages = source.filter((m) => m.role === "user");
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

		for (const msg of source) {
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
		return fullPath;
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
