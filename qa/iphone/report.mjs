#!/usr/bin/env node
// Turns qa/reports/iphone/results.json (written by qa/iphone/audit.mjs) into
// qa/reports/iphone/report.md and findings.json: findings merged across
// devices and roles, grouped by screen, screens ordered by severity.
//
// The report is in Hebrew and must not contain an em-dash or an en-dash.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const OUT = path.join("qa", "reports", "iphone");
const data = JSON.parse(fs.readFileSync(path.join(OUT, "results.json"), "utf8"));

const SEV = ["critical", "high", "medium", "low", "info"];
const SEV_HE = { critical: "קריטי", high: "גבוה", medium: "בינוני", low: "נמוך", info: "מידע" };
const SEV_ICON = { critical: "🔴", high: "🟠", medium: "🟡", low: "⚪", info: "▫️" };
const CHECK_HE = {
  "horizontal-overflow": "גלילה אופקית",
  "off-screen": "יוצא מהמסך",
  "cut-off": "נחתך",
  "tap-target": "מטרת מגע קטנה",
  "input-font": "גופן שדה מתחת ל-16",
  "safe-area": "אזור בטוח",
  rtl: "כיוון ויישור",
  "modal-height": "חלונית גבוהה מהמסך",
};
const DEV_SHORT = { "iPhone SE": "SE", "iPhone SE (3rd gen)": "SE 3", "iPhone 15": "15", "iPhone 15 Pro Max": "Pro Max" };
const ROLE_HE = { superadmin: "מנהל-על", admin: "מנהל", employee1: "עובדת", clientadmin: "מנהל לקוח", anon: "לא מחובר" };

const num = (s, re) => {
  const m = s.match(re);
  return m ? m.slice(1).map(Number) : null;
};

function heMessage(f) {
  const m = f.message;
  switch (f.check) {
    case "horizontal-overflow":
      return `העמוד רחב מהמסך ב-${f.value}px וגולל הצידה`;
    case "off-screen":
      return `הרכיב חורג ${f.value}px מעבר ל${/right/.test(m) ? "קצה הימני" : "קצה השמאלי"} של המסך`;
    case "cut-off":
      return f.severity === "low" ? `טקסט רחב מהתיבה שלו (${f.value}px) ונחתך בלי שלוש נקודות` : `${f.value}px מהרכיב מוסתרים על ידי מיכל שחותך גלישה`;
    case "tap-target": {
      const [w, h] = num(m, /(\d+)x(\d+)px/) ?? [0, 0];
      return `שטח מגע ${w}×${h}px, פחות מ-44×44`;
    }
    case "input-font":
      return `גופן ${f.value}px, ספארי באייפון מגדיל את העמוד כשנוגעים בשדה`;
    case "safe-area": {
      const bottom = /safe-area-inset-bottom/.test(m);
      const where = /sticky/.test(m) ? "דביק לראש העמוד" : /overlay/.test(m) ? (bottom ? "לוח תחתון בתוך שכבה על כל המסך" : "לוח עליון בתוך שכבה על כל המסך") : bottom ? "צמוד לתחתית המסך" : "צמוד לראש המסך";
      return `${where}, בלי ריווח לאזור הבטוח: ${bottom ? "פס הבית מכסה אותו" : "השעון, החריץ או האי הדינמי מכסים אותו"}`;
    }
    case "rtl":
      if (f.severity === "info") return `כיוון אוטומטי נקבע לשמאל לימין בגלל הקידומת [DEMO] של נתוני הדמו. כותרת אמיתית שמתחילה במילה לועזית תתהפך באותו אופן`;
      if (f.severity === "low") return `כיוון אוטומטי נקבע לשמאל לימין כי הטקסט מתחיל באות לועזית`;
      if (/aligned left/.test(m)) return `טקסט עברי מיושר לשמאל בעמוד מימין לשמאל`;
      if (/<html/.test(m)) return `שפת העמוד עברית אבל הכיוון אינו מימין לשמאל`;
      return `טקסט עברי מוצג משמאל לימין: סימני פיסוק ומספרים מתהפכים`;
    case "modal-height": {
      const [h, vh] = num(m, /panel (\d+)px tall in a (\d+)px/) ?? [0, 0];
      return /nothing scrolls/.test(m) ? `גובה ${h}px במסך של ${vh}px, ולא נגלל: החלק התחתון לא נגיש` : `גובה ${h}px במסך של ${vh}px, נגלל בתוכו`;
    }
    default:
      return m;
  }
}

