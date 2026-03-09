# Zotero MCP Chat

An [Obsidian](https://obsidian.md) plugin that lets you ask questions about your Zotero library in plain English and get cited answers — without paying for an API or sending your data to the cloud.

> **Who this is for:** Researchers who use Zotero and Obsidian and want to chat with their library using a free, private AI model running on their own computer.

---

## What it does

You type a question — "What does the literature say about impostor syndrome in PhD students?" — and the plugin searches your Zotero library, finds the most relevant papers, and writes a response with citations. Everything runs locally by default.

---

## Before you start

You'll need all four of these:

| Requirement | What it is |
|---|---|
| [Zotero](https://www.zotero.org) | Reference manager (you probably already have this) |
| [Obsidian](https://obsidian.md) | Note-taking app (you probably already have this) |
| [Ollama](https://ollama.com) | Runs free AI models on your computer |
| [zotero-mcp](https://github.com/54yyyu/zotero-mcp) | Connects Zotero to AI tools |

The setup takes about 20–30 minutes the first time, mostly waiting for things to download.

---

## Step 1 — Install Ollama

Ollama lets you run AI models privately on your own Mac. No account required, no data leaves your computer.

1. Go to [ollama.com](https://ollama.com) and click **Download**
2. Open the downloaded file and install it like any other Mac app
3. Open **Terminal** (press `⌘ Space`, type "Terminal", press Enter)
4. Paste this command and press Enter — it downloads a free AI model (~5 GB):

   ```
   ollama pull llama3.2
   ```

   > **Not sure which model to pick?** `llama3.2` is a good default. If your Mac has less than 16 GB of memory, use `llama3.2:3b` instead (smaller and faster). If you have an M2/M3 Mac with 32 GB+, try `mistral` for better results.
   >
   > **Have 8 GB of memory or less?** Local models may be too slow or unreliable on machines with limited RAM. Ollama also supports cloud-hosted models, which run on remote servers instead of your computer. A good option is `deepseek-v3.1:671b-cloud` — pull it the same way: `ollama pull deepseek-v3.1:671b-cloud`. You will need to be logged into Ollama for cloud models to work. Alternatively, if you have an [OpenRouter](https://openrouter.ai) API key, you can skip Ollama entirely and select OpenRouter as your provider in Step 4.

5. Wait for the download to finish (this can take several minutes)

You can now close Terminal. Ollama runs quietly in the background whenever you need it.

---

## Step 2 — Set up zotero-mcp

zotero-mcp is the bridge between your Zotero library and the plugin. It reads your papers and builds a searchable index so the AI can find relevant ones.

> **Having trouble with this step?** The [zotero-mcp project page](https://github.com/54yyyu/zotero-mcp) is the best place to look — it has the latest installation notes and an issue tracker for known problems.

### 2a. Allow Zotero to talk to other apps

1. Open **Zotero**
2. Go to **Zotero → Settings → Advanced**
3. Tick **"Allow other applications on this computer to communicate with Zotero"**
4. Leave Zotero open — it needs to be running whenever you use the plugin

### 2b. Check that Python is installed

1. Open **Terminal** (press `⌘ Space`, type "Terminal", press Enter)
2. Type this and press Enter:
   ```
   python3 --version
   ```
3. You should see something like `Python 3.12.x`. The number needs to be **between 3.10 and 3.13** — Python 3.12 is recommended. Python 3.14 and above are not currently supported by zotero-mcp's dependencies.

   If you see an error, a version below 3.10, or 3.14+, install Python 3.12 from [python.org/downloads](https://www.python.org/downloads/) and install it like any Mac app, then repeat this step.

   **Make a note of your major version number** (e.g. `3.12` or `3.11`) — you'll need it in the next step.

### 2c. Install zotero-mcp

The recommended way to install zotero-mcp is via **pipx**, which handles the installation cleanly and makes the `zotero-mcp` command available without PATH issues. **Note**: If you've never installed anything with [Homebrew](https://brew.sh) (a package manager), install it first using the following command: 

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then, in Terminal, paste these commands one at a time and press Enter after each — replacing `3.12` in the second command with your own version number from step 2b:

```
brew install pipx
pipx install zotero-mcp-server --python python3.12
pipx ensurepath
```

Once done, **close Terminal and open a new window** before continuing — this is needed for the `zotero-mcp` command to be recognised.

### 2d. Run the setup

```
zotero-mcp setup
```

This will ask you a few questions. Here's exactly what to choose:

| Question | What to pick | Why |
|---|---|---|
| How to connect to Zotero? | **Local API** | No account needed — uses Zotero running on your computer |
| Embedding model? | **Default** | Free, runs locally, no API key required |
| How often to update the index? | **Daily** | Automatically stays up to date without slowing down every launch |

If it asks for anything else, the default option is usually fine.

### 2e. Build your paper index

This step reads your Zotero library and creates the searchable database. It can take a while if you have a large library — run it and then go make a coffee.

```
zotero-mcp update-db --fulltext
```

> **Why `--fulltext`?** Without this flag, the plugin can only search paper titles and abstracts. With it, it also searches the full text of your PDFs, which gives much better results for detailed academic questions. It takes longer to build but is worth it.

When it finishes, you're ready to install the plugin.

> **Adding papers to Zotero later?** Re-run `zotero-mcp update-db --fulltext` in Terminal whenever you want to include newly added papers in searches.

---

## Step 3 — Install the plugin

This plugin isn't in the Obsidian community store yet, so you'll install it using **BRAT** — a free helper plugin for installing beta plugins.

### 3a. Install BRAT

1. In Obsidian, open **Settings → Community plugins**
2. Make sure "Restricted mode" is **off**
3. Click **Browse** and search for "BRAT"
4. Install **BRAT** and enable it

### 3b. Add this plugin via BRAT

1. Open **Settings → BRAT**
2. Click **Add Beta Plugin**
3. Paste this URL and click **Add Plugin**:
   ```
   https://github.com/hughesgm8/zotero-obsidian-chat
   ```
4. BRAT will download and install it automatically

### 3c. Enable the plugin

1. Go to **Settings → Community plugins**
2. Find **Zotero MCP Chat** and toggle it on

> **Getting future updates:** BRAT checks for updates automatically each time Obsidian starts. To check manually at any time, go to **Settings → BRAT** and click **Check for updates** (the refresh icon at the top right). Once BRAT has downloaded a new version, you need to reload the plugin to apply it — either toggle it off and back on in **Settings → Community plugins**, or restart Obsidian entirely.

---

## Step 4 — Configure the plugin

1. Go to **Settings → Zotero MCP Chat**
2. Fill in the **zotero-mcp path** — this is the full path to the `zotero-mcp` command on your computer.
   - Open Terminal and run `which zotero-mcp`
   - Copy the result and paste it into the setting
   - **Important:** the path must be absolute — if the result starts with `~`, expand it manually (e.g. `~` becomes `/Users/yourname`)
3. Under **AI Provider**, select **Ollama**
4. Make sure the **Ollama URL** field is set to `http://localhost:11434` — this is the default and should already be correct
5. The **Model** field should say `llama3.2` (or whatever model you downloaded in Step 1)
6. Click the **X** to close Settings

> **Using OpenRouter or Claude instead?** If you have an API key for [OpenRouter](https://openrouter.ai) or [Anthropic](https://anthropic.com), you can select those providers and enter your key. OpenRouter gives access to many models including free ones. This is optional — Ollama works great for most purposes.

---

## Step 5 — Start chatting

1. Click the **Z icon** in the left sidebar to open the chat panel. If you don't see it, go to **View → Zotero MCP Chat**.
2. Wait a moment for the status dot to turn **green** — this means the connection to your Zotero library is ready (it can take 10–30 seconds the first time).
3. Type a question and press **Enter**.

---

## Using the plugin

### The chat panel

<img width="1439" height="900" alt="Screenshot 2026-03-06 at 10 08 04" src="https://github.com/user-attachments/assets/37309c1d-d166-4f90-bae3-e97800820aae" />

The header shows:
- A **status dot** — green means connected and ready, red means something went wrong
- A **new chat button** (✏️) — clears the current conversation
- A **save button** (💾) — saves the conversation as a note in your vault

---

### Asking a question

Type your question in the input box at the bottom and press **Enter** to send (or **Shift+Enter** to add a new line).

<img width="1440" height="900" alt="image" src="https://github.com/user-attachments/assets/0d07569d-43a2-413a-83b8-36c0de62f8bd" />

The plugin will:
1. Search your Zotero library for relevant papers
2. Send the results and your question to your AI model
3. Display the response with citations

<img width="1440" height="900" alt="image" src="https://github.com/user-attachments/assets/62d7cafa-bf71-4a72-b54a-9ecf3f7700c3" />

Each response includes a **Sources** section listing the papers the answer drew from. Click the **copy button** to copy the full response (including sources) as markdown — useful for pasting directly into a note.

---

### Attaching a note for context

You can give the AI extra context by attaching one of your Obsidian notes — useful when you want answers tailored to a specific project, draft, or set of ideas.

1. Click the **@ button** in the input row
2. Start typing the name of any note in your vault
3. Select the note from the list

<img width="1439" height="900" alt="image" src="https://github.com/user-attachments/assets/3242a62a-dab0-4e79-b6e0-2b39c0f22d64" />

The note appears as a chip above the input box. You can attach multiple notes, and remove any of them by clicking the **×** on its chip. The note content is sent to the AI alongside your question. It doesn't affect which papers are retrieved — it only influences how the AI interprets and responds to your question.

---

### Saving a conversation

Click the **save button** (💾) in the top-right of the panel. The conversation is saved as a markdown note in `Zotero Chats/YYYY-MM-DD/` in your vault.

---

### Smart Import — creating an AI summary of a paper

Smart Import lets you pick a paper from your Zotero library and generate a structured summary note in Obsidian.

Open the **Command Palette** (`⌘P`) and run:

> **Zotero MCP Chat: Import paper from Zotero with AI summary**

<img width="1440" height="900" alt="image" src="https://github.com/user-attachments/assets/5f87476a-692a-463f-a349-48da1e9365f2" />

A search box will appear. Type the title or author of a paper — results from your Zotero library will appear as you type.

<img width="1438" height="899" alt="image" src="https://github.com/user-attachments/assets/68a86802-f378-470a-8858-d3942f7b14e4" />

Click a result. The plugin will fetch the paper's full text and metadata, pass it to your AI model, and create a new note with structured sections: **Summary**, **Key Takeaways**, **Questions for Active Engagement**, and **Relevance** (or whatever sections you've configured in Settings).

<img width="1438" height="900" alt="image" src="https://github.com/user-attachments/assets/efe4657b-1fd1-4600-81a9-aee4dfd2c362" />

---

### Smart Import — enriching an existing note

If you already have a note (for example, one created by the [Zotero Integration](https://github.com/mgmeyers/obsidian-zotero-integration) plugin), you can add an AI summary to it without creating a new file.

1. Open the note you want to enrich
2. Place your cursor where you want the summary to be inserted
3. Open the Command Palette (`⌘P`) and run:

> **Zotero MCP Chat: Insert AI summary into active note**

The plugin will ask you which paper to summarise, then insert the summary at your cursor position.

---

### Customising summary sections

By default, Smart Import generates four sections (Summary, Key Takeaways, Questions for Active Engagement, Relevance). You can change these in **Settings → Zotero MCP Chat → Smart Import sections**.

<img width="1437" height="900" alt="image" src="https://github.com/user-attachments/assets/416e0d6a-44c4-4037-81f6-a72a64482667" />

For each section you can set:
- **Name** — the heading that appears in the note
- **Instructions** — what the AI should write for that section

You can add new sections, delete ones you don't want, and reorder them with the ↑/↓ buttons.

> **Make the most of the Relevance section:** The **Relevance** section is where the AI explains how each paper connects to your own research. It works best when you tell it what you're working on — go to **Settings → Zotero MCP Chat → Your research interests** and write a short description of your research focus (a sentence or two is enough). For example: *"I study the effects of social media on adolescent mental health."* The AI will use this to personalise the Relevance section for every paper you import.

---

## Troubleshooting

**The status dot stays red**
The plugin couldn't connect to zotero-mcp. Check that the path in Settings is correct. Try opening Terminal and running `zotero-mcp` to see if it works on its own.

**"Plugin not ready" error**
Wait a few more seconds after opening the panel — zotero-mcp can take up to 30 seconds to start indexing on first launch.

**Slow responses**
This is normal with local models. Larger models are slower. Try `llama3.2:3b` for faster (but slightly less detailed) responses.

**"Collection already exists" error**
This can happen if you also use zotero-mcp with Claude Desktop at the same time. See the [zotero-mcp issue tracker](https://github.com/54yyyu/zotero-mcp/issues) for the latest fix.

**"Ollama 401: unauthorized" error**
This happens when using a cloud-hosted model through Ollama without being logged in. Open the Ollama app and make sure you are signed into your account, then try again.

**"Error updating database" on startup**
You may see a Zotero API error in the terminal when zotero-mcp starts. This is non-fatal — the server still runs and your existing paper database is unaffected. It just means the automatic refresh on startup failed. Run `zotero-mcp update-db --fulltext` manually in Terminal if you want to re-index.

**Wrong Python version being used for zotero-mcp**
To check which Python version pipx used when installing zotero-mcp, run:
```
pipx list
```
Look for the `zotero-mcp-server` entry — it will show the Python version alongside it. If it shows 3.14 or an unexpected version, force a reinstall with the correct version (replacing `3.12` with your version from step 2b):
```
pipx install zotero-mcp-server --python python3.12 --force
```
If `python3.12` is not recognised as a command, use the full path instead. For a Homebrew install this is typically:
```
pipx install zotero-mcp-server --python /opt/homebrew/opt/python@3.12/bin/python3.12 --force
```
After reinstalling, re-run `zotero-mcp setup` and `zotero-mcp update-db --fulltext`.

**The model doesn't seem to know about my papers**
Make sure you completed Step 2e. If you've added papers to Zotero recently, open Terminal and run `zotero-mcp update-db --fulltext` to re-index.

---

## Privacy

When using Ollama with a local model, everything stays on your computer. Your questions, your papers, and the AI model itself never leave your machine.

When using Ollama with a cloud-hosted model (such as `deepseek-v3.1:671b-cloud`), your questions and relevant paper excerpts are sent to the model provider's servers. When using OpenRouter or Claude, the same applies. Check the relevant provider's privacy policy if this matters for your research.

---

## Feedback

Found a bug or have a suggestion? Open an issue at [github.com/hughesgm8/zotero-obsidian-chat/issues](https://github.com/hughesgm8/zotero-obsidian-chat/issues).
