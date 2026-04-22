import { App, Notice, normalizePath } from "obsidian";
import * as http from "http";
import type { MCPClient } from "./mcp-client";
import type { LLMProvider, LLMMessage } from "./llm/llm-provider";
import type { ZoteroMCPSettings, ZoteroSource } from "./types";

export class PaperImporter {
	private app: App;
	private mcpClient: MCPClient;
	private llmProvider: LLMProvider;
	private settings: ZoteroMCPSettings;

	constructor(
		app: App,
		mcpClient: MCPClient,
		llmProvider: LLMProvider,
		settings: ZoteroMCPSettings
	) {
		this.app = app;
		this.mcpClient = mcpClient;
		this.llmProvider = llmProvider;
		this.settings = settings;
	}

	async getRecentItems(limit = 10): Promise<ZoteroSource[]> {
		const path = `/api/users/0/items/top?sort=dateAdded&direction=desc&limit=${limit}`;
		const body = await new Promise<string>((resolve, reject) => {
			const req = http.request(
				{ hostname: "localhost", port: 23119, path, method: "GET" },
				(res) => {
					if (res.statusCode && res.statusCode >= 400) {
						reject(new Error(`Zotero API returned ${res.statusCode}`));
						res.resume();
						return;
					}
					let data = "";
					res.on("data", (chunk) => { data += chunk.toString(); });
					res.on("end", () => resolve(data));
				}
			);
			req.on("error", reject);
			req.end();
		});
		const items: Array<{ key: string; data: Record<string, unknown> }> = JSON.parse(body);

		return items
			.filter((item) => {
				const t = item.data.itemType as string;
				return t !== "attachment" && t !== "note";
			})
			.map((item) => {
				const d = item.data;
				const dateStr = (d.date as string | undefined) ?? "";
				const yearMatch = dateStr.match(/\b(\d{4})\b/);
				const rawTags = d.tags as Array<{ tag: string }> | undefined;
				return {
					key: item.key,
					title: (d.title as string | undefined) ?? "Untitled",
					authors: this.formatAuthors(
						d.creators as Array<{ firstName?: string; lastName?: string; name?: string }> | undefined
					),
					year: yearMatch ? yearMatch[1] : "n.d.",
					itemType: (d.itemType as string | undefined) ?? "unknown",
					abstract: (d.abstractNote as string | undefined) || undefined,
					tags: rawTags?.map((t) => t.tag).filter(Boolean) ?? [],
				};
			});
	}

	async search(query: string): Promise<ZoteroSource[]> {
		const searchResult = await this.mcpClient.callTool(
			"zotero_search_items",
			{ query, qmode: "titleCreatorYear" }
		);

		if (!searchResult || !searchResult.trim()) return [];

		const itemKeys = this.extractItemKeys(searchResult);
		const sources: ZoteroSource[] = [];

		for (const key of itemKeys) {
			try {
				const metadata = await this.mcpClient.callTool(
					"zotero_get_item_metadata",
					{ item_key: key }
				);
				const source = this.parseMetadata(key, metadata);
				if (source) sources.push(source);
			} catch (err) {
				console.warn(`Failed to fetch metadata for ${key}:`, err);
			}
		}

		return sources;
	}

	private async fetchItemTags(key: string): Promise<string[]> {
		const path = `/api/users/0/items/${key}`;
		try {
			const body = await new Promise<string>((resolve, reject) => {
				const req = http.request(
					{ hostname: "localhost", port: 23119, path, method: "GET" },
					(res) => {
						if (res.statusCode && res.statusCode >= 400) {
							reject(new Error(`Zotero API returned ${res.statusCode}`));
							res.resume();
							return;
						}
						let data = "";
						res.on("data", (chunk) => { data += chunk.toString(); });
						res.on("end", () => resolve(data));
					}
				);
				req.on("error", reject);
				req.end();
			});
			const item: { data: { tags?: Array<{ tag: string }> } } = JSON.parse(body);
			return (item.data.tags ?? []).map((t) => t.tag).filter(Boolean);
		} catch (err) {
			console.error("[ZoteroChat] fetchItemTags failed:", err);
			return [];
		}
	}

