import { App, PluginSettingTab, Setting } from "obsidian";
import type ZoteroMCPChatPlugin from "./main";
import type { LLMProviderType } from "./types";
import { createLLMProvider } from "./llm/index";

export class ZoteroMCPSettingTab extends PluginSettingTab {
	plugin: ZoteroMCPChatPlugin;

	constructor(app: App, plugin: ZoteroMCPChatPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// --- Zotero MCP Section ---
		containerEl.createEl("h2", { text: "Zotero MCP Server" });

		new Setting(containerEl)
			.setName("Zotero MCP command")
			.setDesc(
				"The command used to start the Zotero MCP server. The default should work if you installed zotero-mcp normally."
			)
			.addText((text) =>
				text
					.setPlaceholder("zotero-mcp")
					.setValue(this.plugin.settings.mcpExecutablePath)
					.onChange(async (value) => {
						this.plugin.settings.mcpExecutablePath = value;
						await this.plugin.saveSettings();
					})
			);

		// --- LLM Section ---
		containerEl.createEl("h2", { text: "AI Model" });

		new Setting(containerEl)
			.setName("Provider")
			.setDesc(
				"Which AI service to use. Ollama runs on your computer for free. OpenRouter and Anthropic require an API key."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("ollama", "Ollama (Local, free)")
					.addOption("openrouter", "OpenRouter (cloud, many models)")
					.addOption("anthropic", "Anthropic (Claude)")
					.setValue(this.plugin.settings.llmProvider)
					.onChange(async (value) => {
						this.plugin.settings.llmProvider =
							value as LLMProviderType;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		const provider = this.plugin.settings.llmProvider;

		if (provider === "ollama") {
			new Setting(containerEl)
				.setName("Model")
				.setDesc(
					"Which Ollama model to use. Must already be downloaded in Ollama."
				)
				.addText((text) =>
					text
						.setPlaceholder("deepseek-r1:8b")
						.setValue(this.plugin.settings.ollamaModel)
						.onChange(async (value) => {
							this.plugin.settings.ollamaModel = value;
							await this.plugin.saveSettings();
						})
				);
		}

		if (provider === "openrouter") {
			new Setting(containerEl)
				.setName("API key")
				.setDesc(
					"Your OpenRouter API key. Get one at openrouter.ai."
				)
				.addText((text) =>
					text
						.setPlaceholder("sk-or-...")
						.setValue(this.plugin.settings.openrouterApiKey)
						.onChange(async (value) => {
							this.plugin.settings.openrouterApiKey = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Model")
				.setDesc("Which model to use on OpenRouter.")
				.addText((text) =>
					text
						.setPlaceholder("deepseek/deepseek-r1")
						.setValue(this.plugin.settings.openrouterModel)
						.onChange(async (value) => {
							this.plugin.settings.openrouterModel = value;
							await this.plugin.saveSettings();
						})
				);
		}

		if (provider === "anthropic") {
			new Setting(containerEl)
				.setName("API key")
				.setDesc(
					"Your Anthropic API key. Get one at console.anthropic.com."
				)
				.addText((text) =>
					text
						.setPlaceholder("sk-ant-...")
						.setValue(this.plugin.settings.anthropicApiKey)
						.onChange(async (value) => {
							this.plugin.settings.anthropicApiKey = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Model")
				.setDesc("Which Claude model to use.")
				.addText((text) =>
					text
						.setPlaceholder("claude-sonnet-4-5-20250929")
						.setValue(this.plugin.settings.anthropicModel)
						.onChange(async (value) => {
							this.plugin.settings.anthropicModel = value;
							await this.plugin.saveSettings();
						})
				);
		}

		// --- Behavior Section ---
		containerEl.createEl("h2", { text: "Behavior" });

		new Setting(containerEl)
			.setName("Papers with full text")
			.setDesc(
				"How many of the top search results to include full paper text for. The rest get metadata only. Higher gives deeper answers but uses more resources."
			)
			.addSlider((slider) =>
				slider
					.setLimits(0, 5, 1)
					.setValue(this.plugin.settings.fullTextTopN)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.fullTextTopN = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Max text per paper")
			.setDesc(
				"Maximum characters of full text to include per paper. Longer gives more detail but uses more resources."
			)
			.addSlider((slider) =>
				slider
					.setLimits(1000, 16000, 1000)
					.setValue(this.plugin.settings.fullTextMaxChars)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.fullTextMaxChars = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Conversation memory")
			.setDesc(
				"How many previous messages the AI remembers during a conversation. Higher uses more resources."
			)
			.addSlider((slider) =>
				slider
					.setLimits(2, 20, 2)
					.setValue(this.plugin.settings.maxConversationHistory)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxConversationHistory = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("System prompt")
			.setDesc(
				"Background instructions given to the AI. Controls how it responds to your questions."
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("You are a research assistant...")
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.systemPrompt = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Save conversations to")
			.setDesc(
				"Folder in your vault where saved chats will be stored. Created automatically if it doesn't exist."
			)
			.addText((text) =>
				text
					.setPlaceholder("Zotero Chats")
					.setValue(this.plugin.settings.saveFolder)
					.onChange(async (value) => {
						this.plugin.settings.saveFolder =
							value.trim() || "Zotero Chats";
						await this.plugin.saveSettings();
					})
			);

		// --- Smart Import Section ---
		containerEl.createEl("h2", { text: "Smart Import" });

		new Setting(containerEl)
			.setName("Import folder")
			.setDesc(
				"Folder in your vault where imported paper notes will be saved. Created automatically if it doesn't exist."
			)
			.addText((text) =>
				text
					.setPlaceholder("Zotero Notes")
					.setValue(this.plugin.settings.importFolder)
					.onChange(async (value) => {
						this.plugin.settings.importFolder =
							value.trim() || "Zotero Notes";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Your research interests")
			.setDesc(
				"Describe your research focus so the AI can assess how each imported paper relates to your work. Leave blank to skip the relevance section."
			)
			.addTextArea((text) =>
				text
					.setPlaceholder(
						"e.g., I study the effects of social media on adolescent mental health..."
					)
					.setValue(this.plugin.settings.researchDescription)
					.onChange(async (value) => {
						this.plugin.settings.researchDescription = value;
						await this.plugin.saveSettings();
					})
			);

		// --- Advanced Section (collapsed) ---
		const advancedDetails = containerEl.createEl("details");
		advancedDetails.createEl("summary", {
			text: "Advanced",
			cls: "zotero-chat-advanced-toggle",
		});

		new Setting(advancedDetails)
			.setName("Server port")
			.setDesc(
				"Only change this if port 8000 is already in use by another app."
			)
			.addText((text) =>
				text
					.setPlaceholder("8000")
					.setValue(String(this.plugin.settings.mcpServerPort))
					.onChange(async (value) => {
						const port = parseInt(value, 10);
						if (!isNaN(port) && port > 0 && port < 65536) {
							this.plugin.settings.mcpServerPort = port;
							await this.plugin.saveSettings();
						}
					})
			);

		if (provider === "ollama") {
			new Setting(advancedDetails)
				.setName("Ollama address")
				.setDesc(
					"Only change this if Ollama is running on a different computer or non-standard port."
				)
				.addText((text) =>
					text
						.setPlaceholder("http://localhost:11434")
						.setValue(this.plugin.settings.ollamaBaseUrl)
						.onChange(async (value) => {
							this.plugin.settings.ollamaBaseUrl = value;
							await this.plugin.saveSettings();
						})
				);
		}
	}
}
