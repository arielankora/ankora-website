// Thin, honest shell wrapper. Never throws on a non-zero exit - the
// caller decides what a failure means, because "3 known-red tests" and
// "the type checker exploded" are the same exit code and very different
// news.

import { spawn } from "node:child_process";
import { ROOT } from "./discover.mjs";

export function sh(cmd, args, { cwd = ROOT, env = {}, timeoutMs = 20 * 60_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env, CI: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out, err, all: out + err });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 127, out, err: String(e), all: String(e) });
    });
  });
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
