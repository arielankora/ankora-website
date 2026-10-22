"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { hashTargetId } from "@/lib/hash-target";

// A link to a place on a page, #item-<id>, lands on that place (Ariel,
// 22.10.2026: from "אישורים" a procedure opened the client's page at the
// top). The browser scrolls to the hash once, while it parses the page,
// but the screens under /app stream: loading.tsx's skeleton arrives first
// and the content a moment later, after the browser has already looked
// for the target and found nothing. Next's Link scrolls to a hash only
// when the target is there on arrival, which is the same race.
//
// So this waits for the target to appear, visible, then scrolls to it and
// marks it for a moment (:target does not apply to an element that did
// not exist when the address was read). It stops as soon as the person
// scrolls or types, and after a few seconds in any case.

const GIVE_UP_MS = 15_000;
const MARK_MS = 2_500;
const MARK = ["bg-app-accent-soft", "transition-colors"];

export function HashScroll() {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let giveUp: ReturnType<typeof setTimeout> | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;
    let moved = false;

    const stop = () => {
      observer?.disconnect();
      observer = null;
      if (giveUp) clearTimeout(giveUp);
    };
    const onPerson = () => {
      moved = true;
      stop();
    };

    const visible = (el: HTMLElement) => el.getClientRects().length > 0 && !el.closest("[hidden]");

    const land = (el: HTMLElement) => {
      el.scrollIntoView({ block: "start" });
      el.classList.add(...MARK);
      setTimeout(() => el.classList.remove(...MARK), MARK_MS);
      // Once more after the page settles: what loads above it may push it.
      settle = setTimeout(() => {
        if (!moved && visible(el)) el.scrollIntoView({ block: "start" });
      }, 400);
    };

    const run = () => {
      stop();
      moved = false;
      const id = hashTargetId(window.location.hash);
      if (!id) return;
      const find = () => {
        const el = document.getElementById(id);
        return el && visible(el) ? el : null;
      };
      const now = find();
      if (now) {
        land(now);
        return;
      }
      observer = new MutationObserver(() => {
        if (moved) return stop();
        const el = find();
        if (el) {
          stop();
          land(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style", "class"] });
      giveUp = setTimeout(stop, GIVE_UP_MS);
    };

    run();
    window.addEventListener("hashchange", run);
    window.addEventListener("wheel", onPerson, { passive: true });
    window.addEventListener("touchmove", onPerson, { passive: true });
    window.addEventListener("keydown", onPerson);
    return () => {
      stop();
      if (settle) clearTimeout(settle);
      window.removeEventListener("hashchange", run);
      window.removeEventListener("wheel", onPerson);
      window.removeEventListener("touchmove", onPerson);
      window.removeEventListener("keydown", onPerson);
    };
  }, [pathname, search]);

  return null;
}
