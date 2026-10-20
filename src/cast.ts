import { createRequire } from "module";
import { Bonjour } from "bonjour-service";

const require = createRequire(import.meta.url);
const { Client, DefaultMediaReceiver, Application, JsonController } = require("castv2-client");

export interface DiscoveredDevice {
  name: string;
  host: string;
}

/** A running custom receiver app plus the open connection and JSON channel to it. */
export class CustomAppSession {
  private closed = false;
  private closeHandlers: Array<() => void> = [];

  constructor(private client: any, private channel: any) {}

  get isClosed(): boolean {
    return this.closed;
  }

  send(data: unknown): void {
    if (!this.closed) this.channel.send(data);
  }

  onMessage(handler: (data: any) => void): void {
    this.channel.on("message", handler);
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.client.close();
    for (const handler of this.closeHandlers) handler();
  }
}

export class CastClient {
  private host: string;

  constructor(host: string) {
    this.host = host;
  }

  async discover(): Promise<DiscoveredDevice[]> {
    return new Promise((resolve) => {
      const bonjour = new Bonjour();
      const devices: DiscoveredDevice[] = [];

      const browser = bonjour.find({ type: "googlecast" }, (service: any) => {
        devices.push({
          name: service.name,
          host: service.addresses?.[0] || service.host,
        });
      });

      setTimeout(() => {
        browser.stop();
        bonjour.destroy();
        resolve(devices);
      }, 4000);
    });
  }

  private async connect(): Promise<any> {
    if (!this.host) {
      throw new Error(
        "NEST_HUB_IP is not set. Use the discover_hub tool to find your device IP, then set it in .env"
      );
    }
    try {
      return await this.connectOnce();
    } catch (err: any) {
      // A dozing Hub can miss the first ARP lookup; one retry after a short pause usually succeeds
      if (err?.code !== "EHOSTUNREACH" && err?.code !== "ETIMEDOUT") throw err;
      await new Promise((r) => setTimeout(r, 1000));
      return this.connectOnce();
    }
  }

  private connectOnce(): Promise<any> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let connected = false;
      // The OS connect timeout is ~75 s; fail fast so an offline Hub errors in ~11 s with the retry
      const timer = setTimeout(() => {
        client.close();
        reject(Object.assign(new Error(`Timed out connecting to ${this.host}:8009`), { code: "ETIMEDOUT" }));
      }, 5000);
      client.connect(this.host, () => {
        connected = true;
        clearTimeout(timer);
        resolve(client);
      });
      client.on("error", (err: Error) => {
        clearTimeout(timer);
        if (!connected) client.close();
        reject(err);
      });
    });
  }

  async castMedia(url: string, contentType: string): Promise<void> {
    const client = await this.connect();
    return new Promise((resolve, reject) => {
      client.launch(DefaultMediaReceiver, (err: Error, player: any) => {
        if (err) {
          client.close();
          return reject(err);
        }
        const media = {
          contentId: url,
          contentType,
          streamType: "BUFFERED",
        };
        player.load(media, { autoplay: true }, (err: Error) => {
          client.close();
          if (err) return reject(err);
          resolve();
        });
      });
    });
  }

  /**
   * Launch a custom Web Receiver (or attach to it if it's already running) and open a
   * JSON channel on `namespace`. The connection stays open until the session is closed.
   */
  async launchCustomApp(appId: string, namespace: string): Promise<CustomAppSession> {
    const client = await this.connect();
    class CustomApp extends Application {
      static APP_ID = appId;
    }
    return new Promise((resolve, reject) => {
      client.launch(CustomApp, (err: Error, app: any) => {
        if (err) {
          client.close();
          return reject(err);
        }
        const session = new CustomAppSession(client, app.createController(JsonController, namespace));
        // Fires when the receiver app is stopped or closes the connection
        app.on("close", () => session.close());
        client.on("error", () => session.close());
        resolve(session);
      });
    });
  }

  async stop(): Promise<void> {
    const client = await this.connect();
    return new Promise((resolve, reject) => {
      client.getSessions((err: Error, sessions: any[]) => {
        // Stop the app itself rather than its media, so custom receivers close too;
        // leave the Hub's ambient/idle screen alone
        const active = (sessions ?? []).filter((s) => !s.isIdleScreen);
        if (err || !active.length) {
          client.close();
          return resolve();
        }
        client.receiver.stop(active[0].sessionId, (err: Error) => {
          client.close();
          if (err) return reject(err);
          resolve();
        });
      });
    });
  }

  async getStatus(): Promise<object> {
    const client = await this.connect();
    return new Promise((resolve, reject) => {
      client.getStatus((err: Error, status: any) => {
        client.close();
        if (err) return reject(err);
        resolve(status);
      });
    });
  }
}
