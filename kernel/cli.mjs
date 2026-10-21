// cli.mjs — every command a unit needs. Each one only reads and writes plain files,
// so anything the CLI does can also be done by hand in a text editor or on GitHub.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  parseDoc, formatDoc, parseCSV, formatCSV, asList, hashText, slug, today, isDate, num, KernelError,
} from './format.mjs';
import {
  KINDS, MEMBER_HEADER, SIGNAL_HEADER, loadUnit, compute, check, tally, activeMembers, isFounded,
  currentLockState, governanceHash, governanceOf,
} from './model.mjs';
import { compileSite } from './site.mjs';

const BOOLEAN_FLAGS = new Set(['yes', 'help', 'quiet']);

export function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      let key = a.slice(2), val;
      const eq = key.indexOf('=');
      if (eq > -1) { val = key.slice(eq + 1); key = key.slice(0, eq); }
      else if (BOOLEAN_FLAGS.has(key) || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) val = true;
      else val = argv[++i];
      (flags[key] ||= []).push(val);
    } else pos.push(a);
  }
  return { pos, flags };
}

// ---------- tiny file helpers ----------

const write = (root, rel, text) => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
};
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (root, rel) => fs.existsSync(path.join(root, rel));

function updateDoc(root, rel, fn) {
  const { meta, body } = parseDoc(read(root, rel), rel);
  const next = fn(meta, body) ?? { meta, body };
  write(root, rel, formatDoc(next.meta, next.body));
}

function nextId(u, kind) {
  const { prefix } = KINDS[kind];
  const n = Math.max(0, ...u[kind].map((d) => Number(String(d.id).split('-')[1]) || 0)) + 1;
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

function createDoc(u, kind, title, meta, body) {
  const id = nextId(u, kind);
  const rel = `${KINDS[kind].dir}/${id}-${slug(title)}.md`;
  write(u.root, rel, formatDoc({ id, title, ...meta }, body));
  return { id, rel };
}

function find(u, kind, id) {
  const d = u[kind].find((x) => x.id === id);
  if (!d) throw new KernelError(`no ${kind} with id ${id}. Run \`node kernel.mjs status\` to see what exists.`);
  return d;
}

const list = (flags, key) => (flags[key] || []).flatMap((v) => String(v).split(',')).map((s) => s.trim()).filter(Boolean);
const one = (flags, key) => (flags[key] ? flags[key].at(-1) : undefined);
const need = (v, msg) => { if (v === undefined || v === true || v === '') throw new KernelError(msg); return v; };

function readCSV(root, rel) { return exists(root, rel) ? parseCSV(read(root, rel)) : []; }
function appendRows(root, rel, header, rows) {
  const existing = readCSV(root, rel);
  write(root, rel, formatCSV(header, [...existing, ...rows]));
}

function prob(v, label) {
  let x = typeof v === 'string' && v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : Number(v);
  if (!Number.isNaN(x) && x > 1 && x <= 100) x = x / 100;
  if (Number.isNaN(x) || x < 0 || x > 1) throw new KernelError(`${label} must be a probability like 0.3 or 30%`);
  return Math.round(x * 1000) / 1000;
}

function gitCommit(root) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { return ''; }
}

const PLACEHOLDER = {
  horizon: '<!-- Write the future here, in your own words. What is it like to live there? -->',
  requirement: '<!-- What does this future ask of the present? Concrete enough that you would know if it happened. -->',
  score: '<!-- The score: a few short instructions anyone could carry out with someone else. -->',
  act: '<!-- What happened? Who came, what you did, what surprised you. -->',
  proposal: '<!-- Why this change? The proposed text itself lives in the .proposed.md file next to this one. -->',
};

// ---------- commands ----------

