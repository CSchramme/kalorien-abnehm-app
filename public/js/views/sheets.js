// Wiederverwendbare Bottom-Sheets: Lebensmittel anlegen/bearbeiten, Eintrag hinzufügen/bearbeiten,
// Sport und Gewicht eintragen.
import { get, post, put, del } from '../api.js';
import {
  $, $$, esc, fmt, inputNum, parseDecimal, icon, openSheet, busy, showError, toast, confirmDialog, todayISO,
} from '../ui.js';
import { NUTRIENTS, MEALS, KJ_PER_KCAL, SODIUM_MG_PER_G_SALT, entryFactor } from '../lib/calc.js';
import { parseNutrition } from '../lib/parse.js';

const UNITS = ['Portion', 'g', 'ml', 'Stück', 'Scheibe', 'EL', 'TL', 'Becher', 'Glas', 'Riegel'];
const isMassUnit = (u) => /^(g|ml)$/i.test(u);

export function servingLabel(qty, unit) {
  return `${fmt(qty, 2)} ${unit}`;
}

export function macroLine(v, factor = 1) {
  return `E ${fmt(v.protein * factor)} · KH ${fmt(v.carbs * factor)} · F ${fmt(v.fat * factor)}`;
}

// ---------- Nährwert-Tabelle ----------

export function nutritionTable(values, factor = 1) {
  const rows = NUTRIENTS.map((n) => {
    const v = (Number(values[n.key]) || 0) * factor;
    const shown = n.key === 'kcal'
      ? `${fmt(v * KJ_PER_KCAL)} kJ / ${fmt(v)} kcal`
      : `${fmt(v, n.unit === 'mg' ? 0 : 1)} ${n.unit}`;
    return `<div class="nt-row${n.key === 'sugar' || n.key === 'sat_fat' ? ' nt-sub' : ''}"><dt>${n.label}</dt><dd>${shown}</dd></div>`;
  });
  return `<dl class="nutrition-table">${rows.join('')}</dl>`;
}

// ---------- Lebensmittel-Formular ----------

function field(name, label, unit, value, attrs = '') {
  return `<label class="field"><span>${label}</span>
    <div class="input-unit"><input name="${name}" inputmode="decimal" autocomplete="off" value="${esc(value)}" ${attrs}><span>${unit}</span></div></label>`;
}

export function foodFormHtml(food = {}) {
  const v = (k, d = 1) => inputNum(food[k], d);
  const salt = food.sodium ? inputNum(food.sodium / SODIUM_MG_PER_G_SALT, 2) : '';
  return `
    <div class="paste-box">
      <button type="button" class="btn btn-soft btn-block" data-paste-toggle>${icon('clipboard', { size: 20 })} Nährwerte aus Text übernehmen</button>
      <div class="paste-area" hidden>
        <textarea rows="4" placeholder="Nährwert-Text hier einfügen, z. B. „Brennwert 2.778 kJ / 664 kcal, Eiweiß 35 g …“"></textarea>
        <div class="btn-row">
          <button type="button" class="btn btn-ghost" data-clipboard>Aus Zwischenablage</button>
          <button type="button" class="btn btn-soft" data-parse>Erkennen</button>
        </div>
        <p class="small muted">Tipp fürs iPhone: Screenshot der Nährwerte öffnen, Text lange drücken → „Alles auswählen“ → „Kopieren“ und hier einfügen.</p>
        <p class="parse-result small" aria-live="polite"></p>
      </div>
    </div>
    <label class="field"><span>Name</span>
      <input name="name" required maxlength="120" autocomplete="off" placeholder="z. B. Paprika-Kichererbsen-Topf" value="${esc(food.name ?? '')}"></label>
    <div class="field"><span>Nährwerte pro</span>
      <div class="grid-2">
        <input name="serving_qty" inputmode="decimal" aria-label="Menge" value="${v('serving_qty', 2) || '1'}">
        <input name="serving_unit" list="unit-list" aria-label="Einheit" maxlength="30" value="${esc(food.serving_unit ?? 'Portion')}">
      </div>
      <datalist id="unit-list">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>
    </div>
    <div class="grid-2">
      ${field('kcal', 'Brennwert', 'kcal', v('kcal', 0))}
      ${field('kj', '&nbsp;', 'kJ', food.kcal ? inputNum(food.kcal * KJ_PER_KCAL, 0) : '', 'aria-label="Brennwert in Kilojoule"')}
    </div>
    <div class="grid-2">
      ${field('protein', 'Eiweiß', 'g', v('protein'))}
      ${field('carbs', 'Kohlenhydrate', 'g', v('carbs'))}
    </div>
    <div class="grid-2">
      ${field('fat', 'Fett', 'g', v('fat'))}
      ${field('sat_fat', 'ges. Fettsäuren', 'g', v('sat_fat'))}
    </div>
    <div class="grid-2">
      ${field('sugar', 'davon Zucker', 'g', v('sugar'))}
      ${field('fiber', 'Ballaststoffe', 'g', v('fiber'))}
    </div>
    <div class="grid-2">
      ${field('sodium', 'Natrium', 'mg', v('sodium', 0))}
      ${field('salt', 'oder Salz', 'g', salt)}
    </div>
    <label class="check"><input type="checkbox" name="favorite" ${food.favorite ? 'checked' : ''}><span>Als Favorit oben anzeigen</span></label>`;
}

