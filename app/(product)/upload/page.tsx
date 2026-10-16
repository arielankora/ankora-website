import type { Metadata } from "next";
import { UploadCodeForm } from "./UploadCodeForm";

export const metadata: Metadata = {
  title: "העלאת מסמך חתום | Ankora",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// The fixed page where a signed agreement PDF comes back (16.10.2026).
// The email carries this address and a short code as plain text. Unlike
// a link with a token in it, nothing secret is in the address, so it does
// not matter that the mail client rewrites it. Outside /app because the
// person may have no session; the strict headers come from
// next.config.mjs's /upload rule.
export default function UploadPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10 sm:px-6">
      <span className="font-assistant text-sm font-semibold tracking-[0.2em] text-gold-dim">ANKORA</span>
      <h1 className="mt-8 text-2xl font-medium text-appNavy">העלאת מסמך חתום</h1>
      <p className="mt-3 text-sm leading-7 text-appNavy/70">
        מקלידים את הקוד שקיבלת במייל, ואז מעלים את קובץ ה-PDF החתום. אפשר חתימה דיגיטלית, או הדפסה, חתימה וסריקה.
      </p>
      <div className="mt-8">
        <UploadCodeForm />
      </div>
      <p className="mt-4 text-xs text-appNavy/50">
        הקוד אישי ומיועד לשימוש אחד. הקובץ נשמר אצל אנקורה בלבד. בעיה בקוד? אפשר לפנות ל-ops@ankora.co.il.
      </p>
    </main>
  );
}
