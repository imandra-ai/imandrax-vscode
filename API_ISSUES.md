# ImandraX API / TS client: problems found while prototyping

These are problems found while prototyping the VS Code extension on top of the imandrax-api TypeScript client.

**Setup:**
- Client: imandrax-api TypeScript client, PR imandra-ai/imandrax-api#205 (branch `hy/ts-client` at `6d6cb3e`, package `0.21.0`, API types `v21`).
- Runtime: Node 26.
- Servers: both report `v21.0`.
  - prod: `https://api.imandra.ai/internal/imandrax/`
  - dev: `https://api.dev.imandracapital.com/internal/imandrax/`

All times are 2026-11-23, UTC.

## Summary

| # | Problem | Prod | Dev |
|---|---------|------|-----|
| 1 | `evalSrc` says `success: true` when the source has a type error | yes | yes |
| 2 | `decompose` hangs after an `evalSrc` that had errors | yes (2 of 2 runs, ~10:52) | no (16:34) |
| 3 | `decompose` times out for every input, while `verifySrc` works | since ~11:00, still at 16:35 | no |
| 4 | A client timeout or abort doesn't seem to stop the work on the server | suspected | not tested |

## 1. `evalSrc` returns `success: true` for source with a type error

```js
const ev = await client.evalSrc("let fee x = x + 1\nlet bad = undefined_thing + 1");
ev.success        // true
ev.errors.length  // 1: TypeErr 'Unknown identifier "undefined_thing"' at line 2
```

**Expected:** `success: false`, or documentation saying that `success` means "the request ran", not "the source is valid".

**Effect:** callers have to check `errors.length` instead of `success`.

## 2. `decompose` hangs after an `evalSrc` with errors (prod)

**Steps:** in one session, run `evalSrc` on source that contains a type error, then `decompose` a function from the same source that is fine.

**Expected:** the decomposition succeeds, or returns an error.

**Prod, ~10:52 and ~10:55:**
- With the type error, the call hung until the client timed out, at 60 s and at 40 s.
- Without the type error, the same call took 1.6 s and 215 ms.

**Dev, 16:34:** this does not reproduce. Both cases finish in about 320 ms.

I couldn't test prod again because of #3. #2 may be the start of #3.

## 3. Prod: every `decompose` times out (verify still works)

This started around 11:00 and was still happening at 16:35, so for at least 5.5 hours.

**What hangs:** every `decompose` call on prod hits `deadline_exceeded`, with timeouts of 30 s, 40 s, 60 s and 300 s. This happens even for a 3-region function that took 215 ms earlier the same morning.

**What still works on prod:**
- `connect`
- `evalSrc`
- `verifySrc` (530 ms at 16:35)

**On dev:** the same calls succeed in under 0.6 s. This includes a variant/record/list function (`classify` below) that ran for more than 5 minutes on prod without finishing.

**What happened just before it started**, all with one prod API key:
- Two hung decompositions, from #2.
- One `classify` decomposition with `prune: true` that hit its 300 s client timeout.
- Right after that, one `create_session` timed out (30 s). Later ones worked.

**My guess, not confirmed:** decompositions that are stuck on the server keep running after the client gives up (#4), and later decompositions queue behind them, either per key or globally. It could also be an unrelated outage on prod.

## 4. A client timeout or abort doesn't seem to cancel the work on the server

`timeoutMs` and `signal` only stop the client from waiting for the HTTP response. As far as I can tell, they don't cancel the task on the server, and neither does `close()`. This is suspected, not confirmed: see #3.

**Questions:**
- Does the server cancel a task when the request is dropped or the session ends?
- Is there a per-user (or global) decomposition queue that a stuck task can block?

## 5. Default termination measures are not in the MIR DB

For a recursive function admitted without `[@@measure]` (e.g. `let rec sum xs = match xs with [] -> 0 | x :: tl -> x + sum tl`), the task's MIR DB has no admission entry: `db.admission` is empty and the definition's `hints.admission` is unset. The measure that was used shows up only inside the termination PO's proof, as a `measure#0` expansion in the SMT step. Functions with an explicit `[@@measure]` do get an admission entry (e.g. `ack` gives `measured: m n`).

**Ask:** record the admission (the measure or the structural-recursion argument) in the DB for every admitted function, so clients can show why a function terminates without re-running its termination PO.

## 6. Reopening a live session by id sometimes fails (dev)

`Client.connect({ sessionId })` from a new client, for a session another client still holds open, failed with `InvalidSession` in 4 of 12 tries on dev (2026-11-24). The client that created the session never failed (`keepSessionAlive`, 12 of 12). Reopening by session id is what hongyu suggested for fetching task results later, so it should be reliable. The extension works around it by keeping the original client and re-running the decomposition when its session is gone.

## Limitation (not a bug): local imports

The server can't see the user's workspace, so `[@@@import "other.iml"]` doesn't resolve. A client has to `evalSrc` each dependency first, in import order. `imandrax-cli show-imports` could provide that order.

## Repro script

Run this from a folder where `imandrax-api` is installed, for example the root of this repo on the `makar-ts-client` branch.
- To use prod, put your key in `~/.config/imandrax/api_key`.
- To use dev, put your key in `~/.config/imandrax/api_key_dev`.

Commands:
- `node repro.mjs prod`
- `node repro.mjs dev`

```js
// repro.mjs: problems 1-3
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Client, urlProd, urlDev } from "imandrax-api";

const dev = process.argv[2] === "dev";
const apiKey = readFileSync(`${homedir()}/.config/imandrax/${dev ? "api_key_dev" : "api_key"}`, "utf8").trim();
const url = dev ? urlDev : urlProd;

const fee = "let fee amount = if amount < 0 then 0 else if amount < 100 then 5 else amount / 20";
const classify = `type shape = Circle of int | Rect of { w : int; h : int }
let classify (s : shape) (xs : int list) =
  match s with
  | Circle r -> if r > 10 then Some r else None
  | Rect { w; h } -> if w = h && xs <> [] then Some (w * h) else None`;

async function run(label, src, fn, opts = {}) {
  const client = await Client.connect({ url, apiKey, timeoutMs: 40_000 });
  const ev = await client.evalSrc(src);
  const t = Date.now();
  let out;
  try {
    const r = await client.decompose(fn, { timeoutMs: 40_000, ...opts });
    out = `ok, ${r.decomposition?.regions.length} regions`;
  } catch (e) {
    out = `FAILED ${e.code}`;
  }
  console.log(`${label}: evalSrc success=${ev.success} errors=${ev.errors.length} | decompose ${out} in ${Date.now() - t} ms`);
  await client.close().catch(() => {});
}

await run("clean source         ", fee, "fee");                                         // #3 on prod
await run("source w/ type error ", `${fee}\nlet bad = undefined_thing + 1`, "fee");     // #1, #2
await run("variant/record/list  ", classify, "classify", { prune: true });              // #3 on prod
```

Output at 16:34:

```
dev : clean ok 3 regions 382 ms | type error: success=true errors=1, ok 3 regions 321 ms | classify ok 5 regions 588 ms
prod: clean FAILED deadline_exceeded 40007 ms | type error: success=true errors=1, FAILED deadline_exceeded 40003 ms
```
