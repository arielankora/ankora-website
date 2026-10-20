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
import { inShard } from "./shards.mjs";

export const SEVERITY = ["blocker", "major", "minor", "info"];

export function finding(severity, title, detail = "", meta = {}) {
  return { severity, title, detail, ...meta };
}

export class Run {
  /**
   * @param {number} level
   * @param {{shard?: string|null}} [opts] - when set, this process runs only
   *   the checks that belong to that shard (see lib/shards.mjs). A check
   *   belonging elsewhere is not recorded at all, rather than recorded as
   *   skipped: the merged report has to show each check exactly once, and a
   *   row saying "skipped - other shard" would be noise in every report and
   *   would make `incomplete` fire on a healthy run.
   */
  constructor(level, { shard = null } = {}) {
    this.level = level;
    this.shard = shard;
    this.startedAt = new Date();
    this.checks = [];
    /** Set only by fromShards: wall clock across parallel shards. */
    this.durationOverrideMs = null;
    this.shardTimings = null;
  }

  async check(id, { label, level, blocking = true, skipIf = null }, fn) {
    if (level > this.level) return;
    if (!inShard(id, this.shard, this.level)) return;
    const started = Date.now();
    const skip = skipIf ? await skipIf() : null;
    if (skip) {
      // `blocking` is recorded on a skip too, so `incomplete` below can
      // tell "the browser suite did not run" from "a not-yet-implemented
      // placeholder did not run".
      this.checks.push({ id, label, status: "skipped", blocking, reason: skip, ms: 0, findings: [] });
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

  /**
   * A skipped check is not a passed check.
   *
   * Learned the hard way: a CI run reported PASS while the integration
   * suite and the entire browser suite had quietly skipped themselves on
   * a preflight bug. Nothing was red, nothing was wrong, and nothing had
   * actually been tested. "PASS" on a run that did not open a browser at
   * a level defined by opening a browser is a lie of omission, and the
   * one thing this suite cannot afford is to be believed when it should
   * not be.
   *
   * So the verdict says INCOMPLETE whenever a blocking check at this
   * level did not run. It still exits zero - a missing database is not a
   * product regression and should not block a merge - but nobody reads
   * the word PASS and assumes more than happened.
   */
  get incomplete() {
    return this.checks.some((c) => c.blocking && c.status === "skipped");
  }

  get verdict() {
    if (this.failed) return "FAIL";
    if (this.incomplete) return "INCOMPLETE — some checks did not run";
    return this.warned ? "PASS WITH FINDINGS" : "PASS";
  }

  /**
   * Should this run exit non-zero?
   *
   * One rule, named once, because it used to live in two places and
   * disagree with itself: the verdict said INCOMPLETE and the exit code
   * said 0. The green tick is what people read, and it was wrong.
   */
  get shouldFail() {
    return this.failed || this.incomplete;
  }

  get warned() {
    return this.checks.some((c) => c.status === "warn");
  }

  get allFindings() {
    return this.checks.flatMap((c) => c.findings.map((f) => ({ ...f, check: c.id })));
  }

  summary() {
    const s = (st) => this.checks.filter((c) => c.status === st).length;
    return {
      level: this.level,
      startedAt: this.startedAt.toISOString(),
      durationMs: this.durationOverrideMs ?? Date.now() - this.startedAt.getTime(),
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
    const payload = { summary: this.summary(), checks: this.checks, shard: this.shard ?? null };

    // A shard is half a verdict. It writes its own file and nothing else:
    // `last.json` and `last.md` are what the PR comment and the agent read,
    // and a shard overwriting them would publish "PASS" for a quarter of a
    // run. qa/merge.mjs writes those once every shard has reported.
    if (this.shard) {
      const file = path.join(dir, `shard-${this.shard}.json`);
      fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n");
      // The shard's own table on its job page. The artefact host is
      // unreachable from the networks this project is operated from, so
      // without this the only readable thing about a shard is the scrolled
      // log - which is how run #508's three empty shards looked fine.
      this.appendToJobSummary(`### Shard: ${this.shard}\n\n${this.markdown()}`);
      return path.join("qa", "reports", `shard-${this.shard}.json`);
    }

    fs.writeFileSync(path.join(dir, "last.json"), JSON.stringify(payload, null, 2) + "\n");
    const md = this.markdown();
    fs.writeFileSync(path.join(dir, "last.md"), md);

    // On a CI runner, put the same report on the run's own summary page.
    // Without this the only copy is inside a zipped artifact, and the
    // artifact host is unreachable from the networks this project is
    // actually operated from - so the report existed and nobody could read
    // it. A dispatched run (no pull request to comment on) had no readable
    // output at all.
    this.appendToJobSummary(md);
    return path.join("qa", "reports", "last.json");
  }

  appendToJobSummary(md) {
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryFile) return;
    try {
      fs.appendFileSync(summaryFile, md + "\n");
    } catch (err) {
      process.stdout.write(`  (could not write the job summary: ${err?.message ?? err})\n`);
    }
  }

  /**
   * Rebuild one run out of the shard reports of a split level-3 run.
   *
   * The rendering, the verdict and the `incomplete` rule all live on this
   * class, so the merge must produce a Run rather than a second renderer -
   * a report written twice is a report that will disagree with itself, and
   * this suite has paid for that lesson more than once.
   *
   * @param {number} level
   * @param {Array<{summary:{startedAt:string,durationMs:number},checks:Array<object>,shard?:string|null}>} payloads
   */
  static fromShards(level, payloads) {
    const run = new Run(level);
    run.checks = payloads.flatMap((p) => p.checks ?? []);

    // Wall clock, not the sum. The shards ran at the same time, so adding
    // their durations would report the very number the split removed and
    // would make the headroom watchdog in checks/schedule.mjs cry wolf
    // about a wall nothing is near.
    const spans = payloads
      .map((p) => {
        const start = Date.parse(p.summary?.startedAt ?? "");
        const ms = Number(p.summary?.durationMs ?? 0);
        return Number.isFinite(start) ? { start, end: start + ms } : null;
      })
      .filter(Boolean);
    if (spans.length) {
      const start = Math.min(...spans.map((x) => x.start));
      run.startedAt = new Date(start);
      run.durationOverrideMs = Math.max(...spans.map((x) => x.end)) - start;
    }
    run.shardTimings = payloads.map((p) => ({
      shard: p.shard ?? "?",
      minutes: Number(p.summary?.durationMs ?? 0) / 60_000,
      checks: (p.checks ?? []).length,
    }));
    return run;
  }

  markdown() {
    const s = this.summary();
    const verdict = this.verdict;
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
      this.shardTimings
        ? `Ran as ${this.shardTimings.length} parallel shards: ${this.shardTimings
            .map((t) => `${t.shard} ${t.minutes.toFixed(1)} min`)
            .join(" · ")}. The minutes above are wall clock, not their sum.\n`
        : ``,
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
    const verdict = this.verdict;
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