/** Verknüpft kJ↔kcal und Salz↔Natrium, Einfüge-Erkennung; gibt read() zurück. */
export function bindFoodForm(el) {
  const input = (n) => el.querySelector(`[name="${n}"]`);
  const set = (n, v, d = 1) => (input(n).value = v == null || Number.isNaN(v) ? '' : inputNum(v, d));
  const link = (a, b, toB, digitsB) =>
    input(a).addEventListener('input', () => {
      const n = parseDecimal(input(a).value);
      set(b, n == null || Number.isNaN(n) ? null : toB(n), digitsB);
    });
  link('kcal', 'kj', (n) => n * KJ_PER_KCAL, 0);
  link('kj', 'kcal', (n) => n / KJ_PER_KCAL, 0);
  link('sodium', 'salt', (n) => n / SODIUM_MG_PER_G_SALT, 2);
  link('salt', 'sodium', (n) => n * SODIUM_MG_PER_G_SALT, 0);

  const area = el.querySelector('.paste-area');
  const textarea = area.querySelector('textarea');
  const result = area.querySelector('.parse-result');
  const apply = () => {
    const { values, found, serving } = parseNutrition(textarea.value);
    if (!found.length) {
      result.textContent = 'Keine Nährwerte erkannt. Prüfe den Text oder trage die Werte unten ein.';
      result.className = 'parse-result small warn';
      return;
    }
    for (const n of NUTRIENTS) {
      if (n.key in values) set(n.key, values[n.key], n.key === 'kcal' || n.key === 'sodium' ? 0 : 1);
      else if (n.key !== 'kcal') set(n.key, null);
    }
    if ('kcal' in values) set('kj', values.kcal * KJ_PER_KCAL, 0);
    set('salt', values.sodium != null ? values.sodium / SODIUM_MG_PER_G_SALT : null, 2);
    if (serving) {
      set('serving_qty', serving.qty, 2);
      input('serving_unit').value = serving.unit;
    }
    const labels = NUTRIENTS.filter((n) => found.includes(n.key)).map((n) => n.label);
    result.textContent = `✓ ${found.length} Werte übernommen: ${labels.join(', ')}${serving ? ` (pro ${servingLabel(serving.qty, serving.unit)})` : ''}`;
    result.className = 'parse-result small ok';
    if (!input('name').value) input('name').focus();
  };
  el.querySelector('[data-paste-toggle]').addEventListener('click', () => {
    area.hidden = !area.hidden;
    if (!area.hidden) textarea.focus();
  });
  el.querySelector('[data-parse]').addEventListener('click', apply);
  textarea.addEventListener('paste', () => setTimeout(apply, 0));
  const clipBtn = el.querySelector('[data-clipboard]');
  if (!navigator.clipboard?.readText) clipBtn.hidden = true;
  clipBtn.addEventListener('click', async () => {
    try {
      textarea.value = await navigator.clipboard.readText();
      apply();
    } catch {
      toast('Kein Zugriff auf die Zwischenablage – bitte manuell einfügen.', { type: 'error' });
    }
  });

  return function read() {
    const out = {
      name: input('name').value.trim(),
      serving_qty: parseDecimal(input('serving_qty').value) ?? 1,
      serving_unit: input('serving_unit').value.trim() || 'Portion',
      favorite: input('favorite').checked,
    };
    if (!out.name) throw new Error('Bitte gib einen Namen ein.');
    if (!(out.serving_qty > 0)) throw new Error('Die Bezugsmenge muss größer als 0 sein.');
    for (const n of NUTRIENTS) {
      const v = parseDecimal(input(n.key).value);
      if (Number.isNaN(v) || v < 0) throw new Error(`${n.label}: bitte eine gültige Zahl eingeben.`);
      out[n.key] = v ?? 0;
    }
    return out;
  };
}

