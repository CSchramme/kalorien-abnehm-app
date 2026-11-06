// Kleine UI-Helfer: Escaping, Formatierung, Datum, Icons, Toasts und Bottom-Sheets.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const formatters = new Map();
export function fmt(value, digits = 0) {
  let f = formatters.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
    formatters.set(digits, f);
  }
  const n = Number(value) || 0;
  return f.format(Math.abs(n) < 0.05 && digits ? 0 : n);
}
/** Mit Vorzeichen, z. B. "+1,2" / "−0,8" */
export function fmtSigned(value, digits = 0) {
  const n = Number(value) || 0;
  const s = fmt(Math.abs(n), digits);
  if (s === '0') return '±0';
  return (n > 0 ? '+' : '−') + s;
}
/** Eingaben wie "81,5" oder "81.5" → 81.5; leer → null */
export function parseDecimal(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
/** Zahl für ein Eingabefeld (deutsches Komma) */
export const inputNum = (v, digits = 1) => (v == null || v === '' ? '' : fmt(v, digits).replace(/\./g, ''));

// ---------- Datum (immer lokale Zeit des Geräts) ----------

export function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const todayISO = () => toISO(new Date());
export function addDays(s, n) {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
export const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && toISO(fromISO(s)) === s;

export function dayLabel(s) {
  const diff = Math.round((fromISO(s) - fromISO(todayISO())) / 86400000);
  if (diff === 0) return 'Heute';
  if (diff === -1) return 'Gestern';
  if (diff === 1) return 'Morgen';
  return fromISO(s).toLocaleDateString('de-DE', { weekday: 'long' });
}
export const longDate = (s, opts = {}) =>
  fromISO(s).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', ...opts });
export const shortDate = (s) => fromISO(s).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });

// ---------- Icons (24×24, Strich) ----------

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  today: '<rect x="3" y="4.5" width="18" height="17" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 10h18M8 14.5h3M8 17.5h6"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/><path d="M9 7.5h7M9 11h5"/>',
  scale: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M7.5 10a4.5 4.5 0 0 1 9 0"/><path d="M12 10l1.8-2.6"/>',
  chart: '<path d="M3 20.5h18M6.5 20.5V13M12 20.5V5.5M17.5 20.5V10"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  star: '<path d="M12 2.8l2.85 5.78 6.37.93-4.61 4.49 1.09 6.35L12 17.35l-5.7 3 1.09-6.35-4.61-4.49 6.37-.93z"/>',
  trash: '<path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6M19 6l-.9 13.1A2 2 0 0 1 16.1 21H7.9a2 2 0 0 1-2-1.9L5 6M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M8.5 12h7M8.5 16h5"/>',
  flame: '<path d="M12 22c4.1 0 7-2.9 7-6.9 0-3.4-2.1-5.6-3.8-7.3-.3 1.9-1.3 3.1-2.7 3.6.4-3.3-.9-6.6-3.9-8.9.1 3.9-3.6 6.2-3.6 11.1 0 4.2 2.9 8.4 7 8.4z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.2-4.2"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M17 6l3 3M14.5 8.5l2.5 2.5"/>',
  mail: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="M3 6.5l9 6.5 9-6.5"/>',
  devices: '<rect x="2" y="4" width="14" height="10" rx="2"/><path d="M6 18h6M9 14v4"/><rect x="17" y="8" width="5" height="12" rx="1.5"/>',
  alert: '<path d="M12 3.5L2.5 20h19L12 3.5z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.5h.01"/>',
  target: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="1.5"/>',
  install: '<path d="M12 3v11M7.5 9.5L12 14l4.5-4.5"/><rect x="3" y="15" width="18" height="6" rx="2"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
};

export function icon(name, { size = 22, fill = false, cls = '' } = {}) {
  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
}

// ---------- Toast ----------

let toastTimer;
export function toast(message, { type = 'info', timeout = 2800 } = {}) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.className = `toast toast-${type}`;
  el.innerHTML = `${icon(type === 'error' ? 'alert' : 'check', { size: 18 })}<span></span>`;
  el.querySelector('span').textContent = message;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), timeout);
}

// ---------- Bottom-Sheet ----------

const openSheets = [];

/**
 * Öffnet ein Bottom-Sheet. `body` ist HTML (bereits escaped), `onMount(el, close)` hängt Listener an.
 * Gibt { el, close, closed } zurück; `closed` ist ein Promise mit dem an close() übergebenen Wert.
 */
export function openSheet({ title, body, onMount, className = '' }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  const titleId = `sheet-title-${Math.random().toString(36).slice(2, 8)}`;
  wrap.innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <section class="sheet ${className}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="sheet-grip" aria-hidden="true"></div>
      <header class="sheet-head">
        <h2 id="${titleId}">${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Schließen">${icon('close')}</button>
      </header>
      <div class="sheet-body">${body}</div>
    </section>`;
  document.body.append(wrap);
  document.body.classList.add('sheet-open');
  const prevFocus = document.activeElement;

  let resolve;
  const closed = new Promise((r) => (resolve = r));
  let done = false;
  const close = (value) => {
    if (done) return;
    done = true;
    openSheets.splice(openSheets.indexOf(api), 1);
    wrap.classList.remove('show');
    setTimeout(() => {
      wrap.remove();
      if (!openSheets.length) document.body.classList.remove('sheet-open');
    }, 220);
    prevFocus?.focus?.({ preventScroll: true });
    resolve(value);
  };
  const api = { el: wrap.querySelector('.sheet'), close, closed };
  openSheets.push(api);

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  requestAnimationFrame(() => {
    wrap.classList.add('show');
    const auto = wrap.querySelector('[autofocus]');
    if (auto && matchMedia('(pointer: fine)').matches) auto.focus();
    else api.el.focus?.();
  });
  api.el.tabIndex = -1;
  onMount?.(api.el, close);
  return api;
}

export function closeAllSheets() {
  [...openSheets].forEach((s) => s.close());
}

export function confirmDialog({ title, message, confirmLabel = 'OK', danger = false }) {
  const sheet = openSheet({
    title,
    body: `<p class="muted">${esc(message)}</p>
      <div class="btn-row">
        <button type="button" class="btn btn-ghost" data-close>Abbrechen</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmLabel)}</button>
      </div>`,
    onMount(el, close) {
      el.querySelector('[data-ok]').addEventListener('click', () => close(true));
    },
  });
  return sheet.closed.then((v) => v === true);
}

/** Setzt einen Button in den Lade-Zustand, solange `fn` läuft. */
export async function busy(button, fn) {
  if (!button) return fn();
  if (button.disabled) return;
  button.disabled = true;
  button.classList.add('is-busy');
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
  }
}

/** Zeigt eine Fehlermeldung in einem Formular (oder als Toast). */
export function showError(err, box) {
  const msg = err?.message || 'Unbekannter Fehler';
  if (box) {
    box.textContent = msg;
    box.hidden = false;
  } else toast(msg, { type: 'error' });
}
