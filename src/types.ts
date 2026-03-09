export type LLMProviderType = "ollama" | "openrouter" | "anthropic";

export interface SummarySection {
	name: string;
	instructions: string;
}

export const DEFAULT_SUMMARY_SECTIONS: SummarySection[] = [
	{
		name: "Summary",
		instructions: "2-3 paragraphs covering the paper's main argument, methodology, and findings.",
	},
	{
		name: "Interesting Takeaways",
		instructions: "Bullet points of the most notable insights.",
	},
	{
		name: "Questions for Active Engagement",
		instructions: "Generate 4-5 questions specific to named elements of this paper — a particular method, finding, claim, or dataset. Focus on how this paper's methods, findings, or framing might apply to, complicate, or inform the researcher's work. Include 1-2 questions about open questions or gaps the paper raises.",
	},
	{
		name: "Relevance",
		instructions: "How this paper relates to the researcher's focus described in the 'Your research interests' setting. If no research focus is provided, note that and keep this section brief.",
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
