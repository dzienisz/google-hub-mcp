#!/usr/bin/env node
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// MCP clients launch this server with an arbitrary cwd, so resolve .env
// relative to the project root instead of process.cwd().
config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { CastClient } from "./cast.js";
import { DisplayServer } from "./display.js";
import { fetchAiDevsStats, buildInteractiveDashboardHtml } from "./aidevs.js";

const HUB_IP = process.env.NEST_HUB_IP ?? "";
const DISPLAY_PORT = parseInt(process.env.DISPLAY_PORT ?? "3333", 10);

const cast = new CastClient(HUB_IP);
const display = new DisplayServer(DISPLAY_PORT);

const server = new Server(
  { name: "google-hub-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "discover_hub",
      description:
        "Scan the local network for Google Nest Hub / Chromecast devices via mDNS. Returns device names and IP addresses.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "cast_text",
      description:
        "Render text or Markdown and display it on the Nest Hub screen. Great for showing Claude's output, code snippets, or summaries.",
      inputSchema: {
        type: "object",
        required: ["text"],
        properties: {
          text: {
            type: "string",
            description: "Text or Markdown to display on the screen",
          },
          title: {
            type: "string",
            description: "Optional header title (defaults to 'Claude Code')",
          },
          theme: {
            type: "string",
            enum: ["dark", "light"],
            description: "Color theme (default: dark)",
          },
        },
      },
    },
    {
      name: "cast_url",
      description:
        "Cast any web URL to the Nest Hub display as a full-screen snapshot (the page is rendered server-side and shown as an image).",
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: {
            type: "string",
            description: "The URL to cast (must be reachable from the device)",
          },
        },
      },
    },
    {
      name: "cast_image",
      description:
        "Display an image on the Nest Hub screen from a public URL.",
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: {
            type: "string",
            description: "Public URL of the image (JPEG, PNG, GIF, WebP)",
          },
          content_type: {
            type: "string",
            description: "MIME type of the image (default: image/jpeg)",
          },
        },
      },
    },
    {
      name: "stop_cast",
      description: "Stop whatever is currently playing or displayed on the Nest Hub.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_status",
      description:
        "Get the current playback status and volume information from the Nest Hub.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "cast_aidevs_dashboard",
      description:
        "Fetch AI Devs 4 course progress stats and display a live dashboard on the Nest Hub. Uses the AIDEVS_API_KEY from environment.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "discover_hub": {
        const devices = await cast.discover();
        if (!devices.length) {
          return text("No Nest Hub devices found. Make sure you are on the same Wi-Fi network.");
        }
        const list = devices.map((d) => `- **${d.name}** — \`${d.host}\``).join("\n");
        return text(`Found ${devices.length} device(s):\n${list}\n\nSet NEST_HUB_IP in your .env file to use one.`);
      }

      case "cast_text": {
        const { text: body, title, theme } = args as {
          text: string;
          title?: string;
          theme?: string;
        };
        const url = await display.renderText(body, title, theme);
        await cast.castMedia(url, "image/jpeg");
        return text(`Now showing on Nest Hub: "${title ?? "Claude Code"}"`);
      }

      case "cast_url": {
        const { url } = args as { url: string };
        // The Default Media Receiver can't render HTML — screenshot the page and cast that.
        const snapshotUrl = await display.renderUrl(url);
        await cast.castMedia(snapshotUrl, "image/jpeg");
        return text(`Casting snapshot of ${url} to Nest Hub.`);
      }

      case "cast_image": {
        const { url, content_type = "image/jpeg" } = args as {
          url: string;
          content_type?: string;
        };
        await cast.castMedia(url, content_type);
        return text(`Displaying image on Nest Hub.`);
      }

      case "stop_cast": {
        await cast.stop();
        return text("Cast session stopped.");
      }

      case "get_status": {
        const status = await cast.getStatus();
        return text("```json\n" + JSON.stringify(status, null, 2) + "\n```");
      }

      case "cast_aidevs_dashboard": {
        const key = process.env.AIDEVS_API_KEY ?? "";
        if (!key) throw new Error("AIDEVS_API_KEY is not set in .env");
        const stats = await fetchAiDevsStats(key);
        // The Default Media Receiver can't render HTML, so screenshot the
        // live page and cast it as an image.
        const dashUrl = display.setLivePage("/dashboard", () => buildInteractiveDashboardHtml());
        const snapshotUrl = await display.renderUrl(dashUrl);
        await cast.castMedia(snapshotUrl, "image/jpeg");
        return text(`AI Devs dashboard cast: ${stats.points} pts · ${stats.secrets} secrets · ${stats.days.length} days (live page: ${dashUrl})`);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

function text(msg: string) {
  return { content: [{ type: "text", text: msg }] };
}

async function main() {
  await display.start();

  const apiKey = process.env.AIDEVS_API_KEY ?? "";
  // Expose only what the dashboard renders — the raw API response echoes the API key.
  display.registerJsonEndpoint("/api/aidevs", async () => {
    const { points, secrets, days, email } = await fetchAiDevsStats(apiKey);
    return { points, secrets, days, email };
  });
  display.setLivePage("/dashboard", () => buildInteractiveDashboardHtml());

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[google-hub-mcp] Server ready. Display server on port ${DISPLAY_PORT}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
