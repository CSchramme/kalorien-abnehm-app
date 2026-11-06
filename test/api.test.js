import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/index.js';

let server;
let base;

before(async () => {
  ({ server } = createServer({ dbPath: ':memory:' }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

/** Minimaler Client mit Cookie-Speicher */
function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
  };
}

const profile = {
  sex: 'f', birth_year: 1990, height_cm: 168, start_weight: 82, goal_weight: 70,
  activity: 'light', rate: 0.5, today: '2026-11-01',
};

test('Registrierung, Anmeldung und Profil', async () => {
  const api = client();
  assert.equal((await api('GET', '/api/me')).status, 401);
  assert.equal((await api('POST', '/api/auth/register', { email: 'x', password: '12345678' })).status, 400);
  assert.equal((await api('POST', '/api/auth/register', { email: 'a@b.de', password: 'kurz' })).status, 400);

  const reg = await api('POST', '/api/auth/register', { email: 'Anna@Example.de', password: 'geheim123', name: 'Anna' });
  assert.equal(reg.status, 201);
  assert.match(reg.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);

  const dup = await api('POST', '/api/auth/register', { email: 'anna@example.de', password: 'geheim123' });
  assert.equal(dup.status, 409);

  const me = await api('GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, 'anna@example.de');
  assert.equal(me.data.goals, null);

  const p = await api('PUT', '/api/profile', profile);
  assert.equal(p.status, 200);
  assert.ok(p.data.goals.kcal >= 1200);
  assert.ok(p.data.goals.kcal < p.data.goals.tdee);
  assert.equal(p.data.weight, 82);

  const w = await api('GET', '/api/weights');
  assert.deepEqual(w.data.weights.map((x) => [x.date, x.weight]), [['2026-11-01', 82]]);

  await api('POST', '/api/auth/logout', {});
  assert.equal((await api('GET', '/api/me')).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { email: 'anna@example.de', password: 'falsch!!' })).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { email: 'ANNA@example.de', password: 'geheim123' })).status, 200);
  assert.equal((await api('GET', '/api/me')).status, 200);
});

test('Lebensmittel, Tagebuch und Statistik', async () => {
  const api = client();
  await api('POST', '/api/auth/register', { email: 'ben@example.de', password: 'geheim123' });
  await api('PUT', '/api/profile', { ...profile, sex: 'm' });

  const food = await api('POST', '/api/foods', {
    name: 'Paprika-Kichererbsen-Topf', serving_qty: 1, serving_unit: 'Portion',
    kcal: 664, protein: 35, carbs: 47, fat: 38, sat_fat: 12, fiber: 15, sodium: 1326,
  });
  assert.equal(food.status, 201);
  const fid = food.data.food.id;

  const oats = await api('POST', '/api/foods', { name: 'Haferflocken', serving_qty: 100, serving_unit: 'g', kcal: 370, protein: 13.5, carbs: 58.7, fat: 7 });
  assert.equal(oats.status, 201);

  const search = await api('GET', '/api/foods?q=kicher');
  assert.deepEqual(search.data.foods.map((f) => f.name), ['Paprika-Kichererbsen-Topf']);

  const e1 = await api('POST', '/api/entries', { date: '2026-11-02', meal: 'lunch', food_id: fid, qty: 1.5 });
  assert.equal(e1.status, 201);
  const e2 = await api('POST', '/api/entries', { date: '2026-11-02', meal: 'breakfast', food_id: oats.data.food.id, qty: 50 });
  assert.equal(e2.status, 201);
  const e3 = await api('POST', '/api/entries', { date: '2026-11-02', meal: 'snack', name: 'Apfel', kcal: 80, save_as_food: true });
  assert.equal(e3.status, 201);
  assert.ok(e3.data.entry.food_id);

  const ex = await api('POST', '/api/exercises', { date: '2026-11-02', name: 'Joggen', minutes: 30, kcal: 300 });
  assert.equal(ex.status, 201);

  const day = await api('GET', '/api/day?date=2026-11-02');
  assert.equal(day.data.entries.length, 3);
  assert.equal(Math.round(day.data.totals.kcal), Math.round(664 * 1.5 + 370 * 0.5 + 80));
  assert.equal(day.data.burned, 300);

  // Menge ändern
  const upd = await api('PUT', `/api/entries/${e1.data.entry.id}`, { qty: 1 });
  assert.equal(upd.data.entry.qty, 1);

  // Spätere Änderung am Lebensmittel verändert die Historie nicht
  await api('PUT', `/api/foods/${fid}`, { kcal: 999 });
  const day2 = await api('GET', '/api/day?date=2026-11-02');
  assert.equal(Math.round(day2.data.totals.kcal), Math.round(664 + 185 + 80));

  // Kopieren auf den nächsten Tag
  const copy = await api('POST', '/api/entries/copy', { from: '2026-11-02', to: '2026-11-03', meal: 'lunch' });
  assert.equal(copy.data.copied, 1);

  const stats = await api('GET', '/api/stats?to=2026-11-03&days=7');
  assert.equal(stats.status, 200);
  assert.equal(stats.data.days.length, 7);
  assert.equal(stats.data.from, '2026-10-28');
  assert.equal(stats.data.logged_days, 2);
  assert.ok(stats.data.balance.vs_goal != null);

  // Löschen
  assert.equal((await api('DELETE', `/api/entries/${e2.data.entry.id}`, {})).status, 204);
  assert.equal((await api('DELETE', `/api/entries/${e2.data.entry.id}`, {})).status, 404);

  // Gewicht: gleicher Tag wird überschrieben
  await api('POST', '/api/weights', { date: '2026-11-03', weight: 81.4 });
  await api('POST', '/api/weights', { date: '2026-11-03', weight: '81,2' });
  const ws = await api('GET', '/api/weights');
  assert.deepEqual(ws.data.weights.map((x) => x.weight), [82, 81.2]);
  assert.equal((await api('GET', '/api/me')).data.weight, 81.2);
});

