import { get, onApiEvent } from './api.js';
import { $, $$, icon, closeAllSheets, toast } from './ui.js';
import { isProfileComplete } from './lib/calc.js';

const VIEWS = {
  login: { load: () => import('./views/auth.js'), public: true },
  registrieren: { load: () => import('./views/auth.js'), public: true },
  einrichtung: { load: () => import('./views/setup.js') },
  heute: { load: () => import('./views/today.js'), tab: 'heute' },
  lebensmittel: { load: () => import('./views/foods.js'), tab: 'lebensmittel' },
  gewicht: { load: () => import('./views/weight.js'), tab: 'gewicht' },
  statistik: { load: () => import('./views/stats.js'), tab: 'statistik' },
  profil: { load: () => import('./views/profile.js'), tab: 'profil' },
};

const TABS = [
  { key: 'heute', label: 'Tagebuch', icon: 'today' },
  { key: 'lebensmittel', label: 'Lebensmittel', icon: 'book' },
  { key: 'gewicht', label: 'Gewicht', icon: 'scale' },
  { key: 'statistik', label: 'Statistik', icon: 'chart' },
  { key: 'profil', label: 'Profil', icon: 'user' },
];

export const app = {
  me: null,
  installPrompt: null,
  async refreshMe() {
    try {
      app.me = await get('/api/me');
    } catch (err) {
      if (err.status === 401) app.me = null;
      else throw err;
    }
    return app.me;
  },
  navigate(hash, { replace = false } = {}) {
    if (location.hash === hash) return render();
    if (replace) location.replace(hash);
    else location.hash = hash;
  },
  rerender: () => render(),
};

// ----- Theme (System / Hell / Dunkel) -----
export function applyTheme(theme) {
  try {
    if (theme) localStorage.setItem('theme', theme);
    else theme = localStorage.getItem('theme') || 'system';
  } catch {
    theme ||= 'system';
  }
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1f5527' : '#2e8540');
  return theme;
}

function renderTabbar(active) {
  const bar = $('#tabbar');
  bar.innerHTML = TABS.map(
    (t) => `<a href="#/${t.key}" class="tab${t.key === active ? ' active' : ''}" ${t.key === active ? 'aria-current="page"' : ''}>
      ${icon(t.icon, { size: 24 })}<span>${t.label}</span></a>`,
  ).join('');
  bar.hidden = !active;
  document.body.classList.toggle('has-tabbar', !!active);
}

let renderId = 0;
async function render() {
  const id = ++renderId;
  const [name = '', ...args] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  let viewName = VIEWS[name] ? name : 'heute';
  const view = VIEWS[viewName];

  if (!app.me && !view.public) return app.navigate('#/login', { replace: true });
  if (app.me && view.public) return app.navigate('#/heute', { replace: true });
  if (app.me && !isProfileComplete(app.me.profile) && viewName !== 'einrichtung' && !view.public) {
    return app.navigate('#/einrichtung', { replace: true });
  }

  closeAllSheets();
  const main = $('#app');
  main.setAttribute('aria-busy', 'true');
  try {
    const mod = await view.load();
    if (id !== renderId) return;
    renderTabbar(view.tab);
    const container = document.createElement('div');
    container.className = `view view-${viewName}`;
    await mod.render(container, { name: viewName, args, app });
    if (id !== renderId) return;
    main.replaceChildren(container);
    if (!args.length) window.scrollTo(0, 0);
  } catch (err) {
    if (id !== renderId) return;
    if (err.status === 401) return;
    console.error(err);
    main.innerHTML = `<div class="empty-state">${icon('alert', { size: 32 })}
      <p>${err.status === 0 ? 'Du bist offline und diese Seite ist noch nicht gespeichert.' : 'Da ist etwas schiefgelaufen.'}</p>
      <button class="btn btn-primary" id="retry">Erneut versuchen</button></div>`;
    $('#retry').addEventListener('click', () => render());
  } finally {
    main.removeAttribute('aria-busy');
  }
}

onApiEvent('unauthorized', () => {
  if (!app.me) return;
  app.me = null;
  toast('Bitte melde dich erneut an.', { type: 'error' });
  app.navigate('#/login', { replace: true });
});
onApiEvent('offline', (offline) => {
  document.body.classList.toggle('is-offline', offline || !navigator.onLine);
});
// Chrome/Android: Installations-Dialog für später aufheben (Profil → App installieren)
addEventListener('beforeinstallprompt', (e) => {
  app.installPrompt = e;
});
addEventListener('online', () => document.body.classList.remove('is-offline'));
addEventListener('offline', () => document.body.classList.add('is-offline'));

async function boot() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
  try {
    await app.refreshMe();
  } catch (err) {
    console.error(err);
  }
  addEventListener('hashchange', render);
  await render();
  document.body.classList.add('ready');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Service Worker:', e));
  }
}

boot();
