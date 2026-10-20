// Thin, honest shell wrapper. Never throws on a non-zero exit - the
// caller decides what a failure means, because "3 known-red tests" and
// "the type checker exploded" are the same exit code and very different
// news.

import { spawn } from "node:child_process";
import { ROOT } from "./discover.mjs";

/**
 * Run a command, with a budget that is actually a budget.
 *
 * 20.10.2026: it was not one. `child.kill()` signals the direct child only,
 * and every expensive thing this suite runs is a wrapper around the real
 * work: `npx vitest`, `npx next build`, `npx tsc`. Killing npx left the work
 * running, holding the inherited pipes open, so `close` did not fire until
 * the work finished on its own. The budget killed a wrapper and then waited
 * for the thing it had failed to stop.
 *
 * Measured rather than reasoned about: a 2000ms budget on a parent whose
 * grandchild sleeps 6s returned after 6094ms, with the grandchild's output
 * in it. tests/unit/qa-sh-timeout.test.ts keeps that honest.
 *
 * What it cost, from run #514: integration ran 22.0 minutes against a
 * 15-minute budget, integration-utc 18.4 against the same 15, and coverage
 * about 26 against 25. Three checks over budget, three passes reported, and
 * nothing said a word. The only wall that ever applied was the job's.
 *
 * `detached` puts the child in its own process group so the negative pid
 * reaches the whole tree. `timedOut` is on the result because a killed run
 * and a failed run are the same exit code and very different news, which is
 * the rule this file opens with.
 */
export function sh(cmd, args, { cwd = ROOT, env = {}, timeoutMs = 20 * 60_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env, CI: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let out = "";
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        // Negative pid: the whole process group, which is what `detached`
        // above bought us. Falls back to the child alone if the group is
        // already gone.
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already dead */
        }
      }
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out, err, all: out + err, timedOut, timeoutMs });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 127, out, err: String(e), all: String(e), timedOut, timeoutMs });
    });
  });
}

/**
 * The finding for a run that was stopped rather than one that failed.
 *
 * Returns null when the run was not stopped, so a caller can write
 * `const t = timedOutFinding(r, "..."); if (t) return [t];` and not think
 * about it again.
 */
export function timedOutFinding(r, label) {
  if (!r?.timedOut) return null;
  const minutes = (r.timeoutMs / 60_000).toFixed(0);
  return {
    severity: "blocker",
    title: `${label} was stopped after ${minutes} minutes`,
    detail: [
      "It did not fail. It was killed for running past its budget, so whatever it",
      "would have reported is unknown and this run has no opinion about it.",
      "",
      "Raise the budget in the check if the suite has honestly grown, or find out",
      "what got slower. Do not read this as a pass.",
      "",
      tail(r.all, 20),
    ].join("\n"),
  };
}

/** Last N non-empty lines - what you actually want to read from a failure. */
export function tail(text, n = 25) {
  return text.split("\n").filter((l) => l.trim()).slice(-n).join("\n");
}

/**
 * Why a fetch failed, in words a person can act on.
 *
 * undici throws `TypeError: fetch failed` for every transport problem there
 * is - DNS, TLS, refused, timed out - and puts the actual reason in `cause`.
 * A check that reports only `err.message` therefore reports "fetch failed",
 * which is indistinguishable from "the site is down" and tells nobody what to
 * do next. This happened for real: a CI run reported "apex redirect could not
 * be checked: fetch failed" while the apex was serving its 308 perfectly well
 * to a browser, and there was no way to tell a DNS blip from an outage.
 */
export function failureCause(err) {
  const parts = [];
  for (let e = err; e; e = e.cause) {
    const bit = e.code ?? (e === err ? null : e.message);
    if (bit && !parts.includes(bit)) parts.push(bit);
    if (parts.length >= 3) break;
  }
  if (!parts.length) parts.push(err?.message ?? String(err));
  return parts.join(" <- ");
}

/**
 * GET a URL with a real timeout, and one retry on a TRANSPORT error.
 *
 * Retries only the transport, never a status: a 500 is news and must be
 * reported the first time, while a single DNS or connect blip on a CI runner
 * is not worth waking anyone for. Returns `{ res }` or `{ error }` with the
 * unwrapped cause.
 */
export async function fetchOnce(url, { timeoutMs = 15_000, retries = 1, ...init } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: "manual",
        headers: { "user-agent": "ankora-qa/1", ...(init.headers ?? {}) },
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { res, attempts: attempt + 1 };
    } catch (err) {
      last = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return { error: failureCause(last), attempts: retries + 1 };
}

/**
 * Is a URL reachable from wherever this is running, and if not, why?
 *
 * GET rather than HEAD: an edge or a framework can answer the two
 * differently, and what this is meant to predict is whether the probe's own
 * GETs will work. Returns null when reachable, otherwise the cause.
 */
export async function unreachableBecause(url, timeoutMs = 15_000) {
  const { res, error } = await fetchOnce(url, { timeoutMs });
  if (res) return null;
  return error;
}

/** Back-compat boolean form. */
export async function reachable(url, timeoutMs = 15_000) {
  return (await unreachableBecause(url, timeoutMs)) === null;
}
