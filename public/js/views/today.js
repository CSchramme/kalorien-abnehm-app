import { get, post, del } from '../api.js';
import {
  esc, fmt, icon, todayISO, addDays, dayLabel, longDate, isISODate, toast, showError, busy, fromISO,
} from '../ui.js';
import { MEALS, entryFactor } from '../lib/calc.js';
import {
  openAddEntry, openEntryEditor, openExerciseSheet, openWeightSheet, servingLabel, macroLine,
} from './sheets.js';

function mealForNow() {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h >= 17 && h < 22) return 'dinner';
  return 'snack';
}

/** Ring für die Tagesbilanz (SVG) */
function ring(eaten, budget) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = budget > 0 ? Math.min(eaten / budget, 1) : 0;
  const over = budget > 0 && eaten > budget;
  return `<svg class="ring${over ? ' over' : ''}" viewBox="0 0 120 120" aria-hidden="true">
    <circle class="ring-track" cx="60" cy="60" r="${r}"/>
    <circle class="ring-fill" cx="60" cy="60" r="${r}" stroke-dasharray="${(pct * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 60 60)"/>
  </svg>`;
}

function meter({ label, value, goal, unit, slot, limit = false, digits = 0 }) {
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
  const over = limit && value > goal;
  return `<div class="meter${slot ? ` ${slot}` : ' neutral'}${over ? ' over' : ''}">
    <div class="meter-head"><span>${label}</span>
      <span class="meter-value"><b>${fmt(value, digits)}</b> / ${limit ? 'max. ' : ''}${fmt(goal)} ${unit}</span></div>
    <div class="meter-bar" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${Math.round(value)}"><i style="width:${pct}%"></i></div>
    ${over ? `<span class="status-tag serious">${icon('alert', { size: 14 })} über der Grenze</span>` : ''}
  </div>`;
}

