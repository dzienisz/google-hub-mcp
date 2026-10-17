import http from "http";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { marked } from "marked";
import puppeteer from "puppeteer";

export class DisplayServer {
  private port: number;
  private server: http.Server | null = null;
  private snapshotDir: string;
  private livePages = new Map<string, string | (() => string)>();
  private jsonEndpoints = new Map<string, () => Promise<unknown>>();

  constructor(port: number) {
    this.port = port;
    this.snapshotDir = path.join(os.tmpdir(), "google-hub-mcp");
  }

  setLivePage(urlPath: string, content: string | (() => string)): string {
    this.livePages.set(urlPath, content);
    return `http://${this.getLocalIP()}:${this.port}${urlPath}`;
  }

  registerJsonEndpoint(urlPath: string, handler: () => Promise<unknown>): void {
    this.jsonEndpoints.set(urlPath, handler);
  }

  async start(): Promise<void> {
    await fs.mkdir(this.snapshotDir, { recursive: true });

    this.server = http.createServer(async (req, res) => {
      const urlPath = (req.url ?? "/").split("?")[0];

      if (this.jsonEndpoints.has(urlPath)) {
        try {
          const data = await this.jsonEndpoints.get(urlPath)!();
          res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          res.end(JSON.stringify(data));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      if (this.livePages.has(urlPath)) {
        const content = this.livePages.get(urlPath)!;
        const html = typeof content === "function" ? content() : content;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      const filePath = path.join(this.snapshotDir, path.basename(req.url ?? "/"));
      fs.readFile(filePath)
        .then((data) => {
          res.writeHead(200, { "Content-Type": "image/jpeg" });
          res.end(data);
        })
        .catch(() => {
          res.writeHead(404);
          res.end();
        });
    });

    return new Promise((resolve) => {
      this.server!.listen(this.port, "0.0.0.0", () => resolve());
    });
  }

  async renderUrl(url: string): Promise<string> {
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1024, height: 600 });
      await page.goto(url, { waitUntil: "networkidle0" });
      // Let CSS transitions settle (dashboard progress bars animate in over 0.6s)
      await new Promise((r) => setTimeout(r, 800));
      const screenshot = await page.screenshot({ type: "jpeg", quality: 92 });
      const jpeg = Buffer.from(screenshot);
      const filename = `snapshot-${Date.now()}.jpg`;
      const filePath = path.join(this.snapshotDir, filename);
      await fs.writeFile(filePath, jpeg);
      return `http://${this.getLocalIP()}:${this.port}/${filename}`;
    } finally {
      await browser.close();
    }
  }

  async renderText(text: string, title?: string, theme = "dark"): Promise<string> {
    const html = buildHtml(await marked(text), title, theme);
    return this.renderHtml(html);
  }

  async renderHtml(html: string): Promise<string> {
    const jpeg = await htmlToJpeg(html);
    const filename = `snapshot-${Date.now()}.jpg`;
    const filePath = path.join(this.snapshotDir, filename);
    await fs.writeFile(filePath, jpeg);
    return `http://${this.getLocalIP()}:${this.port}/${filename}`;
  }

  private getLocalIP(): string {
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
      for (const iface of list ?? []) {
        if (iface.family === "IPv4" && !iface.internal) {
          return iface.address;
        }
      }
    }
    return "127.0.0.1";
  }

  stop(): void {
    this.server?.close();
  }
}

async function htmlToJpeg(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 600 });
    // Puppeteer 24.4x no longer accepts networkidle* for setContent; "load" still waits for images/fonts
    await page.setContent(html, { waitUntil: "load" });
    const screenshot = await page.screenshot({ type: "jpeg", quality: 92 });
    return Buffer.from(screenshot);
  } finally {
    await browser.close();
  }
}

function buildHtml(bodyHtml: string, title?: string, theme = "dark"): string {
  const bg        = theme === "dark" ? "#0f0f0f" : "#ffffff";
  const fg        = theme === "dark" ? "#e8e8e8" : "#1a1a1a";
  const accent    = theme === "dark" ? "#8b5cf6" : "#6d28d9";
  const headerBg  = theme === "dark" ? "#1a1a2e" : "#f3f4f6";
  const codeBg    = theme === "dark" ? "#1e1e2e" : "#f3f4f6";
  const codeFg    = theme === "dark" ? "#cdd6f4" : "#374151";
  const mutedFg   = theme === "dark" ? "#aaa"    : "#666";
  const strongFg  = theme === "dark" ? "#fff"    : "#000";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1024px; height: 600px; overflow: hidden;
      background: ${bg}; color: ${fg};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 17px; line-height: 1.65;
      display: flex; flex-direction: column;
    }
    header {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 24px; background: ${headerBg};
      border-bottom: 2px solid ${accent}; flex-shrink: 0;
    }
    header h1 { font-size: 15px; font-weight: 600; color: ${accent}; letter-spacing: 0.3px; }
    main { flex: 1; overflow: hidden; padding: 20px 28px; }
    h1, h2, h3 { color: ${accent}; margin: 14px 0 6px; font-weight: 600; }
    h1 { font-size: 22px; } h2 { font-size: 18px; } h3 { font-size: 16px; }
    p { margin-bottom: 10px; }
    ul, ol { margin: 0 0 10px 22px; } li { margin-bottom: 3px; }
    code {
      background: ${codeBg}; color: ${codeFg};
      padding: 2px 6px; border-radius: 4px;
      font-family: "Courier New", monospace; font-size: 14px;
    }
    pre {
      background: ${codeBg}; color: ${codeFg};
      padding: 12px 16px; border-radius: 8px; overflow: hidden;
      margin-bottom: 12px; font-family: "Courier New", monospace;
      font-size: 13px; line-height: 1.5; border-left: 3px solid ${accent};
    }
    pre code { background: none; padding: 0; }
    strong { color: ${strongFg}; font-weight: 600; }
    a { color: ${accent}; text-decoration: none; }
    blockquote { border-left: 3px solid ${accent}; padding-left: 14px; color: ${mutedFg}; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 15px; }
    th { background: ${codeBg}; color: ${accent}; padding: 6px 10px; text-align: left; border-bottom: 2px solid ${accent}; }
    td { padding: 5px 10px; border-bottom: 1px solid ${codeBg}; }
  </style>
</head>
<body>
  <header>
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="12" fill="${accent}"/>
      <path d="M7 12.5l3.5 3.5 6.5-7" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <h1>${escapeHtml(title || "Claude Code")}</h1>
  </header>
  <main>${bodyHtml}</main>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
