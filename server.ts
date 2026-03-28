/**
 * Standalone Z0tz Relayer Server
 * Run: npx tsx server.ts
 * No vercel CLI needed.
 */
import { createServer } from "node:http";
import { config } from "dotenv";
config();

// Import handlers
import relayHandler from "./api/relay.js";
import healthHandler from "./api/health.js";
import configHandler from "./api/config.js";
import bridgeHandler from "./api/bridge.js";

const PORT = Number(process.env.PORT ?? 3000);

const server = createServer(async (req, res) => {
  // Parse URL
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Collect body for POST requests
  let body = "";
  if (req.method === "POST") {
    for await (const chunk of req) {
      body += chunk;
    }
  }

  // Create mock Vercel request/response objects
  const mockReq: any = {
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: body ? JSON.parse(body) : undefined,
  };

  const mockRes: any = {
    _statusCode: 200,
    _headers: {} as Record<string, string>,
    _body: "",
    setHeader(key: string, value: string) {
      this._headers[key] = value;
      return this;
    },
    status(code: number) {
      this._statusCode = code;
      return this;
    },
    json(data: any) {
      this._body = JSON.stringify(data);
      res.writeHead(this._statusCode, {
        "Content-Type": "application/json",
        ...this._headers,
      });
      res.end(this._body);
      // Log response for relay/bridge
      if (path === "/relay" || path === "/bridge") {
        const icon = data.success ? "✅" : "❌";
        const txInfo = data.transactionHash ? ` tx=${data.transactionHash.slice(0, 18)}...` : "";
        const errInfo = data.error ? ` error=${data.error.slice(0, 80)}` : "";
        console.log(`  ${icon} ${this._statusCode}${txInfo}${errInfo}`);
      }
      return this;
    },
    end(data?: string) {
      res.writeHead(this._statusCode, this._headers);
      res.end(data ?? "");
      return this;
    },
    writeHead(code: number) {
      this._statusCode = code;
      return this;
    },
  };

  // Log incoming requests
  const timestamp = new Date().toISOString().slice(11, 19);
  if (path === "/relay") {
    const parsed = body ? JSON.parse(body) : {};
    console.log(`[${timestamp}] POST /relay chainId=${parsed.chainId} sender=${parsed.userOp?.sender?.slice(0, 14)}... initCode=${(parsed.userOp?.initCode?.length ?? 0) > 2 ? 'YES' : 'no'}`);
  } else if (path === "/bridge") {
    const parsed = body ? JSON.parse(body) : {};
    console.log(`[${timestamp}] POST /bridge src=${parsed.srcChainId} → dest=${parsed.destChainId}`);
  } else if (req.method === "GET") {
    console.log(`[${timestamp}] GET ${path}`);
  }

  try {
    switch (path) {
      case "/relay":
        await relayHandler(mockReq, mockRes);
        break;
      case "/health":
        await healthHandler(mockReq, mockRes);
        break;
      case "/config":
        await configHandler(mockReq, mockRes);
        break;
      case "/bridge":
        await bridgeHandler(mockReq, mockRes);
        break;
      default:
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
    }
  } catch (error) {
    console.error(`Error handling ${path}:`, error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
});

server.listen(PORT, () => {
  console.log(`Z0tz Relayer running on http://localhost:${PORT}`);
  console.log(`  POST /relay   — Submit UserOps`);
  console.log(`  POST /bridge  — Cross-chain relay`);
  console.log(`  GET  /health  — Status`);
  console.log(`  GET  /config  — Contract addresses`);
});
