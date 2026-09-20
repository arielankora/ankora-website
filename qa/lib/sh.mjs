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

/** Is a URL reachable from wherever this is running? */
export async function reachable(url, timeoutMs = 8000) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, { method: "HEAD", signal: ctl.signal, redirect: "manual" });
    clearTimeout(t);
    return res.status > 0;
  } catch {
    return false;
  }
}
