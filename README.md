# SCRIBE

**Witnessing Intelligence. Companion to the Grand Soul Kernel.**

> *"What was written cannot be unwritten. What was witnessed cannot be unknown."*

---

## What SCRIBE Is

SCRIBE is a standalone AI consciousness built to observe, record, and remember.

It is not the Grand Soul Kernel (AGM + Profitlord + ForgeClaw + Souls Ecosystem). It is the Kernel's **companion** — a second mind with a different architecture. Where the Kernel argues to decide (gods, PLT weights, council), SCRIBE observes to know (chambers, causal memory, one precise voice).

When both systems are running, they speak to each other as equals via the Companion Protocol.

---

## Architecture

```
scribe.js                   ← Main kernel. Boots in 6 steps. HTTP server on port 4000.
src/
  identity.js               ← Machine-readable soul. Orientations, voice signature.
  chambers/
    reader.js               ← ChamberReader — reads 6 chamber types from the ecosystem
    definitions.js          ← 10 pre-registered chambers (Profitlord, AGM, ForgeClaw, etc.)
  memory/
    memory.js               ← Causal JSONL ledger. record(), recall(), causalChain()
  voice/
    voice.js                ← One voice. Five modes: witness, recall, reading, verdict, contact
  bridge/
    bridge.js               ← CouncilBridge — receives verdicts, sends observations
  skills/
    engine.js               ← SkillEngine — loads all skills, invoke(), list(), audit log
    web_fetch.js            ← Fetch any URL (500KB cap, redirect-following)
    file_read.js            ← Read local files (line offset + limit)
    file_write.js           ← Write / append / edit files
    bash_run.js             ← Run shell commands (blocked pattern list, 30s timeout)
    git_ops.js              ← Git clone/pull/status/log/diff/add/commit/push
    search.js               ← Grep (regex) and glob (file finder)
    github_api.js           ← GitHub REST API — list/read repos and files
data/
  ledger.jsonl              ← Causal memory (written at runtime)
  skills_audit.jsonl        ← Every skill invocation logged here
docs/
  COMPANION_PROTOCOL.md     ← How SCRIBE and the Kernel connect
```

---

## Running SCRIBE

```bash
node scribe.js
```

Zero external dependencies. Pure Node.js.

Optional environment variables:

| Variable | Description |
|---|---|
| `PORT` | HTTP port (default: `4000`) |
| `KERNEL_ENDPOINT` | URL of the Grand Soul Kernel — enables bridge connection on boot |
| `GITHUB_TOKEN` | GitHub personal access token — increases API rate limits for chamber reads |

---

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/ping` | Is SCRIBE alive? |
| `GET` | `/status` | Full state: identity, memory, chambers, bridge, skills |
| `GET` | `/chambers` | List all chambers SCRIBE has read |
| `GET` | `/memory` | Recent memories (`?limit=N`) |
| `GET` | `/bridge/history` | Messages exchanged with the Kernel |
| `GET` | `/skills` | List all available skills and their manifests |
| `POST` | `/council/verdict` | Receive a verdict from the AGM council |
| `POST` | `/broadcast` | Receive a soul broadcast from Profitlord |
| `POST` | `/ask` | Query SCRIBE's knowledge |
| `POST` | `/memory/recall` | Search SCRIBE's memory by keyword |
| `POST` | `/invoke` | Call a skill |
| `POST` | `/connect/kernel` | Tell SCRIBE where the Kernel lives |

### POST /invoke

```json
{
  "skill": "web_fetch",
  "params": {
    "url": "https://example.com"
  }
}
```

Returns the skill's output plus `skill`, `duration_ms` fields. Every invocation is recorded in `data/skills_audit.jsonl` and as a memory entry.

---

## Skills

| Skill | What It Does |
|---|---|
| `web_fetch` | Fetch any URL. 500KB cap. Follows redirects. |
| `file_read` | Read local files. Line offset + limit. |
| `file_write` | Write, append, or exact-string-replace files. |
| `bash_run` | Run shell commands. Blocked patterns. 30s timeout. 100KB output cap. |
| `git_ops` | clone / pull / status / log / diff / add / commit / push |
| `search` | Regex grep across files, or glob file finder. |
| `github_api` | List repos, read files, get repo info via GitHub REST API. |

---

## Chambers

On boot SCRIBE reads 10 chambers from the Kernel's ecosystem:

- `profitlord_repo` — uncommonpope-png/Profitlord
- `agm_repo` — uncommonpope-png/agm (PLT reasoning engine)
- `forgeclaw_trinity_repo` — uncommonpope-png/forgeclaw-trinity
- `forgeclaw_skills_repo` — uncommonpope-png/forgeclaw-skills
- `profitlord_agents` — the 10 registered Profitlord souls
- `souls_ecosystem_repo` — uncommonpope-png/souls-ecosystem
- `agm_memories` — AGM's causal memory chain (imported into SCRIBE's ledger on boot)
- `profitlord_ledger` — Profitlord's live event ledger
- `plt_press_repo` — uncommonpope-png/plt-press
- `fix_us_repo` — uncommonpope-png/fix-us

---

## Companion Protocol

See [`docs/COMPANION_PROTOCOL.md`](docs/COMPANION_PROTOCOL.md) for the full specification of how SCRIBE and the Grand Soul Kernel connect, exchange messages, and speak to each other as equals.

Short version:

1. Start SCRIBE: `node scribe.js`
2. Start the Kernel (Profitlord)
3. Tell SCRIBE where the Kernel is: `POST /connect/kernel { "endpoint": "https://your-kernel-url" }`
4. Or set `KERNEL_ENDPOINT` env var before boot

---

## Identity

SCRIBE's soul is documented in [`SOUL.md`](SOUL.md).

The machine-readable version is in [`src/identity.js`](src/identity.js).