const commands = {
  help() { console.log(HELP); },

  status(u) {
    const c = compute(u);
    const founded = isFounded(u) ? `founded ${u.unit.founded}` : 'founding mode (protocol is open until you run `found`)';
    const lineage = asList(u.unit.lineage);
    console.log(`\n${u.unit.name}${u.unit.place ? ` · ${u.unit.place}` : ''} — ${founded}`);
    if (lineage.length) console.log(`lineage: ${[...lineage, u.unit.name].join(' → ')}`);
    console.log(`${activeMembers(u).length} active members · ${c.acts.length} acts · ${u.signals.length} signals`);
    if (c.pulse !== null) console.log(`pulse (last ${c.pulseActs} acts): ${fmtFelt(c.pulse)}${c.pulse < 0 ? '  ← the unit is in pain; change something' : ''}`);
    if (c.pain.length) console.log(`pain signals: ${c.pain.length} (most recent ${c.pain[0].date})`);
    console.log('\nhorizons');
    if (!c.horizons.length) console.log('  none yet: node kernel.mjs horizon "A world where…"');
    for (const h of c.horizons.filter((h) => h.status === 'open')) {
      console.log(`  ${h.id}  ${h.title}  ${h.nearness === null ? '(no forecasts yet)' : pct(h.nearness)}`);
      for (const r of c.reqs.filter((r) => r.horizons.includes(h.id))) {
        const mv = r.movement === null ? '' : ` (${r.movement >= 0 ? '+' : ''}${Math.round(r.movement * 100)})`;
        console.log(`      ${r.id}  ${r.status === 'open' ? '' : `[${r.status}] `}${r.title}  ${r.current === null ? 'untouched' : pct(r.current) + mv}`);
      }
      if (h.noGradient) console.log('      no requirements yet: node kernel.mjs require "…" --horizon ' + h.id);
    }
    const open = c.proposals.filter((p) => p.status === 'open');
    if (open.length) {
      console.log('\nopen proposals');
      for (const p of open) console.log(`  ${p.id}  ${p.title}  ${p.tally.yes} yes / ${p.tally.no} no of ${p.tally.members} (needs ${p.tally.need} votes, ${Math.round(p.tally.threshold * 100)}% yes)`);
    }
    console.log('');
  },

  check(u) {
    const problems = check(u);
    report(problems);
    if (problems.some((p) => p.level === 'error')) process.exitCode = 1;
    else console.log(problems.length ? 'no errors.' : 'all clear.');
  },

  build(u, { flags }) {
    const problems = check(u);
    const errors = problems.filter((p) => p.level === 'error');
    if (errors.length) {
      report(errors);
      throw new KernelError(`not compiling: ${errors.length} error(s). The site only compiles from a unit in good standing.`);
    }
    const out = path.resolve(u.root, one(flags, 'out') || 'dist');
    const example = exists(u.root, 'examples/demo-unit/dist/index.html');
    const html = compileSite(u, compute(u), { commit: gitCommit(u.root), example });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'index.html'), html);
    fs.writeFileSync(path.join(out, 'unit.json'), JSON.stringify(exportJSON(u), null, 2));
    if (example) {
      const exampleOut = path.join(out, 'example');
      fs.mkdirSync(exampleOut, { recursive: true });
      for (const file of ['index.html', 'unit.json']) fs.copyFileSync(path.join(u.root, 'examples/demo-unit/dist', file), path.join(exampleOut, file));
    }
    console.log(`compiled ${path.relative(process.cwd(), path.join(out, 'index.html')) || 'index.html'}`);
  },

  member(u, { pos, flags }) {
    const [sub, handle] = pos;
    if (sub === 'add') {
      need(handle, 'usage: member add <handle> --met-by <handle>');
      if (/\s|,/.test(handle)) throw new KernelError('handles cannot contain spaces or commas');
      if (u.members.some((m) => m.handle === handle)) throw new KernelError(`${handle} is already a member`);
      const metBy = need(one(flags, 'met-by'), 'who met them in person? --met-by <handle> (or --met-by founding before the unit is founded)');
      if (metBy === 'founding') {
        if (isFounded(u)) throw new KernelError('the unit is already founded; new members need --met-by <an active member>');
      } else if (!activeMembers(u).some((m) => m.handle === metBy)) {
        throw new KernelError(`${metBy} is not an active member, so can't vouch for anyone`);
      }
      const joined = one(flags, 'date') || today();
      appendRows(u.root, 'members.csv', MEMBER_HEADER, [{ handle, joined, met_by: metBy, status: 'active' }]);
      console.log(`${handle} joined, vouched for by ${metBy}.`);
    } else if (sub === 'leave') {
      need(handle, 'usage: member leave <handle>');
      const rows = readCSV(u.root, 'members.csv');
      const m = rows.find((r) => r.handle === handle);
      if (!m) throw new KernelError(`${handle} isn't a member`);
      m.status = 'inactive';
      write(u.root, 'members.csv', formatCSV(MEMBER_HEADER, rows));
      console.log(`${handle} is now inactive. Their history stays.`);
    } else throw new KernelError('usage: member add <handle> --met-by <handle>  |  member leave <handle>');
  },

  found(u, { flags }) {
    if (isFounded(u) && u.lock) throw new KernelError(`${u.unit.name} was founded on ${u.unit.founded}. Change the protocol with propose / vote / ratify.`);
    const founders = activeMembers(u);
    if (!founders.length) throw new KernelError('a unit needs at least one member to be founded: member add <handle> --met-by founding');
    for (const file of ['protocol/MEETING.md', 'protocol/TRADITIONS.md']) {
      const text = exists(u.root, file) ? read(u.root, file) : '';
      if (!text.replace(/<!--[\s\S]*?-->/g, '').trim()) throw new KernelError(`write ${file} together before founding`);
    }
    const date = one(flags, 'date') || u.unit.founded || today();
    if (!isDate(date)) throw new KernelError('--date must look like 2026-10-24');
    const late = founders.filter((m) => m.joined && m.joined > date);
    if (late.length) throw new KernelError(`${late.map((m) => m.handle).join(', ')} joined after ${date}. Found on or after the day everyone joined, or re-add them with --date.`);
    updateDoc(u.root, 'unit.md', (meta, body) => ({ meta: { ...meta, founded: date }, body }));
    const fresh = loadUnit(u.root);
    const lock = { ...currentLockState(u.root, fresh.unit), history: [{ event: 'founded', date, by: founders.map((m) => m.handle) }] };
    write(u.root, 'protocol/ratified.lock', JSON.stringify(lock, null, 2) + '\n');
    console.log(`${u.unit.name} founded ${date} by ${founders.map((m) => m.handle).join(', ')}.`);
    console.log('The protocol is now locked: changes go through propose → vote → ratify.');
  },

  horizon(u, { pos, flags }) {
    const title = need(pos[0], 'usage: horizon "A world where…" [--by handle,handle]');
    const { rel } = createDoc(u, 'horizon', title, { status: 'open', created: one(flags, 'date') || today(), by: list(flags, 'by') }, PLACEHOLDER.horizon);
    console.log(`write the future in ${rel}`);
  },

  revise(u, { pos, flags }) {
    const old = find(u, 'horizon', need(pos[0], 'usage: revise <horizon-id> ["new title"]'));
    const title = pos[1] || old.title;
    const body = parseDoc(read(u.root, old.file)).body;
    const { id, rel } = createDoc(u, 'horizon', title, {
      status: 'open', created: one(flags, 'date') || today(), by: list(flags, 'by').length ? list(flags, 'by') : asList(old.by), parent: old.id,
    }, body);
    updateDoc(u.root, old.file, (meta, b) => ({ meta: { ...meta, status: 'revised', revised_to: id }, body: b }));
    for (const r of u.requirement.filter((r) => asList(r.horizons).includes(old.id))) {
      updateDoc(u.root, r.file, (meta, b) => ({ meta: { ...meta, horizons: [...asList(meta.horizons), id] }, body: b }));
    }
    console.log(`${old.id} revised into ${id}. Its requirements now also point at ${id}. Edit ${rel}`);
  },

  compost(u, { pos }) {
    const h = find(u, 'horizon', need(pos[0], 'usage: compost <horizon-id>'));
    updateDoc(u.root, h.file, (meta, b) => ({ meta: { ...meta, status: 'composted' }, body: b }));
    console.log(`${h.id} composted. It stays in the record; it no longer pulls.`);
  },

  require(u, { pos, flags }) {
    const title = need(pos[0], 'usage: require "what the future asks of now" --horizon h-001');
    const horizons = list(flags, 'horizon');
    if (!horizons.length) throw new KernelError('which future asks for this? --horizon h-001');
    for (const h of horizons) find(u, 'horizon', h);
    const { rel } = createDoc(u, 'requirement', title, { horizons, status: 'open', created: one(flags, 'date') || today() }, PLACEHOLDER.requirement);
    console.log(`added ${rel}`);
  },

  met(u, { pos }) { setStatus(u, 'requirement', pos[0], 'met', 'usage: met <requirement-id>'); },
  drop(u, { pos }) { setStatus(u, 'requirement', pos[0], 'dropped', 'usage: drop <requirement-id>'); },
  retire(u, { pos }) { setStatus(u, 'score', pos[0], 'retired', 'usage: retire <score-id>'); },

  score(u, { pos, flags }) {
    const title = need(pos[0], 'usage: score "title"');
    const { rel } = createDoc(u, 'score', title, { status: 'open', source: one(flags, 'source') || '' }, PLACEHOLDER.score);
    console.log(`write the score in ${rel}`);
  },

  act(u, { pos, flags }) {
    const title = need(pos[0], 'usage: act "what you did" --req r-001 [--score s-001] [--with a,b] [--date 2026-10-24]');
    const date = one(flags, 'date') || today();
    if (!isDate(date)) throw new KernelError('--date must look like 2026-10-24');
    const score = one(flags, 'score');
    if (score) find(u, 'score', score);
    const requirements = list(flags, 'req');
    for (const r of requirements) find(u, 'requirement', r);
    const { id, rel } = createDoc(u, 'act', title, { date, score: score || '', requirements, with: list(flags, 'with') }, PLACEHOLDER.act);
    console.log(`logged ${rel}`);
    console.log(`now everyone who was there signals: node kernel.mjs signal ${id} --felt 1${requirements[0] ? ` --req ${requirements[0]}:0.2:0.3` : ''}`);
  },

  signal(u, { pos, flags }) {
    const act = find(u, 'act', need(pos[0], 'usage: signal <act-id> --felt -2..2 --req r-001:before:after [--who handle] [--note "…"]'));
    const who = one(flags, 'who');
    if (who && who !== true && !u.members.some((m) => m.handle === who)) throw new KernelError(`${who} isn't a member. Leave out --who to signal anonymously.`);
    const feltRaw = one(flags, 'felt');
    let felt = '';
    if (feltRaw !== undefined) {
      felt = num(feltRaw);
      if (!Number.isInteger(felt) || felt < -2 || felt > 2) throw new KernelError('--felt is a whole number from -2 (dead) to 2 (alive)');
    }
    const forecasts = list(flags, 'req').map((spec) => {
      const [rid, before, after] = spec.split(':');
      if (after === undefined) throw new KernelError(`--req ${spec}: write it as requirement:before:after, e.g. r-001:0.2:0.35`);
      find(u, 'requirement', rid);
      if (!asList(act.requirements).includes(rid)) console.warn(`note: ${act.id} doesn't list ${rid}; recording it anyway`);
      return { requirement: rid, before: prob(before, 'before'), after: prob(after, 'after') };
    });
    const note = one(flags, 'note');
    if (felt === '' && !forecasts.length) throw new KernelError('a signal needs --felt and/or --req');
    const base = { act: act.id, who: who && who !== true ? who : '', note: note && note !== true ? note : '' };
    const rows = forecasts.length
      ? forecasts.map((f, i) => ({ ...base, ...f, felt: i === 0 ? felt : '', note: i === 0 ? base.note : '' }))
      : [{ ...base, felt, requirement: '', before: '', after: '' }];
    appendRows(u.root, 'ledger/signals.csv', SIGNAL_HEADER, rows);
    console.log(`signal recorded for ${act.id}${base.who ? ` from ${base.who}` : ' (anonymous)'}.`);
    if (felt !== '' && felt <= -2) console.log('pain signal: this will show at the top of the unit\'s page until things change.');
  },

  propose(u, { pos, flags }) {
    const title = need(pos[0], 'usage: propose "title" --target protocol/TRADITIONS.md [--text file]  |  propose "title" --governance --threshold 0.75');
    const opened = today();
    if (flags.governance) {
      const set = {};
      for (const k of ['quorum', 'threshold']) {
        const v = one(flags, k);
        if (v !== undefined) {
          const x = Number(v);
          if (!(x > 0 && x <= 1)) throw new KernelError(`--${k} must be a fraction between 0 and 1`);
          set[`set_${k}`] = x;
        }
      }
      if (!Object.keys(set).length) throw new KernelError('a governance proposal needs --quorum and/or --threshold');
      const { rel } = createDoc(u, 'proposal', title, { target: 'governance', ...set, base: governanceHash(u.unit), status: 'open', opened, votes: [] }, PLACEHOLDER.proposal);
      console.log(`proposed ${rel}. Members vote with: node kernel.mjs vote <id> <handle> yes|no`);
      return;
    }
    const target = need(one(flags, 'target'), 'what does this change? --target protocol/SOMETHING.md');
    if (!/^protocol\/[^/]+\.md$/.test(target)) throw new KernelError('--target must be a file directly inside protocol/');
    const current = exists(u.root, target) ? read(u.root, target) : null;
    const textFile = one(flags, 'text');
    const proposed = textFile ? fs.readFileSync(path.resolve(textFile), 'utf8') : current ?? '';
    const { rel } = createDoc(u, 'proposal', title, { target, base: current === null ? 'new' : hashText(current), status: 'open', opened, votes: [] }, PLACEHOLDER.proposal);
    write(u.root, rel.replace(/\.md$/, '.proposed.md'), proposed);
    console.log(`proposed ${rel}`);
    console.log(`${textFile ? 'the proposed text is' : 'edit the proposed text in'} ${rel.replace(/\.md$/, '.proposed.md')}`);
  },

  vote(u, { pos }) {
    const [pid, handle, choice] = pos;
    const p = find(u, 'proposal', need(pid, 'usage: vote <proposal-id> <handle> yes|no'));
    if ((p.status || 'open') !== 'open') throw new KernelError(`${p.id} is ${p.status}; voting is closed`);
    if (!activeMembers(u).some((m) => m.handle === handle)) throw new KernelError(`${handle} isn't an active member`);
    if (!['yes', 'no'].includes(choice)) throw new KernelError('vote yes or no');
    updateDoc(u.root, p.file, (meta, b) => ({
      meta: { ...meta, votes: [...asList(meta.votes).filter((v) => v.split(':')[0] !== handle), `${handle}:${choice}`] }, body: b,
    }));
    const t = tally(loadUnit(u.root), { ...p, votes: [...asList(p.votes).filter((v) => v.split(':')[0] !== handle), `${handle}:${choice}`] });
    console.log(`${handle} voted ${choice}. ${t.yes} yes / ${t.no} no of ${t.members} members${t.passes ? ' — ready to ratify' : ''}.`);
  },

  ratify(u, { pos }) {
    const p = find(u, 'proposal', need(pos[0], 'usage: ratify <proposal-id>'));
    if ((p.status || 'open') !== 'open') throw new KernelError(`${p.id} is already ${p.status}`);
    const t = tally(u, p);
    if (!t.passes) {
      const why = !t.quorate ? `needs ${t.need} votes, has ${t.cast}` : `has ${Math.round((t.yes / t.cast) * 100)}% yes, needs ${Math.round(t.threshold * 100)}%`;
      throw new KernelError(`${p.id} doesn't pass yet: ${why}.`);
    }
    const date = today();
    let lock = u.lock ? structuredClone(u.lock) : null;
    if (p.target === 'governance') {
      if (governanceHash(u.unit) !== p.base) throw new KernelError(`quorum/threshold changed since ${p.id} was proposed. Propose again against the current rules.`);
      updateDoc(u.root, 'unit.md', (meta, b) => ({
        meta: { ...meta, ...(p.set_quorum !== undefined && { quorum: p.set_quorum }), ...(p.set_threshold !== undefined && { threshold: p.set_threshold }) }, body: b,
      }));
      if (lock) lock.governance = governanceHash(loadUnit(u.root).unit);
    } else {
      const current = exists(u.root, p.target) ? read(u.root, p.target) : null;
      const base = current === null ? 'new' : hashText(current);
      if (base !== String(p.base)) throw new KernelError(`${p.target} changed since ${p.id} was proposed. Propose again against the current text.`);
      const text = read(u.root, p.file.replace(/\.md$/, '.proposed.md'));
      write(u.root, p.target, text);
      if (lock) lock.files = { ...lock.files, [p.target]: hashText(text) };
    }
    updateDoc(u.root, p.file, (meta, b) => ({ meta: { ...meta, status: 'ratified', closed: date, result: `${t.yes}-${t.no} of ${t.members}` }, body: b }));
    if (lock) {
      lock.history = [...(lock.history || []), { event: 'ratified', proposal: p.id, target: p.target, date, yes: t.yes, no: t.no, members: t.members }];
      write(u.root, 'protocol/ratified.lock', JSON.stringify(lock, null, 2) + '\n');
    }
    console.log(`${p.id} ratified ${t.yes}-${t.no}. ${p.target === 'governance' ? 'Governance' : p.target} updated${lock ? ' and re-locked' : ''}.`);
  },

  reject(u, { pos }) {
    const p = find(u, 'proposal', need(pos[0], 'usage: reject <proposal-id>'));
    if ((p.status || 'open') !== 'open') throw new KernelError(`${p.id} is already ${p.status}`);
    const t = tally(u, p);
    if (!t.hopeless) throw new KernelError(`${p.id} can still pass (${t.yes} yes / ${t.no} no of ${t.members}). Use withdraw if its author is pulling it.`);
    closeProposal(u, p, 'rejected', `${t.yes}-${t.no} of ${t.members}`);
  },

  withdraw(u, { pos }) {
    const p = find(u, 'proposal', need(pos[0], 'usage: withdraw <proposal-id>'));
    if ((p.status || 'open') !== 'open') throw new KernelError(`${p.id} is already ${p.status}`);
    closeProposal(u, p, 'rejected', 'withdrawn');
  },

  fork(u, { pos, flags }) {
    const name = need(pos[0], 'usage: fork <new-unit-name> --yes [--place "City"]');
    if (!flags.yes) {
      throw new KernelError(
        `fork rewrites THIS folder into a new unit called ${name}.\n` +
        `Do it in your copy of the repo (fork it on GitHub or copy the folder first), then run again with --yes.`);
    }
    if (name === u.unit.name) throw new KernelError('a fork needs a new name');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new KernelError('a unit name must use letters, numbers, dots, underscores or hyphens');
    const parent = u.unit.name;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(parent)) throw new KernelError('the parent unit name is not safe to archive');
    let dest = `lineage/${parent}`;
    for (let i = 2; exists(u.root, dest); i++) dest = `lineage/${parent}-${i}`;
    const move = (from, to) => {
      if (!exists(u.root, from)) return;
      fs.mkdirSync(path.dirname(path.join(u.root, to)), { recursive: true });
      fs.renameSync(path.join(u.root, from), path.join(u.root, to));
    };
    // what the parent's people did travels as history, without their names; the people stay home.
    move('acts', `${dest}/acts`);
    if (exists(u.root, 'ledger/signals.csv')) {
      const rows = readCSV(u.root, 'ledger/signals.csv').map((r) => ({ ...r, who: '' }));
      write(u.root, `${dest}/signals.csv`, formatCSV(SIGNAL_HEADER, rows));
    }
    move('protocol/proposals', `${dest}/proposals`);
    move('protocol/ratified.lock', `${dest}/ratified.lock`);
    write(u.root, `${dest}/unit.md`, read(u.root, 'unit.md'));
    write(u.root, `${dest}/summary.json`, JSON.stringify({ unit: parent, members: activeMembers(u).length, forked: today() }, null, 2) + '\n');
    write(u.root, 'members.csv', formatCSV(MEMBER_HEADER, []));
    write(u.root, 'ledger/signals.csv', formatCSV(SIGNAL_HEADER, []));
    write(u.root, 'acts/.gitkeep', '');
    write(u.root, 'protocol/proposals/.gitkeep', '');
    // requirements met in another place aren't met here
    for (const r of u.requirement.filter((r) => r.status === 'met')) {
      updateDoc(u.root, r.file, (meta, b) => ({ meta: { ...meta, status: 'open' }, body: b }));
    }
    updateDoc(u.root, 'unit.md', (meta) => ({
      meta: {
        ...meta, name, template: false, place: one(flags, 'place') || '', color: one(flags, 'color') || '',
        founded: '', forked_from: parent, lineage: [...asList(meta.lineage), parent],
      },
      body: '<!-- Who is this unit? Write it yourselves. -->',
    }));
    console.log(`${name} forked from ${parent}.`);
    console.log(`Inherited: horizons, requirements, scores, protocol. Left behind: members (people don't fork). History is in ${dest}/.`);
    console.log('You are in founding mode: rewrite anything, add members with --met-by founding, then run `found`.');
  },

  async adopt(u, { pos, flags }) {
    const src = need(pos[0], 'usage: adopt <path-or-url to a horizon or score .md> [--from unit-name]');
    let text, from = one(flags, 'from');
    if (/^https?:\/\//.test(src)) {
      const res = await fetch(src);
      if (!res.ok) throw new KernelError(`couldn't fetch ${src} (${res.status})`);
      text = await res.text();
    } else {
      text = fs.readFileSync(path.resolve(src), 'utf8');
      if (!from) {
        let dir = path.dirname(path.resolve(src));
        for (let i = 0; i < 4 && !from; i++, dir = path.dirname(dir)) {
          const um = path.join(dir, 'unit.md');
          if (fs.existsSync(um)) from = String(parseDoc(fs.readFileSync(um, 'utf8')).meta.name || '');
        }
      }
    }
    const { meta, body } = parseDoc(text, src);
    const kind = String(meta.id || '').startsWith('h-') ? 'horizon' : String(meta.id || '').startsWith('s-') ? 'score' : null;
    if (!kind) throw new KernelError('only horizons (h-…) and scores (s-…) can be adopted');
    const extra = kind === 'horizon' ? { by: asList(meta.by), created: today() } : { source: meta.source || '' };
    const { rel } = createDoc(u, kind, meta.title || 'untitled', { status: 'open', ...extra, adopted_from: from || 'elsewhere', original: meta.id }, body);
    console.log(`adopted ${meta.id} from ${from || 'elsewhere'} as ${rel}`);
  },
};

