#!/usr/bin/env node
// Thin CLI wrapper over the Scite search API. Emits JSON to stdout. Built
// ready for a future research agent to use; not wired into any prompt yet.

const DEFAULT_BASE_URL = "https://api.scite.ai";

function parseArgs(argv) {
  const out = {
    q: null,
    limit: 10,
    mode: "papers",
    timeoutMs: 30_000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--q":
      case "--query": out.q = next(); break;
      case "--limit": out.limit = Number.parseInt(next(), 10); break;
      case "--mode": out.mode = next(); break;
      case "--timeout-ms": out.timeoutMs = Number.parseInt(next(), 10); break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown flag: ${a}`);
    }
  }
  if (!out.q) throw new Error("Missing --q <query>");
  if (!Number.isFinite(out.limit) || out.limit < 1) out.limit = 10;
  if (out.limit > 100) out.limit = 100;
  return out;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: scite-search.mjs --q \"<query>\" [options]",
      "",
      "  --q <query>         Free-text search (required)",
      "  --limit <n>         Max results (default 10, max 100)",
      "  --mode <mode>       Scite search mode (default 'papers')",
      "  --timeout-ms <n>    HTTP timeout (default 30000)",
      "",
    ].join("\n"),
  );
}

function shapeHit(hit) {
  // Scite's response shape varies across endpoints and over time. Pull the
  // common fields defensively and keep the raw hit attached so callers can
  // still dig if the schema shifts.
  const src = hit?._source ?? hit?.source ?? hit ?? {};
  const tally = src.tally ?? hit?.tally ?? {};
  const doi = src.doi ?? hit?.doi ?? null;
  return {
    doi,
    title: src.title ?? hit?.title ?? null,
    year: src.year ?? hit?.year ?? null,
    authors: src.authors ?? hit?.authors ?? [],
    journal: src.journal ?? hit?.journal ?? null,
    abstract: src.abstract ?? hit?.abstract ?? null,
    tally: {
      supporting: tally.supporting ?? 0,
      contrasting: tally.contrasting ?? 0,
      mentioning: tally.mentioning ?? 0,
      total: tally.total ?? 0,
    },
    url: doi ? `https://scite.ai/reports/${doi}` : null,
    raw: hit,
  };
}

async function main() {
  const apiKey = process.env.SCITE_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "SCITE_API_KEY not set. Export the Scite bearer token and retry.\n",
    );
    process.exit(2);
  }

  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }

  const base = (process.env.SCITE_API_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const url = new URL(`${base}/search`);
  url.searchParams.set("term", opts.q);
  url.searchParams.set("limit", String(opts.limit));
  url.searchParams.set("mode", opts.mode);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (err) {
    process.stderr.write(`scite request failed: ${err.message}\n`);
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    process.stderr.write(`scite ${res.status}: ${text.slice(0, 500)}\n`);
    process.exit(1);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    process.stderr.write(`scite returned non-JSON: ${text.slice(0, 200)}\n`);
    process.exit(1);
  }

  const hits = body?.hits ?? body?.results ?? body?.data ?? [];
  const total = body?.total ?? body?.count ?? hits.length;

  process.stdout.write(
    JSON.stringify({
      query: opts.q,
      total,
      results: Array.isArray(hits) ? hits.map(shapeHit) : [],
    }) + "\n",
  );
}

main().catch((err) => {
  process.stderr.write(`unexpected: ${err?.stack ?? err?.message ?? err}\n`);
  process.exit(1);
});
