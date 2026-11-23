import "server-only";
import { getTranslations } from "next-intl/server";
import type { VersionProblem } from "@/lib/agents/model";

/// ADR 0006: a version's or a client addition's checks in the reader's
/// language, by code. lib keeps the Hebrew `text` for the MCP answers; a
/// check the dictionary does not know keeps it on screen too.
export async function problemWords() {
  const t = await getTranslations("agents.versions.problems");
  return (p: VersionProblem) => {
    if (!t.has(p.code as "dash")) return p.text;
    const values = p.code === "undefinedParam" ? { placeholder: `{{${p.values?.key ?? ""}}}` } : p.values;
    return t(p.code as "dash", values as never);
  };
}
