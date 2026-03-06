import { Modal, Notice, setIcon } from "obsidian";
import type { App } from "obsidian";
import type { ZoteroSource } from "./types";
import type { PaperImporter } from "./paper-importer";

export class ImportModal extends Modal {
	private importer: PaperImporter;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private resultsEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private modalTitle: string;
	private onSelect: ((source: ZoteroSource) => Promise<void>) | null;

	constructor(
		app: App,
		importer: PaperImporter,
		options?: {
			title?: string;
			onSelect?: (source: ZoteroSource) => Promise<void>;
		}
	) {
		super(app);
		this.importer = importer;
		this.modalTitle = options?.title ?? "Import paper from Zotero";
		this.onSelect = options?.onSelect ?? null;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("zotero-import-modal");

		contentEl.createEl("h3", { text: this.modalTitle });

		const searchInput = contentEl.createEl("input", {
			type: "text",
			placeholder: "Search your Zotero library...",
			cls: "zotero-import-search",
		});

		this.statusEl = contentEl.createEl("div", {
			cls: "zotero-import-status",
		});

		this.resultsEl = contentEl.createEl("div", {
			cls: "zotero-import-results",
		});

		searchInput.addEventListener("input", () => {
			if (this.debounceTimer) clearTimeout(this.debounceTimer);
			const query = searchInput.value.trim();
			if (!query) {
				this.loadRecentItems();
				return;
			}
			this.debounceTimer = setTimeout(() => this.runSearch(query), 400);
		});

		// Focus the input after the modal renders
		setTimeout(() => searchInput.focus(), 50);

		this.loadRecentItems();
	}

	onClose(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.contentEl.empty();
	}

	private async loadRecentItems(): Promise<void> {
		this.resultsEl.empty();
		this.statusEl.textContent = "Loading recent papers...";

		try {
			const results = await this.importer.getRecentItems(10);
			this.statusEl.textContent = "";
			this.resultsEl.empty();

			if (results.length === 0) {
				this.statusEl.textContent = "No recent papers found.";
				return;
			}

			this.resultsEl.createEl("div", {
				text: "Recently added",
				cls: "zotero-import-section-label",
			});

			for (const source of results) {
				this.renderResult(source);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error("Failed to load recent items:", err);
			this.statusEl.textContent = `Could not load recent papers: ${msg}`;
		}
	}

	private async runSearch(query: string): Promise<void> {
		this.resultsEl.empty();
		this.statusEl.textContent = "Searching...";

		try {
			const results = await this.importer.search(query);

			this.statusEl.textContent = "";
			this.resultsEl.empty();

			if (results.length === 0) {
				this.statusEl.textContent = "No results found.";
				return;
			}

			for (const source of results) {
				this.renderResult(source);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.statusEl.textContent = `Search failed: ${msg}`;
		}
	}

	private renderResult(source: ZoteroSource): void {
		const row = this.resultsEl.createEl("div", {
			cls: "zotero-import-result",
		});

		const titleEl = row.createEl("div", {
			cls: "zotero-import-result-title",
		});
		titleEl.textContent = source.title;

		const metaEl = row.createEl("div", {
			cls: "zotero-import-result-meta",
		});
		const parts: string[] = [];
		if (source.authors) parts.push(source.authors);
		if (source.year && source.year !== "n.d.") parts.push(source.year);
		metaEl.textContent = parts.join(" · ");

		row.addEventListener("click", () => this.selectPaper(source));
	}

	private async selectPaper(source: ZoteroSource): Promise<void> {
		this.close();

		if (this.onSelect) {
			try {
				await this.onSelect(source);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error("Insert failed:", err);
				new Notice(`Insert failed: ${msg}`, 10000);
			}
			return;
		}

		new Notice(
			`Importing "${source.title}"... This may take 20-30 seconds.`,
			8000
		);

		try {
			const result = await this.importer.importPaper(source);
			new Notice(`Imported: ${result.title}`);

			const file = this.app.vault.getAbstractFileByPath(result.filePath);
			if (file) {
				await this.app.workspace.openLinkText(result.filePath, "", true);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error("Import failed:", err);
			new Notice(`Import failed: ${msg}`, 10000);
		}
	}
}
