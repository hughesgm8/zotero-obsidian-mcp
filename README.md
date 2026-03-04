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

### 2c. Install zotero-mcp

The recommended way to install zotero-mcp is via **pipx**, which handles the installation cleanly and makes the `zotero-mcp` command available without PATH issues. **Note**: If you've never installed anything with [Homebrew](https://brew.sh) (a package manager), install it first using the following command: 

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then, in Terminal, paste these commands one at a time and press Enter after each:

```
brew install pipx
pipx install zotero-mcp-server
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
4. Install **Obsidian42 - BRAT** and enable it

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

---

## Step 4 — Configure the plugin

1. Go to **Settings → Zotero MCP Chat**
2. Fill in the **zotero-mcp path** — this is the full path to the `zotero-mcp` command on your computer.
   - Open Terminal and run `which zotero-mcp`
   - Copy the result and paste it into the setting
   - **Important:** the path must be absolute — if the result starts with `~`, expand it manually (e.g. `~` becomes `/Users/yourname`)
3. Under **AI Provider**, select **Ollama**
4. The **Model** field should say `llama3.2` (or whatever model you downloaded in Step 1)
5. Click the **X** to close Settings

> **Using OpenRouter or Claude instead?** If you have an API key for [OpenRouter](https://openrouter.ai) or [Anthropic](https://anthropic.com), you can select those providers and enter your key. OpenRouter gives access to many models including free ones. This is optional — Ollama works great for most purposes.

---

## Step 5 — Start chatting

1. Click the **book icon** in the left sidebar to open the chat panel
2. Wait a moment for the status dot to turn **green** — this means the connection to your Zotero library is ready (it can take 10–30 seconds the first time)
3. Type a question and press **Enter**

### Tips

- **Attach a note for context:** Click the **@** button to attach one of your Obsidian notes. The AI will use it as additional context for your question.
- **Save a conversation:** Click the **export icon** at the top of the chat to save the conversation as a note in your vault.
- **Start fresh:** Click the **pen icon** to clear the chat and start a new conversation.
- **Shift+Enter** adds a new line without sending.

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

**The model doesn't seem to know about my papers**
Make sure you completed Step 2e. If you've added papers to Zotero recently, open Terminal and run `zotero-mcp update-db --fulltext` to re-index.

---

## Privacy

When using Ollama, everything stays on your computer. Your questions, your papers, and the AI model itself never leave your machine.

When using OpenRouter or Claude, your questions and relevant paper excerpts are sent to those services. Check their privacy policies if this matters for your research.

---

## Feedback

Found a bug or have a suggestion? Open an issue at [github.com/hughesgm8/zotero-obsidian-chat/issues](https://github.com/hughesgm8/zotero-obsidian-chat/issues).
