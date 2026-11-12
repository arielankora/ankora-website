"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";

// The player, plus what a bare <audio> does not show:
//   - that the recording is loading. Each play reads the file again from
//     the mailbox (Gmail's attachment ids do not last), which took about
//     6 seconds for a 10-minute call in Cowork's check of 1.11.2026, with
//     nothing on the screen in the meantime;
//   - that it did not load at all, instead of a player stuck on 0:00.
export function RecordingPlayer({ src }: { src: string }) {
  const t = useTranslations("comms.player");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  return (
    <div className="space-y-1">
      <audio
        controls
        preload="none"
        className="w-full"
        src={src}
        onPlay={() => setState((s) => (s === "ready" ? s : "loading"))}
        onWaiting={() => setState((s) => (s === "ready" ? s : "loading"))}
        onPlaying={() => setState("ready")}
        onCanPlay={() => setState((s) => (s === "loading" ? "ready" : s))}
        onError={() => setState("failed")}
      />
      {state === "loading" ? (
        <p role="status" className="text-sm text-app-text-secondary">
          {t("loading")}
        </p>
      ) : null}
      {state === "failed" ? (
        <p role="alert" className="text-sm text-app-error">
          {t("failed")}
        </p>
      ) : null}
    </div>
  );
}
