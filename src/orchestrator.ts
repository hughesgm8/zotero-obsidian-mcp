import type { MCPClient } from "./mcp-client";
import type { LLMProvider, LLMMessage } from "./llm/llm-provider";
import type { ChatMessage, ZoteroMCPSettings, ZoteroSource } from "./types";

export interface OrchestratorResult {
	content: string;
	sources: ZoteroSource[];
}

export class Orchestrator {
	private mcpClient: MCPClient;
	private llmProvider: LLMProvider;
	private settings: ZoteroMCPSettings;

	constructor(
		mcpClient: MCPClient,
		llmProvider: LLMProvider,
		settings: ZoteroMCPSettings
	) {
		this.mcpClient = mcpClient;
		this.llmProvider = llmProvider;
		this.settings = settings;
	}

	async query(
		question: string,
		conversationHistory: ChatMessage[],
		attachedNotes?: Array<{ name: string; content: string }>
	): Promise<OrchestratorResult> {
		// 1) Parallel hybrid search: semantic + per-token keyword
		const [searchResult, keywordKeys] = await Promise.all([
			this.mcpClient.callTool("zotero_semantic_search", { query: question }),
			this.keywordSearch(question),
		]);

		// Detect error text returned as plain content (zotero-mcp does not always
		// set isError:true — it sometimes returns errors as regular text).
		if (searchResult && this.looksLikeError(searchResult)) {
			throw new Error(
				`The Zotero server returned an error: ${searchResult.slice(0, 300)}`
			);
		}

		// 2) Three-tier merge by confidence:
		//   Tier 1: in both semantic + keyword (semantic rank preserved) — highest confidence
		//   Tier 2: keyword-only — specific identifier/author match that semantics missed
		//   Tier 3: semantic-only — conceptually related, no keyword hit
		const semanticKeys = this.extractItemKeys(searchResult);
		const keywordSet = new Set(keywordKeys);
		const semanticSet = new Set(semanticKeys);
		const tier1 = semanticKeys.filter(k => keywordSet.has(k));
		const tier2 = keywordKeys.filter(k => !semanticSet.has(k));
		const tier3 = semanticKeys.filter(k => !keywordSet.has(k));
		const itemKeys = [...tier1, ...tier2, ...tier3].slice(0, 25);

		// Gather source keys from the last assistant message so follow-up
		// questions can reference previously discussed papers.
		const carryForwardKeys: Set<string> = new Set();
		if (conversationHistory.length > 0) {
			for (let i = conversationHistory.length - 1; i >= 0; i--) {
				const msg = conversationHistory[i];
				if (msg.role === "assistant" && msg.sources && msg.sources.length > 0) {
					for (const src of msg.sources) {
						carryForwardKeys.add(src.key);
					}
					break;
				}
			}
		}

		// 3) Fetch metadata for each item
		const sources: ZoteroSource[] = [];
		for (const key of itemKeys) {
			try {
				const metadata = await this.mcpClient.callTool(
					"zotero_get_item_metadata",
					{ item_key: key }
				);
				const source = this.parseMetadata(key, metadata);
				if (source) {
					sources.push(source);
				}
			} catch (err) {
				console.warn(`Failed to fetch metadata for ${key}:`, err);
			}
		}

		// 3b) Add carry-forward sources not found by the new search
		const existingKeys = new Set(sources.map(s => s.key));
		for (const key of carryForwardKeys) {
			if (!existingKeys.has(key)) {
				try {
					const metadata = await this.mcpClient.callTool(
						"zotero_get_item_metadata",
						{ item_key: key }
					);
					const source = this.parseMetadata(key, metadata);
					if (source) {
						sources.push(source);
					}
				} catch (err) {
					console.warn(`Failed to fetch carry-forward metadata for ${key}:`, err);
				}
			}
		}

		// 4) Fetch full text for top N results — prioritize carry-forward papers
		const fullTexts: Map<string, string> = new Map();
		const fullTextCandidates = [
			...sources.filter(s => carryForwardKeys.has(s.key)),
			...sources.filter(s => !carryForwardKeys.has(s.key)),
		];
		const topN = Math.min(this.settings.fullTextTopN, fullTextCandidates.length);
		for (let i = 0; i < topN; i++) {
			try {
				const text = await this.mcpClient.callTool(
					"zotero_get_item_fulltext",
					{ item_key: fullTextCandidates[i].key }
				);
				if (text && text.trim()) {
					const truncated = text.slice(0, this.settings.fullTextMaxChars);
					fullTexts.set(fullTextCandidates[i].key, truncated);
				}
			} catch (err) {
				console.warn(
					`Failed to fetch full text for ${fullTextCandidates[i].key}:`,
					err
				);
			}
		}

		// 5) Build context string
		const context = this.buildContext(sources, searchResult, fullTexts);

		// 6) Build messages for LLM
		const messages = this.buildMessages(
			question,
			context,
			conversationHistory,
			attachedNotes
		);

		// 7) Send to LLM
		const response = await this.llmProvider.chat(messages);

		return {
			content: response.content,
			sources,
		};
	}