/** Lebensmittel anlegen oder bearbeiten */
export function openFoodEditor({ food = null, onSaved } = {}) {
  openSheet({
    title: food ? 'Lebensmittel bearbeiten' : 'Neues Lebensmittel',
    className: 'sheet-tall',
    body: `<form class="form" novalidate>${foodFormHtml(food ?? {})}
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row">
        ${food ? `<button type="button" class="btn btn-ghost danger" data-delete>${icon('trash', { size: 18 })} Löschen</button>` : ''}
        <button type="submit" class="btn btn-primary">Speichern</button>
      </div></form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      const read = bindFoodForm(form);
      const errorBox = form.querySelector('.form-error');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        errorBox.hidden = true;
        busy(form.querySelector('[type=submit]'), async () => {
          try {
            const data = read();
            const res = food ? await put(`/api/foods/${food.id}`, data) : await post('/api/foods', data);
            toast('Gespeichert');
            close();
            onSaved?.(res.food);
          } catch (err) {
            showError(err, errorBox);
          }
        });
      });
      form.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!(await confirmDialog({
          title: 'Lebensmittel löschen?',
          message: `„${food.name}“ wird aus deiner Liste entfernt. Bereits eingetragene Mahlzeiten bleiben erhalten.`,
          confirmLabel: 'Löschen',
          danger: true,
        }))) return;
        try {
          await del(`/api/foods/${food.id}`);
          toast('Gelöscht');
          close();
          onSaved?.(null);
        } catch (err) {
          showError(err);
        }
      });
    },
  });
}

// ---------- Mengen-Auswahl ----------

function amountHtml(item, qty, { mealPicker = null } = {}) {
  const unit = item.serving_unit;
  const mass = isMassUnit(unit);
  const chips = [0.5, 1, 1.5, 2].map((f) => item.serving_qty * f);
  const FRACTIONS = { 0.5: '½', 1: '1', 1.5: '1½', 2: '2' };
  const chipLabel = (c) => (mass ? `${fmt(c, 2)} ${esc(unit)}` : `${FRACTIONS[c / item.serving_qty] ?? fmt(c, 2)} ×`);
  return `
    <div class="amount">
      <p class="muted small">Nährwerte pro ${esc(servingLabel(item.serving_qty, unit))}</p>
      <div class="qty-row">
        <button type="button" class="round-btn" data-step="-1" aria-label="Weniger">${icon('minus')}</button>
        <div class="input-unit big"><input name="qty" inputmode="decimal" autocomplete="off" aria-label="Menge" value="${inputNum(qty, 2)}"><span>${esc(unit)}</span></div>
        <button type="button" class="round-btn" data-step="1" aria-label="Mehr">${icon('plus')}</button>
      </div>
      <div class="chips">${chips.map((c) => `<button type="button" class="chip" data-qty="${c}">${chipLabel(c)}</button>`).join('')}</div>
      ${mealPicker ? mealSegment(mealPicker, 'meal-edit') : ''}
      <div class="amount-preview"></div>
    </div>`;
}

function bindAmount(el, item) {
  const qtyInput = el.querySelector('[name="qty"]');
  const preview = el.querySelector('.amount-preview');
  const step = isMassUnit(item.serving_unit) ? Math.max(1, Math.round(item.serving_qty / 10)) : item.serving_qty * 0.25;
  const readQty = () => parseDecimal(qtyInput.value);
  const update = () => {
    const q = readQty();
    const f = q > 0 ? q / item.serving_qty : 0;
    preview.innerHTML = `
      <p class="hero-number">${fmt(item.kcal * f)} <small>kcal</small></p>
      <div class="macro-pills">
        <span><i class="dot s1"></i>Eiweiß <b>${fmt(item.protein * f, 1)} g</b></span>
        <span><i class="dot s2"></i>KH <b>${fmt(item.carbs * f, 1)} g</b></span>
        <span><i class="dot s3"></i>Fett <b>${fmt(item.fat * f, 1)} g</b></span>
      </div>
      <details class="small"><summary>Alle Nährwerte</summary>${nutritionTable(item, f)}</details>`;
  };
  el.addEventListener('click', (e) => {
    const s = e.target.closest('[data-step]');
    const c = e.target.closest('[data-qty]');
    if (s) {
      const next = Math.max(step, (readQty() || 0) + step * Number(s.dataset.step));
      qtyInput.value = inputNum(Math.round(next * 100) / 100, 2);
      update();
    } else if (c) {
      qtyInput.value = inputNum(Number(c.dataset.qty), 2);
      update();
    }
  });
  qtyInput.addEventListener('input', update);
  update();
  return () => {
    const q = readQty();
    if (!(q > 0)) throw new Error('Bitte gib eine Menge größer als 0 ein.');
    return q;
  };
}

function mealSegment(selected, name = 'meal') {
  return `<div class="segmented small meal-seg" role="radiogroup" aria-label="Mahlzeit">${MEALS.map((m) => `
    <label><input type="radio" name="${name}" value="${m.key}" ${m.key === selected ? 'checked' : ''}><span>${m.label}</span></label>`).join('')}</div>`;
}

// ---------- Eintrag hinzufügen ----------

export function openAddEntry({ date, meal, onDone }) {
  let foods = null;
  openSheet({
    title: 'Hinzufügen',
    className: 'sheet-tall',
    body: `
      ${mealSegment(meal)}
      <div class="picker">
        <div class="segmented tabs" role="tablist">
          <button type="button" role="tab" class="active" data-tab="search">Meine Liste</button>
          <button type="button" role="tab" data-tab="quick">Schnell</button>
          <button type="button" role="tab" data-tab="new">Neu</button>
        </div>
        <div data-panel="search">
          <label class="search-field">${icon('search', { size: 20 })}<input type="search" placeholder="Lebensmittel oder Rezept suchen" aria-label="Suchen" autocomplete="off"></label>
          <ul class="list food-list"><li class="muted small pad">Lädt …</li></ul>
        </div>
        <form data-panel="quick" class="form" hidden novalidate>
          <label class="field"><span>Bezeichnung <small class="muted">(optional)</small></span>
            <input name="name" maxlength="120" placeholder="z. B. Kuchen beim Bäcker"></label>
          <label class="field"><span>Kalorien</span>
            <div class="input-unit"><input name="kcal" inputmode="decimal" placeholder="0" required><span>kcal</span></div></label>
          <div class="grid-3">
            <label class="field"><span>Eiweiß</span><div class="input-unit"><input name="protein" inputmode="decimal"><span>g</span></div></label>
            <label class="field"><span>KH</span><div class="input-unit"><input name="carbs" inputmode="decimal"><span>g</span></div></label>
            <label class="field"><span>Fett</span><div class="input-unit"><input name="fat" inputmode="decimal"><span>g</span></div></label>
          </div>
          <label class="check"><input type="checkbox" name="save_as_food"><span>In „Meine Lebensmittel“ speichern</span></label>
          <p class="form-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block" type="submit">Eintragen</button>
        </form>
        <form data-panel="new" class="form" hidden novalidate>
          ${foodFormHtml({})}
          <p class="form-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block" type="submit">Speichern & weiter</button>
        </form>
      </div>
      <form class="amount-step form" hidden novalidate></form>`,
    async onMount(el, close) {
      const currentMeal = () => el.querySelector('[name="meal"]:checked')?.value ?? meal;
      const picker = el.querySelector('.picker');
      const step = el.querySelector('.amount-step');
      const list = el.querySelector('.food-list');
      const search = el.querySelector('[type="search"]');

      // Tabs
      el.querySelector('.tabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab]');
        if (!b) return;
        $$('[data-tab]', el).forEach((t) => {
          t.classList.toggle('active', t === b);
          t.setAttribute('aria-selected', t === b);
        });
        $$('[data-panel]', el).forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.tab));
      });

      // Mengen-Schritt
      const showAmount = (food) => {
        picker.hidden = true;
        step.hidden = false;
        step.innerHTML = `
          <button type="button" class="link-btn" data-back>${icon('left', { size: 18 })} Zurück</button>
          <h3 class="amount-title">${esc(food.name)}</h3>
          ${amountHtml(food, food.serving_qty)}
          <p class="form-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block" type="submit">Zu ${esc(MEALS.find((m) => m.key === currentMeal()).label)} hinzufügen</button>`;
        const readQty = bindAmount(step, food);
        step.querySelector('[data-back]').addEventListener('click', () => {
          step.hidden = true;
          picker.hidden = false;
        });
        step.onsubmit = (e) => {
          e.preventDefault();
          busy(step.querySelector('[type=submit]'), async () => {
            try {
              await post('/api/entries', { date, meal: currentMeal(), food_id: food.id, qty: readQty() });
              toast(`${food.name} eingetragen`);
              close();
              onDone?.();
            } catch (err) {
              showError(err, step.querySelector('.form-error'));
            }
          });
        };
        step.querySelector('[name="qty"]').select?.();
      };

      // Liste
      const renderList = () => {
        const words = search.value.trim().toLocaleLowerCase('de').split(/\s+/).filter(Boolean);
        const hits = foods.filter((f) => words.every((w) => f.name.toLocaleLowerCase('de').includes(w)));
        if (!foods.length) {
          list.innerHTML = `<li class="empty-inline">Noch nichts gespeichert. Lege unter <b>Neu</b> dein erstes Lebensmittel oder Rezept an – oder trage unter <b>Schnell</b> nur die Kalorien ein.</li>`;
          return;
        }
        if (!hits.length) {
          list.innerHTML = `<li class="empty-inline">Nichts gefunden. Unter <b>Neu</b> kannst du „${esc(search.value)}“ anlegen.</li>`;
          return;
        }
        list.innerHTML = hits.slice(0, 100).map((f) => `
          <li><button type="button" class="list-item" data-food="${f.id}">
            <span class="li-main"><span class="li-title">${f.favorite ? icon('star', { size: 14, fill: true, cls: 'fav' }) : ''}${esc(f.name)}</span>
              <span class="li-sub">${esc(servingLabel(f.serving_qty, f.serving_unit))} · ${macroLine(f)}</span></span>
            <span class="li-value">${fmt(f.kcal)}<small> kcal</small></span>
          </button></li>`).join('');
      };
      list.addEventListener('click', (e) => {
        const b = e.target.closest('[data-food]');
        if (b) showAmount(foods.find((f) => f.id === Number(b.dataset.food)));
      });
      search.addEventListener('input', () => foods && renderList());

      // Schnelleintrag
      const quick = el.querySelector('[data-panel="quick"]');
      quick.addEventListener('submit', (e) => {
        e.preventDefault();
        const box = quick.querySelector('.form-error');
        box.hidden = true;
        busy(quick.querySelector('[type=submit]'), async () => {
          try {
            const fd = new FormData(quick);
            const kcal = parseDecimal(fd.get('kcal'));
            if (!(kcal >= 0) || kcal === null) throw new Error('Bitte gib die Kalorien ein.');
            const body = { date, meal: currentMeal(), name: fd.get('name') || 'Schnelleintrag', kcal, save_as_food: !!fd.get('save_as_food') };
            for (const k of ['protein', 'carbs', 'fat']) {
              const v = parseDecimal(fd.get(k));
              if (Number.isNaN(v)) throw new Error('Bitte nur Zahlen eingeben.');
              body[k] = v ?? 0;
            }
            await post('/api/entries', body);
            toast('Eingetragen');
            close();
            onDone?.();
          } catch (err) {
            showError(err, box);
          }
        });
      });

      // Neues Lebensmittel → danach Menge wählen
      const newForm = el.querySelector('[data-panel="new"]');
      const readFood = bindFoodForm(newForm);
      newForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const box = newForm.querySelector('.form-error');
        box.hidden = true;
        busy(newForm.querySelector('[type=submit]'), async () => {
          try {
            const { food } = await post('/api/foods', readFood());
            foods?.unshift(food);
            showAmount(food);
          } catch (err) {
            showError(err, box);
          }
        });
      });

      try {
        foods = (await get('/api/foods?limit=500')).foods;
        renderList();
        if (!foods.length) el.querySelector('[data-tab="new"]').click();
      } catch (err) {
        list.innerHTML = `<li class="empty-inline">${esc(err.message)}</li>`;
      }
    },
  });
}

// ---------- Eintrag bearbeiten ----------

export function openEntryEditor({ entry, onDone }) {
  openSheet({
    title: entry.name,
    body: `<form class="form" novalidate>
      ${amountHtml(entry, entry.qty, { mealPicker: entry.meal })}
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row">
        <button type="button" class="btn btn-ghost danger" data-delete>${icon('trash', { size: 18 })} Entfernen</button>
        <button type="submit" class="btn btn-primary">Speichern</button>
      </div></form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      const readQty = bindAmount(form, entry);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(form.querySelector('[type=submit]'), async () => {
          try {
            const meal = form.querySelector('[name="meal-edit"]:checked')?.value ?? entry.meal;
            await put(`/api/entries/${entry.id}`, { qty: readQty(), meal });
            toast('Gespeichert');
            close();
            onDone?.();
          } catch (err) {
            showError(err, form.querySelector('.form-error'));
          }
        });
      });
      form.querySelector('[data-delete]').addEventListener('click', () =>
        busy(form.querySelector('[data-delete]'), async () => {
          try {
            await del(`/api/entries/${entry.id}`);
            toast('Entfernt');
            close();
            onDone?.();
          } catch (err) {
            showError(err);
          }
        }),
      );
    },
  });
}

