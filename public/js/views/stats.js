import { get } from '../api.js';
import { fmt, icon, todayISO, fromISO } from '../ui.js';
import { barChart } from '../charts.js';

const RANGES = [7, 30, 90];
let days = 7;

export async function render(root, { app }) {
  const s = await get(`/api/stats?to=${todayISO()}&days=${days}`);
  const goals = app.me.goals;
  const a = s.average;
  const logged = s.logged_days;
  const macroKcal = a.protein * 4 + a.carbs * 4 + a.fat * 9;
  const share = (v) => (macroKcal > 0 ? (v / macroKcal) * 100 : 0);
  const parts = [
    { key: 's1', label: 'Eiweiß', g: a.protein, pct: share(a.protein * 4) },
    { key: 's2', label: 'Kohlenhydrate', g: a.carbs, pct: share(a.carbs * 4) },
    { key: 's3', label: 'Fett', g: a.fat, pct: share(a.fat * 9) },
  ];
  const daysOnTarget = s.days.filter((d) => d.logged && d.kcal <= s.goal + d.burned).length;
  const bal = s.balance;

  root.innerHTML = `
    <header class="page-head simple"><h1>Statistik</h1></header>
    <div class="range-row"><div class="segmented" role="tablist" aria-label="Zeitraum">${RANGES.map((r) => `
      <button type="button" role="tab" data-days="${r}" class="${r === days ? 'active' : ''}" aria-selected="${r === days}">${r} Tage</button>`).join('')}
    </div></div>

    ${logged ? '' : `<div class="card empty-state small">${icon('chart', { size: 28 })}<p>In diesem Zeitraum gibt es noch keine Einträge. Trage im <a href="#/heute">Tagebuch</a> ein, was du isst – dann siehst du hier deine Bilanz.</p></div>`}

    <section class="tiles">
      <div class="card tile">
        <span class="stat-label">Ø pro Tag</span>
        <span class="stat-value">${fmt(a.kcal)} <small>kcal</small></span>
        <span class="small muted">Ziel ${fmt(s.goal)} kcal</span>
      </div>
      <div class="card tile">
        <span class="stat-label">Im Ziel</span>
        <span class="stat-value">${daysOnTarget} <small>von ${logged} ${logged === 1 ? 'Tag' : 'Tagen'}</small></span>
        <span class="small muted">${logged} von ${s.days.length} Tagen erfasst</span>
      </div>
      <div class="card tile wide">
        <span class="stat-label">Kalorienbilanz (${logged} ${logged === 1 ? 'Tag' : 'Tage'})</span>
        <span class="stat-value">${fmt(Math.abs(bal.vs_goal ?? 0))} <small>kcal ${(bal.vs_goal ?? 0) >= 0 ? 'unter' : 'über'} deinem Ziel</small></span>
        ${bal.est_kg != null && logged ? `<span class="small">${bal.est_kg > 0
          ? `${icon('check', { size: 14 })} Gegenüber deinem Gesamtumsatz ein Defizit von ${fmt(bal.vs_tdee)} kcal ≈ <b>${fmt(bal.est_kg, 2)} kg</b> Körperfett`
          : `Gegenüber deinem Gesamtumsatz ein Überschuss von ${fmt(-bal.vs_tdee)} kcal ≈ ${fmt(-bal.est_kg, 2)} kg`}</span>` : ''}
      </div>
    </section>

    <section class="card">
      <h2 class="card-title">Kalorien pro Tag</h2>
      <div class="kcal-chart"></div>
      <div class="legend">
        <span><i class="swatch accent"></i>im Ziel</span>
        <span><i class="swatch over"></i>${icon('alert', { size: 13 })} über Ziel</span>
        <span><i class="swatch line"></i>Tagesziel</span>
      </div>
    </section>

    <section class="card">
      <h2 class="card-title">Ø Makronährstoffe</h2>
      ${macroKcal > 0 ? `
        <div class="segbar" role="img" aria-label="${parts.map((p) => `${p.label} ${fmt(p.pct)} %`).join(', ')}">
          ${parts.map((p) => `<i class="${p.key}" style="flex:${p.pct.toFixed(2)}"></i>`).join('')}
        </div>
        <ul class="macro-legend">${parts.map((p) => `
          <li><i class="dot ${p.key}"></i><span>${p.label}</span><b>${fmt(p.g)} g</b><span class="muted">${fmt(p.pct)} %</span>
            <span class="muted small">Ziel ${fmt(goals[p.key === 's1' ? 'protein' : p.key === 's2' ? 'carbs' : 'fat'])} g</span></li>`).join('')}
        </ul>` : '<p class="muted small">Noch keine Daten.</p>'}
      <dl class="kv small">
        <div><dt>Ø Ballaststoffe</dt><dd>${fmt(a.fiber, 1)} g</dd></div>
        <div><dt>Ø Zucker</dt><dd>${fmt(a.sugar, 1)} g</dd></div>
        <div><dt>Ø gesättigte Fettsäuren</dt><dd>${fmt(a.sat_fat, 1)} g</dd></div>
        <div><dt>Ø Natrium</dt><dd>${fmt(a.sodium)} mg</dd></div>
      </dl>
    </section>

    <section class="card">
      <details>
        <summary class="card-title">Tabelle anzeigen</summary>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Datum</th><th>kcal</th><th>Sport</th><th>E</th><th>KH</th><th>F</th></tr></thead>
          <tbody>${[...s.days].reverse().map((d) => `<tr class="${d.logged ? '' : 'muted'}">
            <td>${fromISO(d.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' })}</td>
            <td>${d.logged ? fmt(d.kcal) : '–'}</td><td>${d.burned ? fmt(d.burned) : '–'}</td>
            <td>${d.logged ? fmt(d.protein) : '–'}</td><td>${d.logged ? fmt(d.carbs) : '–'}</td><td>${d.logged ? fmt(d.fat) : '–'}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </details>
    </section>
    <p class="small muted center">Bilanz = Tagesziel + Sport − Gegessen, nur Tage mit Einträgen. 7.700 kcal ≈ 1 kg Körperfett.</p>`;

  barChart(root.querySelector('.kcal-chart'), {
    bars: s.days.map((d) => ({ date: d.date, value: d.kcal, logged: d.logged })),
    goal: s.goal,
    unit: 'kcal',
  });

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-days]');
    if (b) {
      days = Number(b.dataset.days);
      root.style.opacity = '0.6';
      app.rerender();
    }
  });
}