	private looksLikeError(text: string): boolean {
		const lower = text.toLowerCase().trim();
		return (
			lower.includes("already exists") ||
			lower.includes("collection [") ||
			lower.startsWith("error") ||
			lower.startsWith("semantic search error") ||
			lower.startsWith("no semantically similar") ||
			/^\d{3}\b/.test(lower) // HTTP status code like "404 not found"
		);
	}

	private extractItemKeys(searchResult: string): string[] {
		const keys: string[] = [];

		// Try to parse as JSON first (array of results)
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

		// Fallback: extract keys that look like Zotero item keys (8 alphanumeric chars)
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
		// Try JSON first (in case the format ever changes)
		try {
			const data = JSON.parse(metadataStr);
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
			};
		} catch {
			// Not JSON — parse the markdown returned by format_item_metadata.
			// Lines look like:
			//   # Title of the Paper
			//   **Type:** journalArticle
			//   **Authors:** Smith, J.; Doe, A.
			//   **Date:** 2023
			//   ## Abstract
			//   Abstract text here...
		}

		const lines = metadataStr.split("\n");
		let title = "Untitled";
		let authors = "";
		let year = "n.d.";
		let itemType = "unknown";
		const abstractLines: string[] = [];
		let inAbstract = false;

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
		};
	}

	private formatAuthors(
		creators: Array<{ firstName?: string; lastName?: string; name?: string }> | undefined
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

	private buildContext(
		sources: ZoteroSource[],
		rawSearchResult: string,
		fullTexts: Map<string, string>
	): string {
		if (sources.length === 0) {
			return `Search results (no structured metadata available):\n${rawSearchResult}`;
		}

		const parts = sources.map((s, i) => {
			let entry = `[${i + 1}] ${s.title}\n   Authors: ${s.authors || "Unknown"}\n   Year: ${s.year}\n   Type: ${s.itemType}`;
			if (s.abstract) {
				entry += `\n   Abstract: ${s.abstract}`;
			}
			const fullText = fullTexts.get(s.key);
			if (fullText) {
				const wasTruncated = fullText.length >= this.settings.fullTextMaxChars;
				entry += `\n   --- Full text${wasTruncated ? " (truncated)" : ""} ---\n${fullText}`;
			}
			return entry;
		});

		return `Papers from the user's Zotero library:\n\n${parts.join("\n\n")}`;
	}

	private async keywordSearch(question: string): Promise<string[]> {
		const tokens = question
			.split(/[\s\W]+/)
			.filter(w => w.length >= 3);

		const results = await Promise.all(
			tokens.map(token =>
				this.mcpClient.callTool("zotero_search_items", {
					query: token,
					qmode: "titleCreatorYear",
					limit: 5,
				}).catch(() => "")
			)
		);

		const seen = new Set<string>();
		const keys: string[] = [];
		for (const result of results) {
			for (const key of this.extractItemKeys(result ?? "")) {
				if (!seen.has(key)) {
					seen.add(key);
					keys.push(key);
				}
			}
		}
		return keys;
	}

	private buildMessages(
		question: string,
		context: string,
		history: ChatMessage[],
		attachedNotes?: Array<{ name: string; content: string }>
	): LLMMessage[] {
		const messages: LLMMessage[] = [
			{
				role: "system",
				content: this.settings.systemPrompt,
			},
		];

		// Add truncated conversation history
		const recentHistory = history.slice(-this.settings.maxConversationHistory);
		for (const msg of recentHistory) {
			messages.push({
				role: msg.role,
				content: msg.content,
			});
		}

		// Build user message: Zotero context, optional attached notes, then question
		let userContent = `Context from Zotero library:\n\n${context}\n\n---\n\n`;
		if (attachedNotes && attachedNotes.length > 0) {
			for (const note of attachedNotes) {
				userContent += `Attached note ("${note.name}"):\n\n${note.content}\n\n---\n\n`;
			}
		}
		userContent += `Question: ${question}`;

		messages.push({ role: "user", content: userContent });

		return messages;
	}
}
