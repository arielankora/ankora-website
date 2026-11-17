/* global chrome */
const $ = (id) => document.getElementById(id);

async function load() {
  const managed = await chrome.storage.managed.get(["endpoint", "secret"]).catch(() => ({}));
  const local = await chrome.storage.local.get(["endpoint", "secret", "lastRun"]);
  $("endpoint").value = local.endpoint || "";
  if (managed.secret) {
    $("secret").disabled = true;
    $("secret").placeholder = "מוגדר על ידי הארגון";
  }
  $("status").textContent = local.lastRun ? JSON.stringify(local.lastRun, null, 2) : "";
}

$("save").addEventListener("click", async () => {
  const values = { endpoint: $("endpoint").value.trim() };
  if (!$("secret").disabled && $("secret").value) values.secret = $("secret").value.trim();
  await chrome.storage.local.set(values);
  const result = await chrome.runtime.sendMessage({ type: "run-now" });
  $("status").textContent = JSON.stringify(result && result.lastRun, null, 2);
});

load();
