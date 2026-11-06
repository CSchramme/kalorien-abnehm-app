import { post, put, del } from '../api.js';
import { esc, fmt, icon, openSheet, busy, showError, toast } from '../ui.js';
import { ACTIVITY_LEVELS } from '../lib/calc.js';
import { applyTheme } from '../app.js';

function passwordField(name, label, autocomplete) {
  return `<label class="field"><span>${label}</span><input type="password" name="${name}" autocomplete="${autocomplete}" required></label>`;
}

async function clearOfflineData() {
  try {
    navigator.serviceWorker?.controller?.postMessage('clear-api-cache');
    if (window.caches) {
      for (const k of await caches.keys()) if (k.startsWith('api-')) await caches.delete(k);
    }
  } catch {}
}

export async function render(root, { app }) {
  const { user, profile: p, goals: g } = app.me;
  const activity = ACTIVITY_LEVELS.find((a) => a.key === p.activity);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let theme = 'system';
  try {
    theme = localStorage.getItem('theme') || 'system';
  } catch {}

  root.innerHTML = `
    <header class="page-head simple profile-head">
      <span class="avatar" aria-hidden="true">${esc((user.name || user.email).slice(0, 1).toUpperCase())}</span>
      <div><h1>${esc(user.name || 'Profil')}</h1><p class="muted small">${esc(user.email)}</p></div>
    </header>

    <section class="card">
      <div class="card-head"><h2 class="card-title">Deine Ziele</h2>
        <a class="link-btn" href="#/einrichtung">${icon('edit', { size: 16 })} Bearbeiten</a></div>
      <p class="hero-number">${fmt(g.kcal)} <small>kcal pro Tag${g.override ? ' (manuell)' : ''}</small></p>
      <dl class="kv">
        <div><dt>Grundumsatz</dt><dd>${fmt(g.bmr)} kcal</dd></div>
        <div><dt>Gesamtumsatz</dt><dd>${fmt(g.tdee)} kcal</dd></div>
        <div><dt>Tägliches Defizit</dt><dd>${fmt(g.deficit)} kcal</dd></div>
        <div><dt>Eiweiß</dt><dd>${fmt(g.protein)} g</dd></div>
        <div><dt>Kohlenhydrate</dt><dd>${fmt(g.carbs)} g</dd></div>
        <div><dt>Fett</dt><dd>${fmt(g.fat)} g</dd></div>
        <div><dt>Aktivität</dt><dd>${esc(activity?.label ?? '')}</dd></div>
        <div><dt>Zielgewicht</dt><dd>${p.goal_weight ? `${fmt(p.goal_weight, 1)} kg` : '–'}</dd></div>
      </dl>
    </section>

    <section class="card menu">
      <h2 class="card-title">Konto</h2>
      <button type="button" class="menu-item" data-action="account">${icon('mail', { size: 20 })}<span>Name & E-Mail</span>${icon('right', { size: 18 })}</button>
      <button type="button" class="menu-item" data-action="password">${icon('key', { size: 20 })}<span>Passwort ändern</span>${icon('right', { size: 18 })}</button>
      <a class="menu-item" href="/api/account/export" download>${icon('download', { size: 20 })}<span>Meine Daten exportieren (JSON)</span>${icon('right', { size: 18 })}</a>
      <button type="button" class="menu-item" data-action="others">${icon('devices', { size: 20 })}<span>Auf anderen Geräten abmelden</span></button>
      <button type="button" class="menu-item" data-action="logout">${icon('logout', { size: 20 })}<span>Abmelden</span></button>
    </section>

    <section class="card menu">
      <h2 class="card-title">App</h2>
      <div class="menu-item static">${icon('moon', { size: 20 })}<span>Darstellung</span>
        <div class="segmented small" role="radiogroup" aria-label="Darstellung">
          ${[['system', 'Auto'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([k, l]) => `
            <label><input type="radio" name="theme" value="${k}" ${theme === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}
        </div></div>
      ${standalone ? '' : `<button type="button" class="menu-item" data-action="install">${icon('install', { size: 20 })}<span>App auf dem Home-Bildschirm installieren</span>${icon('right', { size: 18 })}</button>`}
    </section>

    <section class="card menu">
      <button type="button" class="menu-item danger" data-action="delete">${icon('trash', { size: 20 })}<span>Konto löschen</span></button>
    </section>

    <p class="small muted center">Leichter · Mitglied seit ${new Date(user.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}<br>
      Alle Angaben sind Schätzungen und ersetzen keine ärztliche oder ernährungswissenschaftliche Beratung.</p>`;

  root.querySelectorAll('[name="theme"]').forEach((r) => r.addEventListener('change', () => applyTheme(r.value)));

  const actions = {
    account() {
      openSheet({
        title: 'Name & E-Mail',
        body: `<form class="form" novalidate>
          <label class="field"><span>Vorname</span><input name="name" maxlength="60" value="${esc(user.name)}" autocomplete="given-name"></label>
          <label class="field"><span>E-Mail</span><input name="email" type="email" value="${esc(user.email)}" autocomplete="email" autocapitalize="off"></label>
          <div class="pw-confirm" hidden>${passwordField('password', 'Aktuelles Passwort (zur Bestätigung)', 'current-password')}</div>
          <p class="form-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block" type="submit">Speichern</button></form>`,
        onMount(el, close) {
          const form = el.querySelector('form');
          const email = form.querySelector('[name="email"]');
          email.addEventListener('input', () => {
            form.querySelector('.pw-confirm').hidden = email.value.trim().toLowerCase() === user.email;
          });
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            busy(form.querySelector('[type=submit]'), async () => {
              try {
                await put('/api/account', Object.fromEntries(new FormData(form)));
                await app.refreshMe();
                toast('Gespeichert');
                close();
                app.rerender();
              } catch (err) {
                showError(err, form.querySelector('.form-error'));
              }
            });
          });
        },
      });
    },
    password() {
      openSheet({
        title: 'Passwort ändern',
        body: `<form class="form" novalidate>
          <input type="email" name="username" value="${esc(user.email)}" autocomplete="username" hidden>
          ${passwordField('current', 'Aktuelles Passwort', 'current-password')}
          ${passwordField('next', 'Neues Passwort (min. 8 Zeichen)', 'new-password')}
          <p class="small muted">Andere Geräte werden danach abgemeldet.</p>
          <p class="form-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block" type="submit">Passwort ändern</button></form>`,
        onMount(el, close) {
          const form = el.querySelector('form');
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            busy(form.querySelector('[type=submit]'), async () => {
              try {
                await post('/api/account/password', { current: fd.get('current'), next: fd.get('next') });
                toast('Passwort geändert');
                close();
              } catch (err) {
                showError(err, form.querySelector('.form-error'));
              }
            });
          });
        },
      });
    },
    async others(btn) {
      await busy(btn, async () => {
        try {
          await post('/api/auth/logout-others');
          toast('Alle anderen Geräte wurden abgemeldet');
        } catch (err) {
          showError(err);
        }
      });
    },
    async logout(btn) {
      await busy(btn, async () => {
        try {
          await post('/api/auth/logout');
        } catch {}
        await clearOfflineData();
        app.me = null;
        app.navigate('#/login');
      });
    },
    install() {
      if (app.installPrompt) {
        app.installPrompt.prompt();
        app.installPrompt.userChoice.finally(() => (app.installPrompt = null));
        return;
      }
      openSheet({
        title: 'App installieren',
        body: isIOS
          ? `<ol class="steps"><li>Tippe in Safari unten auf <b>Teilen</b> (Quadrat mit Pfeil).</li>
              <li>Wähle <b>„Zum Home-Bildschirm“</b>.</li><li>Tippe auf <b>Hinzufügen</b>.</li></ol>
              <p class="small muted">Danach startet Leichter wie eine normale App – ohne Browserleiste.</p>`
          : `<ol class="steps"><li>Öffne das Browser-Menü (⋮).</li><li>Wähle <b>„App installieren“</b> bzw. <b>„Zum Startbildschirm hinzufügen“</b>.</li></ol>
              <p class="small muted">Die Installation setzt eine HTTPS-Verbindung voraus.</p>`,
      });
    },
    delete() {
      openSheet({
        title: 'Konto löschen',
        body: `<form class="form" novalidate>
          <p>Dein Konto und <b>alle</b> deine Daten (Tagebuch, Lebensmittel, Gewicht) werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.</p>
          <p class="small muted">Tipp: Exportiere vorher deine Daten.</p>
          ${passwordField('password', 'Passwort zur Bestätigung', 'current-password')}
          <p class="form-error" role="alert" hidden></p>
          <button class="btn btn-danger btn-block" type="submit">Konto endgültig löschen</button></form>`,
        onMount(el, close) {
          const form = el.querySelector('form');
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            busy(form.querySelector('[type=submit]'), async () => {
              try {
                await del('/api/account', { password: new FormData(form).get('password') });
                await clearOfflineData();
                close();
                app.me = null;
                toast('Dein Konto wurde gelöscht.');
                app.navigate('#/registrieren');
              } catch (err) {
                showError(err, form.querySelector('.form-error'));
              }
            });
          });
        },
      });
    },
  };

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (b) actions[b.dataset.action]?.(b);
  });
}
