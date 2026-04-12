#!/usr/bin/env tsx
/**
 * Quick connection test — casts "Hello from Claude Code!" to your Nest Hub.
 * Usage: npx tsx test-connection.ts
 */
import "dotenv/config";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { Client, DefaultMediaReceiver } = require("castv2-client");

const HOST = process.env.NEST_HUB_IP;
if (!HOST) {
  console.error("❌  NEST_HUB_IP is not set in .env");
  process.exit(1);
}

console.log(`Connecting to Nest Hub at ${HOST}...`);

const client = new Client();

client.on("error", (err: Error) => {
  console.error("❌  Connection error:", err.message);
  process.exit(1);
});

client.connect(HOST, () => {
  console.log("✅  Connected!");
  console.log("   Launching media receiver...");

  client.launch(DefaultMediaReceiver, (err: Error, player: any) => {
    if (err) {
      console.error("❌  Launch error:", err.message);
      client.close();
      process.exit(1);
    }

    console.log("✅  Receiver launched!");
    console.log("   Loading test page...");

    // The Default Media Receiver supports images/video, not arbitrary HTML.
    // Cast a solid-color JPEG as a visible "hello world".
    const media = {
      contentId: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=1024&h=600&fit=crop",
      contentType: "image/jpeg",
      streamType: "BUFFERED",
      metadata: {
        type: 0,
        metadataType: 0,
        title: "Hello from Claude Code!",
      },
    };

    player.load(media, { autoplay: true }, (err: Error, status: any) => {
      if (err) {
        console.error("❌  Load error:", err.message);
      } else {
        console.log("✅  Casting! Check your Nest Hub.");
        console.log("   Status:", status?.playerState);
      }
      client.close();
      process.exit(0);
    });
  });
});

setTimeout(() => {
  console.error("❌  Timed out after 10s — is the Nest Hub on the same network?");
  process.exit(1);
}, 10_000);
