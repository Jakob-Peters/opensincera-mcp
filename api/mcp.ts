import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createSinceraMcpServer } from "../src/mcp-factory.js";

/**
 * MCP over Streamable HTTP, STATELESS.
 *
 * Stateless (`sessionIdGenerator: undefined`) is mandatory on serverless: a
 * session created in one lambda during `initialize` cannot be recovered by the
 * next request, which lands on a different instance. A fresh server+transport
 * is therefore built per request.
 *
 * Auth is pass-through: the caller sends their own OpenSincera API key as the
 * bearer token and it is forwarded to Sincera. The deployment holds no secret,
 * so every caller spends their own rate limit. To serve a team from one key
 * instead, put your own auth in front and pass that key to the factory.
 *
 * Exported as `default` so Vercel invokes it Node-style with
 * (IncomingMessage, ServerResponse) — the shape the SDK transport requires.
 */

export const config = { maxDuration: 60 };

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<void> {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const [scheme, token] = (req.headers.authorization ?? "").split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    res.statusCode = 401;
    res.setHeader("WWW-Authenticate", 'Bearer realm="opensincera-mcp"');
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid_request", error_description: "Send your OpenSincera API key as a bearer token." }));
    return;
  }

  const server = createSinceraMcpServer(token);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[mcp] request failed", error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }));
    }
  }
}
