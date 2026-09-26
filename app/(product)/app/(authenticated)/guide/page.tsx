import { requireUser } from "@/lib/app-auth/session";
import { GUIDE_GROUPS } from "./content";
import { GuideBrowser } from "./GuideBrowser";

export const metadata = { robots: { index: false, follow: false } };

export default async function GuidePage() {
  const user = await requireUser();

  return (
    <>
      <div className="space-y-10">
        <div>
          <h1 className="text-xl font-medium text-appNavy">מדריך שימוש</h1>
          <p className="mt-1 text-sm text-appNavy/60">
            הסבר מלא על כל יכולות המערכת - מה כל מסך עושה, מי יכול לגשת אליו, ואיך עובדים איתו.
          </p>
        </div>

        {/* App redesign (handoff README, screen 18): dark intro card matching
            the redesign's visual language elsewhere (e.g. AuthShell's dark
            column). The prototype's own version of this card has fabricated
            "three rules" copy (start a timer / write a note / stop it) that
            doesn't match how this guide actually works - the real guide
            below is a full reference organized by role and topic, not a
            three-step onboarding flow - so the text here describes the real
            thing instead of reproducing an invented pitch. */}
        <div className="rounded-2xl bg-navy p-6 text-cream-warm sm:p-8">
          <p className="text-base font-medium text-white">איך להשתמש במדריך הזה</p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-warm/70">
            תוכן העניינים למטה מקובץ לפי נושא, ובכל סעיף מופיע תג שמראה בדיוק אילו תפקידים רואים אותו - כך שהמדריך
            תמיד משקף את מה שאתם עצמכם יכולים לעשות במערכת, לא רשימת יכולות כללית. אפשר גם לקפוץ ישירות לסעיף
            רלוונטי דרך תוכן העניינים, או לחפש מילה בתיבת החיפוש, במקום לגלול על פני כל המדריך.
          </p>
        </div>

        <GuideBrowser groups={GUIDE_GROUPS} />
      </div>
    </>
  );
}