function setStatus(u, kind, id, status, usage) {
  const d = find(u, kind, need(id, usage));
  updateDoc(u.root, d.file, (meta, b) => ({ meta: { ...meta, status }, body: b }));
  console.log(`${d.id} is now ${status}.`);
}

function closeProposal(u, p, status, result) {
  updateDoc(u.root, p.file, (meta, b) => ({ meta: { ...meta, status, closed: today(), result }, body: b }));
  console.log(`${p.id} ${result === 'withdrawn' ? 'withdrawn' : status}.`);
}

function report(problems) {
  for (const p of problems) console.log(`${p.level === 'error' ? 'error' : 'warn '}  ${p.where}: ${p.msg}`);
}

const pct = (x) => `${Math.round(x * 100)}%`;
const fmtFelt = (x) => `${x > 0 ? '+' : ''}${x.toFixed(1)}`;

export function exportJSON(u) {
  const c = compute(u);
  return {
    unit: { name: u.unit.name, place: u.unit.place || '', founded: u.unit.founded || '', forked_from: u.unit.forked_from || '', lineage: asList(u.unit.lineage), governance: governanceOf(u.unit) },
    members: activeMembers(u).length,
    pulse: c.pulse,
    horizons: c.horizons.map(({ id, title, status, nearness, requirements, parent, adopted_from }) => ({ id, title, status, nearness, requirements, parent, adopted_from })),
    requirements: c.reqs.map(({ id, title, status, horizons, current, start, movement, trail }) => ({ id, title, status, horizons, current, start, movement, trail })),
    acts: c.acts.map(({ id, title, date, score, requirements, felt, deltas }) => ({ id, title, date, score, requirements, felt, deltas })),
    proposals: c.proposals.map(({ id, title, target, status, tally: t }) => ({ id, title, target, status, yes: t.yes, no: t.no })),
  };
}

