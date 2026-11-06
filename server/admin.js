// Kleines Verwaltungs-Werkzeug für den Server-Betreiber.
//   node server/admin.js users                      – alle Konten auflisten
//   node server/admin.js reset-password <email>      – neues Zufallspasswort setzen
import crypto from 'node:crypto';
import { openDb, DEFAULT_DB_PATH } from './db.js';
import { hashPassword, normalizeEmail } from './auth.js';

const db = openDb(process.env.DB_PATH || DEFAULT_DB_PATH);
const [cmd, arg] = process.argv.slice(2);

if (cmd === 'users') {
  const rows = db.prepare(
    `SELECT u.id, u.email, u.name, u.created_at,
            (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id) AS entries
       FROM users u ORDER BY u.id`,
  ).all();
  console.table(rows.map((r) => ({ ...r })));
} else if (cmd === 'reset-password' && arg) {
  const email = normalizeEmail(arg);
  const user = email && db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) {
    console.error('Kein Konto mit dieser E-Mail-Adresse gefunden.');
    process.exit(1);
  }
  const pw = crypto.randomBytes(9).toString('base64url');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(pw), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  console.log(`Neues Passwort für ${email}: ${pw}`);
  console.log('Bitte nach der Anmeldung im Profil ändern.');
} else {
  console.log('Verwendung:\n  node server/admin.js users\n  node server/admin.js reset-password <email>');
}
db.close();