// ---------- Sport ----------

// MET-Werte (Compendium of Physical Activities, gerundet)
const ACTIVITIES = {
  'Spazierengehen': 3, 'Gehen (zügig)': 4.3, 'Joggen': 8, 'Laufen (schnell)': 11, 'Radfahren': 6.8,
  'Schwimmen': 7, 'Krafttraining': 5, 'Yoga': 2.5, 'Wandern': 6, 'Tanzen': 5, 'Fußball': 7,
  'HIIT': 8, 'Gartenarbeit': 4, 'Treppensteigen': 8, 'Rudern': 7, 'Tennis': 7.3,
};

export function openExerciseSheet({ date, weight, onDone }) {
  openSheet({
    title: 'Sport & Aktivität',
    body: `<form class="form" novalidate>
      <label class="field"><span>Aktivität</span>
        <input name="name" list="activity-list" required maxlength="80" placeholder="z. B. Joggen" autocomplete="off"></label>
      <datalist id="activity-list">${Object.keys(ACTIVITIES).map((a) => `<option value="${a}">`).join('')}</datalist>
      <div class="grid-2">
        <label class="field"><span>Dauer</span><div class="input-unit"><input name="minutes" inputmode="numeric" placeholder="30"><span>min</span></div></label>
        <label class="field"><span>Verbrauch</span><div class="input-unit"><input name="kcal" inputmode="numeric" placeholder="0"><span>kcal</span></div></label>
      </div>
      <p class="small muted estimate">Wähle eine Aktivität aus der Liste und gib die Dauer ein – der Verbrauch wird dann geschätzt.</p>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Eintragen</button></form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      const kcal = form.querySelector('[name="kcal"]');
      const nameInput = form.querySelector('[name="name"]');
      const minutesInput = form.querySelector('[name="minutes"]');
      const hint = form.querySelector('.estimate');
      let touched = false;
      kcal.addEventListener('input', () => (touched = true));
      form.addEventListener('input', (e) => {
        if (e.target === kcal) return;
        const met = ACTIVITIES[nameInput.value.trim()];
        const min = parseDecimal(minutesInput.value);
        if (met && min > 0 && weight) {
          const est = Math.round(met * weight * (min / 60));
          hint.textContent = `Geschätzt: ca. ${fmt(est)} kcal (MET ${fmt(met, 1)} × ${fmt(weight, 1)} kg × ${fmt(min)} min).`;
          if (!touched) kcal.value = est;
        }
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(form.querySelector('[type=submit]'), async () => {
          try {
            const k = parseDecimal(kcal.value);
            if (!nameInput.value.trim()) throw new Error('Bitte gib eine Aktivität ein.');
            if (!(k >= 0) || k === null) throw new Error('Bitte gib den Kalorienverbrauch ein.');
            await post('/api/exercises', { date, name: nameInput.value, minutes: parseDecimal(minutesInput.value), kcal: k });
            toast('Aktivität eingetragen');
            close();
            onDone?.();
          } catch (err) {
            showError(err, form.querySelector('.form-error'));
          }
        });
      });
    },
  });
}

// ---------- Gewicht ----------

export function openWeightSheet({ date = todayISO(), weight, onDone }) {
  openSheet({
    title: 'Gewicht eintragen',
    body: `<form class="form" novalidate>
      <div class="grid-2">
        <label class="field"><span>Datum</span><input type="date" name="date" value="${esc(date)}" max="${todayISO()}" required></label>
        <label class="field"><span>Gewicht</span><div class="input-unit"><input name="weight" inputmode="decimal" autocomplete="off" value="${inputNum(weight, 1)}" autofocus><span>kg</span></div></label>
      </div>
      <p class="small muted">Tipp: Wiege dich morgens nach dem Aufstehen – so sind die Werte am besten vergleichbar.</p>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Speichern</button></form>`,
    onMount(el, close) {
      const form = el.querySelector('form');
      const w = form.querySelector('[name="weight"]');
      setTimeout(() => w.select?.(), 250);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(form.querySelector('[type=submit]'), async () => {
          try {
            const v = parseDecimal(w.value);
            if (!(v >= 20 && v <= 400)) throw new Error('Bitte gib ein gültiges Gewicht ein.');
            await post('/api/weights', { date: form.querySelector('[name="date"]').value, weight: v });
            toast('Gewicht gespeichert');
            close();
            onDone?.();
          } catch (err) {
            showError(err, form.querySelector('.form-error'));
          }
        });
      });
    },
  });
}

export { entryFactor };
