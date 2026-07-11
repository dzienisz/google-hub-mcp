import { createRequire } from "module";
import { Bonjour } from "bonjour-service";

const require = createRequire(import.meta.url);
const { Client, DefaultMediaReceiver } = require("castv2-client");

export interface DiscoveredDevice {
  name: string;
  host: string;
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

  private connect(): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.host) {
        reject(
          new Error(
            "NEST_HUB_IP is not set. Use the discover_hub tool to find your device IP, then set it in .env"
          )
        );
        return;
      }
      const client = new Client();
      client.connect(this.host, () => resolve(client));
      client.on("error", (err: Error) => reject(err));
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

  async stop(): Promise<void> {
    const client = await this.connect();
    return new Promise((resolve, reject) => {
      client.getSessions((err: Error, sessions: any[]) => {
        if (err || !sessions?.length) {
          client.close();
          return resolve();
        }
        client.join(sessions[0], DefaultMediaReceiver, (err: Error, player: any) => {
          if (err) {
            client.close();
            return reject(err);
          }
          player.stop((err: Error) => {
            client.close();
            if (err) return reject(err);
            resolve();
          });
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
