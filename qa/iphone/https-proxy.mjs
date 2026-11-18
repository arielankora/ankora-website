#!/usr/bin/env node
// Local HTTPS front for `next start`, used by the iPhone audit only.
//
// Why: the app's CSP carries `upgrade-insecure-requests` (next.config.mjs),
// which is right on https production. Chromium exempts loopback from it,
// WebKit does not, so on http://127.0.0.1 WebKit rewrites every script,
// stylesheet and the sign-in POST to https and they all fail. Serving the
// same build over https locally makes the directive a no-op without
// touching a single response.
//
// The server behind it must know its public address is this https one:
// either no AUTH_URL at all (Auth.js follows the forwarded host), or
// AUTH_URL set to https://localhost:<port>. qa/checks/iphone.mjs does the
// latter, because CI sets AUTH_URL for the e2e suite.
//
// By hand: node qa/iphone/https-proxy.mjs [--port 3443] [--target 3100]
// A self-signed certificate is generated into a temp directory on start;
// the audit opens the browser with ignoreHTTPSErrors.

import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Starts the proxy; resolves to { port, close() }. Port 0 picks a free one. */
export function startHttpsProxy({ port = 0, target }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iphone-audit-tls-"));
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem"), "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"],
    { stdio: "ignore" },
  );
  const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
  let listening = 0;
  const server = https.createServer({ key: fs.readFileSync(path.join(dir, "key.pem")), cert: fs.readFileSync(path.join(dir, "cert.pem")) }, (req, res) => {
    const up = http.request(
      {
        host: "127.0.0.1",
        port: target,
        method: req.method,
        path: req.url,
        agent,
        headers: { ...req.headers, "x-forwarded-proto": "https", "x-forwarded-host": req.headers.host, "x-forwarded-port": String(listening) },
      },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.rawHeaders);
        upRes.pipe(res);
      },
    );
    up.on("error", (e) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end(`proxy error: ${e.message}`);
    });
    req.pipe(up);
  });
  server.keepAliveTimeout = 70_000;
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      listening = server.address().port;
      resolve({
        port: listening,
        close: () =>
          new Promise((r) => {
            agent.destroy();
            server.closeAllConnections?.();
            server.close(() => {
              fs.rmSync(dir, { recursive: true, force: true });
              r();
            });
          }),
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const arg = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
  const port = Number(arg("port", 3443));
  const target = Number(arg("target", 3100));
  startHttpsProxy({ port, target }).then(() => console.log(`https://localhost:${port} -> http://127.0.0.1:${target}`));
}
