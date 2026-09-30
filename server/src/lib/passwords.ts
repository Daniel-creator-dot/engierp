import crypto from 'crypto';

export const PASSWORD_POLICY = {
  minLength: 8,
  description: 'At least 8 characters, including at least one letter and one number.',
};

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_POLICY.minLength) {
    return `Password must be at least ${PASSWORD_POLICY.minLength} characters long.`;
  }
  if (password.length > 128) return 'Password must be at most 128 characters long.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return null;
}

// No 0/O, 1/l/I so the password can be read out or typed from an SMS without mistakes.
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function generateTempPassword(length = 12): string {
  while (true) {
    let out = '';
    for (let i = 0; i < length; i++) out += TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)];
    if (!validatePassword(out)) return out;
  }
}

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export function tokenMatches(candidate: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(hashToken(candidate), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
