"use client";
import { useState } from "react";

// The player, plus the one thing a bare <audio> does not do: say so when
// the recording did not load. Cowork's check of 1.11.2026 found a player
// stuck on 0:00 with nothing on the screen to explain it.
export function RecordingPlayer({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-1">
      <audio controls preload="none" className="w-full" src={src} onError={() => setFailed(true)} onPlay={() => setFailed(false)} />
      {failed ? (
        <p role="alert" className="text-sm text-app-error">
          ההקלטה לא נטענה. נסו שוב בעוד דקה.
        </p>
      ) : null}
    </div>
  );
}
