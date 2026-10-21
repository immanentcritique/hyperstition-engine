// site.mjs — compiles a unit into one self-contained page.
//
// Design notes
// - Human-written text (futures, scores, protocol) is set in a serif. Everything the kernel
//   computes is set in a grotesk. You can always tell the unit's voice from the machine's.
// - The field puts the future on the right and the present on the left. On load, the lines
//   draw from right to left: the error travels backwards from the future to what you did.
// - One chromatic colour: the unit's own (unit.md → color). Red is reserved for pain.

import { esc, markdown } from './markdown.mjs';
import { asList } from './format.mjs';
import { activeMembers, isFounded, governanceOf } from './model.mjs';

const DEFAULT_COLOR = '#6a2cff';
const pct = (x) => `${Math.round(x * 100)}%`;
const signed = (x, digits = 0) => {
  const v = digits ? x.toFixed(digits) : String(Math.round(x));
  return x > 0 ? `+${v}` : x < 0 ? `−${v.replace('-', '')}` : v;
};
const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + '…' : String(s));
const fmtDate = (d) => {
  if (!d) return '';
  const t = new Date(`${d}T12:00:00`);
  return Number.isNaN(t) ? d : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// ---------- the field ----------

function field(c) {
  const horizons = c.horizons.filter((h) => h.status === 'open');
  if (!horizons.length) {
    return `<div class="empty">
      <p>No horizons yet. The field starts with a future someone has written down.</p>
      <p><code>node kernel.mjs horizon "A world where…"</code></p>
    </div>`;
  }
  const hIds = new Set(horizons.map((h) => h.id));
  const reqs = c.reqs.filter((r) => r.status !== 'dropped' && r.horizons.some((h) => hIds.has(h)));
  const reqIds = new Set(reqs.map((r) => r.id));
  const acts = c.acts.filter((a) => a.requirements.some((r) => reqIds.has(r))).slice(-12);

  const ROW = 46, TOP = 56, W = 1120;
  const X = { actDot: 250, reqIn: 372, reqOut: 650, reqEdge: 704, hDot: 792 };

  // horizons and requirements in order; acts at the average height of what they aimed at
  const hY = new Map(), rY = new Map();
  let row = 0;
  const reqOrder = [];
  for (const h of horizons) {
    const mine = reqs.filter((r) => r.horizons.find((x) => hIds.has(x)) === h.id);
    reqOrder.push(...mine);
  }
  reqOrder.forEach((r, i) => rY.set(r.id, TOP + i * ROW));
  for (const h of horizons) {
    const ys = reqs.filter((r) => r.horizons.includes(h.id)).map((r) => rY.get(r.id));
    hY.set(h.id, ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : TOP + row * ROW);
    row++;
  }
  // spread horizons that collide
  spread(horizons.map((h) => ({ key: h.id, y: hY.get(h.id) })), ROW, TOP).forEach(({ key, y }) => hY.set(key, y));
  const aY = new Map();
  spread(acts.map((a) => {
    const ys = a.requirements.filter((r) => rY.has(r)).map((r) => rY.get(r));
    return { key: a.id, y: ys.reduce((s, v) => s + v, 0) / ys.length };
  }), ROW * 0.8, TOP).forEach(({ key, y }) => aY.set(key, y));

  const maxY = Math.max(TOP, ...rY.values(), ...hY.values(), ...aY.values());
  const H = maxY + 44;
  const curve = (x1, y1, x2, y2) => {
    const m = (x1 + x2) / 2;
    return `M${x2},${y2} C${m},${y2} ${m},${y1} ${x1},${y1}`; // drawn from the future side
  };

  const back = [], front = [];
  // requirement → horizon
  for (const r of reqOrder) for (const hid of r.horizons.filter((h) => hIds.has(h))) {
    back.push(`<path class="e e-h" d="${curve(X.reqEdge, rY.get(r.id), X.hDot, hY.get(hid))}" pathLength="1"/>`);
  }
  // act → requirement, coloured by how far the act moved the forecast
  for (const a of acts) for (const rid of a.requirements.filter((r) => rY.has(r))) {
    const d = a.deltas[rid];
    const cls = !d ? 'e-none' : d.delta > 0.005 ? 'e-up' : d.delta < -0.005 ? 'e-down' : 'e-flat';
    const w = d ? (1.2 + Math.min(1, Math.abs(d.delta) * 4) * 5).toFixed(2) : 1;
    const label = d ? `${a.title}: ${signed(d.delta * 100)} points on ${rid}` : `${a.title}: no forecast yet`;
    back.push(`<path class="e e-a ${cls}" style="stroke-width:${w}" d="${curve(X.actDot, aY.get(a.id), X.reqIn, rY.get(rid))}" pathLength="1"><title>${esc(label)}</title></path>`);
  }

  for (const a of acts) {
    const y = aY.get(a.id);
    front.push(`<g class="n-act"><title>${esc(a.title)} · ${esc(a.date)}</title>
      <text x="${X.actDot - 14}" y="${y - 3}" text-anchor="end">${esc(trunc(a.title, 30))}</text>
      <text class="sub" x="${X.actDot - 14}" y="${y + 13}" text-anchor="end">${esc(fmtDate(a.date))}${a.felt !== null ? ` · felt ${signed(a.felt, 1)}` : ''}</text>
      <circle cx="${X.actDot}" cy="${y}" r="4"/></g>`);
  }
  for (const r of reqOrder) {
    const y = rY.get(r.id), len = X.reqOut - X.reqIn;
    const fill = r.current === null ? 0 : r.current * len;
    front.push(`<g class="n-req${r.status === 'met' ? ' met' : ''}"><title>${esc(r.title)}</title>
      <text x="${X.reqIn}" y="${y - 9}">${esc(trunc(r.title, 38))}</text>
      <text class="sub" x="${X.reqOut + 10}" y="${y + 4}">${r.status === 'met' ? 'met' : r.current === null ? '—' : pct(r.current)}</text>
      <line class="track" x1="${X.reqIn}" x2="${X.reqOut}" y1="${y}" y2="${y}"/>
      ${fill ? `<line class="fill" x1="${X.reqIn}" x2="${(X.reqIn + fill).toFixed(1)}" y1="${y}" y2="${y}"/>` : ''}</g>`);
  }
  for (const h of horizons) {
    const y = hY.get(h.id), R = 9;
    const arc = h.nearness === null ? '' : arcPath(X.hDot, y, R + 5, h.nearness);
    front.push(`<g class="n-h"><title>${esc(h.title)}</title>
      <circle class="core" cx="${X.hDot}" cy="${y}" r="${R}"/>
      <circle class="ring" cx="${X.hDot}" cy="${y}" r="${R + 5}"/>
      ${arc ? `<path class="arc" d="${arc}"/>` : ''}
      <text x="${X.hDot + 26}" y="${y - 2}">${esc(trunc(h.title, 36))}</text>
      <text class="sub" x="${X.hDot + 26}" y="${y + 14}">${h.nearness === null ? 'no forecasts yet' : `${pct(h.nearness)} by the unit's forecasts`}</text></g>`);
  }

  return `<figure class="field">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="field-title field-desc" preserveAspectRatio="xMinYMin meet">
      <title id="field-title">The field</title>
      <desc id="field-desc">Acts on the left, the requirements they aimed at in the middle, the horizons those requirements serve on the right. Line weight shows how much each act moved the unit's forecast.</desc>
      <text class="col" x="${X.actDot}" y="20" text-anchor="end">now</text>
      <text class="col" x="${X.reqIn}" y="20">what the future asks of now</text>
      <text class="col" x="${X.hDot + 26}" y="20">the future</text>
      <g class="edges">${back.join('')}</g>
      <g class="nodes">${front.join('')}</g>
    </svg>
    <figcaption>${acts.length ? 'Thicker lines moved the forecast more. Lines in the unit’s colour moved it toward the future, red moved it away, dotted grey is unmeasured.' : 'No acts yet. Once the unit does something and signals, the present appears on the left.'}</figcaption>
  </figure>`;
}

function spread(items, gap, min) {
  items.sort((a, b) => a.y - b.y);
  let last = -Infinity;
  for (const it of items) { it.y = Math.max(it.y, last + gap, min); last = it.y; }
  return items;
}

function arcPath(cx, cy, r, frac) {
  frac = Math.max(0, Math.min(0.9999, frac));
  if (frac <= 0) return '';
  const a0 = -Math.PI / 2, a1 = a0 + frac * 2 * Math.PI;
  const p = (a) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  return `M${p(a0)} A${r},${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${p(a1)}`;
}

// ---------- sections ----------

function spark(r) {
  if (!r.trail.length) return '<span class="spark-empty">no acts yet</span>';
  const pts = [r.start, ...r.trail.map((t) => t.after)];
  const W = 96, H = 22, n = pts.length - 1 || 1;
  const xy = pts.map((v, i) => `${((i / n) * W).toFixed(1)},${(H - v * H).toFixed(1)}`);
  return `<svg class="spark" viewBox="-2 -2 ${W + 4} ${H + 4}" aria-hidden="true">
    <line x1="0" x2="${W}" y1="${H}" y2="${H}"/><polyline points="${xy.join(' ')}"/>
    <circle cx="${xy.at(-1).split(',')[0]}" cy="${xy.at(-1).split(',')[1]}" r="2.2"/></svg>`;
}

function horizonSection(u, c) {
  const open = c.horizons.filter((h) => h.status === 'open');
  const earlier = c.horizons.filter((h) => h.status !== 'open');
  const titleOf = new Map(c.horizons.map((h) => [h.id, h.title]));
  const block = (h) => {
    const rs = c.reqs.filter((r) => r.horizons.includes(h.id));
    const notes = [
      h.by.length ? `written by ${esc(h.by.join(', '))}` : '',
      h.parent ? `revised from ${esc(titleOf.get(String(h.parent)) ? `“${titleOf.get(String(h.parent))}”` : h.parent)}` : '',
      h.adopted_from ? `adopted from ${esc(h.adopted_from)}` : '',
      h.created ? `since ${esc(fmtDate(h.created))}` : '',
    ].filter(Boolean);
    return `<article class="horizon" id="${esc(h.id)}">
      <header>
        <h3>${esc(h.title)}</h3>
        ${notes.length ? `<p class="meta">${notes.map((n) => `<span>${n}</span>`).join('')}</p>` : ''}
      </header>
      <div class="voice">${h.body ? markdown(h.body, { shift: 3 }) : '<p class="missing">This future hasn’t been written yet.</p>'}</div>
      ${rs.length ? `<ul class="reqs">${rs.map((r) => `<li class="${r.status}">
          <span class="rt">${esc(r.title)}${r.status !== 'open' ? ` <em>${esc(r.status)}</em>` : ''}</span>
          ${spark(r)}
          <span class="rv">${r.status === 'met' ? 'met' : r.current === null ? '—' : pct(r.current)}</span>
          <span class="rm">${r.movement === null || r.status !== 'open' ? '' : signed(r.movement * 100)}</span>
        </li>`).join('')}</ul>` : `<p class="hint">Nothing asked of the present yet: <code>node kernel.mjs require "…" --horizon ${esc(h.id)}</code></p>`}
    </article>`;
  };
  return `<section id="horizons" aria-labelledby="horizons-h">
    <h2 id="horizons-h">Horizons</h2>
    <p class="lede">Futures this unit wants. Under each are the things it asks of the present, with the unit’s own forecast that each will happen and how far that forecast has moved.</p>
    ${open.length ? open.map(block).join('') : '<p class="empty">No open horizons. <code>node kernel.mjs horizon "A world where…"</code></p>'}
    ${earlier.length ? `<details class="earlier"><summary>${earlier.length} earlier horizon${earlier.length > 1 ? 's' : ''}, revised or composted</summary>
      <ul>${earlier.map((h) => `<li><span>${esc(h.title)}</span> <em>${esc(h.status)}${h.revised_to ? ` into “${esc(titleOf.get(String(h.revised_to)) || h.revised_to)}”` : ''}</em></li>`).join('')}</ul></details>` : ''}
  </section>`;
}

function feltMeter(f) {
  if (f === null) return '<span class="felt none">no signal</span>';
  const x = ((f + 2) / 4) * 40;
  return `<span class="felt${f <= -1 ? ' low' : ''}" title="felt ${signed(f, 1)} on a scale from −2 to +2">
    <svg viewBox="-3 -4 46 8" aria-hidden="true"><line x1="0" x2="40" y1="0" y2="0"/><line class="mid" x1="20" x2="20" y1="-3" y2="3"/><circle cx="${x.toFixed(1)}" cy="0" r="2.6"/></svg>
    ${signed(f, 1)}</span>`;
}

function actSection(u, c) {
  const scoreTitle = new Map(u.score.map((s) => [s.id, s.title]));
  const reqTitle = new Map(u.requirement.map((r) => [r.id, r.title]));
  const acts = [...c.acts].reverse();
  return `<section id="acts" aria-labelledby="acts-h">
    <h2 id="acts-h">Acts</h2>
    ${acts.length ? `<ol class="acts" reversed>${acts.map((a) => {
      const moves = Object.entries(a.deltas).map(([rid, d]) =>
        `<span class="mv ${d.delta > 0.005 ? 'up' : d.delta < -0.005 ? 'down' : ''}">${esc(trunc(reqTitle.get(rid) || rid, 44))} ${signed(d.delta * 100)}</span>`);
      return `<li>
        <time datetime="${esc(a.date)}">${esc(fmtDate(a.date))}</time>
        <div class="what">
          <p class="at">${esc(a.title)}</p>
          <p class="meta">${[
            a.score ? `score: ${esc(scoreTitle.get(String(a.score)) || a.score)}` : '',
            a.with.length ? `${a.with.length} ${a.with.length === 1 ? 'person' : 'people'}` : '',
          ].filter(Boolean).join(', ')}</p>
          ${moves.length ? `<p class="moves">${moves.join('')}</p>` : ''}
          ${a.body ? `<details><summary>what happened</summary><div class="voice">${markdown(a.body, { shift: 3 })}</div></details>` : ''}
        </div>
        ${feltMeter(a.felt)}
      </li>`;
    }).join('')}</ol>` : `<p class="empty">Nothing done yet. After you do something together:<br><code>node kernel.mjs act "what you did" --req r-001 --with a,b</code></p>`}
    ${u.inherited.length ? `<p class="inherited">${u.inherited.map((l) => `Carried over from ${esc(l.name)}: ${l.acts} act${l.acts === 1 ? '' : 's'} and ${l.signals} signals, in <code>lineage/${esc(l.name)}/</code>.`).join(' ')}</p>` : ''}
  </section>`;
}

function scoreSection(u) {
  const scores = u.score.filter((s) => (s.status || 'open') === 'open');
  return `<section id="scores" aria-labelledby="scores-h">
    <h2 id="scores-h">Scores</h2>
    <p class="lede">Instructions anyone can carry out with someone else. An act usually starts from one.</p>
    ${scores.length ? `<div class="scores">${scores.map((s) => `<article class="score" id="${esc(s.id)}">
        <h3>${esc(s.title)}</h3>
        <div class="voice">${s.body ? markdown(s.body, { shift: 3 }) : '<p class="missing">Not written yet.</p>'}</div>
        ${s.adopted_from ? `<p class="meta">adopted from ${esc(s.adopted_from)}</p>` : s.source ? `<p class="meta">from ${esc(s.source)}</p>` : ''}
      </article>`).join('')}</div>` : '<p class="empty">No scores yet. <code>node kernel.mjs score "title"</code></p>'}
  </section>`;
}

function protocolSection(u, c) {
  const g = governanceOf(u.unit);
  const NAMES = { MEETING: 'How we meet', TRADITIONS: 'Traditions' };
  const docs = u.protocol.map(({ file, text }) => {
    const body = markdown(text, { shift: 2 });
    const name = file.replace(/^protocol\//, '').replace(/\.md$/, '');
    const pretty = NAMES[name] || (name.charAt(0) + name.slice(1).toLowerCase()).replace(/[-_]/g, ' ');
    return `<details class="pdoc"${body ? ' open' : ''}><summary>${esc(pretty)}</summary>
      <div class="voice">${body || '<p class="missing">Not written yet. This one is for the unit to write, in its own words.</p>'}</div></details>`;
  }).join('');
  const props = c.proposals.length ? `<ul class="props">${[...c.proposals].reverse().map((p) => `<li class="${esc(p.status)}">
      <span class="pt">${esc(p.title)}</span>
      <span class="pm">${p.target === 'governance' ? 'governance' : esc(String(p.target).replace(/^protocol\//, ''))}</span>
      <span class="ps">${p.status === 'open'
        ? `open, ${p.tally.yes} yes and ${p.tally.no} no of ${p.tally.members}`
        : `${esc(p.status)}${p.result ? ` (${esc(p.result)})` : ''}`}</span></li>`).join('')}</ul>` : '';
  const history = (u.lock?.history || []).map((h) =>
    h.event === 'founded'
      ? `Founded ${esc(fmtDate(h.date))} by ${esc((h.by || []).join(', '))}.`
      : `${esc(h.proposal)} ratified ${esc(fmtDate(h.date))}, ${h.yes}–${h.no}.`).join(' ');
  return `<section id="protocol" aria-labelledby="protocol-h">
    <h2 id="protocol-h">Protocol</h2>
    <p class="lede">${isFounded(u)
      ? `Recorded since the founding. To change these texts through the kernel, a proposal needs ${pct(g.threshold)} yes, with at least ${pct(g.quorum)} of members voting. Each build checks the texts against the recorded lock.`
      : 'In founding mode: anything can still be rewritten. When the room agrees, the unit is founded and these texts lock.'}</p>
    ${docs || '<p class="empty">No protocol texts yet.</p>'}
    ${props ? `<h3 class="sub-h">Proposals</h3>${props}` : ''}
    ${history ? `<p class="history">${history}</p>` : ''}
  </section>`;
}

// ---------- page ----------

export function compileSite(u, c, { commit = '', example = false } = {}) {
  const starter = u.unit.template === true;
  const title = starter ? 'recursion kernel' : u.unit.name;
  const statement = u.statement ? `<section id="statement" aria-label="Artist statement"><details class="pdoc"><summary>Artist statement · emancipatory generativity</summary><div class="voice">${markdown(u.statement, { shift: 2 })}</div></details></section>` : '';
  const start = starter ? `<section class="start" id="start" aria-labelledby="start-h">
    <p class="eyebrow">Cybernetic culture recursion units · v0.1.0</p>
    <blockquote class="statement-quote">By dreaming a better future, its error informs the present while the present informs the dream.</blockquote>
    <p class="attribution"><a href="#statement">emancipatory generativity · artist statement</a></p>
    <p class="lede">A forkable operating system for cybernetic culture recursion units. Keep a shared memory of the futures you want, what you do together, and what changes.</p>
    ${example ? '<p class="entry-links"><a href="example/index.html">Explore a fictional unit ↗</a><a href="#scores">Try a score ↓</a></p>' : ''}
    <details class="pdoc"><summary id="start-h">Start a unit</summary>
      <ol><li>Copy this repository. Install Node.js 22 or newer.</li><li>In your copy, run <code>node kernel.mjs fork ccru.yourplace --yes --place &quot;Your place&quot;</code>.</li><li>Find one another. Try a score. Write your futures, meeting format and traditions together.</li><li>Add the people in the room with <code>node kernel.mjs member add your-handle --met-by founding</code>. Then run <code>node kernel.mjs found</code>.</li><li>Record what happened, signal what changed, and run <code>node kernel.mjs build</code>.</li></ol>
    </details>
  </section>` : '';
  const color = /^#[0-9a-f]{3,8}$/i.test(String(u.unit.color || '')) ? u.unit.color : DEFAULT_COLOR;
  const members = activeMembers(u).length;
  const lineage = [...asList(u.unit.lineage), u.unit.name];
  const founded = isFounded(u) ? `Founded ${fmtDate(u.unit.founded)}` : 'In founding mode';
  const pulse = c.pulse === null ? null : c.pulse;
  const painBand = c.pain.length || (pulse !== null && pulse < 0) ? `<aside class="pain" role="alert" aria-labelledby="pain-h">
      <h2 id="pain-h">${pulse !== null && pulse < 0 ? 'The last acts felt dead. Change something.' : 'Someone signalled pain.'}</h2>
      ${c.pain.length ? `<ul>${c.pain.slice(0, 5).map((p) => `<li><time>${esc(fmtDate(p.date))}</time> ${p.note ? `“${esc(p.note)}”` : 'no note left'}</li>`).join('')}</ul>` : ''}
      <p>Pain signals are shown without names and remain in the record.</p>
    </aside>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(starter ? 'A forkable operating system for cybernetic culture recursion units.' : `${u.unit.name}: a recursion unit's horizons, acts and protocol.`)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap" rel="stylesheet">
<style>
:root{
  --unit:${color};
  --paper:#ffffff; --ink:#000000; --quiet:#64666d; --hair:#dcdde2; --wash:#f4f4f6;
  --pain:#d4002a;
  --unit-text:var(--unit);
  --sans:"Familjen Grotesk",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --serif:"Newsreader",ui-serif,Georgia,"Times New Roman",serif;
  color-scheme:light dark;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --paper:#000000; --ink:#ffffff; --quiet:#9b9da5; --hair:#2b2c31; --wash:#111114; --pain:#ff4b5c;
  --unit-text:color-mix(in oklab,var(--unit) 62%,white);
}}
:root[data-theme="dark"]{--paper:#000000; --ink:#ffffff; --quiet:#9b9da5; --hair:#2b2c31; --wash:#111114; --pain:#ff4b5c; --unit-text:color-mix(in oklab,var(--unit) 62%,white)}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:400 17px/1.5 var(--sans);font-variant-numeric:tabular-nums}
a{color:var(--unit-text)}
:focus-visible{outline:2px solid var(--unit-text);outline-offset:3px}
code{font:0.88em/1.4 ui-monospace,"SF Mono",Menlo,monospace;background:var(--wash);padding:.1em .35em;border-radius:3px;overflow-wrap:anywhere}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}
@media (max-width:640px){.wrap{padding:0 16px}}

/* masthead */
.mast{padding:56px 0 28px;display:grid;grid-template-columns:1fr auto;gap:12px 32px;align-items:end}
.mast h1{margin:0;font:600 clamp(48px,11vw,132px)/.86 var(--sans);letter-spacing:-.045em;overflow-wrap:anywhere}
.mast h1 .dot{color:var(--unit-text)}
.mast .facts{margin:0;color:var(--quiet);font-size:15px;line-height:1.45;text-align:right}
.mast .facts b{color:var(--ink);font-weight:500}
.mast .lineage{grid-column:1/-1;margin:6px 0 0;color:var(--quiet);font-size:15px}
.mast .lineage span+span::before{content:" → ";color:var(--hair)}
.mast .lineage span:last-child{color:var(--ink)}
@media (max-width:640px){.mast{grid-template-columns:1fr;padding-top:36px}.mast .facts{text-align:left}}
nav.jump{display:flex;gap:22px;flex-wrap:wrap;border-top:1px solid var(--ink);padding:10px 0 0;font-size:15px}
nav.jump a{color:var(--ink);text-decoration:none}
nav.jump a:hover{color:var(--unit-text)}
.intro{max-width:62ch;margin:18px 0 0;font:400 20px/1.5 var(--serif)}

/* pain: Beer's algedonic channel, bypassing everything else */
.pain{margin:28px 0 0;border-left:6px solid var(--pain);padding:4px 0 4px 18px}
.pain h2{margin:0;color:var(--pain);font:600 22px/1.25 var(--sans)}
.pain ul{margin:8px 0;padding:0;list-style:none;font-family:var(--serif);font-size:18px}
.pain time{font-family:var(--sans);font-size:14px;color:var(--quiet);margin-right:8px}
.pain p{margin:6px 0 0;color:var(--quiet);font-size:14px}

/* the field */
.field{margin:40px 0 0}
.field svg{display:block;width:100%;height:auto;overflow:visible}
.field text{font-family:var(--sans);font-size:14px;fill:var(--ink)}
.field text.sub{font-size:12px;fill:var(--quiet)}
.field text.col{font-size:13px;fill:var(--quiet)}
.field .e{fill:none;stroke-linecap:round}
.field .e-h{stroke:var(--hair);stroke-width:1.3}
.field .e-up{stroke:var(--unit-text);opacity:.85}
.field .e-down{stroke:var(--pain);opacity:.85}
.field .e-flat,.field .e-none{stroke:var(--quiet);opacity:.5;stroke-dasharray:.006 .012}
.field .n-act circle{fill:var(--paper);stroke:var(--ink);stroke-width:1.4}
.field .n-req .track{stroke:var(--hair);stroke-width:3;stroke-linecap:round}
.field .n-req .fill{stroke:var(--unit-text);stroke-width:3;stroke-linecap:round}
.field .n-req.met .fill{stroke:var(--ink)}
.field .n-h .core{fill:var(--unit-text)}
.field .n-h .ring{fill:none;stroke:var(--hair);stroke-width:1.5}
.field .n-h .arc{fill:none;stroke:var(--unit-text);stroke-width:2.4;stroke-linecap:round}
.field .n-h text:not(.sub){font-weight:500;font-size:15px}
.field figcaption{margin-top:10px;color:var(--quiet);font-size:14px;max-width:70ch}
.field-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.scroll-note{display:none}
@media (max-width:760px){.field svg{min-width:980px}.scroll-note{display:block;margin:0 0 6px;color:var(--quiet);font-size:14px}}
@media (prefers-reduced-motion:no-preference){
  .js .field .e-h,.js .field .e-up,.js .field .e-down{stroke-dasharray:1;stroke-dashoffset:1}
  .js .field .e-flat,.js .field .e-none{opacity:0}
  .js .field.run .e-h{animation:back 1.1s cubic-bezier(.3,.6,.2,1) forwards}
  .js .field.run .e-up,.js .field.run .e-down{animation:back 1.1s cubic-bezier(.3,.6,.2,1) .9s forwards}
  .js .field.run .e-flat,.js .field.run .e-none{animation:fade .8s ease 1.2s forwards}
  @keyframes back{to{stroke-dashoffset:0}}
  @keyframes fade{to{opacity:.5}}
}

/* sections */
section{margin:88px 0 0}
section>h2{margin:0;font:600 34px/1.1 var(--sans);letter-spacing:-.02em;padding-bottom:12px;border-bottom:1px solid var(--ink)}
.lede{margin:14px 0 0;color:var(--quiet);max-width:64ch}
.empty,.hint{color:var(--quiet);margin:20px 0 0}
.empty code,.hint code{color:var(--ink)}
.missing{color:var(--quiet);font-style:italic}
.meta{margin:4px 0 0;color:var(--quiet);font-size:14px}
.meta span+span{margin-left:16px}
.voice{font:400 19px/1.62 var(--serif);max-width:62ch}
.voice p{margin:0 0 .8em}
.voice h4,.voice h5,.voice h6{font:600 16px/1.3 var(--sans);margin:1.2em 0 .4em}
.voice blockquote{margin:0 0 .8em;padding-left:16px;border-left:2px solid var(--hair)}
.voice ul,.voice ol{padding-left:1.2em;margin:0 0 .8em}

.horizon{margin:44px 0 0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 48px}
.horizon header{grid-column:1/-1}
.horizon h3{margin:0;font:400 clamp(28px,4vw,40px)/1.12 var(--serif);letter-spacing:-.01em;max-width:28ch}
.horizon .voice{margin-top:10px}
.reqs{list-style:none;margin:14px 0 0;padding:0;align-self:start}
.reqs li{display:grid;grid-template-columns:minmax(0,1fr) 100px 42px 34px;gap:12px;align-items:center;padding:11px 0;border-top:1px solid var(--hair);font-size:16px}
.reqs li:last-child{border-bottom:1px solid var(--hair)}
.reqs .rt em{font-style:normal;color:var(--quiet);font-size:13px;margin-left:4px}
.reqs .rv{text-align:right;font-weight:500}
.reqs .rm{text-align:right;color:var(--unit-text);font-size:14px}
.reqs li.dropped .rt{text-decoration:line-through;color:var(--quiet)}
.spark{width:100px;height:26px;overflow:visible}
.spark line{stroke:var(--hair);stroke-width:1}
.spark polyline{fill:none;stroke:var(--unit-text);stroke-width:1.6;stroke-linejoin:round}
.spark circle{fill:var(--unit-text)}
.spark-empty{color:var(--quiet);font-size:13px}
@media (max-width:820px){.horizon{grid-template-columns:1fr}.reqs li{grid-template-columns:minmax(0,1fr) 64px 40px 30px}.spark{width:64px}}
.earlier{margin:40px 0 0;color:var(--quiet)}
.earlier summary{cursor:pointer}
.earlier ul{padding-left:1.2em}
.earlier em{font-style:normal;font-size:14px}

.acts{list-style:none;margin:18px 0 0;padding:0}
.acts li{display:grid;grid-template-columns:120px minmax(0,1fr) auto;gap:6px 24px;padding:16px 0;border-bottom:1px solid var(--hair);align-items:start}
.acts time{color:var(--quiet);font-size:15px;padding-top:2px}
.acts .at{margin:0;font-weight:500;font-size:18px}
.acts .moves{margin:6px 0 0;display:flex;flex-wrap:wrap;gap:4px 16px;font-size:14px;color:var(--quiet)}
.acts .mv.up{color:var(--unit-text)}
.acts .mv.down{color:var(--pain)}
.acts details{margin-top:8px}
.acts summary{cursor:pointer;color:var(--quiet);font-size:14px}
.acts .voice{font-size:17px;margin-top:6px}
.felt{display:inline-flex;align-items:center;gap:8px;font-size:14px;color:var(--quiet);white-space:nowrap;padding-top:4px}
.felt svg{width:46px;height:10px;overflow:visible}
.felt line{stroke:var(--hair);stroke-width:1.4}
.felt line.mid{stroke:var(--quiet)}
.felt circle{fill:var(--ink)}
.felt.low{color:var(--pain)}
.felt.low circle{fill:var(--pain)}
@media (max-width:640px){.acts li{grid-template-columns:1fr}.acts time{padding:0}}
.inherited{margin:18px 0 0;color:var(--quiet);font-size:15px}

.start{margin:40px 0 0;max-width:780px}
.eyebrow{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--quiet)}
.statement-quote{margin:22px 0 16px;font:400 clamp(30px,5vw,50px)/1.15 var(--serif);letter-spacing:-.02em}
.attribution{font-size:14px;color:var(--quiet)}
.entry-links{display:flex;flex-wrap:wrap;gap:14px 28px;margin:26px 0}
.start ol{padding-left:1.3em;max-width:64ch}
.start li{padding:6px 0}
#statement .voice{margin-top:24px}
.scores{margin:22px 0 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:0 48px}
.score{padding:18px 0 22px;border-top:1px solid var(--hair)}
.score h3{margin:0 0 6px;font:500 15px/1.3 var(--sans);color:var(--quiet)}
.score .voice{font-size:21px;line-height:1.45}
.score .voice p:last-child{margin-bottom:0}

.pdoc{margin:22px 0 0;border-top:1px solid var(--hair);padding-top:12px}
.pdoc summary{cursor:pointer;font:500 18px/1.3 var(--sans)}
.pdoc .voice{margin-top:12px}
.sub-h{margin:40px 0 0;font:600 20px/1.2 var(--sans)}
.props{list-style:none;margin:10px 0 0;padding:0}
.props li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:4px 24px;padding:10px 0;border-bottom:1px solid var(--hair);font-size:16px}
.props .pm,.props .ps{color:var(--quiet);font-size:14px}
.props li.open .ps{color:var(--unit-text)}
.props li.rejected .pt{color:var(--quiet)}
@media (max-width:640px){.props li{grid-template-columns:1fr}}
.history{margin:18px 0 0;color:var(--quiet);font-size:15px;max-width:70ch}

footer{margin:110px 0 0;padding:18px 0 48px;border-top:1px solid var(--ink);display:grid;grid-template-columns:1fr 1fr;gap:12px 32px;color:var(--quiet);font-size:14px}
footer p{margin:0;max-width:52ch}
@media (max-width:640px){footer{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap">
  <header class="mast">
    <h1>${esc(title)}<span class="dot" aria-hidden="true">.</span></h1>
    <p class="facts">${starter ? 'Starter repository<br>Write the unit together' : `${u.unit.place ? `${esc(u.unit.place)}<br>` : ''}${esc(founded)}<br><b>${members}</b> ${members === 1 ? 'member' : 'members'}${pulse !== null ? `<br>pulse <b>${signed(pulse, 1)}</b>` : ''}`}</p>
    ${lineage.length > 1 ? `<p class="lineage" aria-label="lineage">${lineage.map((n) => `<span>${esc(n)}</span>`).join('')}</p>` : ''}
  </header>
  <nav class="jump" aria-label="sections">${starter ? '<a href="#start">Start a unit</a>' : '<a href="#field">Field</a><a href="#horizons">Horizons</a><a href="#acts">Acts</a>'}<a href="#scores">Scores</a><a href="#protocol">Protocol</a>${u.statement ? '<a href="#statement">Statement</a>' : ''}</nav>
  ${start}
  <main>
  ${u.unit.body ? `<div class="intro">${markdown(u.unit.body, { shift: 2 })}</div>` : ''}
  ${painBand}
  ${starter ? '' : `<div id="field">${c.horizons.some((h) => h.status === 'open') ? '<p class="scroll-note">Scroll right, toward the future.</p>' : ''}<div class="field-scroll">${field(c)}</div></div>
  ${horizonSection(u, c)}
  ${actSection(u, c)}`}
  ${scoreSection(u)}
  ${protocolSection(u, c)}
  ${statement}
  </main>
  <footer>
    <p>Compiled by the recursion kernel${commit ? ` from commit <code>${esc(commit)}</code>` : ''} on ${esc(fmtDate(new Date().toISOString().slice(0, 10)))}. Built from the unit’s files.</p>
    <p>To start a unit of your own, fork this unit’s repository and run <code>node kernel.mjs fork &lt;name&gt; --yes</code>. Horizons, scores and protocol come with you. Members don’t: everyone in a unit was met in person by someone already in it.</p>
  </footer>
</div>
<script>
document.documentElement.classList.add('js');
const f=document.querySelector('.field');
if(f){const io=new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting){f.classList.add('run');io.disconnect()}},{threshold:.2});io.observe(f)}
</script>
</body>
</html>
`;
}
