// Secrets said out loud (claude/org-brain-spec-2026-10-12.md, 4 and R4).
// Pure. A recording catches a password read over the phone, a pasted API
// key, a card number. None of it may enter the client file: the item is
// dropped, and the person who sent it is given a task to have the secret
// changed, because a secret that was spoken is a secret that leaked.
//
// Deliberately loose. A false alarm costs a person one look; a missed
// secret sits in a database, in a backup, and in every export after it.

export type SecretHit = { kind: "PASSWORD" | "API_KEY" | "PRIVATE_KEY" | "CARD" | "TOKEN"; label: string };

const PATTERNS: { kind: SecretHit["kind"]; label: string; re: RegExp }[] = [
  { kind: "PASSWORD", label: "סיסמה", re: /(password|passwd|pwd|סיסמה|סיסמא|הסיסמה|הסיסמא|קוד גישה)[^\n:=]{0,30}?(?:[:=]|\s(?:היא|הוא|is)\s)\s*\S{4,}/i },
  { kind: "PRIVATE_KEY", label: "מפתח פרטי", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: "API_KEY", label: "מפתח API", re: /\b(sk-[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,})\b/ },
  { kind: "TOKEN", label: "טוקן", re: /\b(bearer\s+[A-Za-z0-9._-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/i },
];

/// Luhn, so a 16-digit order number is not a card and a card is.
function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function findSecrets(text: string | null | undefined): SecretHit[] {
  if (!text) return [];
  const hits: SecretHit[] = [];
  for (const p of PATTERNS) if (p.re.test(text)) hits.push({ kind: p.kind, label: p.label });
  for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
      hits.push({ kind: "CARD", label: "מספר כרטיס" });
      break;
    }
  }
  return hits;
}