const elDesc = (el) => {
  if (!el) return "העמוד כולו";
  const text = el.text ? ` "${el.text.replace(/\|/g, "/").slice(0, 40)}"` : "";
  return `\`<${el.tag}>\`${text}`;
};
const elKey = (el) => (el ? `${el.tag}|${el.text}|${el.cls}|${el.path.replace(/:nth-of-type\(\d+\)/g, "")}` : "page");

// ------------------------------------------------------------------
// Flatten every finding with its context.
// ------------------------------------------------------------------
const flat = [];
for (const v of data.visits) {
  for (const f of v.findings) flat.push({ ...f, route: v.route, device: v.device, role: v.role, modal: null, shot: v.shot });
  for (const m of v.modals) for (const f of m.findings) flat.push({ ...f, route: v.route, device: v.device, role: v.role, modal: m.trigger, shot: m.shot });
}

// Shared shell: the same element flagged on most opened screens.
const okRoutes = new Set(data.visits.filter((v) => v.outcome === "ok").map((v) => v.route));
const routesByKey = new Map();
for (const f of flat) {
  const k = `${f.check}|${f.severity}|${elKey(f.el)}|${f.modal ?? ""}`;
  if (!routesByKey.has(k)) routesByKey.set(k, new Set());
  routesByKey.get(k).add(f.route);
}
const sharedKeys = new Set([...routesByKey].filter(([k, rs]) => !k.startsWith("horizontal-overflow") && rs.size >= Math.max(5, okRoutes.size * 0.3)).map(([k]) => k));

// Merge per screen.
function merge(list, keyFn) {
  const map = new Map();
  for (const f of list) {
    const k = keyFn(f);
    let g = map.get(k);
    if (!g) {
      g = { ...f, devices: new Set(), roles: new Set(), routes: new Set(), shots: new Set(), maxValue: f.value ?? null };
      map.set(k, g);
    }
    g.devices.add(f.device);
    g.roles.add(f.role);
    g.routes.add(f.route);
    if (f.shot) g.shots.add(f.shot);
    if (SEV.indexOf(f.severity) < SEV.indexOf(g.severity)) Object.assign(g, { severity: f.severity, message: f.message, value: f.value });
    if (f.value != null && (g.maxValue == null || f.value > g.maxValue)) g.maxValue = f.value;
  }
  return [...map.values()].sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity) || (b.maxValue ?? 0) - (a.maxValue ?? 0));
}

const sharedFindings = merge(
  flat.filter((f) => sharedKeys.has(`${f.check}|${f.severity}|${elKey(f.el)}|${f.modal ?? ""}`)),
  (f) => `${f.check}|${f.severity}|${elKey(f.el)}|${f.modal ?? ""}`,
);
const screenFlat = flat.filter((f) => !sharedKeys.has(`${f.check}|${f.severity}|${elKey(f.el)}|${f.modal ?? ""}`));

const byRoute = new Map();
for (const f of screenFlat) {
  if (!byRoute.has(f.route)) byRoute.set(f.route, []);
  byRoute.get(f.route).push(f);
}
const allRoutes = [...new Set(data.visits.map((v) => v.route))];
const screens = allRoutes.map((route) => {
  const visits = data.visits.filter((v) => v.route === route);
  const findings = merge(byRoute.get(route) ?? [], (f) => `${f.check}|${elKey(f.el)}|${f.modal ?? ""}|${f.check === "horizontal-overflow" ? "" : ""}`);
  const worst = findings.length ? Math.min(...findings.map((f) => SEV.indexOf(f.severity))) : SEV.length;
  const score = findings.reduce((a, f) => a + [1000, 100, 10, 1, 0][SEV.indexOf(f.severity)], 0);
  return { route, visits, findings, worst, score };
});
const crashed = screens.filter((s) => s.visits.some((v) => v.outcome === "error-boundary" || v.outcome === "error" || /^http-5/.test(v.outcome)));
screens.sort((a, b) => a.worst - b.worst || b.score - a.score || a.route.localeCompare(b.route));

// ------------------------------------------------------------------
// Render.
// ------------------------------------------------------------------
const L = [];
const commit = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "?";
  }
})();
const opened = data.visits.filter((v) => v.outcome === "ok").length;
const allMerged = [...sharedFindings, ...screens.flatMap((s) => s.findings)];
const countBy = (sev, check) => allMerged.filter((f) => f.severity === sev && (!check || f.check === check)).length;

