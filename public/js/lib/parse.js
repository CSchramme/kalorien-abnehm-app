// Erkennt Nährwerte in kopiertem Text – z. B. aus einer Rezept-App, von einer Verpackung
// oder per iPhone "Live Text" aus einem Screenshot.
//
// Beispiel:
//   "Nährwerte pro 1 Portion  Natrium 1.326 mg  Eiweiß 35 g  Brennwert 2.778 kJ / 664 kcal ..."

import { KJ_PER_KCAL, SODIUM_MG_PER_G_SALT } from './calc.js';

const ALIASES = {
  sat_fat: [
    'davon gesättigte Fettsäuren', 'gesättigte Fettsäuren', 'Fettsäuren gesättigt', 'gesättigte Fette',
    'gesättigtes Fett', 'saturated fatty acids', 'saturated fat', 'saturates', 'sat fat', 'ges. Fettsäuren',
  ],
  sugar: ['davon Zucker', 'Zuckerarten', 'Zucker', 'sugars', 'sugar'],
  carbs: ['Kohlenhydrate', 'Kohlenhydrat', 'carbohydrates', 'carbohydrate', 'carbs'],
  fiber: ['Ballaststoffe', 'Ballaststoff', 'dietary fiber', 'fiber', 'fibre'],
  protein: ['Eiweiß', 'Eiweiss', 'Proteine', 'protein'],
  fat: ['Fett gesamt', 'total fat', 'Fett', 'Fette', 'fat'],
  sodium: ['Natrium', 'sodium'],
  salt: ['Kochsalz', 'Salz', 'salt'],
  kcal: ['Brennwert', 'Energiegehalt', 'Energie', 'Kalorien', 'energy', 'calories'],
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const aliasList = Object.entries(ALIASES)
  .flatMap(([key, names]) => names.map((name) => ({ key, name })))
  .sort((a, b) => b.name.length - a.name.length);

const aliasByLower = new Map(aliasList.map((a) => [a.name.toLowerCase(), a.key]));

const LABEL_RE = new RegExp(
  `(?<!\\p{L})(${aliasList.map((a) => escapeRe(a.name).replace(/\s+/g, '\\s+')).join('|')})(?!\\p{L})`,
  'giu',
);

// Zahl mit optionaler Einheit. "<" (z. B. "<0,5 g") wird ignoriert.
const VALUE_RE = /(\d+(?:[.,]\d+)*)\s*(kcal|kj|mg|µg|mcg|g|%)?(?!\p{L})/giu;

/** Deutsche und englische Zahlenformate: "1.326" → 1326, "3,5" → 3.5, "0.5" → 0.5 */
export function parseNumber(s) {
  s = String(s).trim();
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  const parts = s.split('.');
  if (parts.length > 2) return parseFloat(parts.join(''));
  if (parts.length === 2 && parts[1].length === 3 && !/^0+$/.test(parts[0])) {
    return parseFloat(parts.join('')); // Tausendertrennzeichen
  }
  return parseFloat(s);
}

function tokens(text, offset = 0) {
  const out = [];
  for (const m of text.matchAll(VALUE_RE)) {
    const unit = (m[2] || '').toLowerCase().replace('mcg', 'µg');
    if (unit === '%') continue;
    out.push({ value: parseNumber(m[1]), unit, index: offset + m.index, end: offset + m.index + m[0].length });
  }
  return out;
}

/** Wandelt einen Wert-Token in die Zieleinheit des Nährstoffs um */
function convert(key, tok) {
  const { value, unit } = tok;
  if (!Number.isFinite(value)) return null;
  if (key === 'sodium') {
    if (unit === 'g') return value * 1000;
    if (unit === 'µg') return value / 1000;
    return value; // mg oder ohne Einheit
  }
  if (key === 'salt') {
    if (unit === 'mg') return value / 1000;
    return value;
  }
  if (unit === 'mg') return value / 1000;
  if (unit === 'µg') return value / 1e6;
  if (unit === 'kcal' || unit === 'kj') return null;
  return value;
}

function energyFrom(toks) {
  const kcal = toks.find((t) => t.unit === 'kcal');
  if (kcal) return kcal.value;
  const kj = toks.find((t) => t.unit === 'kj');
  if (kj) return kj.value / KJ_PER_KCAL;
  const plain = toks.find((t) => !t.unit);
  return plain ? plain.value : null;
}

function detectServing(text) {
  const m = text.match(/(?:pro|je|per)\s+(\d+(?:[.,]\d+)?)\s*(g|ml)(?!\p{L})/iu);
  if (m) return { qty: parseNumber(m[1]), unit: m[2].toLowerCase() };
  if (/(?:pro|je|per)\s+(?:1\s+|einer?\s+)?(?:Portion|serving|Stück)/iu.test(text)) {
    return { qty: 1, unit: 'Portion' };
  }
  return null;
}

/**
 * @param {string} text
 * @returns {{ values: Record<string, number>, found: string[], serving: {qty:number, unit:string}|null }}
 */
export function parseNutrition(text) {
  text = String(text ?? '').replace(/ /g, ' ');
  const labels = [];
  for (const m of text.matchAll(LABEL_RE)) {
    const key = aliasByLower.get(m[1].toLowerCase().replace(/\s+/g, ' '));
    if (key) labels.push({ key, index: m.index, end: m.index + m[0].length });
  }

  const raw = {};
  const segments = labels.map((l, i) => {
    const segEnd = i + 1 < labels.length ? labels[i + 1].index : text.length;
    return tokens(text.slice(l.end, segEnd), l.end);
  });
  // Tabellen-Layout: erst alle Bezeichnungen, dann alle Werte (nur das letzte Label hat Werte dahinter)
  const emptyBeforeLast = segments.slice(0, -1).filter((s) => !s.length).length;
  const columnar = labels.length > 1 && emptyBeforeLast >= (labels.length - 1) / 2;

  // 1) Wert steht hinter dem Label (bis zum nächsten Label)
  if (!columnar) {
    labels.forEach((l, i) => {
      const toks = segments[i];
      if (!toks.length || raw[l.key] != null) return;
      const v = l.key === 'kcal' ? energyFrom(toks) : convert(l.key, toks[0]);
      if (v != null) raw[l.key] = v;
    });
  }

  // 2) Tabellen-Layout → Werte der Reihe nach den Bezeichnungen zuordnen
  if (columnar) {
    const after = tokens(text.slice(labels[labels.length - 1].end), labels[labels.length - 1].end);
    const merged = [];
    for (let i = 0; i < after.length; i++) {
      const t = after[i];
      const next = after[i + 1];
      // "2.778 kJ / 664 kcal" ist EIN Energiewert
      if (t.unit === 'kj' && next?.unit === 'kcal' && /^\s*[/|]?\s*$/.test(text.slice(t.end, next.index))) {
        merged.push([t, next]);
        i++;
      } else merged.push([t]);
    }
    const uniq = labels.filter((l, i) => labels.findIndex((x) => x.key === l.key) === i);
    if (merged.length >= uniq.length) {
      uniq.forEach((l, i) => {
        if (raw[l.key] != null) return;
        const v = l.key === 'kcal' ? energyFrom(merged[i]) : convert(l.key, merged[i][0]);
        if (v != null) raw[l.key] = v;
      });
    }
  }

  // 3) Energie ohne Label ("664 kcal")
  if (raw.kcal == null) {
    const t = tokens(text);
    const e = t.find((x) => x.unit === 'kcal') ?? t.find((x) => x.unit === 'kj');
    if (e) raw.kcal = e.unit === 'kcal' ? e.value : e.value / KJ_PER_KCAL;
  }

  // Salz → Natrium (nur wenn kein Natrium angegeben ist)
  if (raw.sodium == null && raw.salt != null) raw.sodium = raw.salt * SODIUM_MG_PER_G_SALT;
  delete raw.salt;

  const values = {};
  for (const [k, v] of Object.entries(raw)) {
    values[k] = k === 'kcal' || k === 'sodium' ? Math.round(v) : Math.round(v * 10) / 10;
  }
  return { values, found: Object.keys(values), serving: detectServing(text) };
}
