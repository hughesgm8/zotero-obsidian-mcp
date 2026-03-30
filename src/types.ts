export type LLMProviderType = "ollama" | "openrouter" | "anthropic";

export interface SummarySection {
	name: string;
	instructions: string;
}

export const DEFAULT_SUMMARY_SECTIONS: SummarySection[] = [
	{
		name: "Core Claim",
		instructions: "State the paper's central argument in 4–5 sentences. Include what the paper proposes, the conceptual or empirical basis it uses, and what it does not yet demonstrate. If it's a framework or position paper without empirical validation, say so explicitly.",
	},
	{
		name: "What Isn't in the Abstract",
		instructions: "List 4–5 things a reader wouldn't know from the title and abstract alone. For each item, write 2–3 sentences explaining what it is and why it's worth noting — don't just name it. Don't restate claims from the abstract. These should be non-obvious insights, unexpected framings, or moves in the argument worth noticing. ",
	},
	{
		name: "Reading the Evidence",
		instructions: "Write 2 short paragraphs. First: describe how the paper builds its case — the theoretical foundations it draws on, the kind of examples or data it uses, how the argument is structured. Second: assess the strength of that evidence — what would count as validation, what gaps remain, and what the paper itself acknowledges as limitations.",
	},
	{
		name: "Questions to Hold",
		instructions: "Write 3–4 questions — one sentence each — for the researcher to hold while reading. At least one should target an unstated assumption the paper makes. At least one should connect to the researcher's described work. At least one should point to a gap or open question the paper raises. Do not answer these questions.",
	},
	{
		name: "Connections",
		instructions: "Identify 2–3 specific connections to the researcher's described work. For each, write 3–4 sentences: name the specific concept, method, or finding, then explain how the researcher might engage with or use it. Aim for actionable specificity, not topic-level overlap. If no research description is provided, say so and skip this section.",

	},
];

export interface ZoteroMCPSettings {
	// MCP Server
	mcpExecutablePath: string;
	mcpServerPort: number;

	// LLM Provider
	llmProvider: LLMProviderType;

	// Ollama
	ollamaBaseUrl: string;
	ollamaModel: string;

	// OpenRouter
	openrouterApiKey: string;
	openrouterModel: string;

	// Anthropic
	anthropicApiKey: string;
	anthropicModel: string;

	// Behavior
	maxConversationHistory: number;
	systemPrompt: string;
	fullTextTopN: number;
	fullTextMaxChars: number;

	// Conversations
	saveFolder: string;

	// Smart Import
	importFolder: string;
	researchDescription: string;
	summarySections: SummarySection[];
}

export const DEFAULT_SETTINGS: ZoteroMCPSettings = {
	mcpExecutablePath: "zotero-mcp",
	mcpServerPort: 8000,

	llmProvider: "ollama",

	ollamaBaseUrl: "http://localhost:11434",
	ollamaModel: "deepseek-r1:8b",

	openrouterApiKey: "",
	openrouterModel: "deepseek/deepseek-r1",

	anthropicApiKey: "",
	anthropicModel: "claude-sonnet-4-5-20250929",

	maxConversationHistory: 6,
	fullTextTopN: 3,
	fullTextMaxChars: 4000,
	systemPrompt:
		"You are a research assistant with access to the user's Zotero library. " +
		"Answer questions using the provided paper metadata and context. " +
		"Always cite sources by title and author when referencing specific papers. " +
		"If no relevant papers are found, say so honestly.",

	saveFolder: "Zotero Chats",

	importFolder: "Zotero Notes",
	researchDescription: "",
	summarySections: DEFAULT_SUMMARY_SECTIONS.map(s => ({ ...s })),
};

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	sources?: ZoteroSource[];
	timestamp: number;
}

export interface ZoteroSource {
	key: string;
	title: string;
	authors: string;
	year: string;
	itemType: string;
	abstract?: string;
}

export interface CachedChat {
	id: string;            // unique key: timestamp string at cache time
	title: string;         // first user message truncated to 60 chars, editable
	messages: ChatMessage[];
	cachedAt: number;      // Date.now() ms
	savedFilePath?: string; // vault path if explicitly saved
}
