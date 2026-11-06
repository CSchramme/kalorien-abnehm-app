// Schlanke SVG-Diagramme (Linie für Gewicht, Säulen für Kalorien) mit Hover-/Touch-Tooltip.
import { fmt, fromISO } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';

function niceStep(range, target = 4) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
}

function mount(el, draw) {
  el.classList.add('chart');
  let lastW = 0;
  const ro = new ResizeObserver(() => {
    const w = Math.round(el.clientWidth);
    if (w && w !== lastW) {
      lastW = w;
      draw(w);
    }
  });
  ro.observe(el);
}

function tooltip(el) {
  const getTip = () => {
    let tip = el.querySelector('.chart-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.setAttribute('role', 'status');
      tip.hidden = true;
      el.append(tip);
    }
    return tip;
  };
  return {
    show(x, y, lines) {
      const tip = getTip();
      tip.replaceChildren(
        ...lines.map(([value, label], i) => {
          const row = document.createElement('div');
          const b = document.createElement(i === 0 ? 'strong' : 'span');
          b.textContent = value;
          row.append(b);
          if (label) {
            const s = document.createElement('small');
            s.textContent = ` ${label}`;
            row.append(s);
          }
          return row;
        }),
      );
      tip.hidden = false;
      const w = tip.offsetWidth;
      const left = Math.max(0, Math.min(el.clientWidth - w, x - w / 2));
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(0, y - tip.offsetHeight - 12)}px`;
    },
    hide() {
      const tip = el.querySelector('.chart-tip');
      if (tip) tip.hidden = true;
    },
  };
}

const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const text = (x, y, str, attrs = {}) => {
  const t = svgEl('text', { x, y, ...attrs });
  t.textContent = str;
  return t;
};

/**
 * Liniendiagramm.
 * @param {HTMLElement} el
 * @param {{ points: {date:string, value:number}[], goal?: number, unit: string, digits?: number, height?: number }} o
 */
export function lineChart(el, { points, goal = null, unit, digits = 1, height = 220 }) {
  mount(el, (W) => {
    const H = height;
    const pad = { t: 18, r: 14, b: 26, l: 40 };
    const t0 = fromISO(points[0].date).getTime();
    const t1 = fromISO(points[points.length - 1].date).getTime();
    const span = Math.max(t1 - t0, 86400000);
    const vals = points.map((p) => p.value).concat(goal != null ? [goal] : []);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 2) {
      lo -= 1;
      hi += 1;
    }
    const step = niceStep(hi - lo);
    lo = Math.floor((lo - step * 0.25) / step) * step;
    hi = Math.ceil((hi + step * 0.25) / step) * step;
    const x = (d) => pad.l + ((fromISO(d).getTime() - t0) / span) * (W - pad.l - pad.r) || pad.l;
    const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
    svg.setAttribute('aria-label', `Verlauf von ${points.length} Messungen`);
    for (let v = lo; v <= hi + 1e-9; v += step) {
      svg.append(svgEl('line', { class: 'grid', x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }));
      svg.append(text(pad.l - 8, y(v) + 4, fmt(v, step < 1 ? 1 : 0), { class: 'tick', 'text-anchor': 'end' }));
    }
    // X-Achse: erstes, mittleres, letztes Datum
    const fmtD = (d) => fromISO(d).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
    const xTicks = points.length > 2 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : points.map((_, i) => i);
    [...new Set(xTicks)].forEach((i, k, arr) => {
      const anchor = arr.length > 1 && k === 0 ? 'start' : k === arr.length - 1 && arr.length > 1 ? 'end' : 'middle';
      svg.append(text(x(points[i].date), H - 6, fmtD(points[i].date), { class: 'tick', 'text-anchor': anchor }));
    });

    if (goal != null) {
      svg.append(svgEl('line', { class: 'ref', x1: pad.l, x2: W - pad.r, y1: y(goal), y2: y(goal) }));
      svg.append(text(W - pad.r, y(goal) - 6, `Ziel ${fmt(goal, digits)} ${unit}`, { class: 'ref-label', 'text-anchor': 'end' }));
    }

    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    if (points.length > 1) {
      svg.append(svgEl('path', {
        class: 'area',
        d: `${d}L${x(points.at(-1).date).toFixed(1)},${H - pad.b}L${x(points[0].date).toFixed(1)},${H - pad.b}Z`,
      }));
      svg.append(svgEl('path', { class: 'line', d }));
    }
    const last = points.at(-1);
    svg.append(svgEl('circle', { class: 'dot', cx: x(last.date), cy: y(last.value), r: 4.5 }));

    // Hover-Ebene
    const cross = svgEl('line', { class: 'crosshair', y1: pad.t, y2: H - pad.b, visibility: 'hidden' });
    const hoverDot = svgEl('circle', { class: 'dot', r: 4.5, visibility: 'hidden' });
    svg.append(cross, hoverDot);
    const hit = svgEl('rect', { x: pad.l - 10, y: 0, width: W - pad.l - pad.r + 20, height: H, fill: 'transparent' });
    svg.append(hit);
    el.replaceChildren(svg);
    const tip = tooltip(el);
    const move = (evt) => {
      const r = svg.getBoundingClientRect();
      const px = evt.clientX - r.left;
      let best = 0;
      points.forEach((p, i) => {
        if (Math.abs(x(p.date) - px) < Math.abs(x(points[best].date) - px)) best = i;
      });
      const p = points[best];
      const cx = x(p.date);
      const cy = y(p.value);
      cross.setAttribute('x1', cx);
      cross.setAttribute('x2', cx);
      cross.setAttribute('visibility', 'visible');
      hoverDot.setAttribute('cx', cx);
      hoverDot.setAttribute('cy', cy);
      hoverDot.setAttribute('visibility', 'visible');
      const prev = points[best - 1];
      tip.show(cx, cy, [
        [`${fmt(p.value, digits)} ${unit}`, ''],
        [fromISO(p.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' }), prev ? `(${p.value - prev.value >= 0 ? '+' : '−'}${fmt(Math.abs(p.value - prev.value), digits)})` : ''],
      ]);
    };
    const leave = () => {
      cross.setAttribute('visibility', 'hidden');
      hoverDot.setAttribute('visibility', 'hidden');
      tip.hide();
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
  });
}

/**
 * Säulendiagramm für Tageswerte.
 * @param {{ bars: {date:string, value:number, logged:boolean}[], goal?: number, unit: string, height?: number }} o
 */
export function barChart(el, { bars, goal = null, unit, height = 220 }) {
  mount(el, (W) => {
    const H = height;
    const pad = { t: 18, r: 8, b: 26, l: 44 };
    const max = Math.max(goal ?? 0, ...bars.map((b) => b.value), 100);
    const step = niceStep(max, 4);
    const hi = Math.ceil((max * 1.05) / step) * step;
    const innerW = W - pad.l - pad.r;
    const band = innerW / bars.length;
    const bw = Math.max(2, Math.min(24, band - 2));
    const y = (v) => pad.t + (1 - v / hi) * (H - pad.t - pad.b);
    const base = y(0);

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
    svg.setAttribute('aria-label', `Kalorien pro Tag, ${bars.length} Tage`);
    for (let v = 0; v <= hi + 1e-9; v += step) {
      svg.append(svgEl('line', { class: v === 0 ? 'axis' : 'grid', x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }));
      svg.append(text(pad.l - 8, y(v) + 4, fmt(v), { class: 'tick', 'text-anchor': 'end' }));
    }

    const every = bars.length <= 7 ? 1 : bars.length <= 14 ? 2 : bars.length <= 31 ? 7 : 14;
    const tickFmt = bars.length <= 7
      ? (d) => fromISO(d).toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '')
      : (d) => fromISO(d).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });

    const tip = tooltip(el);
    bars.forEach((b, i) => {
      const cx = pad.l + band * i + band / 2;
      if ((bars.length - 1 - i) % every === 0) {
        svg.append(text(cx, H - 6, tickFmt(b.date), { class: 'tick', 'text-anchor': 'middle' }));
      }
      if (!b.logged) return;
      const top = y(b.value);
      const h = Math.max(0, base - top);
      const r = Math.min(4, bw / 2, h);
      const x0 = cx - bw / 2;
      const over = goal != null && b.value > goal;
      svg.append(svgEl('path', {
        class: `bar${over ? ' over' : ''}`,
        d: `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${base}Z`,
      }));
    });
    if (goal != null) {
      svg.append(svgEl('line', { class: 'ref', x1: pad.l, x2: W - pad.r, y1: y(goal), y2: y(goal) }));
      svg.append(text(W - pad.r, y(goal) - 6, `Ziel ${fmt(goal)}`, { class: 'ref-label', 'text-anchor': 'end' }));
    }

    // Trefferflächen (ganze Spalte)
    const hl = svgEl('rect', { class: 'band-hl', y: pad.t, height: H - pad.t - pad.b, width: band, visibility: 'hidden' });
    svg.insertBefore(hl, svg.firstChild);
    bars.forEach((b, i) => {
      const hit = svgEl('rect', { x: pad.l + band * i, y: 0, width: band, height: H, fill: 'transparent', tabindex: -1 });
      const show = () => {
        hl.setAttribute('x', pad.l + band * i);
        hl.setAttribute('visibility', 'visible');
        const lines = [[b.logged ? `${fmt(b.value)} ${unit}` : 'Keine Einträge', '']];
        lines.push([fromISO(b.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }), '']);
        if (b.logged && goal != null) {
          const diff = b.value - goal;
          lines.push([`${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))}`, diff > 0 ? 'über Ziel' : 'unter Ziel']);
        }
        tip.show(pad.l + band * i + band / 2, b.logged ? y(b.value) : base, lines);
      };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerdown', show);
      hit.addEventListener('pointerleave', () => {
        hl.setAttribute('visibility', 'hidden');
        tip.hide();
      });
      svg.append(hit);
    });
    el.replaceChildren(svg);
  });
}
