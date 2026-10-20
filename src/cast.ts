import { createRequire } from "module";
import { Bonjour } from "bonjour-service";

const require = createRequire(import.meta.url);
const { Client, DefaultMediaReceiver, Application, JsonController } = require("castv2-client");

// Launching loads the receiver page on the Hub (~3 s for ours); plain requests answer in under 1 s
const LAUNCH_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 10_000;

/** castv2 nulls its socket once the connection closes, after which close() throws. */
function closeClient(client: any): void {
  if (client.client?.socket) client.close();
}

/**
 * Run a castv2 request on a connected client. castv2 drops a request's callback when the
 * connection closes first, so also settle on close, error or timeout. The connection is
 * closed afterwards unless `keepOpen` is set and the request succeeded.
 */
function castRequest<T>(
  client: any,
  timeoutMs: number,
  run: (done: (err: Error | null, value?: T) => void) => void,
  keepOpen = false
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err: Error | null, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err || !keepOpen) closeClient(client);
      if (err) reject(err);
      else resolve(value as T);
    };
    const timer = setTimeout(() => done(new Error(`Cast request timed out after ${timeoutMs / 1000} s`)), timeoutMs);
    client.client.once("close", () => done(new Error("Cast connection closed before the request finished")));
    client.on("error", (err: Error) => done(err));
    run(done);
  });
}

export interface DiscoveredDevice {
  name: string;
  host: string;
}

/** A running custom receiver app plus the open connection and JSON channel to it. */
export class CustomAppSession {
  private closed = false;
  private closeHandlers: Array<() => void> = [];

  constructor(private client: any, private channel: any, private sessionId: string) {}

  get isClosed(): boolean {
    return this.closed;
  }

  /** Stop the receiver app on the Hub (back to the ambient screen), then close the connection. */
  async stopApp(): Promise<void> {
    if (this.closed) return;
    // castv2 drops the callback if the connection closes first, so also settle on close or after 3 s
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, 3000);
      this.closeHandlers.push(done);
      this.client.receiver.stop(this.sessionId, done);
    });
    this.close();
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
    closeClient(this.client);
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
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        closeClient(client);
        reject(err);
      };
      // The OS connect timeout is ~75 s; fail fast so an offline Hub errors in ~11 s with the retry
      const timer = setTimeout(() => {
        fail(Object.assign(new Error(`Timed out connecting to ${this.host}:8009`), { code: "ETIMEDOUT" }));
      }, 5000);
      client.connect(this.host, () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(client);
      });
      client.on("error", fail);
      // The socket can close before connecting without emitting "error"
      client.client.once("close", () => {
        fail(Object.assign(new Error(`Connection to ${this.host}:8009 closed before it was ready`), { code: "ECONNRESET" }));
      });
    });
  }

  async castMedia(url: string, contentType: string): Promise<void> {
    const client = await this.connect();
    return castRequest<void>(client, LAUNCH_TIMEOUT_MS, (done) => {
      client.launch(DefaultMediaReceiver, (err: Error, player: any) => {
        if (err) return done(err);
        const media = {
          contentId: url,
          contentType,
          streamType: "BUFFERED",
        };
        player.load(media, { autoplay: true }, (err: Error) => done(err));
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
    const app = await castRequest<any>(
      client,
      LAUNCH_TIMEOUT_MS,
      (done) => client.launch(CustomApp, (err: Error, app: any) => done(err, app)),
      true
    );
    const session = new CustomAppSession(
      client,
      app.createController(JsonController, namespace),
      app.session.sessionId
    );
    // Fires when the receiver app is stopped or closes the connection
    app.on("close", () => session.close());
    client.on("error", () => session.close());
    client.client.once("close", () => session.close());
    return session;
  }

  async stop(): Promise<void> {
    const client = await this.connect();
    return castRequest<void>(client, REQUEST_TIMEOUT_MS, (done) => {
      client.getSessions((err: Error, sessions: any[]) => {
        // Stop the app itself rather than its media, so custom receivers close too;
        // leave the Hub's ambient/idle screen alone
        const active = (sessions ?? []).filter((s) => !s.isIdleScreen);
        if (err || !active.length) return done(null);
        client.receiver.stop(active[0].sessionId, (err: Error) => done(err));
      });
    });
  }

  async getStatus(): Promise<object> {
    const client = await this.connect();
    return castRequest<object>(client, REQUEST_TIMEOUT_MS, (done) => {
      client.getStatus((err: Error, status: any) => done(err, status));
    });
  }
}