L.push(`# דוח תצוגה באייפון: מסכי המוצר`);
L.push("");
L.push(`נוצר ב-${data.generatedAt.slice(0, 16).replace("T", " ")} (UTC) מקומיט \`${commit}\`, מול בנייה מקומית (\`next start\`) עם נתוני הדמו.`);
L.push("");
L.push(`דפדפן: WebKit של Playwright. מכשירים: ${data.devices.join(", ")}. שפה: he-IL. תפקידים: ${data.roles.map((r) => ROLE_HE[r] ?? r).join(", ")}.`);
L.push("");
L.push(`ביקורים: ${data.visits.length}. נפתחו ונבדקו: ${opened}. הופנו למסך אחר: ${data.visits.filter((v) => v.outcome === "redirected").length}. אין הרשאה לתפקיד: ${data.visits.filter((v) => v.outcome === "forbidden").length}. קרסו או החזירו שגיאה: ${data.visits.filter((v) => !["ok", "redirected", "forbidden"].includes(v.outcome)).length}. משך: ${Math.round(data.seconds / 60)} דקות.`);
L.push("");
L.push(`## סיכום`);
L.push("");
L.push(`ממצא אחד בטבלה הוא רכיב אחד במסך אחד, אחרי איחוד של כל המכשירים והתפקידים שבהם הוא הופיע.`);
L.push("");
const checks = Object.keys(CHECK_HE);
L.push(`| בדיקה | ${SEV.map((s) => `${SEV_ICON[s]} ${SEV_HE[s]}`).join(" | ")} |`);
L.push(`|---|${SEV.map(() => "---:").join("|")}|`);
for (const c of checks) L.push(`| ${CHECK_HE[c]} | ${SEV.map((s) => countBy(s, c) || "").join(" | ")} |`);
L.push(`| **סך הכול** | ${SEV.map((s) => `**${countBy(s) || 0}**`).join(" | ")} |`);
L.push("");
if (crashed.length) {
  L.push(`**מסכים שקרסו** (מסך השגיאה "משהו השתבש" או שגיאת שרת): ${crashed.map((s) => `\`${s.route}\``).join(", ")}. פירוט בסעיף של כל מסך.`);
  L.push("");
}
const vpath = path.join(OUT, "verified.md");
if (fs.existsSync(vpath)) {
  L.push(fs.readFileSync(vpath, "utf8").trim());
  L.push("");
}
L.push(`## איך לקרוא את הדוח`);
L.push("");
L.push(`- המכשירים בטבלאות: SE הוא הפרופיל "iPhone SE" של Playwright, ברוחב 320 נקודות (הדור הראשון). SE 3 הוא הדור השלישי, ברוחב 375. 15 הוא iPhone 15 ברוחב 393. Pro Max הוא iPhone 15 Pro Max ברוחב 430.`);
L.push(`- צילומי מסך מלאים: בתיקייה \`shots/<מכשיר>/<תפקיד>/\`. בצילום עמוד מלא של WebKit, סרגל הניווט התחתון הקבוע מצויר במקום שבו היה במסך הראשון, באמצע העמוד. זו תופעה של כלי הצילום, לא של האפליקציה.`);
L.push(`- חלוניות: בכל מסך הסקריפט פותח את כפתור "עוד" בסרגל התחתון ועד ארבעה כפתורים שנראים כפותחי חלונית (לא כפתורי שמירה, מחיקה, שליחה או אישור). ממצא בתוך חלונית מסומן "בחלונית" עם שם הכפתור.`);
L.push(`- אזור בטוח: הבדיקה קוראת את גיליונות הסגנון ומחפשת \`env(safe-area-inset-*)\` על הרכיב הצמוד לקצה, על ילדיו ועל הוריו. הדפדפן באמולציה לא מדמה חריץ, ולכן אין דרך למדוד את החפיפה עצמה.`);
L.push(`- מטרת מגע: לפי 44×44 של אפל. קישור בתוך משפט פטור. מתחת ל-24 בצד אחד מסומן בינוני, השאר נמוך.`);
L.push(`- כיוון: ממצאי "מידע" נובעים מהקידומת [DEMO] בנתוני הדמו ולא נספרים כתקלה, אבל הם מראים איפה כותרת שמתחילה במילה לועזית תתהפך.`);
L.push(`- מה נדרש כדי להריץ: מדיניות האבטחה של האתר מורה לדפדפן לשדרג כל בקשה לחיבור מאובטח. בפרודקשן זה נכון, אבל WebKit מחיל את זה גם על שרת מקומי, ובלי חיבור מאובטח אף סקריפט לא נטען. לכן הסריקה עוברת דרך שרת מקומי קטן עם תעודה עצמית (\`qa/iphone/https-proxy.mjs\`), בלי לשנות שום תגובה של האפליקציה. בנוסף, בזריעה אין תהליך, ולכן הסקריפט יוצר תהליך דמו אחד כדי לפתוח את מסכי התהליך. מסכי החתימה וההעלאה בקישור נפתחו עם קישור לא תקף, כי הקישורים נשמרים מוצפנים.`);
L.push("");

