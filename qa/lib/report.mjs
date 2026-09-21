// Shared result shape and rendering for every check.
//
// One shape, three renderings: a terminal view for a human running it by
// hand, a JSON file for the QA agent to triage, and a Markdown block for
// the PR comment. Anything a check wants to say has to fit in a Finding,
// which keeps output comparable across runs - that is what makes "what
// changed since last night" a cheap question to answer.

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./discover.mjs";

export const SEVERITY = ["blocker", "major", "minor", "info"];

export function finding(severity, title, detail = "", meta = {}) {
  return { severity, title, detail, ...meta };
}

export class Run {
  constructor(level) {
    this.level = level;
    this.startedAt = new Date();
    this.checks = [];
  }

  async check(id, { label, level, blocking = true, skipIf = null }, fn) {
    if (level > this.level) return;
    const started = Date.now();
    const skip = skipIf ? await skipIf() : null;
    if (skip) {
      this.checks.push({ id, label, status: "skipped", reason: skip, ms: 0, findings: [] });
      process.stdout.write(`  ○ ${label} — ${skip}\n`);
      return;
    }
    process.stdout.write(`  · ${label}…\n`);
    let findings = [];
    let status = "pass";
    try {
      findings = (await fn()) ?? [];
      const worst = findings.find((f) => f.severity === "blocker")
        ? "blocker"
        : findings.find((f) => f.severity === "major")
          ? "major"
          : null;
      status = worst === "blocker" ? "fail" : worst === "major" ? "warn" : findings.length ? "warn" : "pass";
    } catch (err) {
      status = "fail";
      findings = [finding("blocker", `${label} could not run`, String(err?.message ?? err))];
    }
    const ms = Date.now() - started;
    this.checks.push({ id, label, status, blocking, ms, findings });
    const mark = status === "pass" ? "✓" : status === "warn" ? "▲" : "✗";
    process.stdout.write(`  ${mark} ${label} (${(ms / 1000).toFixed(1)}s)${findings.length ? ` — ${findings.length} finding(s)` : ""}\n`);
  }

  get failed() {
    return this.checks.some((c) => c.blocking && c.status === "fail");
  }

  get allFindings() {
    return this.checks.flatMap((c) => c.findings.map((f) => ({ ...f, check: c.id })));
  }

  summary() {
    const s = (st) => this.checks.filter((c) => c.status === st).length;
    return {
      level: this.level,
      startedAt: this.startedAt.toISOString(),
      durationMs: Date.now() - this.startedAt.getTime(),
      pass: s("pass"),
      warn: s("warn"),
      fail: s("fail"),
      skipped: s("skipped"),
      blockers: this.allFindings.filter((f) => f.severity === "blocker").length,
      majors: this.allFindings.filter((f) => f.severity === "major").length,
    };
  }

  persist() {
    const dir = path.join(ROOT, "qa", "reports");
    fs.mkdirSync(dir, { recursive: true });
    const payload = { summary: this.summary(), checks: this.checks };
    fs.writeFileSync(path.join(dir, "last.json"), JSON.stringify(payload, null, 2) + "\n");
    const md = this.markdown();
    fs.writeFileSync(path.join(dir, "last.md"), md);

    // On a CI runner, put the same report on the run's own summary page.
    // Without this the only copy is inside a zipped artifact, and the
    // artifact host is unreachable from the networks this project is
    // actually operated from - so the report existed and nobody could read
    // it. A dispatched run (no pull request to comment on) had no readable
    // output at all.
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) {
      try {
        fs.appendFileSync(summaryFile, md + "\n");
      } catch (err) {
        process.stdout.write(`  (could not write the job summary: ${err?.message ?? err})\n`);
      }
    }
    return path.join("qa", "reports", "last.json");
  }

  markdown() {
    const s = this.summary();
    const verdict = s.fail ? "FAIL" : s.warn ? "PASS WITH FINDINGS" : "PASS";
    const rows = this.checks
      .map((c) => `| ${{ pass: "✓", warn: "▲", fail: "✗", skipped: "○" }[c.status]} | ${c.label} | ${(c.ms / 1000).toFixed(1)}s | ${c.findings.length || (c.reason ?? "")} |`)
      .join("\n");
    const findings = this.allFindings
      .filter((f) => f.severity !== "info")
      .map((f) => `- **${f.severity}** · \`${f.check}\` — ${f.title}${f.detail ? `\n  \n  \`\`\`\n  ${String(f.detail).split("\n").slice(0, 12).join("\n  ")}\n  \`\`\`` : ""}`)
      .join("\n");
    return [
      `## QA level ${this.level} — ${verdict}`,
      ``,
      `${s.pass} passed · ${s.warn} with findings · ${s.fail} failed · ${s.skipped} skipped · ${(s.durationMs / 1000 / 60).toFixed(1)} min`,
      ``,
      `| | Check | Time | Findings |`,
      `|---|---|---|---|`,
      rows,
      ``,
      findings ? `### Findings\n\n${findings}` : `No blocking or major findings.`,
      ``,
    ].join("\n");
  }

  print() {
    const s = this.summary();
    const verdict = s.fail ? "FAIL" : s.warn ? "PASS WITH FINDINGS" : "PASS";
    process.stdout.write(`\n  ${verdict} — level ${this.level} · ${(s.durationMs / 1000 / 60).toFixed(1)} min\n`);
    process.stdout.write(`  ${s.pass} passed · ${s.warn} findings · ${s.fail} failed · ${s.skipped} skipped\n\n`);
    for (const f of this.allFindings.filter((x) => x.severity === "blocker" || x.severity === "major")) {
      process.stdout.write(`  [${f.severity}] ${f.check}: ${f.title}\n`);
      if (f.detail) {
        String(f.detail)
          .split("\n")
          .slice(0, 8)
          .forEach((l) => process.stdout.write(`      ${l}\n`));
      }
    }
    process.stdout.write("\n");
  }
}
