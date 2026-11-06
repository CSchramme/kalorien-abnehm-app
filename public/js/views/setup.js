// Einrichtung (beim ersten Start) bzw. "Körperdaten & Ziel bearbeiten"
import { put } from '../api.js';
import { esc, fmt, inputNum, parseDecimal, busy, showError, todayISO, toast, icon } from '../ui.js';
import { SEXES, ACTIVITY_LEVELS, RATES, computeGoals, isProfileComplete, calcBmi, bmiCategory } from '../lib/calc.js';

export async function render(root, { app }) {
  const me = app.me;
  const p = me.profile ?? {};
  const editing = isProfileComplete(p);
  const year = new Date().getFullYear();
  const rateValue = p.rate ?? 0.5;

  root.innerHTML = `
    <header class="page-head simple">
      ${editing ? `<a href="#/profil" class="icon-btn" aria-label="Zurück">${icon('left')}</a>` : ''}
      <div><h1>${editing ? 'Körperdaten & Ziel' : `Willkommen${me.user.name ? `, ${esc(me.user.name)}` : ''}!`}</h1>
      ${editing ? '' : '<p class="muted">Ein paar Angaben, dann berechnen wir dein persönliches Kalorienziel.</p>'}</div>
    </header>
    <form class="stack" novalidate>
      <section class="card form">
        <h2 class="card-title">Über dich</h2>
        <fieldset class="field"><legend>Geschlecht <small class="muted">(für den Grundumsatz)</small></legend>
          <div class="segmented">${SEXES.map((s) => `
            <label><input type="radio" name="sex" value="${s.key}" ${p.sex === s.key ? 'checked' : ''} required><span>${s.label}</span></label>`).join('')}
          </div></fieldset>
        <div class="grid-2">
          <label class="field"><span>Geburtsjahr</span>
            <input name="birth_year" inputmode="numeric" placeholder="z. B. 1990" value="${p.birth_year ?? ''}" min="${year - 110}" max="${year - 12}"></label>
          <label class="field"><span>Größe</span>
            <div class="input-unit"><input name="height_cm" inputmode="decimal" placeholder="170" value="${inputNum(p.height_cm, 0)}"><span>cm</span></div></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>${editing ? 'Startgewicht' : 'Aktuelles Gewicht'}</span>
            <div class="input-unit"><input name="start_weight" inputmode="decimal" placeholder="80" value="${inputNum(p.start_weight)}"><span>kg</span></div></label>
          <label class="field"><span>Zielgewicht</span>
            <div class="input-unit"><input name="goal_weight" inputmode="decimal" placeholder="72" value="${inputNum(p.goal_weight)}"><span>kg</span></div></label>
        </div>
        ${editing ? `<p class="small muted">Dein aktuelles Gewicht (${fmt(me.weight, 1)} kg) trägst du unter <a href="#/gewicht">Gewicht</a> ein.</p>` : ''}
      </section>

      <section class="card form">
        <h2 class="card-title">Wie aktiv bist du im Alltag?</h2>
        <div class="choice-list">${ACTIVITY_LEVELS.map((a) => `
          <label class="choice"><input type="radio" name="activity" value="${a.key}" ${(p.activity ?? 'light') === a.key ? 'checked' : ''}>
            <span><b>${a.label}</b><small>${a.hint}</small></span></label>`).join('')}
        </div>
      </section>

      <section class="card form">
        <h2 class="card-title">Wie schnell möchtest du abnehmen?</h2>
        <div class="choice-list">${RATES.map((r) => `
          <label class="choice"><input type="radio" name="rate" value="${r.value}" ${rateValue === r.value ? 'checked' : ''}>
            <span><b>${r.label}</b><small>${r.hint}</small></span></label>`).join('')}
        </div>
        <details class="field" ${p.kcal_override ? 'open' : ''}>
          <summary>Eigenes Kalorienziel festlegen</summary>
          <label class="field"><span>Tagesziel (leer = automatisch)</span>
            <div class="input-unit"><input name="kcal_override" inputmode="numeric" placeholder="z. B. 1800" value="${p.kcal_override ?? ''}"><span>kcal</span></div></label>
        </details>
      </section>

      <section class="card goal-preview" aria-live="polite"></section>

      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">${editing ? 'Speichern' : 'Los geht’s'}</button>
      <p class="small muted center">Die Berechnung (Mifflin-St Jeor) ist eine Schätzung und ersetzt keine ärztliche Beratung.</p>
    </form>`;

  const form = root.querySelector('form');
  const preview = root.querySelector('.goal-preview');
  const errorBox = root.querySelector('.form-error');

  const read = () => {
    const fd = new FormData(form);
    return {
      sex: fd.get('sex') || null,
      birth_year: parseDecimal(fd.get('birth_year')),
      height_cm: parseDecimal(fd.get('height_cm')),
      start_weight: parseDecimal(fd.get('start_weight')),
      goal_weight: parseDecimal(fd.get('goal_weight')),
      activity: fd.get('activity'),
      rate: Number(fd.get('rate') ?? 0.5),
      kcal_override: parseDecimal(fd.get('kcal_override')),
    };
  };

  const update = () => {
    const v = read();
    const weight = editing ? me.weight : v.start_weight;
    const valid = v.sex && v.birth_year > 1900 && v.height_cm >= 100 && v.start_weight >= 30;
    const g = valid ? computeGoals(v, weight) : null;
    if (!g) {
      preview.innerHTML = `<p class="muted">Fülle die Angaben aus, um dein Tagesziel zu sehen.</p>`;
      return;
    }
    const bmi = calcBmi(weight, v.height_cm);
    const toLose = v.goal_weight ? weight - v.goal_weight : 0;
    const weeks = g.rate > 0 && toLose > 0 ? Math.ceil(toLose / g.rate) : 0;
    const targetDate = weeks
      ? new Date(Date.now() + weeks * 7 * 86400000).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
      : null;
    preview.innerHTML = `
      <p class="eyebrow">Dein Tagesziel</p>
      <p class="hero-number">${fmt(g.kcal)} <small>kcal</small></p>
      <dl class="kv">
        <div><dt>Grundumsatz</dt><dd>${fmt(g.bmr)} kcal</dd></div>
        <div><dt>Gesamtumsatz</dt><dd>${fmt(g.tdee)} kcal</dd></div>
        <div><dt>Tägliches Defizit</dt><dd>${fmt(g.deficit)} kcal</dd></div>
        <div><dt>BMI</dt><dd>${fmt(bmi, 1)} · ${bmiCategory(bmi)}</dd></div>
        <div><dt>Eiweiß · KH · Fett</dt><dd>${g.protein} · ${g.carbs} · ${g.fat} g</dd></div>
      </dl>
      ${targetDate ? `<p class="note">${icon('target', { size: 18 })}<span>Ziel ${fmt(v.goal_weight, 1)} kg voraussichtlich im <b>${targetDate}</b>.</span></p>` : ''}
      ${!v.goal_weight || toLose <= 0 ? `<p class="note">${icon('info', { size: 18 })}<span>Ohne niedrigeres Zielgewicht wird dein Gewicht gehalten.</span></p>` : ''}
      ${g.limited ? `<p class="note warn">${icon('alert', { size: 18 })}<span>Das gewählte Tempo würde unter ${fmt(g.kcal)} kcal führen. Wir haben das Ziel auf diesen Mindestwert begrenzt.</span></p>` : ''}`;
  };

  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    const v = read();
    if (!v.sex) return showError(new Error('Bitte wähle ein Geschlecht aus.'), errorBox);
    busy(form.querySelector('[type=submit]'), async () => {
      try {
        await put('/api/profile', { ...v, today: todayISO() });
        await app.refreshMe();
        toast(editing ? 'Gespeichert' : 'Alles bereit – viel Erfolg!');
        app.navigate(editing ? '#/profil' : '#/heute');
      } catch (err) {
        showError(err, errorBox);
      }
    });
  });
}
