# opensincera-mcp

An MCP server for the [OpenSincera](https://open.sincera.io) API. It gives Claude (or any MCP client) publisher ad-experience benchmarks: ads-to-content ratio, ads in view, ad refresh, page weight, supply paths and tech stack for any tracked domain, with percentiles against the whole ecosystem.

Read-only, nine tools, one source file. Not affiliated with Sincera or The Trade Desk.

## Setup

You need an OpenSincera API key: sign up at [open.sincera.io](https://open.sincera.io) with a work email, then copy it from Profile → API Key.

```sh
git clone https://github.com/Jakob-Peters/opensincera-mcp.git
cd opensincera-mcp
npm install
```

### Local (stdio)

Claude Code:

```sh
claude mcp add opensincera -e SINCERA_API_TOKEN=your-key -- npx tsx /path/to/opensincera-mcp/src/stdio.ts
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "opensincera": {
      "command": "npx",
      "args": ["tsx", "/path/to/opensincera-mcp/src/stdio.ts"],
      "env": { "SINCERA_API_TOKEN": "your-key" }
    }
  }
}
```

### Remote (Vercel)

`vercel deploy --prod` serves the same tools at `https://<your-deployment>/mcp` over stateless Streamable HTTP. The deployment holds no secret: each caller sends their own OpenSincera key as the bearer token and it is forwarded to Sincera.

```sh
claude mcp add --transport http opensincera https://<your-deployment>/mcp --header "Authorization: Bearer your-key"
```

To serve a team from one shared key behind your own login (OAuth), put your auth check in `api/mcp.ts` and pass the shared key to `createSinceraMcpServer`.

## Tools

| Tool | Arguments | Returns |
|---|---|---|
| `sincera_publisher` | `domain` or `id` | One publisher's benchmarks, with mobile/desktop metrics and ecosystem percentiles |
| `sincera_publisher_urls` | `domain` or `id` | Page-level metrics for up to 5 recently crawled URLs |
| `sincera_list_publishers` | `page` | Publisher directory, 100 per page |
| `sincera_ecosystem` | none | Ecosystem totals: wrapper adoption, Prebid version split, GPID adoption |
| `sincera_technical_sales_houses` | `filter` | Benchmarks per technical sales house |
| `sincera_prebid_modules` | `filter`, `category`, `limit` | Prebid modules by adoption, most adopted first |
| `sincera_adsystems` | `filter`, `limit` | Ad systems known to Sincera |
| `sincera_resolution_market_shares` | `device`, `date` | Screen-resolution market share for one month (default latest) |
| `sincera_bundle_mapping` | `domain`, `id`, `bundle` or `page` | App bundle IDs mapped to publishers |

Three raw responses are too large for a model context (resolution shares about 1 MB, ad systems about 320 KB, Prebid modules about 190 KB), so those tools filter and cap rows. Everything else is returned as Sincera sends it.

## API reference

Base URL `https://open.sincera.io/api`. Every endpoint is a `GET` with `Authorization: Bearer <key>`. The official reference is [OpenSincera queries](https://open.thetradedesk.com/seller/docsApp/GuidesSeller/opensincera/doc/OpenSinceraQueries).

| Endpoint | Parameters | Notes |
|---|---|---|
| `/publishers` | `id`, `domain` or `page` | `id` wins over `domain`; `page` lists 100 per page ordered by publisher ID |
| `/urls` | `id` or `domain` | Web publishers only; up to 5 pages updated in the last 90 days |
| `/ecosystem` | none | |
| `/technical_sales_houses` | none | Refreshed daily |
| `/mapping_modules` | none | Prebid modules detected in the last 90 days |
| `/adsystems` | none | |
| `/resolution_market_shares` | none | Monthly history back to 2009 |
| `/bundle_mapping` | `id`, `domain`, `bundle` or `page` | Publisher identifier wins over `bundle` |

Units in the publisher response:

| Field | Unit |
|---|---|
| `avg_ads_to_content_ratio` (A2CR) | Fraction of pixels given to ads; 0.2 = 20% |
| `avg_ads_in_view` | Ads per viewport |
| `avg_ad_refresh` | Seconds before an ad unit refreshes |
| `avg_page_weight` | MB |
| `avg_cpu` | Seconds |
| `traffic_rank` | 1 is the highest traffic; `null` if unranked |
| `device_level_metrics.*.percentile` | Percentile against the whole ecosystem |

Errors:

| Status | Body | Meaning |
|---|---|---|
| 401 | `{"error":"Unauthorized access"}` | Key missing or invalid |
| 401 | `{"error":"Must accept user agreement ..."}` | Accept the agreement at open.sincera.io first |
| 404 | `{}` | The domain, ID or bundle is not tracked |
| 404 | `{"error":"Not found"}` | No such endpoint |
| 429 | `{"error":"Rate limit exceeded"}` | Per-minute or daily limit hit |

Domain lookups take the bare domain (no protocol or path) and are case-insensitive. The server strips protocol, `www.` and path for you.

## Limits and terms

- **Rate limits:** 45 requests per rolling minute and 7,000 per rolling 24 hours per account. The server caches each response in memory for an hour.
- **One key per system:** Sincera permanently suspends accounts that use several keys on one system to get around the limits.
- **Attribution:** if you show this data anywhere, name OpenSincera as the source.
- **No passthrough:** do not republish the dataset one-to-one, and do not label your own metrics as Sincera metrics such as A2CR.

These are Sincera's rules, summarised from their [FAQ](https://open.thetradedesk.com/seller/docsApp/GuidesSeller/opensincera/doc/OpenSinceraFAQs); read it before building on the data.

## License

MIT
