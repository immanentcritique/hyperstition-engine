// model.mjs — load a unit from disk, compute its signals, check its integrity.

import fs from 'node:fs';
import path from 'node:path';
import { parseDoc, parseCSV, asList, hashText, isDate, num, mean, KernelError } from './format.mjs';

export const KINDS = {
  horizon: { dir: 'horizons', prefix: 'h', statuses: ['open', 'revised', 'composted'] },
  requirement: { dir: 'requirements', prefix: 'r', statuses: ['open', 'met', 'dropped'] },
  score: { dir: 'scores', prefix: 's', statuses: ['open', 'retired'] },
  act: { dir: 'acts', prefix: 'a', statuses: null },
  proposal: { dir: 'protocol/proposals', prefix: 'p', statuses: ['open', 'ratified', 'rejected'] },
};

export const MEMBER_HEADER = ['handle', 'joined', 'met_by', 'status'];
export const SIGNAL_HEADER = ['act', 'who', 'requirement', 'felt', 'before', 'after', 'note'];
export const DEFAULT_GOVERNANCE = { quorum: 0.5, threshold: 0.66 };

const rd = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const ex = (root, rel) => fs.existsSync(path.join(root, rel));

function readDocs(root, dir, kind) {
  if (!ex(root, dir)) return [];
  return fs.readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith('.md') && !f.endsWith('.proposed.md') && !f.startsWith('_') && f !== 'README.md')
    .sort()
    .map((f) => {
      const rel = `${dir}/${f}`;
      const { meta, body } = parseDoc(rd(root, rel), rel);
      const text = body.replace(/<!--[\s\S]*?-->/g, '').trim();
      return { ...meta, id: meta.id == null ? '' : String(meta.id), kind, body: text, file: rel };
    });
}

/** Files under protocol/ that the unit governs (proposals and the lock are machinery, not protocol). */
export function protocolFiles(root) {
  if (!ex(root, 'protocol')) return [];
  return fs.readdirSync(path.join(root, 'protocol'))
    .filter((f) => f.endsWith('.md') && fs.statSync(path.join(root, 'protocol', f)).isFile())
    .sort()
    .map((f) => `protocol/${f}`);
}

export function governanceOf(unit) {
  return {
    quorum: num(unit.quorum) ?? DEFAULT_GOVERNANCE.quorum,
    threshold: num(unit.threshold) ?? DEFAULT_GOVERNANCE.threshold,
  };
}

export const governanceHash = (unit) => hashText(JSON.stringify(governanceOf(unit)));

export function currentLockState(root, unit) {
  const files = {};
  for (const f of protocolFiles(root)) files[f] = hashText(rd(root, f));
  return { files, governance: governanceHash(unit) };
}

export function loadUnit(root) {
  root = path.resolve(root);
  if (!ex(root, 'unit.md')) {
    throw new KernelError(`no unit.md in ${root}. Run this from a unit's folder, or pass --root <folder>.`);
  }
  const u = parseDoc(rd(root, 'unit.md'), 'unit.md');
  const unit = { ...u.meta, body: u.body, name: String(u.meta.name ?? '') };
  const out = { root, unit };
  for (const [kind, { dir }] of Object.entries(KINDS)) out[kind] = readDocs(root, dir, kind);
  out.statement = ex(root, 'ARTIST-STATEMENT.md') ? rd(root, 'ARTIST-STATEMENT.md') : '';
  out.members = ex(root, 'members.csv') ? parseCSV(rd(root, 'members.csv')) : [];
  out.signals = ex(root, 'ledger/signals.csv') ? parseCSV(rd(root, 'ledger/signals.csv')) : [];
  out.protocol = protocolFiles(root).map((f) => ({ file: f, text: rd(root, f) }));
  out.lock = ex(root, 'protocol/ratified.lock') ? JSON.parse(rd(root, 'protocol/ratified.lock')) : null;
  out.inherited = loadLineage(root);
  return out;
}

