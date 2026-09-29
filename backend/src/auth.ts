/**
 * Passwords and session tokens, using only Web Crypto (built into Workers,
 * needs no dependency). PBKDF2 with a random salt per password, a timing-safe
 * comparison, and 256-bit random tokens.
 */

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

const PBKDF2_ITERATIONS = 210_000; // OWASP's 2024+ minimum for HMAC-SHA256

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return { hash: toHex(bits), salt: toHex(salt) };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(salt) as BufferSource, iterations: PBKDF2_ITERATIONS }, key, 256);
  return timingSafeEqualHex(toHex(bits), hash);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function newSessionToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}
export function newId(prefix: string): string {
  return `${prefix}_${toHex(crypto.getRandomValues(new Uint8Array(12)))}`;
}

// ---------------------------------------------------------------------------
// Input rules
// ---------------------------------------------------------------------------

// Letters (either case, stored as typed), digits, underscore. Uniqueness is
// checked case-insensitively (see username_lc in the schema), so "Alice" and
// "alice" cannot both be taken.
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validUsername(u: string): boolean {
  return USERNAME_RE.test(u);
}
export function validEmail(e: string): boolean {
  return EMAIL_RE.test(e) && e.length <= 254;
}
export function passwordProblem(p: string): string | null {
  if (p.length < 8) return 'Password must be at least 8 characters.';
  if (p.length > 200) return 'Password is too long.';
  return null;
}
