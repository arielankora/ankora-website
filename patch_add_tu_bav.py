#!/usr/bin/env python3
"""
Add Tu B'Av ("ט"ו באב" - the "love holiday") to the il_holidays catalog.

Ariel noticed it was missing from Grantor's list of 14 Israeli holidays
after subscribing + running the cron. Checked the catalog
(lib/app-domain/important-dates-holidays.ts): it's a real gap, not a
rendering bug - the il_holidays catalog only has 14 entries and Tu B'Av
was never one of them.

Verified via hebcal.com's own API (2026: 15 Av 5786 = 2026-07-29) that
the event's exact description is "Tu B'Av" (same apostrophe style as the
existing "Tish'a B'Av"/tisha_bav entry already in this catalog), so an
"exact" matcher is safe and consistent with the rest of the file.

No test changes needed: tests/unit/important-dates-holidays.test.ts
computes IL_CATALOG_SIZE dynamically from HOLIDAY_CATALOG.length, so it
auto-adjusts. No guide content.ts change needed either - the guide's
holiday-catalog note doesn't enumerate individual holidays or a count.

Run from the repo root (arielankora/ankora-website), on a fresh branch
off main (e.g. `git checkout -b fix/add-tu-bav`).
Idempotent: safe to re-run.
"""
import pathlib

ROOT = pathlib.Path(".")
PATH = ROOT / "lib/app-domain/important-dates-holidays.ts"

MARKER = 'key: "tu_bav"'

OLD = '  { key: "tisha_bav", labelHe: "תשעה באב", calendarKeys: ["il_holidays"], defaultReminderDaysBefore: [7], match: { type: "exact", value: "Tish\'a B\'Av" } },\n'

NEW = OLD + '  { key: "tu_bav", labelHe: "ט\\"ו באב (יום האהבה)", calendarKeys: ["il_holidays"], defaultReminderDaysBefore: [7], match: { type: "exact", value: "Tu B\'Av" } },\n'

text = PATH.read_text(encoding="utf-8")

if MARKER in text:
    print("Already applied: tu_bav entry already present. No changes written.")
else:
    count = text.count(OLD)
    if count != 1:
        raise SystemExit(
            f"ABORT: expected exactly 1 occurrence of the tisha_bav anchor line in {PATH}, found {count}.\n"
            f"No changes were written. Anchor was:\n{OLD!r}"
        )
    text = text.replace(OLD, NEW)
    PATH.write_text(text, encoding="utf-8")
    print(f"Patched: {PATH}")

print("\nDone.")
print("Next:")
print("  git diff")
print("  git add -A")
print('  git commit -m "fix: add missing Tu B\'Av (ט\\"ו באב) to il_holidays catalog"')
print("  git push -u origin fix/add-tu-bav")
print("\nThen open a PR (do not merge yet) - same review flow as every other change.")