const fmtSet = (s, map) => [...s].map((x) => map[x] ?? x).join(", ");
const row = (f, withRoutes = false) => {
  const where = f.modal ? `בחלונית "${f.modal}": ` : "";
  const routes = withRoutes ? ` | ${f.routes.size}` : "";
  return `| ${SEV_ICON[f.severity]} ${SEV_HE[f.severity]} | ${CHECK_HE[f.check]} | ${where}${elDesc(f.el)} | ${heMessage(f)} | ${fmtSet(f.devices, DEV_SHORT)} | ${fmtSet(f.roles, ROLE_HE)}${routes} |`;
};

if (sharedFindings.length) {
  L.push(`## רכיבים משותפים (מופיעים ב-30% מהמסכים או יותר)`);
  L.push("");
  L.push(`אלה רכיבי המעטפת: הכותרת, הסרגל התחתון, החיפוש. תיקון אחד שלהם מוריד את הממצא מכל המסכים, ולכן הם לא חוזרים בסעיפי המסכים.`);
  L.push("");
  L.push(`| חומרה | בדיקה | רכיב | פרטים | מכשירים | תפקידים | מסכים |`);
  L.push(`|---|---|---|---|---|---|---:|`);
  for (const f of sharedFindings.filter((f) => f.severity !== "info")) L.push(row(f, true));
  L.push("");
}

// Pro Max: the device Ariel uses. Everything seen on it, worst first, shared shell included.
{
  const PM = "iPhone 15 Pro Max";
  const pm = [...sharedFindings, ...screens.flatMap((s) => s.findings)].filter((f) => f.devices.has(PM) && f.severity !== "info" && f.severity !== "low");
  const pmCrash = data.visits.filter((v) => v.device === PM && !["ok", "redirected", "forbidden"].includes(v.outcome));
  L.push(`## iPhone 15 Pro Max: מה שנמצא במכשיר של אריאל`);
  L.push("");
  L.push(`כל ממצא בחומרה בינונית ומעלה שהופיע ב-Pro Max, מהחמור לקל. ממצאים נמוכים מופיעים בסעיפי המסכים. ${pmCrash.length ? `קריסות או שגיאות ב-Pro Max: ${[...new Set(pmCrash.map((v) => `\`${v.route}\``))].join(", ")}.` : ""}`);
  L.push("");
  if (pm.length) {
    L.push(`| חומרה | בדיקה | מסך | רכיב | פרטים | תפקידים |`);
    L.push(`|---|---|---|---|---|---|`);
    pm.sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity));
    // Many fields or taps on one screen read better as one row per screen.
    const collapsed = [];
    const groups = new Map();
    for (const f of pm) {
      if ((f.check === "input-font" || f.check === "tap-target") && f.routes.size === 1) {
        const k = `${f.check}|${[...f.routes][0]}|${f.modal ?? ""}`;
        if (!groups.has(k)) {
          const g = { ...f, n: 0, roles: new Set(), minV: Infinity };
          groups.set(k, g);
          collapsed.push(g);
        }
        const g = groups.get(k);
        g.n++;
        f.roles.forEach((r) => g.roles.add(r));
        if (f.value != null) g.minV = Math.min(g.minV, f.value);
      } else collapsed.push(f);
    }
    for (const f of collapsed) {
      if (f.n > 1) {
        const where = f.modal ? `בחלונית "${f.modal}": ` : "";
        const what = f.check === "input-font" ? `${f.n} שדות בגופן קטן מ-16px (הקטן ביותר ${f.minV}px), ספארי מגדיל את העמוד בכל נגיעה בשדה` : `${f.n} רכיבים קטנים מ-44×44 (הקטן ביותר ${f.minV}px)`;
        L.push(`| ${SEV_ICON[f.severity]} ${SEV_HE[f.severity]} | ${CHECK_HE[f.check]} | \`${[...f.routes][0]}\` | ${where}כמה רכיבים | ${what} | ${fmtSet(f.roles, ROLE_HE)} |`);
        continue;
      }
      const where = f.modal ? `בחלונית "${f.modal}": ` : "";
      const scr = f.routes.size > 1 ? `${f.routes.size} מסכים (משותף)` : `\`${[...f.routes][0]}\``;
      L.push(`| ${SEV_ICON[f.severity]} ${SEV_HE[f.severity]} | ${CHECK_HE[f.check]} | ${scr} | ${where}${elDesc(f.el)} | ${heMessage(f)} | ${fmtSet(f.roles, ROLE_HE)} |`);
    }
    L.push("");
  }
}

