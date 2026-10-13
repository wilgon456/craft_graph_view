<div align="center">

![Craft Graph View](docs/readme-banner.svg)

# Craft Graph View

Explore document links, tags and folders as an interactive 2D or 3D graph.

**English** · [한국어](README.ko.md)

![project: web app](https://img.shields.io/badge/project-web%20app-facc15?style=flat-square) ![stack: Next.js 16](https://img.shields.io/badge/stack-Next.js%2016-facc15?style=flat-square) [![License](https://img.shields.io/badge/license-MIT-facc15?style=flat-square)](LICENSE)

[Start locally](#start-locally) · [Data flow](#data-flow) · [Commands](#commands)

</div>

---

## Overview

A customized **Graft** document-graph application for Craft. This checkout uses a fixed Craft connection configured in [lib/craft-config.ts](lib/craft-config.ts); the connection UI does not ask for an API key.

![2D Craft document graph](public/graft-to-2d.png)

## Features

- Force-directed 2D and 3D graph views.
- Document previews, direct Craft links and graph statistics.
- Connections extracted from document links, tags and folders.
- Browser caching in IndexedDB and incremental refreshes based on modification timestamps.
- Tag-rename UI, research route and optional AI summarization in this customized checkout.

![3D Craft document graph](public/graft-to-3d.png)

## Start locally

Requires Bun, access to the configured Craft source and a browser with WebGL for the 3D view.

```bash
git clone https://github.com/wilgon456/craft_graph_view.git
cd craft_graph_view
bun install
bun dev
```

Open **http://localhost:3000**. The app uses its configured Craft source automatically. To use your own source, edit `lib/craft-config.ts`; a previously stored `craft_api_url` in `localStorage` can override the default.

The existing npm fallback is:

```bash
npm install --legacy-peer-deps
npm run dev
```

## Data flow

```text
Craft API <-> Next.js proxy <-> Browser graph + IndexedDB cache
```

The browser sends requests through `/api/craft/[...path]`. The Next.js server receives the request headers and Craft response before forwarding them. **Craft content therefore passes through the server**; it is not accurate to describe the app as browser-only data transport.

The graph and cache live in the browser, and this project has no application database. The proxy includes origin/path policy checks and in-memory per-IP rate limiting. It also has error logging; review the route implementation and your hosting logs before using sensitive documents.

## Connection and optional AI

| Area | Configuration / behavior |
| --- | --- |
| Craft source | Fixed default in `lib/craft-config.ts`, with browser-stored URL override |
| Proxy | GET plus restricted POST/PUT paths; DELETE is rejected |
| Summarization | Disabled unless `ENABLE_AI_SUMMARIZE=true`; uses `OPENROUTER_API_KEY` |
| Research | Uses the server's `OPENAI_API_KEY` and can write results back to Craft |
| Analytics | Vercel Analytics is included |

Enabling AI flows can send document content to external providers. Keep server API keys out of the repository, review write-capable flows before exposing a deployment, and do not assume that a public source checkout grants access to private Craft content.

## Commands

```bash
bun test
bun lint
bun build
bun start
```

## Project map

| Path | Purpose |
| --- | --- |
| `lib/graph/` | Parsing, fetching, caching and graph operations |
| `components/graph/` | 2D/3D views, controls and previews |
| `app/api/craft/` | Craft API proxy |
| `app/api/summarize/` | Optional AI summary endpoint |
| `app/api/research/` | Research and Craft write-back flow |
| `hooks/use-craft-graph.ts` | Client graph orchestration |
| `public/` | Screenshots, icons and demo graph |

Architecture notes are in [CLAUDE.md](CLAUDE.md), [graph library notes](lib/graph/CLAUDE.md) and [visualization notes](components/graph/CLAUDE.md).

## Hosting and credits

The repository includes `vercel.json` for Bun-based hosting. Configure your own Craft source and any optional server credentials before deployment. Screenshots originate from the Graft project and may differ from this customized interface.

Original Graft project: [graft.to](https://graft.to) and [1ar.io/tools/graft](https://1ar.io/tools/graft). [MIT license](LICENSE).
