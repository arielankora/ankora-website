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
  "components/app/states/NotFound.tsx",
  "components/app/states/ServerError.tsx",
  "components/app/states/Skeleton.tsx",
  "components/app/Forbidden.tsx",
  "components/app/Drawer.tsx",
  "components/app/useActionForm.ts",
  "components/app/toast/ToastProvider.tsx",
  "app/(product)/app/(authenticated)/profile/page.tsx",
  "app/(product)/app/(authenticated)/profile/NameForm.tsx",
  "app/(product)/app/(authenticated)/profile/TimezoneForm.tsx",
  "app/(product)/app/(authenticated)/profile/LanguageForm.tsx",
  "app/(product)/app/(authenticated)/profile/WhatsappForm.tsx",
  "app/(product)/app/(authenticated)/profile/ChangePasswordForm.tsx",
  "app/(product)/app/(authenticated)/profile/NotificationPreferenceForm.tsx",
  "app/(product)/app/(authenticated)/profile/PasskeysCard.tsx",
  "app/(product)/app/(authenticated)/profile/actions.ts",
  "app/(product)/app/(authenticated)/mcp-actions.ts",
  "components/app/ClaudeConnectionCard.tsx",
  "components/app/ClaudeGrantList.tsx",
  "components/app/CopyValue.tsx",
  "components/app/AuthShell.tsx",
  "components/app/vault/webauthn-client.ts",
  "app/(product)/app/login/page.tsx",
  "app/(product)/app/login/LoginForm.tsx",
  "app/(product)/app/login/SecondFactorStep.tsx",
  "app/(product)/app/login/actions.ts",
  "app/(product)/app/forgot-password/page.tsx",
  "app/(product)/app/forgot-password/ForgotPasswordForm.tsx",
  "app/(product)/app/reset-password/page.tsx",
  "app/(product)/app/reset-password/ResetPasswordForm.tsx",
  "app/(product)/app/reset-password/actions.ts",
  "app/(product)/app/login-link/page.tsx",
  "app/(product)/app/login-link/LoginLinkConsumer.tsx",
  "app/(product)/app/login-link/actions.ts",
  "app/(product)/app/login-link/request/page.tsx",
  "app/(product)/app/login-link/request/RequestLinkForm.tsx",
  "app/(product)/app/oauth/consent/page.tsx",
  "app/api/step-up/route.ts",
  "app/api/step-up/passkey/options/route.ts",
  "app/api/step-up/passkey/verify/route.ts",
  "app/api/passkeys/register/options/route.ts",
  "app/api/passkeys/register/verify/route.ts",
  "app/(product)/app/(authenticated)/my-time/ClosedBankNotice.tsx",
  "app/(product)/app/(authenticated)/my-time/EntryRow.tsx",
  "app/(product)/app/(authenticated)/my-time/ManualEntryForm.tsx",
  "app/(product)/app/(authenticated)/my-time/ManualEntryParts.tsx",
  "app/(product)/app/(authenticated)/my-time/MyTimeView.tsx",
  "app/(product)/app/(authenticated)/my-time/actions.ts",
  "app/(product)/app/(authenticated)/my-time/entry-errors.ts",
  "app/(product)/app/(authenticated)/my-time/page.tsx",
  "app/(product)/app/(authenticated)/tasks/CreateTaskForm.tsx",
  "app/(product)/app/(authenticated)/tasks/TaskBoard.tsx",
  "app/(product)/app/(authenticated)/tasks/TaskFilters.tsx",
  "app/(product)/app/(authenticated)/tasks/TaskListProvider.tsx",
  "app/(product)/app/(authenticated)/tasks/TaskListView.tsx",
  "app/(product)/app/(authenticated)/tasks/TaskRow.tsx",
  "app/(product)/app/(authenticated)/tasks/TasksViewSwitch.tsx",
  "app/(product)/app/(authenticated)/tasks/[id]/AdvanceWithClaude.tsx",
  "app/(product)/app/(authenticated)/tasks/[id]/PortalNotesPanel.tsx",
  "app/(product)/app/(authenticated)/tasks/[id]/RunLessonCard.tsx",
  "app/(product)/app/(authenticated)/tasks/[id]/TaskDetail.tsx",
  "app/(product)/app/(authenticated)/tasks/[id]/TaskManualEntry.tsx",
  "app/(product)/app/(authenticated)/tasks/[id]/TaskPlanPanel.tsx",
  "app/(product)/app/(authenticated)/tasks/[id]/TaskSteps.tsx",
  "app/(product)/app/(authenticated)/tasks/[id]/TaskThread.tsx",
  "app/(product)/app/(authenticated)/tasks/[id]/TaskTimeSummary.tsx",
  "app/(product)/app/(authenticated)/tasks/[id]/VendorCheckCard.tsx",
  "app/(product)/app/(authenticated)/tasks/[id]/actions.ts",
  "app/(product)/app/(authenticated)/tasks/[id]/page.tsx",
  "app/(product)/app/(authenticated)/tasks/actions.ts",
  "app/(product)/app/(authenticated)/tasks/page.tsx",
  "app/(product)/app/(authenticated)/tasks/task-sort.ts",
  "app/(product)/app/(authenticated)/timer/TimerWidget.tsx",
  "app/(product)/app/(authenticated)/timer/actions.ts",
  "app/(product)/app/(authenticated)/timer/page.tsx",
  "components/app/MessageClient.tsx",
  // Not listed on purpose: tasks/[id]/TaskShare.tsx builds the Hebrew
  // message sent to a colleague (content, not interface); list-query.ts and
  // mine-scope.ts keep Hebrew fallbacks for the calendar, translated later.
  "app/(product)/app/(authenticated)/guide/page.tsx",
  "app/(product)/app/(authenticated)/guide/GuideBrowser.tsx",
  "app/(product)/app/(authenticated)/guide/search.ts",
  "app/(product)/app/(authenticated)/guide/content.en.ts",
  // guide/content.ts is the Hebrew guide itself; content.en.ts is its English twin
  // (tests/unit/guide-content-parity.test.ts keeps the two in step).
];

describe("translated screens (ADR 0006)", () => {
  it.each(TRANSLATED_FILES)("%s shows no Hebrew written in the code", (file) => {
    const offenders = sourceStrings(file)
      .filter((s) => HEBREW.test(s.text))
      .map((s) => `${s.file}:${s.line}  ${JSON.stringify(s.text.trim())}`);
    expect(offenders, "Move these into messages/he.json and messages/en.json").toEqual([]);
  });
});
