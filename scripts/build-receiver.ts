// Writes the Cast Web Receiver page that GitHub Pages serves from /docs.
// Run after changing the dashboard: npm run build:receiver
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildInteractiveDashboardHtml } from "../src/aidevs.js";

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "receiver");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "index.html"), buildInteractiveDashboardHtml("cast"));
console.log(`Wrote ${path.relative(process.cwd(), path.join(outDir, "index.html"))}`);