L.push(`## לפי מסך, מהחמור לקל`);
L.push("");
for (const s of screens) {
  const sev = s.worst < SEV.length ? `${SEV_ICON[SEV[s.worst]]} ${SEV_HE[SEV[s.worst]]}` : "✅ נקי";
  L.push(`### \`${s.route}\``);
  L.push("");
  const counts = SEV.map((x) => [x, s.findings.filter((f) => f.severity === x).length]).filter(([x, n]) => n && x !== "info");
  L.push(`חומרה עליונה: ${sev}. ${counts.length ? counts.map(([x, n]) => `${SEV_HE[x]}: ${n}`).join(", ") + "." : "אין ממצאים מעבר לרכיבים המשותפים."}`);
  L.push("");
  // Status per role.
  const status = {};
  for (const v of s.visits) {
    const k = v.outcome === "forbidden" ? "אין הרשאה" : v.outcome === "redirected" ? `הופנה ל-\`${new URL(v.finalUrl).pathname}\`` : v.outcome === "ok" ? "נפתח" : v.outcome === "error-boundary" ? "**קרס: מסך \"משהו השתבש\"**" : `**${v.outcome}${v.error ? `: ${v.error.slice(0, 80)}` : ""}**`;
    (status[v.role] ??= new Set()).add(k);
  }
  L.push(`מצב: ${Object.entries(status).map(([r, ks]) => `${ROLE_HE[r] ?? r}: ${[...ks].join(" / ")}`).join(". ")}.`);
  L.push("");
  const shots = s.visits.filter((v) => v.shot);
  if (shots.length) {
    const byRole = {};
    for (const v of shots) (byRole[v.role] ??= []).push(`[${DEV_SHORT[v.device]}](${encodeURI(v.shot)})`);
    L.push(`צילומים: ${Object.entries(byRole).map(([r, l]) => `${ROLE_HE[r] ?? r}: ${l.join(" ")}`).join(". ")}.`);
    L.push("");
  }
  const errs = [...new Set(s.visits.flatMap((v) => v.pageErrors))];
  if (errs.length) {
    L.push(`שגיאות JavaScript בעמוד: ${errs.slice(0, 3).map((e) => `\`${e.replace(/`/g, "'")}\``).join("; ")}.`);
    L.push("");
  }
  const shown = s.findings.filter((f) => f.severity !== "info");
  const info = s.findings.length - shown.length;
  if (shown.length) {
    L.push(`| חומרה | בדיקה | רכיב | פרטים | מכשירים | תפקידים |`);
    L.push(`|---|---|---|---|---|---|`);
    const MAXLOW = 15;
    const lows = shown.filter((f) => f.severity === "low");
    for (const f of shown.filter((f) => f.severity !== "low")) L.push(row(f));
    for (const f of lows.slice(0, MAXLOW)) L.push(row(f));
    if (lows.length > MAXLOW) L.push(`| ⚪ נמוך | | ועוד ${lows.length - MAXLOW} ממצאים נמוכים | ב-\`findings.json\` | | |`);
    L.push("");
  }
  if (info) {
    L.push(`ועוד ${info} ממצאי מידע (כיוון אוטומטי בגלל הקידומת [DEMO]).`);
    L.push("");
  }
}

const md = L.join("\n");
if (/[\u2013\u2014]/.test(md)) throw new Error("report contains an em-dash or en-dash");
fs.writeFileSync(path.join(OUT, "report.md"), md);
fs.writeFileSync(
  path.join(OUT, "findings.json"),
  JSON.stringify(
    {
      shared: sharedFindings.map((f) => ({ ...f, devices: [...f.devices], roles: [...f.roles], routes: [...f.routes], shots: [...f.shots] })),
      screens: screens.map((s) => ({ route: s.route, outcomes: s.visits.map((v) => ({ role: v.role, device: v.device, outcome: v.outcome, finalUrl: v.finalUrl })), findings: s.findings.map((f) => ({ ...f, devices: [...f.devices], roles: [...f.roles], routes: [...f.routes], shots: [...f.shots] })) })),
    },
    null,
    1,
  ),
);
console.log(`[iphone] report.md: ${screens.length} screens, ${allMerged.length} merged findings`);
