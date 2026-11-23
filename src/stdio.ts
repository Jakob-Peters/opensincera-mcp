#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSinceraMcpServer } from "./mcp-factory.js";

const token = process.env.SINCERA_API_TOKEN;
if (!token) {
  console.error("SINCERA_API_TOKEN is not set (open.sincera.io → Profile → API Key).");
  process.exit(1);
}
await createSinceraMcpServer(token).connect(new StdioServerTransport());
