/* global chrome */
// Ankora: Claude usage limits (17.11.2026, "דרך 3").
//
// Every 15 minutes, reads the share of the five-hour window and of the
// weekly limit that the signed-in Claude account has used, and sends the
// two percentages, their reset times and the account's email to Ankora.
// Nothing else is read or sent: no conversation, no prompt, no file.
//
// The numbers come from claude.ai's own usage endpoint, the one behind
// Settings > Usage. It is not a documented API and may change; when it
// does, readings stop and the "שימוש בקלוד" screen shows the person's last
// reading getting old.
//
// Configuration comes from a Chrome policy (chrome.storage.managed), set in
// the Google Workspace console under the extension's "Policy for
// extensions": {"secret": "...", "endpoint": "..."}. For a manual install,
// the options page stores the same two values locally.

const DEFAULT_ENDPOINT = "https://www.ankora.co.il/api/claude-limits";
const ALARM = "ankora-claude-limits";
const PERIOD_MINUTES = 15;
const VERSION = chrome.runtime.getManifest().version;

async function config() {
  const managed = await chrome.storage.managed.get(["endpoint", "secret"]).catch(() => ({}));
  const local = await chrome.storage.local.get(["endpoint", "secret"]);
  return {
    endpoint: managed.endpoint || local.endpoint || DEFAULT_ENDPOINT,
    secret: managed.secret || local.secret || "",
  };
}

async function claudeJson(path) {
  const res = await fetch(`https://claude.ai${path}`, { credentials: "include", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/// The organization whose limits to read: the one claude.ai last used,
/// else the first that answers the usage endpoint with numbers.
async function orgIds() {
  const ids = [];
  const cookie = await chrome.cookies.get({ url: "https://claude.ai", name: "lastActiveOrg" }).catch(() => null);
  if (cookie && cookie.value) ids.push(cookie.value);
  const orgs = await claudeJson("/api/organizations").catch(() => []);
  for (const o of Array.isArray(orgs) ? orgs : []) if (o && o.uuid && !ids.includes(o.uuid)) ids.push(o.uuid);
  return ids.slice(0, 5);
}

/// claude.ai reports utilization as a percentage. A fraction (0 to 1) from
/// an older shape is turned into one.
function percent(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v > 0 && v <= 1 && !Number.isInteger(v) ? Math.round(v * 1000) / 10 : v;
}

function window_(w) {
  if (!w || typeof w !== "object") return { pct: null, resetsAt: null };
  return { pct: percent(w.utilization), resetsAt: typeof w.resets_at === "string" || typeof w.resets_at === "number" ? w.resets_at : null };
}

async function readUsage() {
  for (const id of await orgIds()) {
    const usage = await claudeJson(`/api/organizations/${encodeURIComponent(id)}/usage`).catch(() => null);
    if (!usage) continue;
    const fiveHour = window_(usage.five_hour);
    const sevenDay = window_(usage.seven_day);
    if (fiveHour.pct !== null || sevenDay.pct !== null) return { fiveHour, sevenDay };
  }
  return null;
}

async function emails() {
  let claude = null;
  for (const path of ["/api/account", "/api/bootstrap"]) {
    const data = await claudeJson(path).catch(() => null);
    const e = data && (data.email_address || (data.account && data.account.email_address));
    if (typeof e === "string" && e.includes("@")) {
      claude = e;
      break;
    }
  }
  const profile = await chrome.identity.getProfileUserInfo({ accountStatus: "ANY" }).catch(() => ({}));
  return { claude, chrome: profile && profile.email ? profile.email : null };
}

async function report() {
  const { endpoint, secret } = await config();
  if (!secret) return { ok: false, reason: "not configured" };
  const usage = await readUsage();
  if (!usage) return { ok: false, reason: "no usage from claude.ai (signed out, or the endpoint changed)" };
  const who = await emails();
  const email = who.claude || who.chrome;
  if (!email) return { ok: false, reason: "no email" };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify({
      email,
      altEmail: who.claude && who.chrome && who.claude !== who.chrome ? who.chrome : undefined,
      fiveHour: usage.fiveHour,
      sevenDay: usage.sevenDay,
      observedAt: new Date().toISOString(),
      version: VERSION,
    }),
  });
  return { ok: res.ok, status: res.status };
}

async function run() {
  try {
    const result = await report();
    await chrome.storage.local.set({ lastRun: { at: new Date().toISOString(), ...result } });
  } catch (err) {
    await chrome.storage.local.set({ lastRun: { at: new Date().toISOString(), ok: false, reason: String(err && err.message) } });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES, delayInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES, delayInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) run();
});
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === "run-now") {
    run().then(() => chrome.storage.local.get("lastRun").then(reply));
    return true;
  }
  return false;
});
