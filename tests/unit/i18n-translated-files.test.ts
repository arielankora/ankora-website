import { describe, expect, it } from "vitest";
import { HEBREW, sourceStrings } from "../helpers/source-strings";

/**
 * ADR 0006. A screen counts as translated when every word it shows comes
 * from messages/*.json. This list is those screens, and the guard is that
 * none of them puts Hebrew on the screen from the code again.
 *
 * Without it, translation decays one pull request at a time: someone adds
 * a button to a translated screen, writes its label in Hebrew the way the
 * rest of the codebase still does, and an English reader finds it weeks
 * later. Comments are free to stay in any language; only text a person
 * can see is checked.
 *
 * Add a file here in the same pull request that translates it. Never
 * remove one to make the suite pass.
 */
const TRANSLATED_FILES = [
  "app/(product)/layout.tsx",
  "app/(product)/error.tsx",
  "app/(product)/app/not-found.tsx",
  "components/app/AppShell.tsx",
  "components/app/Sidebar.tsx",
  "components/app/TopBar.tsx",
  "components/app/BottomNav.tsx",
  "components/app/CommandPalette.tsx",
  "components/app/NotificationsBell.tsx",
  "components/app/LogoutButton.tsx",
  "components/app/LiveTimerPill.tsx",
  "components/app/BackLink.tsx",
  "components/app/HebrewOnly.tsx",
  "components/app/states/Offline.tsx",
  "components/app/toast/ToastProvider.tsx",
  "app/(product)/app/(authenticated)/profile/page.tsx",
  "app/(product)/app/(authenticated)/profile/NameForm.tsx",
  "app/(product)/app/(authenticated)/profile/TimezoneForm.tsx",
  "app/(product)/app/(authenticated)/profile/LanguageForm.tsx",
  "app/(product)/app/(authenticated)/profile/WhatsappForm.tsx",
  "app/(product)/app/(authenticated)/profile/ChangePasswordForm.tsx",
  "app/(product)/app/(authenticated)/profile/NotificationPreferenceForm.tsx",
];

describe("translated screens (ADR 0006)", () => {
  it.each(TRANSLATED_FILES)("%s shows no Hebrew written in the code", (file) => {
    const offenders = sourceStrings(file)
      .filter((s) => HEBREW.test(s.text))
      .map((s) => `${s.file}:${s.line}  ${JSON.stringify(s.text.trim())}`);
    expect(offenders, "Move these into messages/he.json and messages/en.json").toEqual([]);
  });
});
