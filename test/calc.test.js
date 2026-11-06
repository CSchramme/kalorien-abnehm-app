import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNutrition, parseNumber } from '../public/js/lib/parse.js';
import { computeGoals, calcBmr, sumEntries } from '../public/js/lib/calc.js';

const SCREENSHOT = `Nährwerte pro 1 Portion
Natrium
1.326 mg
Eiweiß
35 g
Brennwert
2.778 kJ / 664 kcal
Fett
38 g
Ballaststoffe
15 g
gesättigte Fettsäuren
12 g
Kohlenhydrate
47 g`;

const EXPECTED = { kcal: 664, protein: 35, carbs: 47, fat: 38, sat_fat: 12, fiber: 15, sodium: 1326 };

test('Zahlenformate', () => {
  assert.equal(parseNumber('1.326'), 1326);
  assert.equal(parseNumber('3,5'), 3.5);
  assert.equal(parseNumber('0.5'), 0.5);
  assert.equal(parseNumber('1.234,5'), 1234.5);
  assert.equal(parseNumber('12.5'), 12.5);
});

test('Nährwerte aus Rezept-App (Zeilen)', () => {
  const r = parseNutrition(SCREENSHOT);
  assert.deepEqual(r.values, EXPECTED);
  assert.deepEqual(r.serving, { qty: 1, unit: 'Portion' });
});

test('Nährwerte aus Rezept-App (eine Zeile)', () => {
  assert.deepEqual(parseNutrition(SCREENSHOT.replace(/\n/g, ' ')).values, EXPECTED);
});

test('Tabellen-Layout: erst Bezeichnungen, dann Werte', () => {
  const r = parseNutrition('Natrium Eiweiß Brennwert Fett\n1.326 mg 35 g 2.778 kJ / 664 kcal 38 g');
  assert.deepEqual(r.values, { sodium: 1326, protein: 35, kcal: 664, fat: 38 });
});

test('Verpackung pro 100 g mit Salz', () => {
  const r = parseNutrition(
    'Nährwerte pro 100 g: Energie 1500 kJ / 359 kcal, Fett 3,2 g, davon gesättigte Fettsäuren 0,5 g, ' +
      'Kohlenhydrate 60 g, davon Zucker 2,1 g, Ballaststoffe 8 g, Eiweiß 12 g, Salz 0,8 g',
  );
  assert.deepEqual(r.values, { kcal: 359, fat: 3.2, sat_fat: 0.5, carbs: 60, sugar: 2.1, fiber: 8, protein: 12, sodium: 320 });
  assert.deepEqual(r.serving, { qty: 100, unit: 'g' });
});

test('Nur kJ angegeben', () => {
  assert.equal(parseNutrition('Brennwert 1000 kJ').values.kcal, 239);
});

test('Englisches Nährwert-Label', () => {
  const r = parseNutrition('Calories 250\nTotal Fat 12g\nSaturated Fat 3g\nSodium 470mg\nTotal Carbohydrate 31g\nDietary Fiber 2g\nSugars 5g\nProtein 5g');
  assert.deepEqual(r.values, { kcal: 250, fat: 12, sat_fat: 3, sodium: 470, carbs: 31, fiber: 2, sugar: 5, protein: 5 });
});

test('Grundumsatz und Kalorienziel', () => {
  // Mifflin-St Jeor: 10*80 + 6.25*180 - 5*30 + 5 = 1780
  assert.equal(calcBmr({ sex: 'm', weight: 80, height: 180, age: 30 }), 1780);
  const now = new Date('2026-06-01');
  const g = computeGoals(
    { sex: 'm', birth_year: 1996, height_cm: 180, start_weight: 80, goal_weight: 75, activity: 'sedentary', rate: 0.5 },
    80,
    now,
  );
  assert.equal(g.bmr, 1780);
  assert.equal(g.tdee, 2136);
  assert.equal(g.kcal, 1590); // 2136 − 550 = 1586 → auf 10 gerundet
  assert.equal(g.protein, 120); // 1,6 g × 75 kg

  // Untergrenze greift
  const low = computeGoals(
    { sex: 'f', birth_year: 1950, height_cm: 150, start_weight: 50, goal_weight: 45, activity: 'sedentary', rate: 1 },
    50,
    now,
  );
  assert.equal(low.kcal, 1200);
  assert.equal(low.limited, true);

  // Zielgewicht erreicht → Gewicht halten
  const keep = computeGoals(
    { sex: 'm', birth_year: 1996, height_cm: 180, start_weight: 80, goal_weight: 80, activity: 'sedentary', rate: 0.5 },
    80,
    now,
  );
  assert.equal(keep.deficit, keep.tdee - keep.kcal);
  assert.ok(Math.abs(keep.kcal - keep.tdee) < 10);

  // Manuelles Ziel
  assert.equal(computeGoals({ sex: 'm', birth_year: 1996, height_cm: 180, start_weight: 80, activity: 'light', kcal_override: 1800 }, 80, now).kcal, 1800);
});

test('Summe der Einträge berücksichtigt Mengen', () => {
  const t = sumEntries([
    { serving_qty: 100, qty: 250, kcal: 100, protein: 10 },
    { serving_qty: 1, qty: 0.5, kcal: 664, protein: 35 },
  ]);
  assert.equal(t.kcal, 250 + 332);
  assert.equal(t.protein, 25 + 17.5);
});