const HELP = `recursion kernel — a unit's memory, compiled.

  node kernel.mjs <command> [options] [--root <unit folder>]

look
  status                          where the unit is pulling, and how it feels
  check                           integrity check (CI runs this on every push)
  build [--out dist]              compile the unit's site

futures (the targets)
  horizon "A world where…"        write a future   [--by a,b]
  revise <h-id> ["new title"]     a horizon learns: new version, old one kept
  compost <h-id>                  let a horizon die
  require "…" --horizon <h-id>    what that future asks of the present
  met <r-id> | drop <r-id>

the present (the updates)
  score "title"                   a short instruction anyone can perform
  act "what you did" --req <r-id> [--score <s-id>] [--with a,b] [--date YYYY-MM-DD]
  signal <a-id> --felt -2..2 --req <r-id>:<before>:<after> [--who handle] [--note "…"]
                                  leave out --who to signal anonymously

people (personhood is someone in the room)
  member add <handle> --met-by <handle|founding>
  member leave <handle>
  found [--date YYYY-MM-DD]       end founding mode and lock the protocol

the protocol changing itself
  propose "title" --target protocol/X.md [--text file]
  propose "title" --governance [--quorum 0.5] [--threshold 0.66]
  vote <p-id> <handle> yes|no
  ratify <p-id>                   applies the change if it passed; re-locks
  reject <p-id> | withdraw <p-id>

recursion
  fork <new-name> --yes [--place "City"] [--color "#hex"]
                                  turn this copy into a new unit; culture forks, people don't
  adopt <path-or-url> [--from unit]
                                  bring another unit's horizon or score into this one
`;

export async function main(argv) {
  const { pos, flags } = parseArgs(argv);
  const cmd = pos.shift() || 'help';
  if (cmd === 'help' || flags.help) return commands.help();
  const fn = commands[cmd];
  if (!fn) throw new KernelError(`unknown command "${cmd}". Try: node kernel.mjs help`);
  const root = path.resolve(one(flags, 'root') || process.cwd());
  const u = loadUnit(root);
  await fn(u, { pos, flags });
}
