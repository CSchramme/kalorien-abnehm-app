import { get, del } from '../api.js';
import { esc, fmt, fmtSigned, icon, todayISO, addDays, longDate, busy, showError, confirmDialog, toast } from '../ui.js';
import { calcBmi, bmiCategory } from '../lib/calc.js';
import { lineChart } from '../charts.js';
import { openWeightSheet } from './sheets.js';

const RANGES = [
  { key: '30', label: '1 Mon.', days: 30 },
  { key: '90', label: '3 Mon.', days: 90 },
  { key: '365', label: '1 Jahr', days: 365 },
  { key: 'all', label: 'Alle', days: null },
];

let range = '90';

export async function render(root, { app }) {
  const { weights } = await get('/api/weights');
  const p = app.me.profile;
  const goals = app.me.goals;
  const current = weights.at(-1)?.weight ?? p.start_weight;
  const start = p.start_weight;
  const goal = p.goal_weight;
  const lost = start - current;
  const total = goal != null ? start - goal : null;
  const pct = total > 0 ? Math.max(0, Math.min(100, (lost / total) * 100)) : null;
  const toGo = goal != null ? current - goal : null;
  const bmi = calcBmi(current, p.height_cm);
  const refresh = async () => {
    await app.refreshMe();
    app.rerender();
  };

  let eta = '';
  if (toGo > 0 && goals?.rate > 0) {
    const weeks = Math.ceil(toGo / goals.rate);
    const d = new Date(Date.now() + weeks * 7 * 86400000);
    eta = `Bei ${fmt(goals.rate, 2)} kg pro Woche erreichst du dein Ziel voraussichtlich im <b>${d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</b>.`;
  } else if (toGo != null && toGo <= 0) {
    eta = 'Zielgewicht erreicht – großartig! Passe dein Ziel im Profil an oder halte dein Gewicht.';
  }

  root.innerHTML = `
    <section class="hero">
    <header class="page-head simple"><h1>Gewicht</h1>
      <button type="button" class="btn btn-hero btn-small" data-add>${icon('plus', { size: 18 })} Eintragen</button></header>
    <div class="weight-hero">
      <div class="stat-row">
        <div class="stat"><span class="stat-label">Aktuell</span><span class="stat-value">${fmt(current, 1)} <small>kg</small></span></div>
        <div class="stat"><span class="stat-label">Seit Start</span>
          <span class="stat-value">${fmtSigned(-lost, 1)} <small>kg</small></span>
          ${lost > 0 ? `<span class="status-tag good">${icon('check', { size: 14 })} abgenommen</span>` : ''}</div>
        ${goal != null ? `<div class="stat"><span class="stat-label">Noch bis Ziel</span><span class="stat-value">${fmt(Math.max(0, toGo), 1)} <small>kg</small></span></div>` : ''}
      </div>
      ${pct != null ? `
        <div class="progress" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100" aria-label="Fortschritt zum Zielgewicht">
          <i style="width:${pct}%"></i></div>
        <div class="progress-legend"><span>Start ${fmt(start, 1)} kg</span><b>${fmt(pct)} %</b><span>Ziel ${fmt(goal, 1)} kg</span></div>` : ''}
      ${eta ? `<p class="note">${icon('target', { size: 18 })}<span>${eta}</span></p>` : ''}
    </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2 class="card-title">Verlauf</h2>
        <div class="segmented small" role="tablist">${RANGES.map((r) => `
          <button type="button" role="tab" data-range="${r.key}" class="${r.key === range ? 'active' : ''}" aria-selected="${r.key === range}">${r.label}</button>`).join('')}</div>
      </div>
      <div class="weight-chart"></div>
    </section>

    <section class="card bmi">
      <div><span class="stat-label">BMI</span><span class="stat-value">${fmt(bmi, 1)}</span></div>
      <p>${bmiCategory(bmi)}<br><small class="muted">bei ${fmt(p.height_cm)} cm Körpergröße</small></p>
    </section>

    <section class="card">
      <h2 class="card-title">Messungen</h2>
      ${weights.length ? `<ul class="list">${[...weights].reverse().map((w, i, arr) => {
        const prev = arr[i + 1];
        const diff = prev ? w.weight - prev.weight : null;
        return `<li class="list-item static">
          <span class="li-main"><span class="li-title">${fmt(w.weight, 1)} kg</span>
            <span class="li-sub">${esc(longDate(w.date, { weekday: 'short', year: 'numeric' }))}</span></span>
          ${diff != null ? `<span class="li-delta">${fmtSigned(diff, 1)}</span>` : ''}
          <button type="button" class="icon-btn small" data-del="${w.id}" aria-label="Messung vom ${esc(w.date)} löschen">${icon('trash', { size: 18 })}</button>
        </li>`;
      }).join('')}</ul>` : '<p class="muted">Noch keine Messungen.</p>'}
    </section>`;

  const drawChart = () => {
    const fresh = document.createElement('div');
    fresh.className = 'weight-chart';
    root.querySelector('.weight-chart').replaceWith(fresh);
    const days = RANGES.find((r) => r.key === range).days;
    const from = days ? addDays(todayISO(), -days + 1) : '0000-00-00';
    const pts = weights.filter((w) => w.date >= from).map((w) => ({ date: w.date, value: w.weight }));
    if (pts.length) lineChart(fresh, { points: pts, goal, unit: 'kg', digits: 1 });
    else fresh.innerHTML = '<p class="muted small">Keine Messungen in diesem Zeitraum.</p>';
  };
  drawChart();

  root.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-range]');
    if (r) {
      range = r.dataset.range;
      root.querySelectorAll('[data-range]').forEach((b) => {
        b.classList.toggle('active', b === r);
        b.setAttribute('aria-selected', b === r);
      });
      drawChart();
      return;
    }
    if (e.target.closest('[data-add]')) {
      openWeightSheet({ weight: current, onDone: refresh });
      return;
    }
    const d = e.target.closest('[data-del]');
    if (d) {
      const w = weights.find((x) => x.id === Number(d.dataset.del));
      if (!(await confirmDialog({
        title: 'Messung löschen?',
        message: `${fmt(w.weight, 1)} kg vom ${longDate(w.date, { year: 'numeric' })} wird gelöscht.`,
        confirmLabel: 'Löschen',
        danger: true,
      }))) return;
      busy(d, async () => {
        try {
          await del(`/api/weights/${w.id}`);
          toast('Gelöscht');
          refresh();
        } catch (err) {
          showError(err);
        }
      });
    }
  });
}
