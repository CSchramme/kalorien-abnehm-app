import { get, put } from '../api.js';
import { esc, fmt, icon, showError } from '../ui.js';
import { openFoodEditor, servingLabel, macroLine } from './sheets.js';

let query = '';

export async function render(root, { app }) {
  const { foods } = await get('/api/foods?limit=500');

  root.innerHTML = `
    <section class="hero">
    <header class="page-head simple"><h1>Lebensmittel</h1>
      <button type="button" class="btn btn-hero btn-small" data-new>${icon('plus', { size: 18 })} Neu</button></header>
    <label class="search-field">${icon('search', { size: 20 })}
      <input type="search" placeholder="${foods.length} gespeichert – suchen" aria-label="Suchen" value="${esc(query)}" autocomplete="off"></label>
    </section>
    <section class="card list-card"><ul class="list food-list"></ul></section>
    <p class="small muted center">Tipp: Nährwerte aus einer Rezept-App oder von der Verpackung kopieren und beim Anlegen mit „Nährwerte aus Text übernehmen“ einfügen.</p>`;

  const list = root.querySelector('.food-list');
  const draw = () => {
    const words = query.trim().toLocaleLowerCase('de').split(/\s+/).filter(Boolean);
    const hits = foods.filter((f) => words.every((w) => f.name.toLocaleLowerCase('de').includes(w)));
    if (!foods.length) {
      list.innerHTML = `<li class="empty-inline">${icon('book', { size: 28 })}<p>Hier sammelst du deine Lebensmittel und Rezepte – einmal angelegt, sind sie mit zwei Fingertipps im Tagebuch.</p>
        <button type="button" class="btn btn-soft" data-new>Erstes Lebensmittel anlegen</button></li>`;
      return;
    }
    list.innerHTML = hits.length
      ? hits.map((f) => `
        <li class="list-row">
          <button type="button" class="icon-btn small fav-toggle${f.favorite ? ' on' : ''}" data-fav="${f.id}" aria-pressed="${!!f.favorite}" aria-label="Favorit: ${esc(f.name)}">
            ${icon('star', { size: 20, fill: !!f.favorite })}</button>
          <button type="button" class="list-item" data-edit="${f.id}">
            <span class="li-main"><span class="li-title">${esc(f.name)}</span>
              <span class="li-sub">${esc(servingLabel(f.serving_qty, f.serving_unit))} · ${macroLine(f)}${f.use_count ? ` · ${f.use_count}× gegessen` : ''}</span></span>
            <span class="li-value">${fmt(f.kcal)}<small> kcal</small></span>
          </button></li>`).join('')
      : `<li class="empty-inline">Nichts gefunden für „${esc(query)}“.</li>`;
  };
  draw();

  root.querySelector('[type="search"]').addEventListener('input', (e) => {
    query = e.target.value;
    draw();
  });

  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-new]')) {
      openFoodEditor({ onSaved: () => app.rerender() });
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      openFoodEditor({ food: foods.find((f) => f.id === Number(edit.dataset.edit)), onSaved: () => app.rerender() });
      return;
    }
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      const f = foods.find((x) => x.id === Number(fav.dataset.fav));
      f.favorite = f.favorite ? 0 : 1;
      draw();
      try {
        await put(`/api/foods/${f.id}`, { favorite: !!f.favorite });
      } catch (err) {
        f.favorite = f.favorite ? 0 : 1;
        draw();
        showError(err);
      }
    }
  });
}