/** Records a unit carried over when it forked: the ancestors' acts and signals, kept read-only. */
function loadLineage(root) {
  if (!ex(root, 'lineage')) return [];
  return fs.readdirSync(path.join(root, 'lineage'))
    .filter((d) => fs.statSync(path.join(root, 'lineage', d)).isDirectory())
    .sort()
    .map((name) => {
      const base = `lineage/${name}`;
      const acts = readDocs(root, `${base}/acts`, 'act');
      const signals = ex(root, `${base}/signals.csv`) ? parseCSV(rd(root, `${base}/signals.csv`)) : [];
      const summary = ex(root, `${base}/summary.json`) ? JSON.parse(rd(root, `${base}/summary.json`)) : {};
      return { name, acts: acts.length, signals: signals.length, members: summary.members ?? 0, forked: summary.forked || '' };
    });
}

export const activeMembers = (u) => u.members.filter((m) => (m.status || 'active') === 'active');
export const isFounded = (u) => isDate(u.unit.founded);

// ---------- the signal math ----------
//
// Every act is followed by signals from the people who were there.
//   felt   -2..+2   algedonic: did this feel alive or dead? (Beer's pain/pleasure channel)
//   before  0..1    how likely the requirement seemed before the act
//   after   0..1    how likely it seems now
// after − before is a temporal-difference error: an error signal available now,
// without waiting for the future to arrive. Summed per act and per requirement,
// it is the unit's credit assignment: which acts actually moved which parts of the future.

