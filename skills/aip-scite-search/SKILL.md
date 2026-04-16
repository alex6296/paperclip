---
name: aip-scite-search
description: >
  Thin CLI wrapper over the Scite search API — takes a keyword query and
  returns up to N matching papers with title, DOI, year, abstract, and
  citation-stance counts (supporting / contrasting / mentioning). Built for
  future agents to cite prior work when investigating a bug or writing a
  design. Not wired into any current agent prompt.
---

# aip-scite-search

Call `https://api.scite.ai/search` and print the JSON results. The skill is
**ready to use but intentionally not attached to any agent yet** — the
Scite key is meant for future research-oriented agents, not code-dev ones.

## Invocation

```bash
node skills/aip-scite-search/bin/scite-search.mjs --q "<query>" [options]
```

### Options

| Flag | Default | Notes |
|---|---|---|
| `--q <query>` | **required** | Free-text search |
| `--limit <n>` | `10` | Max results (Scite caps ≈ 100/page) |
| `--mode <mode>` | `papers` | Scite search mode; `papers` is the usual one |
| `--timeout-ms <n>` | `30000` | Hard HTTP timeout |

## Output

JSON to stdout:

```json
{
  "query": "kubernetes crashloopbackoff",
  "total": 17,
  "results": [
    {
      "doi": "10.1234/abcd",
      "title": "...",
      "year": 2024,
      "authors": ["Last, F.", "..."],
      "journal": "...",
      "abstract": "...",
      "tally": {
        "supporting": 4,
        "contrasting": 1,
        "mentioning": 37,
        "total": 42
      },
      "url": "https://scite.ai/reports/10.1234/abcd"
    }
  ]
}
```

If Scite's response shape changes, the raw hit is preserved under
`raw` on each result so the caller can still extract fields.

Exit code 0 on success (even zero results). Non-zero on HTTP error,
auth failure, or timeout — stderr carries the message.

## Auth

Scite requires a Bearer token. Set `SCITE_API_KEY` in the environment:

```bash
export SCITE_API_KEY=...
```

If the key is missing the tool exits 2 with a clear message; nothing else
calls Scite. The key is **not** a code-development key — treat it as a
research-tier credential.

## How to wire this into a future agent

When you hire a research / analyst agent (e.g. Architect variant, or a
future "Research" role), add `aip-scite-search` to its `desiredSkills` and
include in the agent's prompt:

> When you need prior-art, methodology references, or empirical claims,
> run `node skills/aip-scite-search/bin/scite-search.mjs --q "<query>"`
> and cite DOIs in your writeup.

Do **not** attach this to coding/testing/deploy agents — those don't need
it and burning a research key on tab completion is wasteful.

## Environment

| Var | Required | Notes |
|---|---|---|
| `SCITE_API_KEY` | yes | Scite Bearer token |
| `SCITE_API_URL` | no | Overrides default `https://api.scite.ai` |

## Source

Net-new; not lifted from the prototype.
