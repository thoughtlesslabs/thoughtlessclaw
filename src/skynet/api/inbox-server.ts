import http from "node:http";
import type { Skynet } from "../skynet.js";

export interface InboxServerConfig {
  port: number;
  host?: string;
}

export class InboxServer {
  private server: http.Server | null = null;
  private skynet: Skynet;
  private config: InboxServerConfig;

  constructor(skynet: Skynet, config: InboxServerConfig) {
    this.skynet = skynet;
    this.config = { host: "0.0.0.0", ...config };
  }

  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };

      if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
      }

      try {
        if (req.url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }

        if (req.url === "/inbox" && req.method === "POST") {
          await this.handleInbox(req, res, corsHeaders);
          return;
        }

        if (req.url?.startsWith("/inbox") && req.method === "GET") {
          await this.listInbox(req, res, corsHeaders);
          return;
        }

        res.writeHead(404, corsHeaders);
        res.end(JSON.stringify({ error: "Not found" }));
      } catch (err) {
        console.error("[InboxServer] Error:", err);
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    });

    return new Promise((resolve) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        console.log(`[InboxServer] Listening on http://${this.config.host}:${this.config.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          console.log("[InboxServer] Stopped");
          resolve();
        });
      });
    }
  }

  private async handleInbox(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    corsHeaders: Record<string, string>,
  ): Promise<void> {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    let data: {
      request: string;
      context?: string;
      priority?: "critical" | "high" | "normal" | "low";
      source?: "human" | "channel" | "scheduler" | "webhook" | "agent";
    };

    try {
      data = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    if (!data.request) {
      res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
      res.end(JSON.stringify({ error: "Missing request field" }));
      return;
    }

    const id = await this.skynet.addInboxItem(
      data.request,
      data.context || "",
      "webhook",
      data.priority || "normal",
      data.source || "webhook",
    );

    res.writeHead(201, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ id, status: "queued" }));
  }

  private async listInbox(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    corsHeaders: Record<string, string>,
  ): Promise<void> {
    const vault = this.skynet.getVault();
    const files = await vault.list("inbox", "\\.json$");

    const items: {
      id: string;
      request: string;
      priority: string;
      status: string;
      createdAt: number;
    }[] = [];
    for (const file of files) {
      const entry = await vault.read(`inbox/${file}`);
      if (entry) {
        const e = entry as unknown as {
          id: string;
          request?: string;
          priority?: string;
          status?: string;
          createdAt: number;
        };
        items.push({
          id: e.id,
          request: e.request || "",
          priority: e.priority || "normal",
          status: e.status || "pending",
          createdAt: e.createdAt,
        });
      }
    }

    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
    res.end(JSON.stringify({ items }));
  }
}

export function createInboxServer(skynet: Skynet, config: InboxServerConfig): InboxServer {
  return new InboxServer(skynet, config);
}