export async function render(root, { args, app }) {
  const date = isISODate(args[0]) ? args[0] : todayISO();
  const day = await get(`/api/day?date=${date}`);
  const g = day.goals;
  const t = day.totals;
  const budget = g.kcal + day.burned;
  const left = budget - t.kcal;
  const isToday = date === todayISO();
  const refresh = () => app.rerender();

  const byMeal = Object.fromEntries(MEALS.map((m) => [m.key, day.entries.filter((e) => e.meal === m.key)]));

  root.innerHTML = `
    <header class="page-head date-nav">
      <a class="icon-btn" href="#/heute/${addDays(date, -1)}" aria-label="Vorheriger Tag">${icon('left')}</a>
      <label class="date-title">
        <span class="h1">${dayLabel(date)}</span>
        <small>${longDate(date, { weekday: isToday || Math.abs(fromISO(date) - fromISO(todayISO())) < 2 * 86400000 ? 'long' : undefined, year: date.slice(0, 4) !== todayISO().slice(0, 4) ? 'numeric' : undefined })}</small>
        <input type="date" value="${date}" aria-label="Datum wählen">
      </label>
      <a class="icon-btn" href="#/heute/${addDays(date, 1)}" aria-label="Nächster Tag">${icon('right')}</a>
    </header>
    ${isToday ? '' : `<p class="center"><a class="chip" href="#/heute">Zu heute springen</a></p>`}

    <section class="card summary" aria-label="Kalorienbilanz">
      <div class="ring-wrap">
        ${ring(t.kcal, budget)}
        <div class="ring-label">
          <b>${fmt(Math.abs(left))}</b>
          <span>${left >= 0 ? 'kcal übrig' : 'kcal zu viel'}</span>
        </div>
      </div>
      <dl class="ledger">
        <div><dt>Tagesziel</dt><dd>${fmt(g.kcal)}</dd></div>
        <div><dt>− Gegessen</dt><dd>${fmt(t.kcal)}</dd></div>
        <div><dt>+ Sport</dt><dd>${fmt(day.burned)}</dd></div>
        <div class="total ${left < 0 ? 'neg' : ''}"><dt>= ${left >= 0 ? 'Übrig' : 'Zu viel'}</dt><dd>${left < 0 ? '−' : ''}${fmt(Math.abs(left))}</dd></div>
      </dl>
    </section>

    <section class="card">
      <div class="meters">
        ${meter({ label: 'Eiweiß', value: t.protein, goal: g.protein, unit: 'g', slot: 's1' })}
        ${meter({ label: 'Kohlenhydrate', value: t.carbs, goal: g.carbs, unit: 'g', slot: 's2' })}
        ${meter({ label: 'Fett', value: t.fat, goal: g.fat, unit: 'g', slot: 's3' })}
      </div>
      <details class="more-nutrients">
        <summary>Weitere Nährwerte</summary>
        <div class="meters compact">
          ${meter({ label: 'Ballaststoffe', value: t.fiber, goal: g.fiber, unit: 'g' })}
          ${meter({ label: 'davon Zucker', value: t.sugar, goal: g.sugar, unit: 'g', limit: true })}
          ${meter({ label: 'gesättigte Fettsäuren', value: t.sat_fat, goal: g.sat_fat, unit: 'g', limit: true })}
          ${meter({ label: 'Natrium', value: t.sodium, goal: g.sodium, unit: 'mg', limit: true })}
        </div>
      </details>
    </section>

    ${MEALS.map((m) => {
      const list = byMeal[m.key];
      const kcal = list.reduce((s, e) => s + e.kcal * entryFactor(e), 0);
      return `<section class="card meal" data-meal="${m.key}">
        <header class="meal-head">
          <h2>${m.label}</h2>
          <span class="meal-kcal">${list.length ? `${fmt(kcal)} kcal` : ''}</span>
          <button type="button" class="icon-btn accent" data-add="${m.key}" aria-label="${m.label}: hinzufügen">${icon('plus')}</button>
        </header>
        ${list.length ? `<ul class="list">${list.map((e) => {
          const f = entryFactor(e);
          return `<li><button type="button" class="list-item" data-entry="${e.id}">
            <span class="li-main"><span class="li-title">${esc(e.name)}</span>
              <span class="li-sub">${esc(servingLabel(e.qty, e.serving_unit))} · ${macroLine(e, f)}</span></span>
            <span class="li-value">${fmt(e.kcal * f)}<small> kcal</small></span></button></li>`;
        }).join('')}</ul>` : `<div class="meal-empty">
            <button type="button" class="link-btn" data-add="${m.key}">${icon('plus', { size: 18 })} Eintragen</button>
            <button type="button" class="link-btn muted" data-copy="${m.key}">${icon('copy', { size: 16 })} Wie gestern</button>
          </div>`}
      </section>`;
    }).join('')}

    <section class="card meal">
      <header class="meal-head">
        <h2>Sport & Aktivität</h2>
        <span class="meal-kcal">${day.burned ? `${fmt(day.burned)} kcal` : ''}</span>
        <button type="button" class="icon-btn accent" data-exercise aria-label="Aktivität hinzufügen">${icon('plus')}</button>
      </header>
      ${day.exercises.length ? `<ul class="list">${day.exercises.map((x) => `
        <li class="list-item static">
          <span class="li-icon">${icon('flame', { size: 18 })}</span>
          <span class="li-main"><span class="li-title">${esc(x.name)}</span>${x.minutes ? `<span class="li-sub">${fmt(x.minutes)} min</span>` : ''}</span>
          <span class="li-value">${fmt(x.kcal)}<small> kcal</small></span>
          <button type="button" class="icon-btn small" data-del-exercise="${x.id}" aria-label="${esc(x.name)} löschen">${icon('trash', { size: 18 })}</button>
        </li>`).join('')}</ul>` : '<p class="meal-empty muted small">Verbrannte Kalorien erhöhen dein Tagesbudget.</p>'}
    </section>

    <section class="card weight-quick">
      ${day.weight
        ? `<span>${icon('scale', { size: 20 })} Gewicht: <b>${fmt(day.weight.weight, 1)} kg</b></span>
           <button type="button" class="link-btn" data-weight>Ändern</button>`
        : `<span class="muted">${icon('scale', { size: 20 })} Noch kein Gewicht ${isToday ? 'für heute' : 'an diesem Tag'}</span>
           <button type="button" class="link-btn" data-weight>Eintragen</button>`}
    </section>

    <button type="button" class="fab" data-add="${isToday ? mealForNow() : 'snack'}" aria-label="Essen hinzufügen">${icon('plus', { size: 28 })}</button>`;

  // Datum wählen
  const dateInput = root.querySelector('.date-title input');
  dateInput.addEventListener('change', () => {
    if (isISODate(dateInput.value)) app.navigate(`#/heute/${dateInput.value}`);
  });
  root.querySelector('.date-title').addEventListener('click', () => {
    try {
      dateInput.showPicker?.();
    } catch {}
  });

  root.addEventListener('click', async (e) => {
    const t2 = e.target;
    const add = t2.closest('[data-add]');
    const entryBtn = t2.closest('[data-entry]');
    const copy = t2.closest('[data-copy]');
    const delX = t2.closest('[data-del-exercise]');
    if (add) openAddEntry({ date, meal: add.dataset.add, onDone: refresh });
    else if (entryBtn) {
      const entry = day.entries.find((x) => x.id === Number(entryBtn.dataset.entry));
      openEntryEditor({ entry, onDone: refresh });
    } else if (copy) {
      busy(copy, async () => {
        try {
          const { copied } = await post('/api/entries/copy', { from: addDays(date, -1), to: date, meal: copy.dataset.copy });
          if (!copied) toast('Am Vortag gibt es dafür keine Einträge.', { type: 'error' });
          else {
            toast(`${copied} ${copied === 1 ? 'Eintrag' : 'Einträge'} übernommen`);
            refresh();
          }
        } catch (err) {
          showError(err);
        }
      });
    } else if (t2.closest('[data-exercise]')) {
      openExerciseSheet({ date, weight: app.me?.weight, onDone: refresh });
    } else if (delX) {
      busy(delX, async () => {
        try {
          await del(`/api/exercises/${delX.dataset.delExercise}`);
          refresh();
        } catch (err) {
          showError(err);
        }
      });
    } else if (t2.closest('[data-weight]')) {
      openWeightSheet({
        date,
        weight: day.weight?.weight ?? app.me?.weight,
        onDone: async () => {
          await app.refreshMe();
          refresh();
        },
      });
    }
  });
}