	async importPaper(
		source: ZoteroSource
	): Promise<{ filePath: string; title: string }> {
		// 1) Fetch full text (max 100k chars to avoid LLM API 500s on huge papers)
		let fullText = "";
		try {
			const rawText = await this.mcpClient.callTool(
				"zotero_get_item_fulltext",
				{ item_key: source.key }
			);
			if (rawText) {
				fullText = rawText.slice(0, 40000);
			}
		} catch (err) {
			console.warn("No full text available, proceeding with abstract only:", err);
		}

		// 2) Build LLM prompt
		const messages = this.buildImportPrompt(source, fullText);

		// 3) Call LLM
		let response;
		try {
			response = await this.llmProvider.chat(messages);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(`AI generation failed: ${msg}. This often happens if the paper is too long for the model or the API is unavailable.`);
		}

		// 4) Parse sections from LLM response
		const sections = this.parseLLMSections(response.content);

		// 5) Ensure Zotero tags are populated (authoritative source is the local API)
		if (!source.tags || source.tags.length === 0) {
			source.tags = await this.fetchItemTags(source.key);
		}
		// 6) Build the note markdown
		const note = this.buildNote(source, sections);

		// 7) Save to vault
		const folder = normalizePath(this.settings.importFolder);
		await this.ensureFolder(folder);

		const sanitized = this.sanitizeFilename(source.title);
		let filePath = normalizePath(`${folder}/${sanitized}.md`);
		filePath = await this.resolveCollision(filePath);

		await this.app.vault.create(filePath, note);

		return { filePath, title: source.title };
	}

	async generateSummaryMarkdown(source: ZoteroSource): Promise<string> {
		let fullText = "";
		try {
			const rawText = await this.mcpClient.callTool(
				"zotero_get_item_fulltext",
				{ item_key: source.key }
			);
			if (rawText) fullText = rawText.slice(0, 40000);
		} catch {
			// proceed with abstract only
		}

		const messages = this.buildImportPrompt(source, fullText);
		let response;
		try {
			response = await this.llmProvider.chat(messages);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(`AI generation failed: ${msg}`);
		}

		const sections = this.parseLLMSections(response.content);

		let md = `*AI summary generated by Zotero Chat · ${source.authors || "Unknown"} (${source.year})*\n\n`;
		for (const section of this.settings.summarySections) {
			md += `## ${section.name}\n${sections[section.name] || `*No ${section.name.toLowerCase()} generated.*`}\n\n`;
		}

		return md.trim();
	}

	// --- Helpers reused from orchestrator.ts ---

	private extractItemKeys(searchResult: string): string[] {
		const keys: string[] = [];

		try {
			const parsed = JSON.parse(searchResult);
			if (Array.isArray(parsed)) {
				for (const item of parsed) {
					if (item.key) keys.push(item.key as string);
					if (item.itemKey) keys.push(item.itemKey as string);
				}
			}
			if (keys.length > 0) return keys.slice(0, 10);
		} catch {
			// Not JSON, try regex
		}

		const keyPattern = /\b([A-Z0-9]{8})\b/g;
		let match;
		while ((match = keyPattern.exec(searchResult)) !== null) {
			if (!keys.includes(match[1])) {
				keys.push(match[1]);
			}
		}

		return keys.slice(0, 10);
	}

	private parseMetadata(
		key: string,
		metadataStr: string
	): ZoteroSource | null {
		try {
			const data = JSON.parse(metadataStr);
			const rawTags: Array<{ tag: string } | string> = data.tags ?? [];
			const tags = rawTags.map((t) => (typeof t === "string" ? t : t.tag)).filter(Boolean);
			return {
				key,
				title: data.title || "Untitled",
				authors: this.formatAuthors(data.creators || data.authors),
				year: data.date
					? String(data.date).slice(0, 4)
					: data.year
						? String(data.year)
						: "n.d.",
				itemType: data.itemType || "unknown",
				abstract: data.abstractNote || data.abstract,
				tags,
			};
		} catch {
			// Parse markdown format
		}

		const lines = metadataStr.split("\n");
		let title = "Untitled";
		let authors = "";
		let year = "n.d.";
		let itemType = "unknown";
		const abstractLines: string[] = [];
		let inAbstract = false;
		const tags: string[] = [];

		for (const line of lines) {
			const t = line.trim();
			if (t.startsWith("# ")) {
				title = t.slice(2).trim();
				inAbstract = false;
			} else if (/^\*\*Type:\*\*/.test(t)) {
				itemType = t.replace(/^\*\*Type:\*\*\s*/, "").trim();
				inAbstract = false;
			} else if (/^\*\*Authors:\*\*/.test(t)) {
				authors = t.replace(/^\*\*Authors:\*\*\s*/, "").trim();
				inAbstract = false;
			} else if (/^\*\*Date:\*\*/.test(t)) {
				const dateStr = t.replace(/^\*\*Date:\*\*\s*/, "").trim();
				const m = dateStr.match(/\b(\d{4})\b/);
				year = m ? m[1] : "n.d.";
				inAbstract = false;
			} else if (/^\*\*Tags:\*\*/.test(t)) {
				const tagStr = t.replace(/^\*\*Tags:\*\*\s*/, "").trim();
				tags.push(...tagStr.split(",").map((s) => s.trim()).filter(Boolean));
				inAbstract = false;
			} else if (t === "## Abstract") {
				inAbstract = true;
			} else if (t.startsWith("## ")) {
				inAbstract = false;
			} else if (inAbstract && t) {
				abstractLines.push(t);
			}
		}

		return {
			key,
			title,
			authors,
			year,
			itemType,
			abstract: abstractLines.length > 0 ? abstractLines.join(" ") : undefined,
			tags,
		};
	}

