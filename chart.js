// Shared SVG line chart used by the ticker page and the paper portfolio. No libraries.
// Needs common.js.

// Chart colours (validated for colour-blind separation and contrast on the dark panel).
const C = {price: '#3987e5', s20: '#d95926', s50: '#199e70', s100: '#c98500',
           composite: '#3987e5', mom: '#d95926', fund: '#199e70',
           value: '#3987e5', bench: '#d95926',
           volume: '#3a4552', grid: '#232b36', axis: '#8b98a8', panel: '#161c24'};

function compact(x) {
  const a = Math.abs(x);
  if (a >= 1e9) return (x / 1e9).toFixed(1) + 'bn';
  if (a >= 1e6) return (x / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'm';
  if (a >= 1e3) return (x / 1e3).toFixed(0) + 'k';
  return String(Math.round(x));
}
function niceStep(span, n) {
  const raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------- generic line chart (+ optional volume panel underneath, sharing the date axis) ----------
// o = {dates, series:[{name, color, values, width}], yMin, yMax, fmtY, height, volume, tip(i)}
function lineChart(host, o) {
  const n = o.dates.length;
  const W = Math.max(280, host.clientWidth);
  const volH = o.volume ? 60 : 0, gap = o.volume ? 12 : 0;
  const m = {l: 58, r: 50, t: 8, b: 22};
  const pw = W - m.l - m.r, ph = o.height - m.t - m.b - volH - gap;
  const X = i => m.l + (n > 1 ? i / (n - 1) : 0.5) * pw;

  let lo = o.yMin, hi = o.yMax;
  if (lo == null || hi == null) {
    const vals = o.series.flatMap(s => s.values).filter(v => v != null);
    const mn = Math.min(...vals), mx = Math.max(...vals), pad = (mx - mn || mx || 1) * 0.06;
    lo = lo ?? mn - pad; hi = hi ?? mx + pad;
  }
  const Y = v => m.t + ph - (v - lo) / (hi - lo) * ph;
  const step = niceStep(hi - lo, 4);
  let svg = '';

  // grid + y labels
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    const y = Y(v).toFixed(1);
    svg += `<line x1="${m.l}" x2="${m.l + pw}" y1="${y}" y2="${y}" stroke="${C.grid}"/>` +
      `<text x="${m.l - 8}" y="${y}" dy="0.32em" text-anchor="end" class="ax">${esc(o.fmtY(v, step))}</text>`;
  }

  // x labels at month starts, thinned so they don't collide
  let lastX = -1e9, firstLabel = true;
  const daily = n <= 40;   // short spans (early score history): label days, not months
  for (let i = 0; i < n && daily; i++) {
    const x = X(i);
    if (x - lastX < 46) continue;
    lastX = x;
    svg += `<text x="${x.toFixed(1)}" y="${o.height - 6}" text-anchor="middle" class="ax xt">${fmtDate(o.dates[i]).slice(0, 5)}</text>`;
  }
  for (let i = 0; i < n && !daily; i++) {
    const mo = o.dates[i].slice(5, 7);
    if (i > 0 && mo === o.dates[i - 1].slice(5, 7)) continue;
    if (i === 0) continue;                    // partial first month: skip
    const x = X(i);
    if (x - lastX < 58 || x > m.l + pw - 20) continue;
    lastX = x;
    const label = MONTHS[+mo - 1] + (mo === '01' || firstLabel ? ` ’${o.dates[i].slice(2, 4)}` : '');
    firstLabel = false;
    svg += `<text x="${x.toFixed(1)}" y="${o.height - 6}" text-anchor="middle" class="ax xt">${label}</text>`;
  }

  // volume bars
  if (o.volume) {
    const vt = m.t + ph + gap, vmax = Math.max(...o.volume, 1);
    const bw = Math.max(1, pw / n - (pw / n > 4 ? 2 : 0));
    let bars = '';
    o.volume.forEach((v, i) => {
      const h = v / vmax * volH;
      if (h > 0) bars += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${(vt + volH - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"/>`;
    });
    svg += `<g fill="${C.volume}">${bars}</g>` +
      `<text x="${m.l - 8}" y="${vt + 4}" dy="0.32em" text-anchor="end" class="ax">${compact(vmax)}</text>` +
      `<text x="${m.l - 8}" y="${vt + volH}" text-anchor="end" class="ax">Vol</text>`;
  }

  // lines
  for (const s of o.series) {
    let d = '', pen = false;
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1);
      pen = true;
    });
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 1.5}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  // direct labels at the right-hand end, nudged apart so they don't overlap
  const ends = o.series.map(s => {
    let i = s.values.length - 1;
    while (i >= 0 && s.values[i] == null) i--;
    return i < 0 ? null : {s, y: Y(s.values[i])};
  }).filter(Boolean).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
  for (const e of ends) {
    svg += `<line x1="${m.l + pw + 5}" x2="${m.l + pw + 13}" y1="${e.y.toFixed(1)}" y2="${e.y.toFixed(1)}" stroke="${e.s.color}" stroke-width="2.5" stroke-linecap="round"/>` +
      `<text x="${m.l + pw + 16}" y="${e.y.toFixed(1)}" dy="0.32em" class="ax lbl">${esc(e.s.short || e.s.name)}</text>`;
  }

  const label = `${o.title}. ${n} points from ${fmtDate(o.dates[0])} to ${fmtDate(o.dates[n - 1])}. Use left and right arrow keys to read values.`;
  host.innerHTML = `<svg width="${W}" height="${o.height}" tabindex="0" role="img" aria-label="${esc(label)}">${svg}
    <g class="xh" style="display:none"><line class="xl" y1="${m.t}" y2="${m.t + ph + gap + volH}" stroke="${C.axis}" stroke-dasharray="3 3"/>
    ${o.series.map(s => `<circle r="4" fill="${s.color}" stroke="${C.panel}" stroke-width="2"/>`).join('')}</g>
    <rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph + gap + volH}" fill="transparent"/></svg>
    <div class="tip" hidden></div>`;

  // hover / touch / keyboard read-out
  const el = host.querySelector('svg'), xh = el.querySelector('.xh'), tip = host.querySelector('.tip');
  const dots = xh.querySelectorAll('circle');
  let cur = -1;
  function show(i) {
    cur = Math.max(0, Math.min(n - 1, i));
    const x = X(cur);
    xh.style.display = '';
    xh.querySelector('.xl').setAttribute('x1', x); xh.querySelector('.xl').setAttribute('x2', x);
    o.series.forEach((s, k) => {
      const v = s.values[cur];
      dots[k].style.display = v == null ? 'none' : '';
      if (v != null) { dots[k].setAttribute('cx', x); dots[k].setAttribute('cy', Y(v)); }
    });
    tip.hidden = false;
    tip.innerHTML = o.tip(cur);
    const tw = tip.offsetWidth;
    tip.style.left = (x + 14 + tw > W ? x - 14 - tw : x + 14) + 'px';
    tip.style.top = m.t + 'px';
  }
  function hide() { xh.style.display = 'none'; tip.hidden = true; }
  const at = e => Math.round((e.clientX - el.getBoundingClientRect().left - m.l) / pw * (n - 1));
  el.addEventListener('pointermove', e => show(at(e)));
  el.addEventListener('pointerdown', e => show(at(e)));
  el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); show((cur < 0 ? n - 1 : cur) + (e.key === 'ArrowLeft' ? -1 : 1));
    } else if (e.key === 'Escape') hide();
  });
  el.addEventListener('blur', hide);
}

const legend = series => `<div class="legend-row">${series.map(s =>
  `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;

