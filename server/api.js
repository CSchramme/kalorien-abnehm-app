import { HttpError, readJson, sendJson, clientIp, createRateLimiter } from './http.js';
import { hashPassword, verifyPassword, getDummyHash, validatePassword, normalizeEmail, SESSION_COOKIE } from './auth.js';
import { transaction } from './db.js';
import {
  NUTRIENTS, NUTRIENT_KEYS, MEAL_KEYS, ACTIVITY_LEVELS, SEXES, computeGoals, sumEntries,
} from '../public/js/lib/calc.js';

// ---------- Validierung ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function date(v, field = 'Datum') {
  if (!isDate(v)) throw new HttpError(400, `${field} ist ungültig.`);
  return v;
}
function addDays(s, n) {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function text(v, { field, max = 120, required = false, fallback = '' } = {}) {
  if (v == null || v === '') {
    if (required) throw new HttpError(400, `${field} fehlt.`);
    return fallback;
  }
  if (typeof v !== 'string') throw new HttpError(400, `${field} ist ungültig.`);
  const t = v.trim();
  if (required && !t) throw new HttpError(400, `${field} fehlt.`);
  if (t.length > max) throw new HttpError(400, `${field} ist zu lang (max. ${max} Zeichen).`);
  return t || fallback;
}
function num(v, { field, min = -Infinity, max = Infinity, required = false, fallback = null } = {}) {
  if (v == null || v === '') {
    if (required) throw new HttpError(400, `${field} fehlt.`);
    return fallback;
  }
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${field} ist ungültig.`);
  return n;
}
function oneOf(v, allowed, field) {
  if (!allowed.includes(v)) throw new HttpError(400, `${field} ist ungültig.`);
  return v;
}
function id(v) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(404, 'Nicht gefunden.');
  return n;
}
function nutrients(body, { partial = false } = {}) {
  const out = {};
  for (const n of NUTRIENTS) {
    if (partial && !(n.key in body)) continue;
    out[n.key] = num(body[n.key], { field: n.label, min: 0, max: n.max, fallback: 0 });
  }
  return out;
}
function serving(body, { partial = false } = {}) {
  const out = {};
  if (!partial || 'serving_qty' in body) {
    out.serving_qty = num(body.serving_qty, { field: 'Portionsgröße', min: 0.001, max: 100000, fallback: 1 });
  }
  if (!partial || 'serving_unit' in body) {
    out.serving_unit = text(body.serving_unit, { field: 'Einheit', max: 30, fallback: 'Portion' });
  }
  return out;
}

const FOOD_COLS = ['name', 'serving_qty', 'serving_unit', ...NUTRIENT_KEYS];

// ---------- API ----------

export function createApi({ db, sessions, trustProxy = false, cookieSecure = 'auto' }) {
  const limit = createRateLimiter();
  const routes = [];
  const route = (method, path, handler, { auth = true } = {}) => {
    const keys = [];
    const re = new RegExp(`^${path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    routes.push({ method, re, keys, handler, auth });
  };

  const q = {
    profile: db.prepare(
      'SELECT sex, birth_year, height_cm, start_weight, goal_weight, activity, rate, kcal_override, updated_at FROM profiles WHERE user_id = ?',
    ),
    latestWeight: db.prepare('SELECT date, weight FROM weights WHERE user_id = ? ORDER BY date DESC LIMIT 1'),
    food: db.prepare('SELECT * FROM foods WHERE id = ? AND user_id = ?'),
    entry: db.prepare('SELECT * FROM entries WHERE id = ? AND user_id = ?'),
  };

  const userState = (userId) => {
    const profile = q.profile.get(userId) ?? null;
    const latest = q.latestWeight.get(userId) ?? null;
    const weight = latest?.weight ?? profile?.start_weight ?? null;
    return { profile, weight, weight_date: latest?.date ?? null, goals: computeGoals(profile, weight) };
  };

  const cookie = (req, value, maxAge) => {
    const secure =
      cookieSecure === true ||
      (cookieSecure === 'auto' && (req.socket.encrypted || (trustProxy && req.headers['x-forwarded-proto'] === 'https')));
    return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  };
  const startSession = (ctx, userId) => {
    const token = sessions.create(userId, ctx.req.headers['user-agent']);
    ctx.headers['Set-Cookie'] = cookie(ctx.req, token, sessions.ttlSeconds);
  };
  const endSession = (ctx) => {
    sessions.destroy(ctx.token);
    ctx.headers['Set-Cookie'] = cookie(ctx.req, '', 0);
  };

  // ----- Konto & Anmeldung -----

  route('POST', '/api/auth/register', async (ctx) => {
    limit(`register:${ctx.ip}`, 10, 60 * 60_000);
    const { body } = ctx;
    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError(400, 'Bitte gib eine gültige E-Mail-Adresse ein.');
    const pwError = validatePassword(body.password);
    if (pwError) throw new HttpError(400, pwError);
    const name = text(body.name, { field: 'Name', max: 60 });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'Für diese E-Mail-Adresse gibt es bereits ein Konto.');
    }
    const hash = await hashPassword(body.password);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
      .run(email, hash, name);
    startSession(ctx, Number(lastInsertRowid));
    ctx.status = 201;
    return { ok: true };
  }, { auth: false });

  route('POST', '/api/auth/login', async (ctx) => {
    limit(`login:${ctx.ip}`, 20, 15 * 60_000);
    const email = normalizeEmail(ctx.body.email);
    const password = String(ctx.body.password ?? '');
    if (email) limit(`login:${email}`, 10, 15 * 60_000);
    const user = email ? db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email) : null;
    const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
    if (!user || !ok) throw new HttpError(401, 'E-Mail oder Passwort ist falsch.');
    startSession(ctx, user.id);
    return { ok: true };
  }, { auth: false });

  route('POST', '/api/auth/logout', (ctx) => {
    endSession(ctx);
    return { ok: true };
  }, { auth: false });

  route('POST', '/api/auth/logout-others', (ctx) => {
    sessions.destroyOthers(ctx.user.id, ctx.user.tokenHash);
    return { ok: true };
  });

  route('GET', '/api/me', (ctx) => {
    const { id: userId, email, name, created_at } = ctx.user;
    return { user: { id: userId, email, name, created_at }, ...userState(userId) };
  });

  route('PUT', '/api/account', async (ctx) => {
    const { body, user } = ctx;
    const name = text(body.name, { field: 'Name', max: 60 });
    let email = user.email;
    if (body.email != null && normalizeEmail(body.email) !== user.email) {
      email = normalizeEmail(body.email);
      if (!email) throw new HttpError(400, 'Bitte gib eine gültige E-Mail-Adresse ein.');
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
      if (!(await verifyPassword(String(body.password ?? ''), row.password_hash))) {
        throw new HttpError(403, 'Zum Ändern der E-Mail-Adresse bitte das aktuelle Passwort eingeben.');
      }
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, user.id)) {
        throw new HttpError(409, 'Diese E-Mail-Adresse wird bereits verwendet.');
      }
    }
    db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(name, email, user.id);
    return { ok: true };
  });

  route('POST', '/api/account/password', async (ctx) => {
    limit(`pw:${ctx.user.id}`, 10, 15 * 60_000);
    const { current, next } = ctx.body;
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(ctx.user.id);
    if (!(await verifyPassword(String(current ?? ''), row.password_hash))) {
      throw new HttpError(403, 'Das aktuelle Passwort ist falsch.');
    }
    const pwError = validatePassword(next);
    if (pwError) throw new HttpError(400, pwError);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), ctx.user.id);
    sessions.destroyOthers(ctx.user.id, ctx.user.tokenHash);
    return { ok: true };
  });

  route('DELETE', '/api/account', async (ctx) => {
    limit(`delete:${ctx.user.id}`, 10, 15 * 60_000);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(ctx.user.id);
    if (!(await verifyPassword(String(ctx.body.password ?? ''), row.password_hash))) {
      throw new HttpError(403, 'Das Passwort ist falsch.');
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(ctx.user.id);
    ctx.headers['Set-Cookie'] = cookie(ctx.req, '', 0);
    return { ok: true };
  });

  route('GET', '/api/account/export', (ctx) => {
    const uid = ctx.user.id;
    const all = (table, order) => db.prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY ${order}`).all(uid);
    const { email, name, created_at } = ctx.user;
    ctx.headers['Content-Disposition'] = `attachment; filename="leichter-export-${new Date().toISOString().slice(0, 10)}.json"`;
    return {
      exported_at: new Date().toISOString(),
      account: { email, name, created_at },
      profile: q.profile.get(uid) ?? null,
      foods: all('foods', 'id'),
      entries: all('entries', 'date, id'),
      exercises: all('exercises', 'date, id'),
      weights: all('weights', 'date'),
    };
  });

  // ----- Profil & Ziele -----

  route('PUT', '/api/profile', (ctx) => {
    const b = ctx.body;
    const year = new Date().getFullYear();
    const p = {
      sex: oneOf(b.sex, SEXES.map((s) => s.key), 'Geschlecht'),
      birth_year: num(b.birth_year, { field: 'Geburtsjahr', min: year - 110, max: year - 12, required: true }),
      height_cm: num(b.height_cm, { field: 'Größe', min: 100, max: 250, required: true }),
      start_weight: num(b.start_weight, { field: 'Gewicht', min: 30, max: 400, required: true }),
      goal_weight: num(b.goal_weight, { field: 'Zielgewicht', min: 30, max: 400 }),
      activity: oneOf(b.activity, ACTIVITY_LEVELS.map((a) => a.key), 'Aktivität'),
      rate: num(b.rate, { field: 'Abnehmtempo', min: 0, max: 1, fallback: 0.5 }),
      kcal_override: num(b.kcal_override, { field: 'Kalorienziel', min: 800, max: 6000 }),
    };
    if (p.kcal_override != null) p.kcal_override = Math.round(p.kcal_override);
    const today = b.today != null ? date(b.today) : new Date().toISOString().slice(0, 10);
    transaction(db, () => {
      db.prepare(
        `INSERT INTO profiles (user_id, sex, birth_year, height_cm, start_weight, goal_weight, activity, rate, kcal_override, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET sex = excluded.sex, birth_year = excluded.birth_year,
           height_cm = excluded.height_cm, start_weight = excluded.start_weight, goal_weight = excluded.goal_weight,
           activity = excluded.activity, rate = excluded.rate, kcal_override = excluded.kcal_override,
           updated_at = excluded.updated_at`,
      ).run(ctx.user.id, p.sex, p.birth_year, p.height_cm, p.start_weight, p.goal_weight, p.activity, p.rate, p.kcal_override);
      // Erstes Gewicht automatisch ins Gewichtsprotokoll übernehmen
      if (!q.latestWeight.get(ctx.user.id)) {
        db.prepare('INSERT INTO weights (user_id, date, weight) VALUES (?, ?, ?)').run(ctx.user.id, today, p.start_weight);
      }
    });
    return userState(ctx.user.id);
  });

  // ----- Lebensmittel & Rezepte -----

  route('GET', '/api/foods', (ctx) => {
    const search = (ctx.query.get('q') || '').trim().toLocaleLowerCase('de');
    const max = Math.min(500, Number(ctx.query.get('limit')) || 200);
    const rows = db
      .prepare(
        `SELECT * FROM foods WHERE user_id = ?
          ORDER BY favorite DESC, (last_used_at IS NULL), last_used_at DESC, use_count DESC, name COLLATE NOCASE`,
      )
      .all(ctx.user.id);
    const words = search.split(/\s+/).filter(Boolean);
    const filtered = words.length
      ? rows.filter((r) => words.every((w) => r.name.toLocaleLowerCase('de').includes(w)))
      : rows;
    return { foods: filtered.slice(0, max) };
  });

  route('POST', '/api/foods', (ctx) => {
    const f = {
      name: text(ctx.body.name, { field: 'Name', required: true }),
      ...serving(ctx.body),
      ...nutrients(ctx.body),
    };
    const favorite = ctx.body.favorite ? 1 : 0;
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO foods (user_id, ${FOOD_COLS.join(', ')}, favorite) VALUES (?, ${FOOD_COLS.map(() => '?').join(', ')}, ?)`)
      .run(ctx.user.id, ...FOOD_COLS.map((k) => f[k]), favorite);
    ctx.status = 201;
    return { food: q.food.get(Number(lastInsertRowid), ctx.user.id) };
  });

  route('PUT', '/api/foods/:id', (ctx) => {
    const foodId = id(ctx.params.id);
    if (!q.food.get(foodId, ctx.user.id)) throw new HttpError(404, 'Lebensmittel nicht gefunden.');
    const b = ctx.body;
    const upd = { ...serving(b, { partial: true }), ...nutrients(b, { partial: true }) };
    if ('name' in b) upd.name = text(b.name, { field: 'Name', required: true });
    if ('favorite' in b) upd.favorite = b.favorite ? 1 : 0;
    const keys = Object.keys(upd);
    if (keys.length) {
      db.prepare(`UPDATE foods SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
        .run(...keys.map((k) => upd[k]), foodId, ctx.user.id);
    }
    return { food: q.food.get(foodId, ctx.user.id) };
  });

  route('DELETE', '/api/foods/:id', (ctx) => {
    const { changes } = db.prepare('DELETE FROM foods WHERE id = ? AND user_id = ?').run(id(ctx.params.id), ctx.user.id);
    if (!changes) throw new HttpError(404, 'Lebensmittel nicht gefunden.');
  });

  // ----- Tagebuch -----

  route('GET', '/api/day', (ctx) => {
    const d = date(ctx.query.get('date'));
    const uid = ctx.user.id;
    const entries = db.prepare('SELECT * FROM entries WHERE user_id = ? AND date = ? ORDER BY id').all(uid, d);
    const exercises = db.prepare('SELECT * FROM exercises WHERE user_id = ? AND date = ? ORDER BY id').all(uid, d);
    const weight = db.prepare('SELECT id, date, weight FROM weights WHERE user_id = ? AND date = ?').get(uid, d) ?? null;
    const { goals } = userState(uid);
    return {
      date: d,
      entries,
      exercises,
      weight,
      totals: sumEntries(entries),
      burned: exercises.reduce((s, e) => s + e.kcal, 0),
      goals,
    };
  });

  route('POST', '/api/entries', (ctx) => {
    const b = ctx.body;
    const uid = ctx.user.id;
    const d = date(b.date);
    const meal = oneOf(b.meal, MEAL_KEYS, 'Mahlzeit');
    let e;
    if (b.food_id != null) {
      const food = q.food.get(id(b.food_id), uid);
      if (!food) throw new HttpError(404, 'Lebensmittel nicht gefunden.');
      e = { food_id: food.id, ...Object.fromEntries(FOOD_COLS.map((k) => [k, food[k]])) };
      e.qty = num(b.qty, { field: 'Menge', min: 0.001, max: 100000, fallback: food.serving_qty });
    } else {
      e = {
        food_id: null,
        name: text(b.name, { field: 'Name', fallback: 'Schnelleintrag' }),
        ...serving(b),
        ...nutrients(b),
      };
      e.qty = num(b.qty, { field: 'Menge', min: 0.001, max: 100000, fallback: e.serving_qty });
    }
    const newId = transaction(db, () => {
      if (b.food_id == null && b.save_as_food) {
        const { lastInsertRowid } = db
          .prepare(`INSERT INTO foods (user_id, ${FOOD_COLS.join(', ')}) VALUES (?, ${FOOD_COLS.map(() => '?').join(', ')})`)
          .run(uid, ...FOOD_COLS.map((k) => e[k]));
        e.food_id = Number(lastInsertRowid);
      }
      if (e.food_id != null) {
        db.prepare(`UPDATE foods SET use_count = use_count + 1, last_used_at = datetime('now') WHERE id = ?`).run(e.food_id);
      }
      const cols = ['date', 'meal', 'food_id', 'qty', ...FOOD_COLS];
      const vals = { ...e, date: d, meal };
      return Number(
        db.prepare(`INSERT INTO entries (user_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`)
          .run(uid, ...cols.map((k) => vals[k])).lastInsertRowid,
      );
    });
    ctx.status = 201;
    return { entry: q.entry.get(newId, uid) };
  });

  route('PUT', '/api/entries/:id', (ctx) => {
    const entryId = id(ctx.params.id);
    if (!q.entry.get(entryId, ctx.user.id)) throw new HttpError(404, 'Eintrag nicht gefunden.');
    const b = ctx.body;
    const upd = { ...serving(b, { partial: true }), ...nutrients(b, { partial: true }) };
    if ('qty' in b) upd.qty = num(b.qty, { field: 'Menge', min: 0.001, max: 100000, required: true });
    if ('meal' in b) upd.meal = oneOf(b.meal, MEAL_KEYS, 'Mahlzeit');
    if ('date' in b) upd.date = date(b.date);
    if ('name' in b) upd.name = text(b.name, { field: 'Name', required: true });
    const keys = Object.keys(upd);
    if (keys.length) {
      db.prepare(`UPDATE entries SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`)
        .run(...keys.map((k) => upd[k]), entryId, ctx.user.id);
    }
    return { entry: q.entry.get(entryId, ctx.user.id) };
  });

  route('DELETE', '/api/entries/:id', (ctx) => {
    const { changes } = db.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?').run(id(ctx.params.id), ctx.user.id);
    if (!changes) throw new HttpError(404, 'Eintrag nicht gefunden.');
  });

  /** Mahlzeit(en) eines Tages auf einen anderen Tag kopieren, z. B. "wie gestern" */
  route('POST', '/api/entries/copy', (ctx) => {
    const from = date(ctx.body.from, 'Quelldatum');
    const to = date(ctx.body.to, 'Zieldatum');
    const meal = ctx.body.meal != null ? oneOf(ctx.body.meal, MEAL_KEYS, 'Mahlzeit') : null;
    const cols = ['food_id', 'name', 'serving_qty', 'serving_unit', 'qty', ...NUTRIENT_KEYS];
    const { changes } = db
      .prepare(
        `INSERT INTO entries (user_id, date, meal, ${cols.join(', ')})
         SELECT user_id, ?, meal, ${cols.join(', ')} FROM entries
          WHERE user_id = ? AND date = ? AND (? IS NULL OR meal = ?) ORDER BY id`,
      )
      .run(to, ctx.user.id, from, meal, meal);
    return { copied: Number(changes) };
  });

  // ----- Sport / Aktivität -----

  route('POST', '/api/exercises', (ctx) => {
    const b = ctx.body;
    const { lastInsertRowid } = db
      .prepare('INSERT INTO exercises (user_id, date, name, minutes, kcal) VALUES (?, ?, ?, ?, ?)')
      .run(
        ctx.user.id,
        date(b.date),
        text(b.name, { field: 'Aktivität', required: true, max: 80 }),
        num(b.minutes, { field: 'Dauer', min: 0, max: 1440 }),
        num(b.kcal, { field: 'Kalorien', min: 0, max: 10000, required: true }),
      );
    ctx.status = 201;
    return { exercise: db.prepare('SELECT * FROM exercises WHERE id = ?').get(Number(lastInsertRowid)) };
  });

  route('DELETE', '/api/exercises/:id', (ctx) => {
    const { changes } = db.prepare('DELETE FROM exercises WHERE id = ? AND user_id = ?').run(id(ctx.params.id), ctx.user.id);
    if (!changes) throw new HttpError(404, 'Eintrag nicht gefunden.');
  });

  // ----- Gewicht -----

  route('GET', '/api/weights', (ctx) => {
    return { weights: db.prepare('SELECT id, date, weight FROM weights WHERE user_id = ? ORDER BY date').all(ctx.user.id) };
  });

  route('POST', '/api/weights', (ctx) => {
    const d = date(ctx.body.date);
    const w = num(ctx.body.weight, { field: 'Gewicht', min: 20, max: 400, required: true });
    db.prepare(
      'INSERT INTO weights (user_id, date, weight) VALUES (?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET weight = excluded.weight',
    ).run(ctx.user.id, d, w);
    ctx.status = 201;
    return { weight: db.prepare('SELECT id, date, weight FROM weights WHERE user_id = ? AND date = ?').get(ctx.user.id, d) };
  });

  route('DELETE', '/api/weights/:id', (ctx) => {
    const { changes } = db.prepare('DELETE FROM weights WHERE id = ? AND user_id = ?').run(id(ctx.params.id), ctx.user.id);
    if (!changes) throw new HttpError(404, 'Eintrag nicht gefunden.');
  });

  // ----- Statistik / Kalorienbilanz -----

  route('GET', '/api/stats', (ctx) => {
    const to = date(ctx.query.get('to'));
    const days = num(ctx.query.get('days'), { field: 'Zeitraum', min: 1, max: 366, fallback: 7 });
    const from = addDays(to, -(Math.round(days) - 1));
    const uid = ctx.user.id;
    const sums = NUTRIENT_KEYS.map((k) => `SUM(${k} * qty / serving_qty) AS ${k}`).join(', ');
    const eaten = new Map(
      db.prepare(`SELECT date, ${sums} FROM entries WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date`)
        .all(uid, from, to)
        .map((r) => [r.date, r]),
    );
    const burned = new Map(
      db.prepare('SELECT date, SUM(kcal) AS kcal FROM exercises WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date')
        .all(uid, from, to)
        .map((r) => [r.date, r.kcal]),
    );
    const { goals } = userState(uid);
    const goal = goals?.kcal ?? null;

    const list = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const e = eaten.get(d);
      const row = { date: d, logged: !!e, burned: burned.get(d) ?? 0 };
      for (const k of NUTRIENT_KEYS) row[k] = e ? e[k] : 0;
      list.push(row);
    }
    const logged = list.filter((r) => r.logged);
    const avg = Object.fromEntries(
      NUTRIENT_KEYS.map((k) => [k, logged.length ? logged.reduce((s, r) => s + r[k], 0) / logged.length : 0]),
    );
    // Bilanz nur über Tage mit Einträgen: (Ziel + Sport) − Gegessen; positiv = unter dem Ziel geblieben
    const balanceVsGoal = goal == null ? null : logged.reduce((s, r) => s + goal + r.burned - r.kcal, 0);
    // Echtes Defizit gegenüber dem Gesamtumsatz ⇒ geschätzte Fettabnahme
    const deficitVsTdee = goals ? logged.reduce((s, r) => s + goals.tdee + r.burned - r.kcal, 0) : null;
    return {
      from,
      to,
      goal,
      days: list,
      logged_days: logged.length,
      average: avg,
      balance: {
        vs_goal: balanceVsGoal,
        vs_tdee: deficitVsTdee,
        est_kg: deficitVsTdee == null ? null : deficitVsTdee / 7700,
      },
    };
  });

  route('GET', '/api/health', () => ({ ok: true }), { auth: false });

  // ---------- Dispatcher ----------

  return async function handleApi(req, res, url, token) {
    const ctx = { req, res, url, query: url.searchParams, headers: {}, status: 200, token, ip: clientIp(req, trustProxy) };
    try {
      const candidates = routes.filter((r) => r.re.test(url.pathname));
      if (!candidates.length) throw new HttpError(404, 'Nicht gefunden.');
      const r = candidates.find((c) => c.method === req.method);
      if (!r) throw new HttpError(405, 'Methode nicht erlaubt.');

      if (req.method !== 'GET') {
        // CSRF-Schutz: nur JSON-Anfragen vom selben Ursprung
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          throw new HttpError(415, 'Content-Type application/json erwartet.');
        }
        const origin = req.headers.origin;
        if (origin) {
          const host = (trustProxy && req.headers['x-forwarded-host']) || req.headers.host;
          let originHost = null;
          try {
            originHost = new URL(origin).host;
          } catch {}
          if (originHost !== host) throw new HttpError(403, 'Ungültiger Ursprung.');
        }
      }

      const m = url.pathname.match(r.re);
      ctx.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      ctx.user = sessions.lookup(token);
      if (r.auth && !ctx.user) throw new HttpError(401, 'Bitte melde dich an.');
      ctx.body = req.method === 'GET' ? {} : await readJson(req);

      const result = await r.handler(ctx);
      if (result === undefined) return sendJson(res, 204, null, ctx.headers);
      sendJson(res, ctx.status, result, ctx.headers);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message }, ctx.headers);
      console.error(err);
      sendJson(res, 500, { error: 'Interner Serverfehler.' });
    }
  };
}
