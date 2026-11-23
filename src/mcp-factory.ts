import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const BASE = "https://open.sincera.io/api";

const INSTRUCTIONS = `OpenSincera (The Trade Desk), read-only: publisher ad-experience benchmarks measured by Sincera's synthetic crawl. Use it to benchmark a domain against the market or a competitor.

· Start with sincera_publisher (by domain). Its device_level_metrics carry percentiles against the whole ecosystem — that is the benchmark.
· avg_ads_to_content_ratio (A2CR) is a fraction (0.2 = 20%). avg_ad_refresh is seconds. avg_page_weight is MB. avg_cpu is seconds.
· A domain Sincera does not track returns "not tracked" — say so, do not substitute another domain.
· Always name OpenSincera as the source when you present these numbers, and never label other metrics as A2CR/Sincera metrics.
· Limits are 45 requests/min and 7000/day per account: do not loop over many domains; responses are cached for an hour.`;

// Sincera refreshes daily, so an hour of per-process caching costs nothing in
// freshness and saves the rate limit. Keyed by token so one caller never reads
// another's cache.
const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; data: unknown }>();

async function sincera(token: string, path: string, params: Record<string, string | number | undefined> = {}): Promise<unknown> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));

  const key = `${token} ${url.href}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 404 && !body.error) throw new Error("Not tracked by OpenSincera.");
    throw new Error(`OpenSincera ${res.status}: ${body.error ?? res.statusText}`);
  }
  cache.set(key, { at: Date.now(), data: body });
  return body;
}

const text = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });

/** Sincera wants the bare domain: no protocol, no path. */
const bareDomain = (d?: string) => d?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

const byName = (rows: unknown, field: string, filter?: string) =>
  filter && Array.isArray(rows)
    ? rows.filter((r) => String((r as Record<string, unknown>)[field] ?? "").toLowerCase().includes(filter.toLowerCase()))
    : rows;

const publisherRef = {
  domain: z.string().optional().describe("Bare domain, e.g. businessinsider.com"),
  id: z.number().int().optional().describe("Sincera publisher_id (wins over domain)"),
};
const filter = z.string().optional().describe("Case-insensitive substring match on name; omit for all");
const limit = z.number().int().min(1).optional().describe("Max rows (default 50)");
const readOnly = { readOnlyHint: true, openWorldHint: true };

/** `token` is the caller's OpenSincera API key (open.sincera.io → Profile → API Key). */
export function createSinceraMcpServer(token: string): McpServer {
  const get = (path: string, params?: Record<string, string | number | undefined>) => sincera(token, path, params);
  const server = new McpServer({ name: "opensincera-mcp", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "sincera_publisher",
    {
      description:
        "Benchmark one publisher: A2CR, ads in view, ad refresh, page weight, CPU, supply paths, reseller count, tech stack, plus mobile/desktop metrics with ecosystem percentiles. Give domain or id.",
      inputSchema: publisherRef,
      annotations: readOnly,
    },
    async ({ domain, id }) => text(await get("/publishers", { id, domain: id ? undefined : bareDomain(domain) })),
  );

  server.registerTool(
    "sincera_publisher_urls",
    {
      description:
        "Page-level metrics for up to 5 recently crawled URLs of a web publisher: A2CR, ads in view, refresh, ad overlap, per-scroll-depth viewport details.",
      inputSchema: publisherRef,
      annotations: readOnly,
    },
    async ({ domain, id }) => text(await get("/urls", { id, domain: id ? undefined : bareDomain(domain) })),
  );

  server.registerTool(
    "sincera_list_publishers",
    {
      description: "Paginated publisher directory (100 per page, ordered by publisher_id): id, name, domain, owner/manager domain, traffic rank.",
      inputSchema: { page: z.number().int().min(1).optional() },
      annotations: readOnly,
    },
    async ({ page }) => text(await get("/publishers", { page: page ?? 1 })),
  );

  server.registerTool(
    "sincera_ecosystem",
    {
      description:
        "Ecosystem-wide totals: publishers tracked, header wrapper adoption, Prebid major-version split, GPID and video.plcmt adoption, average user-ID modules deployed.",
      annotations: readOnly,
    },
    async () => text(await get("/ecosystem")),
  );

  server.registerTool(
    "sincera_technical_sales_houses",
    {
      description:
        "Benchmarks per technical sales house / managed-service provider: managed accounts, refresh, A2CR, ads in view, ad overlap and out-of-view render frequency, by device.",
      inputSchema: { filter },
      annotations: readOnly,
    },
    async ({ filter }) => {
      const data = (await get("/technical_sales_houses")) as { technical_sales_houses?: unknown };
      return text(byName(data.technical_sales_houses, "name", filter));
    },
  );

  server.registerTool(
    "sincera_prebid_modules",
    {
      description:
        "Prebid modules seen in the last 90 days with detected_count (adoption) and category (bid, id, rtd, analytics, formats), most adopted first.",
      inputSchema: { filter, category: z.enum(["bid", "formats", "analytics", "id", "rtd", "internal"]).optional(), limit },
      annotations: readOnly,
    },
    async ({ filter, category, limit }) => {
      type Module = { module_category: string | null; detected_count: number };
      const rows = (byName(await get("/mapping_modules"), "module_name", filter) as Module[])
        .filter((m) => !category || m.module_category === category)
        .sort((a, b) => b.detected_count - a.detected_count);
      return text({ total: rows.length, modules: rows.slice(0, limit ?? 50) });
    },
  );

  server.registerTool(
    "sincera_adsystems",
    {
      description: "Ad systems known to Sincera: id, name, canonical domain, description. Resolves adsystem_id from other tools.",
      inputSchema: { filter, limit },
      annotations: readOnly,
    },
    async ({ filter, limit }) => {
      // logo URLs are a third of the payload and useless to a model
      const rows = (byName(await get("/adsystems"), "name", filter) as Array<{ image?: unknown }>).map(({ image, ...r }) => r);
      return text({ total: rows.length, adsystems: rows.slice(0, limit ?? 50) });
    },
  );

  server.registerTool(
    "sincera_resolution_market_shares",
    {
      description: "Screen-resolution market share by device, in percent, for the latest month (history goes back to 2009; pass date for an older month).",
      inputSchema: {
        device: z.enum(["desktop", "mobile", "tablet"]).optional(),
        date: z.string().optional().describe("Month as YYYY-MM-01; default latest"),
      },
      annotations: readOnly,
    },
    async ({ device, date }) => {
      const rows = (await get("/resolution_market_shares")) as Array<{ date: string; device: string }>;
      const month = date ?? rows.reduce((max, r) => (r.date > max ? r.date : max), "");
      return text(rows.filter((r) => r.date === month && (!device || r.device === device)));
    },
  );

  server.registerTool(
    "sincera_bundle_mapping",
    {
      description: "Map app bundle IDs to publishers: look up by publisher domain/id or by bundle, or page through all (100 per page).",
      inputSchema: { ...publisherRef, bundle: z.string().optional(), page: z.number().int().min(1).optional() },
      annotations: readOnly,
    },
    async ({ domain, id, bundle, page }) =>
      text(await get("/bundle_mapping", { id, domain: id ? undefined : bareDomain(domain), bundle, page })),
  );

  return server;
}
