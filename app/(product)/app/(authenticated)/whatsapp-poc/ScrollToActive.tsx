"use client";
import { useEffect } from "react";

/// Brings the open contact's row into view in the list (Cowork's check,
/// 1.11.2026: a contact far down the list opened with the list at its top).
export function ScrollToActive() {
  useEffect(() => {
    document.querySelector('[data-inbox-row][aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, []);
  return null;
}
