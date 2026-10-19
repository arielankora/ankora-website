"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreClientAction } from "./actions";

/// Brings an archived or paused client back to active. Used on the
/// list's "בארכיון" section and on the screen of a client that is not
/// active.
export function RestoreClientButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function restore() {
    setError(null);
    startTransition(async () => {
      const result = await restoreClientAction(clientId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={restore}
        disabled={pending}
        className="rounded-full border border-app-border px-3.5 py-2 text-xs text-app-text-primary hover:border-gold disabled:opacity-50"
      >
        {pending ? "מחזיר..." : "החזרה לפעיל"}
      </button>
      {error && <span className="text-xs text-app-error">{error}</span>}
    </div>
  );
}
