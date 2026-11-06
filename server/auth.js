import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

export const SESSION_DAYS = 60;
export const SESSION_COOKIE = 'sid';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keylen } = PARAMS;
  const hash = await scrypt(password.normalize('NFKC'), salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [algo, N, r, p, saltB64, hashB64] = String(stored).split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(actual, expected);
}

/** Hash zum Vergleichen, wenn es den Benutzer nicht gibt (gleiche Antwortzeit). */
let dummyHash;
export async function getDummyHash() {
  dummyHash ??= await hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHash;
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Das Passwort muss mindestens 8 Zeichen lang sein.';
  if (pw.length > 200) return 'Das Passwort ist zu lang.';
  return null;
}

export function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSessionStore(db) {
  const insert = db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
  );
  const find = db.prepare(
    `SELECT s.user_id, s.expires_at, u.email, u.name, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  );
  const extend = db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?');
  const remove = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const removeAll = db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?');
  const purge = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

  const ttl = SESSION_DAYS * 86400_000;
  purge.run(Date.now());

  return {
    create(userId, userAgent = '') {
      const token = crypto.randomBytes(32).toString('base64url');
      const now = Date.now();
      insert.run(sha256(token), userId, now, now + ttl, String(userAgent).slice(0, 300));
      return token;
    },
    /** Liefert den Benutzer zur Session und verlängert sie bei Nutzung (gleitendes Ablaufdatum). */
    lookup(token) {
      if (!token || token.length > 100) return null;
      const hash = sha256(token);
      const now = Date.now();
      const row = find.get(hash, now);
      if (!row) return null;
      if (row.expires_at - now < ttl / 2) extend.run(now + ttl, hash);
      return { id: row.user_id, email: row.email, name: row.name, created_at: row.created_at, tokenHash: hash };
    },
    destroy(token) {
      if (token) remove.run(sha256(token));
    },
    /** Meldet alle anderen Geräte ab. */
    destroyOthers(userId, keepTokenHash = '') {
      removeAll.run(userId, keepTokenHash);
    },
    ttlSeconds: ttl / 1000,
  };
}
