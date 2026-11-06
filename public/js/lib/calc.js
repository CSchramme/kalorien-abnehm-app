// Gemeinsame Konstanten und Berechnungen – werden vom Browser UND vom Server importiert.

export const NUTRIENTS = [
  { key: 'kcal', label: 'Brennwert', short: 'kcal', unit: 'kcal', max: 20000 },
  { key: 'protein', label: 'Eiweiß', short: 'Eiweiß', unit: 'g', max: 5000 },
  { key: 'carbs', label: 'Kohlenhydrate', short: 'KH', unit: 'g', max: 5000 },
  { key: 'sugar', label: 'davon Zucker', short: 'Zucker', unit: 'g', max: 5000 },
  { key: 'fat', label: 'Fett', short: 'Fett', unit: 'g', max: 5000 },
  { key: 'sat_fat', label: 'gesättigte Fettsäuren', short: 'ges. Fett', unit: 'g', max: 5000 },
  { key: 'fiber', label: 'Ballaststoffe', short: 'Ballastst.', unit: 'g', max: 5000 },
  { key: 'sodium', label: 'Natrium', short: 'Natrium', unit: 'mg', max: 200000 },
];
export const NUTRIENT_KEYS = NUTRIENTS.map((n) => n.key);

export const KJ_PER_KCAL = 4.184;
export const KCAL_PER_KG_FAT = 7700;
/** 1 g Salz enthält ca. 0,4 g = 400 mg Natrium */
export const SODIUM_MG_PER_G_SALT = 400;

export const MEALS = [
  { key: 'breakfast', label: 'Frühstück' },
  { key: 'lunch', label: 'Mittagessen' },
  { key: 'dinner', label: 'Abendessen' },
  { key: 'snack', label: 'Snacks' },
];
export const MEAL_KEYS = MEALS.map((m) => m.key);

export const SEXES = [
  { key: 'f', label: 'Weiblich' },
  { key: 'm', label: 'Männlich' },
  { key: 'd', label: 'Divers' },
];

export const ACTIVITY_LEVELS = [
  { key: 'sedentary', label: 'Kaum aktiv', hint: 'Bürojob, wenig Bewegung', factor: 1.2 },
  { key: 'light', label: 'Leicht aktiv', hint: '1–3× Sport pro Woche', factor: 1.375 },
  { key: 'moderate', label: 'Mäßig aktiv', hint: '3–5× Sport pro Woche', factor: 1.55 },
  { key: 'active', label: 'Sehr aktiv', hint: '6–7× Sport pro Woche', factor: 1.725 },
  { key: 'very_active', label: 'Extrem aktiv', hint: 'Körperliche Arbeit + Training', factor: 1.9 },
];

export const RATES = [
  { value: 0.25, label: '0,25 kg / Woche', hint: 'sanft' },
  { value: 0.5, label: '0,5 kg / Woche', hint: 'empfohlen' },
  { value: 0.75, label: '0,75 kg / Woche', hint: 'zügig' },
  { value: 1, label: '1 kg / Woche', hint: 'ambitioniert' },
];

/** Untergrenzen, unter die das automatisch berechnete Kalorienziel nicht fällt */
export const MIN_KCAL = { f: 1200, m: 1500, d: 1350 };

export function round(v, digits = 0) {
  const f = 10 ** digits;
  return Math.round((Number(v) || 0) * f) / f;
}

/** Grundumsatz nach Mifflin-St Jeor */
export function calcBmr({ sex, weight, height, age }) {
  const base = 10 * weight + 6.25 * height - 5 * age;
  const offset = sex === 'm' ? 5 : sex === 'f' ? -161 : -78;
  return base + offset;
}

export function calcBmi(weight, heightCm) {
  if (!weight || !heightCm) return null;
  const m = heightCm / 100;
  return weight / (m * m);
}

export function bmiCategory(bmi) {
  if (bmi == null) return '';
  if (bmi < 18.5) return 'Untergewicht';
  if (bmi < 25) return 'Normalgewicht';
  if (bmi < 30) return 'Übergewicht';
  if (bmi < 35) return 'Adipositas Grad I';
  if (bmi < 40) return 'Adipositas Grad II';
  return 'Adipositas Grad III';
}

export function isProfileComplete(p) {
  return !!(p && p.sex && p.birth_year && p.height_cm && p.start_weight && p.activity);
}

/**
 * Berechnet Tagesziele aus Profil + aktuellem Gewicht.
 * Kalorienziel = Gesamtumsatz − Defizit (Abnehmtempo × 7700 kcal / 7 Tage),
 * nie unter MIN_KCAL (außer bei manuellem Ziel).
 */
export function computeGoals(profile, weight, now = new Date()) {
  if (!isProfileComplete(profile)) return null;
  weight = weight || profile.start_weight;
  const age = Math.max(12, now.getFullYear() - profile.birth_year);
  const bmr = calcBmr({ sex: profile.sex, weight, height: profile.height_cm, age });
  const activity = ACTIVITY_LEVELS.find((a) => a.key === profile.activity) ?? ACTIVITY_LEVELS[0];
  const tdee = bmr * activity.factor;

  const losing = profile.goal_weight != null && profile.goal_weight < weight;
  const rate = losing ? Number(profile.rate ?? 0.5) : 0;
  const minKcal = MIN_KCAL[profile.sex] ?? 1350;

  let kcal = tdee - (rate * KCAL_PER_KG_FAT) / 7;
  let limited = false;
  if (kcal < minKcal) {
    kcal = minKcal;
    limited = true;
  }
  kcal = Math.round(kcal / 10) * 10;
  const override = profile.kcal_override > 0 ? Math.round(profile.kcal_override) : null;
  if (override) {
    kcal = override;
    limited = false;
  }

  // Eiweiß: 1,6 g pro kg (Referenz: Zielgewicht, falls niedriger), max. 35 % der Energie
  const refWeight = losing ? profile.goal_weight : weight;
  const protein = Math.round(Math.min(1.6 * refWeight, (kcal * 0.35) / 4));
  const fat = Math.round((kcal * 0.3) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));

  return {
    age,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    kcal,
    deficit: Math.round(tdee - kcal),
    rate,
    limited,
    override: !!override,
    protein,
    carbs,
    fat,
    sat_fat: Math.round((kcal * 0.1) / 9), // Obergrenze (DGE/WHO: < 10 % der Energie)
    sugar: Math.round((kcal * 0.1) / 4), // Obergrenze freier Zucker (WHO: < 10 % der Energie)
    fiber: 30, // Richtwert DGE
    sodium: 2000, // Obergrenze WHO in mg (≈ 5 g Salz)
  };
}

/** Summe der Nährwerte einer Liste von Einträgen (Werte je Portion × Menge) */
export function sumEntries(entries) {
  const t = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0]));
  for (const e of entries) {
    const f = entryFactor(e);
    for (const k of NUTRIENT_KEYS) t[k] += (Number(e[k]) || 0) * f;
  }
  return t;
}

export function entryFactor(e) {
  const sq = Number(e.serving_qty) || 1;
  return (Number(e.qty) || 0) / sq;
}