	private formatAuthors(
		creators:
			| Array<{ firstName?: string; lastName?: string; name?: string }>
			| undefined
	): string {
		if (!creators || !Array.isArray(creators)) return "";
		return creators
			.map((c) => {
				if (c.name) return c.name;
				if (c.lastName && c.firstName)
					return `${c.lastName}, ${c.firstName}`;
				return c.lastName || c.firstName || "";
			})
			.filter(Boolean)
			.join("; ");
	}

	// --- LLM prompt ---

	private buildImportPrompt(
		source: ZoteroSource,
		fullText: string
	): LLMMessage[] {
		const systemMsg =
			"You are helping a researcher build a personal knowledge base. " + 
			"Your job is to orient them and spark productive thinking — not to summarize comprehensively. " + 
			"Be direct and opinionated. Distinguish between what a paper claims and what it demonstrates. " +
			"Never answer questions for the reader; raise them.";

		let userContent = `Please analyze the following paper and produce structured notes.\n\n`;
		userContent += `**Title:** ${source.title}\n`;
		userContent += `**Authors:** ${source.authors || "Unknown"}\n`;
		userContent += `**Year:** ${source.year}\n`;

		if (source.abstract) {
			userContent += `\n**Abstract:**\n${source.abstract}\n`;
		}

		if (fullText && fullText.trim()) {
			userContent += `\n**Full text:**\n${fullText}\n`;
		}

		if (this.settings.researchDescription.trim()) {
			userContent += `\n**My research focus:**\n${this.settings.researchDescription}\n`;
		}

		const sectionList = this.settings.summarySections.map(s => `## ${s.name}`).join(", ");
		userContent += `\nPlease write the following sections using markdown headings (${sectionList}):\n\n`;
		for (const section of this.settings.summarySections) {
			userContent += `- **${section.name}**: ${section.instructions}\n`;
		}

		return [
			{ role: "system", content: systemMsg },
			{ role: "user", content: userContent },
		];
	}

	// --- Parse LLM sections ---

	private parseLLMSections(content: string): Record<string, string> {
		const sections: Record<string, string> = {};
		const headingPattern = /^#{1,6}\s+(.+)$/gm;
		const matches: Array<{ name: string; index: number }> = [];

		let m;
		while ((m = headingPattern.exec(content)) !== null) {
			matches.push({ name: m[1].trim(), index: m.index + m[0].length });
		}

		for (let i = 0; i < matches.length; i++) {
			const start = matches[i].index;
			const end = i + 1 < matches.length ? matches[i + 1].index - matches[i + 1].name.length - 3 : content.length;
			sections[matches[i].name] = content.slice(start, end).trim();
		}

		return sections;
	}

	// --- Build note markdown ---

	private buildNote(
		source: ZoteroSource,
		sections: Record<string, string>
	): string {
		const tags = this.buildTags(source);
		const authorsYaml = source.authors
			? `"${source.authors.replace(/"/g, '\\"')}"`
			: '""';

		let note = `---\n`;
		note += `Title: "${source.title.replace(/"/g, '\\"')}"\n`;
		note += `Year: ${source.year}\n`;
		note += `Authors: ${authorsYaml}\n`;
		note += `Tags:\n`;
		for (const tag of tags) {
			note += `  - ${tag}\n`;
		}
		note += `Related:\n`;
		note += `Aliases:\n`;
		note += `---\n\n`;

		for (const section of this.settings.summarySections) {
			note += `## ${section.name}\n${sections[section.name] || `*No ${section.name.toLowerCase()} generated.*`}\n\n`;
		}

		if (source.abstract) {
			note += `## Abstract\n${source.abstract}\n\n`;
		}

		note += `## Notes\n> Your own notes go here.\n`;

		return note;
	}

	private buildTags(source: ZoteroSource): string[] {
		const tags: string[] = [];
		if (source.itemType && source.itemType !== "unknown") {
			tags.push(source.itemType);
		}
		tags.push("literature");
		tags.push("ai-imported");
		if (source.tags) {
			for (const t of source.tags) {
				if (!tags.includes(t)) tags.push(t);
			}
		}
		return tags;
	}

	// --- File system helpers ---

	private async ensureFolder(path: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (!existing) {
			await this.app.vault.createFolder(path);
		}
	}

	private sanitizeFilename(name: string): string {
		return name
			.replace(/[\\/:*?"<>|]/g, "-")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 200);
	}

	private async resolveCollision(filePath: string): Promise<string> {
		let candidate = filePath;
		let counter = 1;
		while (this.app.vault.getAbstractFileByPath(candidate)) {
			const base = filePath.replace(/\.md$/, "");
			candidate = `${base} (${counter}).md`;
			counter++;
		}
		return candidate;
	}
}
