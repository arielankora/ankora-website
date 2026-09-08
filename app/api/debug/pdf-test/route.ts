import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import bidiFactory from "bidi-js";
import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { toPdfTable } from "@/lib/pdf";

// TEMPORARY diagnostic route - docs/adr/0001 section 19.12 investigation.
// Not part of the product surface, not linked from any UI. Renders a set
// of isolated, labeled test cases so we can determine EMPIRICALLY (via
// pixel inspection of the actual Vercel-deployed output, not local
// sandbox) what pdfkit/fontkit actually do with Hebrew text on this
// runtime, since local sandbox testing during an earlier session reached
// a conclusion ("pdfkit auto-reorders RTL text") that live Preview QA
// then contradicted. Delete this route once 19.12 is resolved.

const bidi = bidiFactory();
const HEBREW_FONT = "Heebo-Hebrew";
const LATIN_FONT = "Heebo-Latin";

function registerFonts(doc: PDFKit.PDFDocument) {
  doc.registerFont(HEBREW_FONT, path.join(process.cwd(), "node_modules/@fontsource/heebo/files/heebo-hebrew-400-normal.woff"));
  doc.registerFont(LATIN_FONT, path.join(process.cwd(), "node_modules/@fontsource/heebo/files/heebo-latin-400-normal.woff"));
}

function reverseChars(s: string): string {
  return Array.from(s).reverse().join("");
}

export async function GET(req: Request) {
  try {
    await requireUserOrThrow();
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  const mode = new URL(req.url).searchParams.get("mode");

  if (mode === "table") {
    // J: the REAL production pipeline (toPdfTable -> drawCell -> bidi.getReorderedString
    // -> splitRuns -> sequential per-run doc.text() calls with manually tracked cursorX),
    // fed realistic mixed Hebrew+number+Latin report rows - this is what A-I do NOT
    // cover, since every A-I test draws exactly one font in one doc.text() call.
    const buf = await toPdfTable({
      title: "דוח שעות לפי לקוח",
      subtitle: "1 בינואר 2026 - 31 בינואר 2026",
      headers: ["לקוח", "שעות", "תאריך", "הערה"],
      rows: [
        ["יוסי כהן", 3.5, "12/25/2024", "פגישת ייעוץ"],
        ["Acme Corp", 7, "01/02/2026", "תמיכה טכנית 24/7"],
        ["לקוח גרנטור רכש", 111, "15/01/2026", "שעות לפי לקוח"],
      ],
    });
    return new Response(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=pdf-debug-table.pdf",
        "Cache-Control": "no-store",
      },
    });
  }

  const buf = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, font: false } as unknown as PDFKit.PDFDocumentOptions);
    registerFonts(doc);
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = 40;
    function label(text: string) {
      doc.font(LATIN_FONT).fontSize(9).fillColor("#888888").text(text, 40, y, { lineBreak: false });
      y += 14;
    }
    function drawLine(text: string, font: string = HEBREW_FONT) {
      doc.font(font).fontSize(14).fillColor("#000000").text(text, 40, y, { lineBreak: false });
      y += 26;
    }

    const single = "שלום"; // shalom - single word
    const phrase = "שעות לפי לקוח"; // 3-word Hebrew phrase, no digits
    const mixed = "לקוח גרנטור רכש 111 שעות"; // Hebrew + embedded number

    label("A: raw logical single word, one Hebrew-font call, no processing at all");
    drawLine(single);

    label("B: manually char-reversed single word, one Hebrew-font call");
    drawLine(reverseChars(single));

    label("C: raw logical 3-word phrase, ONE Hebrew-font call, no processing at all");
    drawLine(phrase);

    label("D: manually char-reversed (whole string) 3-word phrase, one Hebrew-font call");
    drawLine(reverseChars(phrase));

    label("E: bidi-js getReorderedString of the phrase, drawn as ONE Hebrew-font call");
    {
      const levels = bidi.getEmbeddingLevels(phrase);
      const visual = bidi.getReorderedString(phrase, levels);
      drawLine(visual);
    }

    label("F: each word of the phrase reversed individually, word ORDER also reversed, one call, space-joined");
    {
      const words = phrase.split(" ");
      const rebuilt = words.map(reverseChars).reverse().join(" ");
      drawLine(rebuilt);
    }

    label("G: each word reversed individually, ORIGINAL word order kept, one call");
    {
      const words = phrase.split(" ");
      const rebuilt = words.map(reverseChars).join(" ");
      drawLine(rebuilt);
    }

    label("H: mixed Hebrew+number, naive approach - reverse each Hebrew run, keep number normal, runs in reversed order");
    {
      // crude manual run split: Hebrew run / number run / Hebrew run
      // "לקוח גרנטור רכש" + " 111 " + "שעות"
      const heb1 = "לקוח גרנטור רכש";
      const num = "111";
      const heb2 = "שעות";
      // visual: rightmost = heb2, then num, then heb1 (reversed original order), each Hebrew run's words individually reversed+reordered
      const heb1Words = heb1.split(" ").map(reverseChars).reverse().join(" ");
      const heb2Rev = reverseChars(heb2);
      const rebuilt = `${heb2Rev} ${num} ${heb1Words}`;
      drawLine(rebuilt);
    }

    label("I: reference - plain Latin/digits only, sanity check (should always be correct)");
    drawLine("ABC 123 test", LATIN_FONT);

    doc.end();
  });

  return new Response(buf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=pdf-debug-test.pdf",
      "Cache-Control": "no-store",
    },
  });
}