export function compute(u) {
  const rows = u.signals.map((r) => ({
    ...r, felt: num(r.felt), before: num(r.before), after: num(r.after),
  }));

  const acts = u.act.map((a) => {
    const rs = rows.filter((r) => r.act === a.id);
    const felts = rs.map((r) => r.felt).filter((v) => v !== null);
    const groups = {};
    for (const r of rs) {
      if (r.requirement && r.before !== null && r.after !== null) (groups[r.requirement] ||= []).push(r);
    }
    const deltas = {};
    for (const [rid, list] of Object.entries(groups)) {
      deltas[rid] = {
        before: mean(list.map((x) => x.before)),
        after: mean(list.map((x) => x.after)),
        delta: mean(list.map((x) => x.after - x.before)),
        voices: list.length,
      };
    }
    return {
      ...a,
      date: String(a.date ?? ''),
      requirements: asList(a.requirements),
      with: asList(a.with),
      felt: felts.length ? mean(felts) : null,
      feltVoices: felts.length,
      deltas,
    };
  }).sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));

  const reqs = u.requirement.map((r) => {
    const trail = acts.filter((a) => a.deltas[r.id]).map((a) => ({ act: a.id, date: a.date, ...a.deltas[r.id] }));
    const status = r.status || 'open';
    const current = status === 'met' ? 1 : trail.length ? trail.at(-1).after : null;
    const start = trail.length ? trail[0].before : null;
    return {
      ...r, status,
      horizons: asList(r.horizons),
      trail, current, start,
      movement: current !== null && start !== null ? current - start : null,
      untouched: !trail.length && status === 'open',
    };
  });

  const horizons = u.horizon.map((h) => {
    const rs = reqs.filter((r) => r.horizons.includes(h.id) && r.status !== 'dropped');
    const known = rs.filter((r) => r.current !== null);
    return {
      ...h,
      status: h.status || 'open',
      by: asList(h.by),
      requirements: rs.map((r) => r.id),
      nearness: known.length ? mean(known.map((r) => r.current)) : null,
      noGradient: rs.length === 0,
    };
  });

  const dateOf = new Map(acts.map((a) => [a.id, a.date]));
  const pain = rows
    .filter((r) => r.felt !== null && r.felt <= -2)
    .map((r) => ({ act: r.act, date: dateOf.get(r.act) || '', note: r.note || '' }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const felt = acts.filter((a) => a.felt !== null);
  const recent = felt.slice(-5);
  const pulse = recent.length ? mean(recent.map((a) => a.felt)) : null;

  const proposals = u.proposal.map((p) => ({ ...p, status: p.status || 'open', tally: tally(u, p) }));

  return { acts, reqs, horizons, pain, pulse, pulseActs: recent.length, proposals };
}

export function tally(u, p) {
  const active = activeMembers(u);
  const handles = new Set(active.map((m) => m.handle));
  const votes = {};
  for (const v of asList(p.votes)) {
    const [who, choice] = v.split(':').map((s) => s.trim());
    if (handles.has(who) && (choice === 'yes' || choice === 'no')) votes[who] = choice;
  }
  const yes = Object.values(votes).filter((c) => c === 'yes').length;
  const cast = Object.keys(votes).length;
  const { quorum, threshold } = governanceOf(u.unit);
  const need = Math.max(1, Math.ceil(quorum * active.length));
  const quorate = cast >= need;
  const passes = quorate && cast > 0 && yes / cast >= threshold;
  // can it still pass if every remaining member voted yes?
  const remaining = active.length - cast;
  const best = cast + remaining > 0 ? (yes + remaining) / (cast + remaining) : 0;
  const hopeless = best < threshold;
  return { yes, no: cast - yes, cast, members: active.length, need, quorate, passes, hopeless, threshold, quorum };
}

// ---------- integrity ----------

const ALLOWED_TARGET = /^protocol\/[^/]+\.md$/;

export function check(u) {
  const problems = [];
  const err = (where, msg) => problems.push({ level: 'error', where, msg });
  const warn = (where, msg) => problems.push({ level: 'warn', where, msg });

  if (!u.unit.name) err('unit.md', 'needs a name');
  else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(u.unit.name)) err('unit.md', 'name must use letters, numbers, dots, underscores or hyphens');
  const g = governanceOf(u.unit);
  if (!(g.quorum > 0 && g.quorum <= 1)) err('unit.md', 'quorum must be a fraction between 0 and 1');
  if (!(g.threshold > 0 && g.threshold <= 1)) err('unit.md', 'threshold must be a fraction between 0 and 1');
  if (u.unit.founded && !isDate(u.unit.founded)) err('unit.md', `founded must be a date like 2026-10-24, not "${u.unit.founded}"`);

  // ids
  const ids = new Map();
  for (const [kind, spec] of Object.entries(KINDS)) {
    for (const d of u[kind]) {
      if (!new RegExp(`^${spec.prefix}-\\d+$`).test(d.id)) err(d.file, `id should look like ${spec.prefix}-001, got "${d.id}"`);
      if (ids.has(d.id)) err(d.file, `id ${d.id} is also used by ${ids.get(d.id)}`);
      ids.set(d.id, d.file);
      if (!path.basename(d.file).startsWith(d.id)) warn(d.file, `file name doesn't start with its id (${d.id})`);
      if (spec.statuses && d.status && !spec.statuses.includes(d.status)) {
        err(d.file, `status must be one of ${spec.statuses.join(', ')}`);
      }
      if (kind !== 'act' && kind !== 'proposal' && !d.title) err(d.file, 'needs a title');
    }
  }
  const has = (kind, id) => u[kind].some((d) => d.id === id);

  // members: everyone was met in person by someone already in the room
  const seen = new Set();
  for (const m of u.members) {
    const where = `members.csv line ${m._line}`;
    if (!m.handle) { err(where, 'missing handle'); continue; }
    if (/\s|,/.test(m.handle)) err(where, `handle "${m.handle}" can't contain spaces or commas`);
    if (seen.has(m.handle)) err(where, `${m.handle} is listed twice`);
    if (m.met_by !== 'founding' && !seen.has(m.met_by)) {
      err(where, `${m.handle} must be met_by "founding" or a member listed above them (got "${m.met_by}")`);
    }
    if (m.met_by === 'founding' && isFounded(u) && m.joined && m.joined > u.unit.founded) {
      err(where, `${m.handle} joined after the founding, so needs a met_by member`);
    }
    if (m.joined && !isDate(m.joined)) err(where, `joined must be a date`);
    if (m.status && !['active', 'inactive'].includes(m.status)) err(where, 'status must be active or inactive');
    seen.add(m.handle);
  }
  const memberSet = new Set(u.members.map((m) => m.handle));

  for (const h of u.horizon) {
    if (h.parent && !has('horizon', String(h.parent))) warn(h.file, `parent ${h.parent} isn't in this unit`);
    if (!h.body && (h.status || 'open') === 'open') warn(h.file, 'has no written future yet');
  }
  for (const r of u.requirement) {
    const hs = asList(r.horizons);
    if (!hs.length) err(r.file, 'must point at least one horizon (horizons: [h-001])');
    for (const h of hs) if (!has('horizon', h)) err(r.file, `points at ${h}, which doesn't exist`);
  }
  for (const a of u.act) {
    if (!isDate(a.date)) err(a.file, 'needs a date like 2026-10-24');
    if (a.score && !has('score', String(a.score))) err(a.file, `uses score ${a.score}, which doesn't exist`);
    for (const r of asList(a.requirements)) if (!has('requirement', r)) err(a.file, `aims at ${r}, which doesn't exist`);
    for (const w of asList(a.with)) if (!memberSet.has(w)) warn(a.file, `${w} isn't in members.csv (a guest?)`);
  }
  for (const s of u.signals) {
    const where = `ledger/signals.csv line ${s._line}`;
    const act = u.act.find((a) => a.id === s.act);
    if (!act) { err(where, `act ${s.act || '(blank)'} doesn't exist`); continue; }
    if (s.who && !memberSet.has(s.who)) warn(where, `${s.who} isn't in members.csv`);
    const felt = num(s.felt);
    if (s.felt !== '' && !(Number.isInteger(felt) && felt >= -2 && felt <= 2)) err(where, 'felt must be a whole number from -2 to 2');
    if (s.requirement) {
      if (!has('requirement', s.requirement)) err(where, `requirement ${s.requirement} doesn't exist`);
      else if (!asList(act.requirements).includes(s.requirement)) warn(where, `${s.act} doesn't list ${s.requirement} in its requirements`);
      for (const k of ['before', 'after']) {
        const v = num(s[k]);
        if (v === null || v < 0 || v > 1) err(where, `${k} must be a probability from 0 to 1`);
      }
    } else if (s.before !== '' || s.after !== '') err(where, 'a forecast needs a requirement');
    if (s.felt === '' && !s.requirement) warn(where, 'empty signal');
  }

  for (const p of u.proposal) {
    const isGov = p.target === 'governance';
    if (!isGov && !ALLOWED_TARGET.test(String(p.target || ''))) {
      err(p.file, `target must be "governance" or a file directly inside protocol/ (got "${p.target}")`);
    }
    if ((p.status || 'open') === 'open' && !isGov) {
      const proposed = p.file.replace(/\.md$/, '.proposed.md');
      if (!ex(u.root, proposed)) err(p.file, `missing ${proposed} (the proposed text)`);
    }
    for (const v of asList(p.votes)) {
      const [who, choice] = v.split(':').map((s) => s.trim());
      if (!memberSet.has(who)) warn(p.file, `vote from ${who}, who isn't a member`);
      if (!['yes', 'no'].includes(choice)) err(p.file, `vote "${v}" should be handle:yes or handle:no`);
    }
  }

  // the protocol enforces itself: after founding, governed text only changes by ratified proposal
  if (isFounded(u)) {
    for (const file of ['protocol/MEETING.md', 'protocol/TRADITIONS.md']) {
      const text = u.protocol.find((p) => p.file === file)?.text || '';
      if (!text.replace(/<!--[\s\S]*?-->/g, '').trim()) err(file, 'write this together before founding');
    }
    if (!u.lock) err('protocol/ratified.lock', 'this unit is founded but has no lock. Run `node kernel.mjs found` again to re-lock.');
    else {
      const now = currentLockState(u.root, u.unit);
      for (const [f, h] of Object.entries(u.lock.files || {})) {
        if (!now.files[f]) err(f, 'was deleted without a ratified proposal');
        else if (now.files[f] !== h) err(f, 'was edited without a ratified proposal');
      }
      for (const f of Object.keys(now.files)) {
        if (!(f in (u.lock.files || {}))) err(f, 'was added without a ratified proposal');
      }
      if (u.lock.governance !== now.governance) err('unit.md', 'quorum or threshold changed without a ratified proposal');
    }
  }

  return problems;
}
