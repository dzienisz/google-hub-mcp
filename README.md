# google-hub-mcp

An [MCP](https://modelcontextprotocol.io) server that lets **Claude Code** talk to your **Google Nest Hub** over the local network.

Send text, Markdown, images, and URLs directly to your Nest Hub display — right from a Claude Code session.

```
Claude Code  ──▶  MCP Server (Node.js)  ──▶  Cast Protocol  ──▶  Nest Hub
                       │
                  Local HTTP server
                (renders Markdown → HTML)
```

---

## How it works

The server exposes six tools to Claude Code:

| Tool | What it does |
|---|---|
| `discover_hub` | Scans your LAN for Nest Hub / Chromecast devices via mDNS |
| `cast_text` | Renders text or Markdown and displays it on the Hub |
| `cast_url` | Casts any webpage full-screen |
| `cast_image` | Displays an image from a public URL |
| `stop_cast` | Stops the current cast session |
| `get_status` | Returns the device's current status and volume |

`cast_text` works by spinning up a small local HTTP server that renders Markdown to a Nest Hub-optimized HTML page (1024×600), then casts that local URL to the device.

---

## Requirements

- Node.js 18+
- Google Nest Hub (1st or 2nd gen) or Nest Hub Max on the **same Wi-Fi** as your Mac
- Your Mac's firewall must allow inbound connections on `DISPLAY_PORT` (default `3333`)
  - If that port is already taken (e.g. another Claude Code session is running this server), the display server falls back to the next free port (`3334`, `3335`, … up to 9 above, then any free port). The startup log on stderr shows the port in use. The macOS application firewall allows by app (`node`), not by port, so this normally needs no extra setup — but if you filter by port, open the range too.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure your device IP

Copy the example env file and fill in your Nest Hub's IP address:

```bash
cp .env.example .env
```

**Find the IP in the Google Home app:**
> Open the Home app → tap your Nest Hub → tap the gear icon (Settings) → Device info → IP address

Alternatively, run `discover_hub` from Claude Code after setup — it will scan for devices automatically.

### 3. Build

```bash
npm run build
```

### 4. Register with Claude Code

Add the server to your Claude Code MCP config. Open (or create) `~/.claude/settings.json` and add:

```json
{
  "mcpServers": {
    "google-hub": {
      "command": "node",
      "args": ["/Users/home/Developer/google-hub/dist/index.js"],
      "env": {
        "NEST_HUB_IP": "192.168.1.xxx",
        "DISPLAY_PORT": "3333"
      }
    }
  }
}
```

Or, if you prefer to use the `.env` file instead of inline env vars, omit the `"env"` block and rely on `dotenv` loading `.env` automatically.

Restart Claude Code after editing `settings.json`.

---

## Usage examples

Once registered, ask Claude in any session:

```
Show a summary of this PR on my Nest Hub.
```

```
Cast the README to my Nest Hub.
```

```
Display this code snippet on the Hub in dark mode.
```

```
What's currently showing on my Nest Hub?
```

```
Stop whatever is on my Nest Hub.
```

---

## Development

Run in dev mode (no build step needed):

```bash
npm run dev
```

To test a tool manually without Claude Code, you can use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector npm run dev
```

---

## Display details

The Nest Hub's built-in browser renders standard HTML/CSS. The local display server targets:

| Device | Resolution |
|---|---|
| Nest Hub (1st gen) | 1024 × 600 |
| Nest Hub (2nd gen) | 1024 × 600 |
| Nest Hub Max | 1280 × 800 |

The generated page is fixed at 1024×600. For Nest Hub Max, you can increase this in `src/display.ts`.

---

## Limitations

- The Cast protocol works over the **local network only** — your Mac and Nest Hub must be on the same Wi-Fi.
- `cast_text` serves content from your Mac's local HTTP server, so the Nest Hub must be able to reach your Mac's IP on `DISPLAY_PORT`.
- This uses the Cast v2 protocol (same as Chromecast), not the Google Home API — no Google account or OAuth required.
- `cast_url` uses the Default Media Receiver, which has domain restrictions. For arbitrary URLs, `cast_text` (which hosts locally) is more reliable.

---

## License

MIT
