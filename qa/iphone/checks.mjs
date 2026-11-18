// In-page layout checks for the iPhone audit (qa/iphone/audit.mjs).
//
// `pageChecks` is serialised by Playwright and runs inside the page, so it
// must not close over anything from this module. It returns plain findings:
// { check, severity, message, el } where `el` describes the element well
// enough to find it again (tag, classes, text, a short CSS path).

export function pageChecks() {
  // The layout width, not innerWidth. In Chromium's phone emulation a page wider than the device
  // grows the layout viewport to fit it, innerWidth follows (333 on a 320 iPhone SE, CI 18.11.2026),
  // and the sideways scroll then compares equal to the "screen" and goes unreported, while the bottom
  // bar is pushed off. clientWidth stays the device width in both engines.
  const vw = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
  const vh = window.innerHeight;
  const TOL = 1;
  const out = [];
  const HEB = /[֐-׿]/g;
  const LAT = /[A-Za-z]/g;

  const isVisible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    // Inside a closed <details>: Chromium still lays the content out (content-visibility), so it has
    // a box, but nobody sees it. A filter chip there read as cut off (18.11.2026).
    if (el.closest("details:not([open]) > :not(summary)")) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    // sr-only and similar visually hidden helpers
    if (r.width <= 1 && r.height <= 1) return false;
    if (cs.clip === "rect(0px, 0px, 0px, 0px)" || cs.clipPath === "inset(50%)") return false;
    return true;
  };
  const ownText = (el) =>
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  const label = (el) => {
    const t = (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("placeholder") || el.getAttribute("title") || "")
      .replace(/\s+/g, " ")
      .trim();
    return t.slice(0, 50);
  };
  const cssPath = (el) => {
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && parts.length < 5 && n !== document.body) {
      let s = n.tagName.toLowerCase();
      if (n.id) {
        parts.unshift(`${s}#${n.id}`);
        break;
      }
      const role = n.getAttribute("role");
      if (role) s += `[role=${role}]`;
      const parent = n.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === n.tagName);
        if (same.length > 1) s += `:nth-of-type(${same.indexOf(n) + 1})`;
      }
      parts.unshift(s);
      n = n.parentElement;
    }
    return parts.join(" > ");
  };
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === "string" ? el.className : el.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 8).join(" "),
      text: label(el),
      path: cssPath(el),
      rect: { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) },
    };
  };
  const add = (check, severity, message, el, extra = {}) => out.push({ check, severity, message, el: el ? describe(el) : null, ...extra });

  const all = Array.from(document.body.querySelectorAll("*")).filter(
    (el) => !["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META", "BR"].includes(el.tagName),
  );
  const visible = all.filter(isVisible);
  const visibleSet = new Set(visible);

  // ---------------------------------------------------------------
  // 1. Horizontal overflow of the page itself.
  // ---------------------------------------------------------------
  const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (sw > vw + TOL) {
    add("horizontal-overflow", "critical", `scrollWidth ${sw}px > innerWidth ${vw}px (page scrolls sideways by ${sw - vw}px)`, null, { value: sw - vw });
  }

  // ---------------------------------------------------------------
  // 2. Elements cut off or off-screen (horizontally).
  // ---------------------------------------------------------------
  const inFixedLayer = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).position === "fixed") return true;
    }
    return false;
  };
  const leafish = visible.filter((el) => {
    if (["IMG", "SVG", "INPUT", "SELECT", "TEXTAREA", "BUTTON", "A", "VIDEO", "CANVAS"].includes(el.tagName.toUpperCase())) return true;
    return ownText(el).length > 0;
  });
  let widestCache = null;
  const widest = () => {
    if (widestCache) return widestCache;
    const rows = [];
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const over = Math.max(r.right - vw, -r.left);
      if (over > 1 && !inFixedLayer(el)) rows.push([over, describe(el)]);
    }
    rows.sort((a, b) => b[0] - a[0]);
    widestCache = rows.slice(0, 3).map(([over, d]) => `${Math.round(over)}px ${d.tag}.${d.cls.split(" ").slice(0, 4).join(".")} "${d.text.slice(0, 30)}"`);
    return widestCache;
  };
  const offFlagged = new Set();
  for (const el of leafish) {
    if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
    const r = el.getBoundingClientRect();
    let verdict = null;
    let clipper = null;
    // A fixed element escapes overflow:hidden on its ancestors, unless one of them is its
    // containing block (transform, filter, contain). A dialog rendered inside a list row is
    // not cut off by the row's rounded card (false positive found 18.11.2026).
    let escaped = getComputedStyle(el).position === "fixed";
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (escaped) {
        const contains = acs.transform !== "none" || acs.filter !== "none" || /paint|strict|content|layout/.test(acs.contain);
        if (!contains) continue;
        escaped = false;
      }
      if (acs.position === "fixed") escaped = true;
      const ox = acs.overflowX;
      if (ox === "visible") continue;
      if (a === document.body) break;
      const ar = a.getBoundingClientRect();
      if (ox === "auto" || ox === "scroll") {
        // Intended horizontal scroller. Fine, unless the scroller itself sticks out (handled when we reach it).
        verdict = "scroller";
        break;
      }
      // hidden / clip
      if (r.right > ar.right + TOL || r.left < ar.left - TOL) {
        verdict = "clipped";
        clipper = a;
      } else verdict = "inside";
      break;
    }
    if (verdict === "scroller" || verdict === "inside") continue;
    if (verdict === "clipped") {
      // Intentional: truncate / line-clamp / marquee-like carousels are excluded by ellipsis check.
      const cs = getComputedStyle(clipper);
      if (cs.textOverflow === "ellipsis" || getComputedStyle(el).textOverflow === "ellipsis") continue;
      const hiddenPart = Math.max(0, r.right - clipper.getBoundingClientRect().right) + Math.max(0, clipper.getBoundingClientRect().left - r.left);
      if (hiddenPart < 4) continue;
      offFlagged.add(el);
      add("cut-off", "high", `content clipped by an overflow:hidden ancestor (${Math.round(hiddenPart)}px hidden)`, el, { clipper: describe(clipper), value: Math.round(hiddenPart) });
      continue;
    }
    if (r.right > vw + TOL || r.left < -TOL) {
      if (inFixedLayer(el) && (r.left >= vw || r.right <= 0)) continue; // closed off-canvas panel
      const past = Math.round(Math.max(r.right - vw, -r.left));
      offFlagged.add(el);
      // The geometry goes into the message: a control pinned to the screen (the bottom bar) can only
      // land off it when the layout viewport itself is wider than the screen, and the report should
      // say so rather than leave the next person to guess (CI, 18.11.2026, calendar and credentials at 320).
      const geo = `screen ${vw}, layout ${document.documentElement.clientWidth}, scrollWidth ${Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)}, scrollX ${Math.round(window.scrollX)}, visual ${Math.round(window.visualViewport?.width ?? vw)}@${Math.round(window.visualViewport?.offsetLeft ?? 0)}`;
      add("off-screen", past > 8 ? "high" : "medium", `element extends ${past}px past the ${r.right > vw ? "right" : "left"} edge of the viewport (${geo})`, el, { value: past, widest: widest() });
    }
  }
  // Text truncated without ellipsis (own text wider than the box, box clips).
  for (const el of visible) {
    if (offFlagged.has(el)) continue;
    const cs = getComputedStyle(el);
    if (!(cs.overflowX === "hidden" || cs.overflowX === "clip")) continue;
    if (cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none" && cs.webkitLineClamp) continue;
    if (!ownText(el)) continue;
    if (el.scrollWidth > el.clientWidth + 2) {
      add("cut-off", "low", `text wider than its box and clipped without an ellipsis (${el.scrollWidth}px in ${el.clientWidth}px)`, el, { value: el.scrollWidth - el.clientWidth });
    }
  }
  // Text squeezed into a narrow column: a sentence a word a line beside something that would not
  // wrap. Nothing leaves the screen, so the checks above see nothing. Found on the approvals screen,
  // a proposal's text beside its four actions (iPhone 15 Pro, 18.11.2026).
  for (const el of leafish) {
    const text = ownText(el);
    if (text.split(/\s+/).filter(Boolean).length < 5) continue;
    const r = el.getBoundingClientRect();
    const line = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.4;
    if (r.width < Math.min(120, vw * 0.3) && r.height > line * 4) {
      // In a table the columns share out the width by design, and on a phone the table scrolls in its
      // own box: worth seeing, not a blocker. The blocker is a flex row that would not wrap.
      const inTable = !!el.closest("td, th");
      add("squeezed", inTable ? "medium" : "high", `text squeezed into a ${Math.round(r.width)}px column, ${Math.round(r.height / line)} lines (${text.split(/\s+/).length} words)${inTable ? ", in a table cell" : ""}`, el, { value: Math.round(r.width) });
    }
  }

  // ---------------------------------------------------------------
  // 3. Tap targets under 44 x 44 (Apple HIG).
  // ---------------------------------------------------------------
  const tapSel = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=checkbox], [role=switch], [role=menuitem], [tabindex]:not([tabindex="-1"])';
  const seenTap = new Set();
  for (const el of document.querySelectorAll(tapSel)) {
    if (!visibleSet.has(el) && !(el.tagName === "INPUT" && ["checkbox", "radio"].includes(el.type))) continue;
    if (el.disabled) continue;
    let target = el;
    if (el.tagName === "INPUT" && ["checkbox", "radio"].includes(el.type)) {
      const lab = el.closest("label") || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
      if (lab) target = lab;
    } else if (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) {
      // A field inside its own label is focused by a tap anywhere on the label.
      const lab = el.closest("label");
      if (lab && lab.querySelectorAll("input:not([type=hidden]), select, textarea").length === 1) {
        const lr = lab.getBoundingClientRect(), er = el.getBoundingClientRect();
        if (lr.width * lr.height > er.width * er.height) target = lab;
      }
    }
    if (seenTap.has(target)) continue;
    seenTap.add(target);
    // Nested interactive: count the outer one only.
    if (target.parentElement && target.parentElement.closest(tapSel) && target.parentElement.closest(tapSel) !== target) continue;
    const cs = getComputedStyle(target);
    // WCAG 2.5.8 inline exception: a link inside a sentence.
    if (target.tagName === "A" && cs.display === "inline") {
      const p = target.parentElement;
      const pt = (p?.innerText || "").replace(/\s+/g, " ").trim();
      const lt = (target.innerText || "").replace(/\s+/g, " ").trim();
      if (pt.length > lt.length + 3) continue;
    }
    const r = target.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // A hit area drawn by ::before (the app's .tap-area utility) counts: it is what a finger hits.
    const pb = getComputedStyle(target, "::before");
    const hasHit = pb.content && pb.content !== "none" && pb.position === "absolute";
    const hitW = hasHit ? Math.max(r.width, parseFloat(pb.width) || 0) : r.width;
    const hitH = hasHit ? Math.max(r.height, parseFloat(pb.height) || 0) : r.height;
    if (hitW >= 44 && hitH >= 44) continue;
    if (r.width < 44 || r.height < 44) {
      add("tap-target", r.width < 24 || r.height < 24 ? "medium" : "low", `tap target ${Math.round(r.width)}x${Math.round(r.height)}px (min 44x44)`, target, { value: Math.round(Math.min(r.width, r.height)) });
    }
  }

  // ---------------------------------------------------------------
  // 4. Inputs under 16px (iOS Safari zooms the page on focus).
  // ---------------------------------------------------------------
  const noZoomTypes = ["checkbox", "radio", "hidden", "range", "file", "submit", "button", "reset", "image", "color"];
  for (const el of document.querySelectorAll('input, select, textarea, [contenteditable="true"], [contenteditable=""]')) {
    if (el.tagName === "INPUT" && noZoomTypes.includes(el.type)) continue;
    if (!visibleSet.has(el) && !(el.closest("[role=dialog]"))) continue;
    if (!visibleSet.has(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) add("input-font", "high", `${el.tagName.toLowerCase()}${el.type ? `[type=${el.type}]` : ""} font-size ${fs}px < 16px: iOS zooms in on focus`, el, { value: fs });
  }

  // ---------------------------------------------------------------
  // 5. Fixed / sticky edges that ignore the safe area.
  // ---------------------------------------------------------------
  const safeSel = { top: [], bottom: [] };
  const walkRules = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules && !rule.selectorText) {
        walkRules(rule.cssRules);
        continue;
      }
      if (!rule.selectorText) continue;
      const txt = rule.cssText;
      if (txt.includes("safe-area-inset-top") || /constant\(safe-area-inset-top/.test(txt)) safeSel.top.push(rule.selectorText);
      if (txt.includes("safe-area-inset-bottom")) safeSel.bottom.push(rule.selectorText);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walkRules(sheet.cssRules);
    } catch {
      /* cross-origin */
    }
  }
  const usesSafe = (el, edge) => {
    const sels = safeSel[edge];
    const nodes = [el, ...el.querySelectorAll("*")].slice(0, 400);
    for (const n of nodes) {
      const inline = n.getAttribute("style") || "";
      if (inline.includes(`safe-area-inset-${edge}`)) return true;
      for (const s of sels) {
        try {
          if (n.matches(s)) return true;
        } catch {
          /* bad selector */
        }
      }
    }
    // also an ancestor up to the fixed root (e.g. inset-0 wrapper padding)
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      for (const s of sels) {
        try {
          if (a.matches(s)) return true;
        } catch {}
      }
    }
    return false;
  };
  const fixedRoots = visible.filter((el) => {
    const p = getComputedStyle(el).position;
    return p === "fixed" || p === "sticky";
  });
  for (const root of fixedRoots) {
    const pos = getComputedStyle(root).position;
    const r = root.getBoundingClientRect();
    if (pos === "sticky") {
      const top = getComputedStyle(root).top;
      const bottom = getComputedStyle(root).bottom;
      if (top !== "auto" && parseFloat(top) <= 0 && r.width >= vw * 0.5) checkEdge(root, "top", "sticky top:0 (sits under the status bar / notch when the page scrolls)");
      if (bottom !== "auto" && parseFloat(bottom) <= 0 && r.width >= vw * 0.5) checkEdge(root, "bottom", "sticky bottom:0");
      continue;
    }
    // Full-screen overlay: look at its panels instead.
    const covers = r.height >= vh * 0.95 && r.width >= vw * 0.95;
    const panels = covers
      ? Array.from(root.querySelectorAll("*")).filter((c) => {
          if (!visibleSet.has(c)) return false;
          const cr = c.getBoundingClientRect();
          return cr.width >= vw * 0.5 && cr.height < vh * 0.95 && (cr.bottom >= vh - 2 || cr.top <= 2) && c.tagName !== "BUTTON";
        })
      : [root];
    // only outermost panels
    const outer = panels.filter((p) => !panels.some((q) => q !== p && q.contains(p)));
    for (const p of outer) {
      const pr = p.getBoundingClientRect();
      if (pr.width < vw * 0.5) continue;
      if (pr.bottom >= vh - 2 && pr.top > vh * 0.3) checkEdge(p, "bottom", covers ? "bottom sheet / panel inside a full-screen overlay" : "fixed to the bottom edge");
      if (pr.top <= 2 && pr.bottom < vh * 0.7) checkEdge(p, "top", covers ? "top panel inside a full-screen overlay" : "fixed to the top edge");
    }
  }
  function checkEdge(el, edge, what) {
    if (usesSafe(el, edge)) return true;
    add(
      "safe-area",
      edge === "bottom" ? "high" : "medium",
      `${what}, no env(safe-area-inset-${edge}) on it or its children: ${edge === "bottom" ? "the home indicator overlaps it" : "the notch / Dynamic Island / status bar overlaps it"}`,
      el,
    );
    return true;
  }

  // ---------------------------------------------------------------
  // 6. RTL alignment.
  // ---------------------------------------------------------------
  const docDir = document.documentElement.getAttribute("dir");
  const lang = document.documentElement.getAttribute("lang") || "";
  if (lang.startsWith("he") && docDir !== "rtl") add("rtl", "critical", `<html lang="${lang}"> but dir="${docDir}"`, null);
  const rtlDoc = getComputedStyle(document.body).direction === "rtl";
  for (const el of visible) {
    const t = ownText(el);
    if (t.length < 3) continue;
    const heb = (t.match(HEB) || []).length;
    const lat = (t.match(LAT) || []).length;
    if (heb < 3 || heb < lat) continue;
    if (el.closest("input, textarea, code, pre, [contenteditable]")) continue;
    const cs = getComputedStyle(el);
    if (cs.direction === "ltr" && rtlDoc) {
      // dir="auto" picks the direction from the first strong character. Seeded rows all start with
      // "[DEMO]", so a Hebrew title flips to LTR in the audit and would not in real data that starts
      // in Hebrew. Real data that starts with a Latin word (a product name) flips the same way, so it
      // is still reported, at low severity and labelled.
      const auto = el.closest("[dir=auto]") || el.matches("bdi");
      const full = (el.innerText || t).trim();
      if (auto && /^\[DEMO\]/.test(full)) {
        add("rtl", "info", `dir="auto" resolves to LTR because the text starts with the Latin "[DEMO]" seed prefix; a Hebrew title that starts with a Latin word would flip the same way`, el);
      } else if (auto) {
        add("rtl", "low", `dir="auto" resolves to LTR (text starts with a Latin character), Hebrew line renders left-to-right`, el);
      } else {
        add("rtl", "high", `Hebrew text rendered with direction:ltr (punctuation and numbers flip, alignment ${cs.textAlign})`, el);
      }
      continue;
    }
    if (cs.direction === "rtl" && cs.textAlign === "left") {
      const r = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const tr = range.getBoundingClientRect();
      if (r.width - tr.width > 16) add("rtl", "medium", `Hebrew text aligned left (text-align:left) in a right-to-left page`, el);
    }
  }
  // Inline-start/end mixups: icons with explicit "left"/"right" margins are too noisy to judge; skipped deliberately.

  // ---------------------------------------------------------------
  // 7. Modals taller than the viewport.
  // ---------------------------------------------------------------
  const dialogs = Array.from(document.querySelectorAll('[role=dialog], [role=alertdialog], dialog[open], [aria-modal="true"]')).filter((d) => visibleSet.has(d));
  for (const d of dialogs) {
    const dr = d.getBoundingClientRect();
    // the panel: largest visible descendant that is not the backdrop button, or the dialog itself
    let panel = d;
    if (dr.height >= vh * 0.95 && dr.width >= vw * 0.95) {
      const kids = Array.from(d.querySelectorAll("*")).filter((c) => visibleSet.has(c) && c.tagName !== "BUTTON" && c.getBoundingClientRect().height < Math.max(dr.height, vh) * 1.5);
      const outer = kids.filter((k) => !kids.some((q) => q !== k && q.contains(k) && q.getBoundingClientRect().height > 0));
      if (outer.length) panel = outer.sort((a, b) => b.getBoundingClientRect().height * b.getBoundingClientRect().width - a.getBoundingClientRect().height * a.getBoundingClientRect().width)[0];
    }
    const pr = panel.getBoundingClientRect();
    const fullH = Math.max(pr.height, panel.scrollHeight);
    if (fullH <= vh + TOL && pr.top >= -TOL && pr.bottom <= vh + TOL) continue;
    // Can the person reach the rest? Look for a vertical scroller between the panel and the dialog.
    let scrollable = false;
    for (let n = panel; n; n = n === d ? null : n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 1) {
        scrollable = true;
        break;
      }
      if (n === d) break;
    }
    if (!scrollable) {
      for (const n of panel.querySelectorAll("*")) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 1) {
          scrollable = true;
          break;
        }
      }
    }
    const closeBtn = d.querySelector('[aria-label="סגירה"], [aria-label="סגור"], [aria-label="Close"], [aria-label="close"]');
    add(
      "modal-height",
      scrollable ? "medium" : "critical",
      `modal panel ${Math.round(fullH)}px tall in a ${vh}px viewport (top ${Math.round(pr.top)}, bottom ${Math.round(pr.bottom)}); ${scrollable ? "it scrolls internally" : "nothing scrolls: the overflow is unreachable"}`,
      panel,
      { value: Math.round(fullH - vh) },
    );
  }

  return {
    findings: out,
    meta: { vw, vh, scrollWidth: sw, scrollHeight: document.documentElement.scrollHeight, dir: docDir, lang, title: document.title },
  };
}
