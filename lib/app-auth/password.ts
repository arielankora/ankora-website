// Password hashing per spec section 16.2: "Passwords hashed באמצעות אלגוריתם
// תקני ... Argon2/bcrypt מתאים." bcryptjs is a pure-JS bcrypt implementation
// - no native bindings to compile, which matters on Vercel's serverless
// build environment.
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Spec section 4.2: "Password policy configurable; לפחות 10 תווים, מניעת
// סיסמאות חלשות נפוצות." Configurable today means "a single constant that's
// trivial to move to an env var/DB setting later," not a settings UI yet -
// no Phase 1 acceptance criterion asks for admin-configurable policy.
export const PASSWORD_MIN_LENGTH = 10;

const COMMON_WEAK_PASSWORDS = new Set([
  "password",
  "password1",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyuiop",
  "letmein123",
  "admin1234",
  "welcome123",
  "iloveyou1",
]);

export function validatePasswordPolicy(plain: string): { valid: boolean; reason?: string } {
  if (plain.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, reason: `הסיסמה חייבת להכיל לפחות ${PASSWORD_MIN_LENGTH} תווים.` };
  }
  if (COMMON_WEAK_PASSWORDS.has(plain.toLowerCase())) {
    return { valid: false, reason: "הסיסמה נפוצה מדי. יש לבחור סיסמה חזקה יותר." };
  }
  return { valid: true };
}
