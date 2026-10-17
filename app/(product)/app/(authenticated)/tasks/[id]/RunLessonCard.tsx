"use client";
import { useState } from "react";
import { useToast } from "@/components/app/toast/ToastProvider";
import { LESSON_QUESTION, MAX_LESSON } from "@/lib/process-lessons";
import { recordRunLessonAction } from "./actions";

// Learning from runs (spec 5.4). On a run that just closed, one question
// about the procedure it followed. Whoever did the work is the one who
// knows; the answer goes to the process's owner, who decides whether it
// goes into the next version. "It held" is an answer too, and ends the
// question.

export function RunLessonCard({ taskId, processName }: { taskId: string; processName: string }) {
  const { showToast } = useToast();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);

  async function send(text: string | null) {
    if (pending) return;
    setPending(true);
    const result = await recordRunLessonAction({ taskId, body: text });
    setPending(false);
    if (!result.ok) {
      showToast({ tone: "error", title: "לא נשמר", description: result.error });
      return;
    }
    showToast({ tone: "success", title: text ? "ההערה נשלחה לבעלים של התהליך" : "נרשם שהנוהל היה נכון" });
  }

  return (
    <section className="rounded-2xl border border-gold/40 bg-gold/[0.04] p-5" data-testid="run-lesson">
      <h2 className="text-sm font-medium text-appNavy">{LESSON_QUESTION}</h2>
      <p className="mt-1 text-xs text-appNavy/60">הריצה הזו נפתחה מהנוהל של {processName}. מה שתכתבו מגיע לבעלים של התהליך, לגרסה הבאה של הנוהל.</p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={MAX_LESSON}
        rows={3}
        placeholder="למשל: שלב 2 צריך להתחיל יום עבודה קודם, כי איילה לא עונה בימי שישי."
        className="mt-3 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || !body.trim()}
          onClick={() => send(body)}
          className="rounded-full bg-gold-gradient px-5 py-2 text-sm font-medium text-navy disabled:opacity-50"
        >
          שליחה לבעלים
        </button>
        <button type="button" disabled={pending} onClick={() => send(null)} className="text-sm text-appNavy/60 hover:text-appNavy disabled:opacity-50">
          הנוהל היה נכון
        </button>
      </div>
    </section>
  );
}