test('Daten sind zwischen Konten getrennt', async () => {
  const a = client();
  const b = client();
  await a('POST', '/api/auth/register', { email: 'c1@example.de', password: 'geheim123' });
  await b('POST', '/api/auth/register', { email: 'c2@example.de', password: 'geheim123' });
  const f = await a('POST', '/api/foods', { name: 'Privat', kcal: 100 });
  const e = await a('POST', '/api/entries', { date: '2026-11-02', meal: 'dinner', food_id: f.data.food.id });

  assert.equal((await b('GET', '/api/foods')).data.foods.length, 0);
  assert.equal((await b('PUT', `/api/foods/${f.data.food.id}`, { kcal: 1 })).status, 404);
  assert.equal((await b('DELETE', `/api/entries/${e.data.entry.id}`, {})).status, 404);
  assert.equal((await b('POST', '/api/entries', { date: '2026-11-02', meal: 'dinner', food_id: f.data.food.id })).status, 404);
  assert.equal((await b('GET', '/api/day?date=2026-11-02')).data.entries.length, 0);
});

test('Passwort ändern, Export und Konto löschen', async () => {
  const api = client();
  const other = client();
  await api('POST', '/api/auth/register', { email: 'd@example.de', password: 'geheim123' });
  await other('POST', '/api/auth/login', { email: 'd@example.de', password: 'geheim123' });
  assert.equal((await other('GET', '/api/me')).status, 200);

  assert.equal((await api('POST', '/api/account/password', { current: 'falsch123', next: 'neuesPW123' })).status, 403);
  assert.equal((await api('POST', '/api/account/password', { current: 'geheim123', next: 'neuesPW123' })).status, 200);
  // andere Geräte werden abgemeldet, dieses bleibt angemeldet
  assert.equal((await other('GET', '/api/me')).status, 401);
  assert.equal((await api('GET', '/api/me')).status, 200);

  const exp = await api('GET', '/api/account/export');
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-disposition'), /attachment/);
  assert.equal(exp.data.account.email, 'd@example.de');
  assert.ok(!JSON.stringify(exp.data).includes('password_hash'));

  assert.equal((await api('DELETE', '/api/account', { password: 'geheim123' })).status, 403);
  assert.equal((await api('DELETE', '/api/account', { password: 'neuesPW123' })).status, 200);
  assert.equal((await api('GET', '/api/me')).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { email: 'd@example.de', password: 'neuesPW123' })).status, 401);
});

test('Schutz gegen CSRF und ungültige Eingaben', async () => {
  const api = client();
  await api('POST', '/api/auth/register', { email: 'e@example.de', password: 'geheim123' });
  const form = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=e@example.de&password=geheim123',
  });
  assert.equal(form.status, 415);
  const foreign = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ email: 'e@example.de', password: 'geheim123' }),
  });
  assert.equal(foreign.status, 403);

  assert.equal((await api('GET', '/api/day?date=2026-02-30')).status, 400);
  assert.equal((await api('POST', '/api/entries', { date: '2026-11-02', meal: 'brunch', kcal: 1 })).status, 400);
  assert.equal((await api('POST', '/api/foods', { name: '', kcal: 1 })).status, 400);
  assert.equal((await api('POST', '/api/foods', { name: 'X', kcal: -5 })).status, 400);
});

test('Statische Dateien und Sicherheits-Header', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(`${base}/manifest.webmanifest`)).headers.get('content-type'), 'application/manifest+json; charset=utf-8');
  assert.equal((await fetch(`${base}/..%2Fpackage.json`)).status, 403);
  assert.equal((await fetch(`${base}/gibts-nicht.js`)).status, 404);
});
