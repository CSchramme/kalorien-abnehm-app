import { post } from '../api.js';
import { esc, busy, showError } from '../ui.js';

export async function render(root, { name, app }) {
  const register = name === 'registrieren';
  root.innerHTML = `
    <div class="auth">
      <section class="hero auth-brand">
        <img src="/icons/icon.svg" alt="" width="76" height="76">
        <h1>Leichter</h1>
        <p>Kalorien zählen, Ziel erreichen.</p>
      </section>
      <div class="segmented" role="tablist">
        <a href="#/login" role="tab" class="${register ? '' : 'active'}" aria-selected="${!register}">Anmelden</a>
        <a href="#/registrieren" role="tab" class="${register ? 'active' : ''}" aria-selected="${register}">Registrieren</a>
      </div>
      <form class="card form" novalidate>
        ${register ? `
        <label class="field"><span>Vorname <small class="muted">(optional)</small></span>
          <input name="name" autocomplete="given-name" maxlength="60"></label>` : ''}
        <label class="field"><span>E-Mail</span>
          <input name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" required></label>
        <label class="field"><span>Passwort</span>
          <input name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" minlength="8" required>
          ${register ? '<small class="muted">Mindestens 8 Zeichen.</small>' : ''}</label>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary btn-block" type="submit">${register ? 'Konto erstellen' : 'Anmelden'}</button>
      </form>
      <p class="muted center small">${register
        ? `Schon ein Konto? <a href="#/login">${esc('Hier anmelden')}</a>`
        : 'Neu hier? <a href="#/registrieren">Kostenlos registrieren</a>'}</p>
      <p class="muted center small">Deine Daten bleiben auf diesem Server und werden nicht weitergegeben.</p>
    </div>`;

  const form = root.querySelector('form');
  const errorBox = form.querySelector('.form-error');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    const data = Object.fromEntries(new FormData(form));
    busy(form.querySelector('[type=submit]'), async () => {
      try {
        await post(register ? '/api/auth/register' : '/api/auth/login', data);
        await app.refreshMe();
        app.navigate('#/heute');
      } catch (err) {
        showError(err, errorBox);
      }
    });
  });
}
