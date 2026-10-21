// End-to-end tests for the kernel. Zero dependencies: node test/run.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseDoc, formatDoc, parseCSV, formatCSV } from '../kernel/format.mjs';
import { loadUnit, compute, check, tally } from '../kernel/model.mjs';
import { markdown } from '../kernel/markdown.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const kernel = path.join(here, '..', 'kernel.mjs');
let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`ok    ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n${e.stack}`); process.exitCode = 1; }
};

function freshUnit(name = 'test.unit') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-'));
  fs.writeFileSync(path.join(root, 'unit.md'), formatDoc({ name, place: 'Here', founded: '', lineage: [], quorum: 0.5, threshold: 0.66 }, ''));
  fs.mkdirSync(path.join(root, 'protocol'));
  fs.writeFileSync(path.join(root, 'protocol/MEETING.md'), 'We meet.\n');
  fs.writeFileSync(path.join(root, 'protocol/TRADITIONS.md'), '1. One.\n');
  return root;
}
const run = (root, ...args) => {
  const r = spawnSync('node', [kernel, ...args, '--root', root], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout + r.stderr).trim() };
};
const ok = (root, ...args) => {
  const r = run(root, ...args);
  assert.equal(r.code, 0, `${args.join(' ')} failed:\n${r.out}`);
  return r.out;
};
const errors = (root) => check(loadUnit(root)).filter((p) => p.level === 'error');

// ---------- formats ----------

test('frontmatter round-trips awkward values', () => {
  const meta = { id: 'h-001', title: 'A world: where "we" meet, again', by: ['ada', 'ben'], empty: '', n: 0.66, flag: true, dateish: '2026-10-24', vote: ['ada:yes'], num_string: '42' };
  const back = parseDoc(formatDoc(meta, 'line one\nline two'));
  assert.deepEqual(back.meta, meta);
  assert.equal(back.body, 'line one\nline two');
});

test('frontmatter reads block lists and empty keys', () => {
  const d = parseDoc('---\nid: r-001\nhorizons:\n  - h-001\n  - h-002\nstatus:\n---\nbody');
  assert.deepEqual(d.meta.horizons, ['h-001', 'h-002']);
  assert.equal(d.meta.status, '');
});

test('CSV round-trips commas, quotes and newlines', () => {
  const rows = [{ act: 'a-001', who: '', note: 'we said "no", then\nyes' }];
  const back = parseCSV(formatCSV(['act', 'who', 'note'], rows));
  assert.equal(back[0].note, rows[0].note);
  assert.equal(back[0].who, '');
});

test('markdown escapes HTML and refuses javascript: links', () => {
  const html = markdown('<script>x</script> [hi](javascript:alert(1)) **b**');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('href="#"'));
  assert.ok(html.includes('<strong>b</strong>'));
});

// ---------- people and founding ----------

const root = freshUnit();

test('founding needs a member, members need someone who met them', () => {
  assert.notEqual(run(root, 'found').code, 0);
  ok(root, 'member', 'add', 'ada', '--met-by', 'founding', '--date', '2026-10-01');
  ok(root, 'member', 'add', 'ben', '--met-by', 'founding', '--date', '2026-10-01');
  assert.match(run(root, 'found', '--date', '2026-09-01').out, /joined after/);
  assert.notEqual(run(root, 'member', 'add', 'cy', '--met-by', 'nobody').code, 0);
  ok(root, 'found', '--date', '2026-10-01');
  assert.notEqual(run(root, 'member', 'add', 'cy', '--met-by', 'founding').code, 0, 'no founding members after founding');
  ok(root, 'member', 'add', 'cy', '--met-by', 'ada');
  assert.equal(errors(root).length, 0);
});

// ---------- the loop ----------

test('horizon → requirement → act → signal computes forecast deltas', () => {
  ok(root, 'horizon', 'A world where', '--by', 'ada');
  ok(root, 'require', 'One thing now', '--horizon', 'h-001');
  ok(root, 'require', 'Another thing', '--horizon', 'h-001');
  ok(root, 'act', 'We did it', '--req', 'r-001', '--with', 'ada,ben', '--date', '2026-10-02');
  ok(root, 'signal', 'a-001', '--who', 'ada', '--felt', '2', '--req', 'r-001:0.2:0.4');
  ok(root, 'signal', 'a-001', '--felt', '1', '--req', 'r-001:20%:30%');
  const c = compute(loadUnit(root));
  const a = c.acts[0];
  assert.equal(a.felt, 1.5);
  assert.ok(Math.abs(a.deltas['r-001'].delta - 0.15) < 1e-9);
  const r = c.reqs.find((x) => x.id === 'r-001');
  assert.ok(Math.abs(r.current - 0.35) < 1e-9);
  assert.ok(Math.abs(r.movement - 0.15) < 1e-9);
  assert.equal(c.reqs.find((x) => x.id === 'r-002').untouched, true);
  assert.ok(Math.abs(c.horizons[0].nearness - 0.35) < 1e-9, 'nearness only counts measured requirements');
});

test('bad signals are refused', () => {
  assert.notEqual(run(root, 'signal', 'a-001', '--felt', '3').code, 0);
  assert.notEqual(run(root, 'signal', 'a-001', '--req', 'r-001:0.2').code, 0);
  assert.notEqual(run(root, 'signal', 'a-001', '--who', 'stranger', '--felt', '1').code, 0);
});

test('pain signals surface, anonymously', () => {
  ok(root, 'act', 'Long meeting', '--req', 'r-002', '--date', '2026-10-03');
  ok(root, 'signal', 'a-002', '--felt', '-2', '--note', 'this was dead', '--req', 'r-002:0.3:0.2');
  const c = compute(loadUnit(root));
  assert.equal(c.pain.length, 1);
  assert.equal(c.pain[0].note, 'this was dead');
  assert.ok(!('who' in c.pain[0]));
});

test('revising a horizon keeps the old one and carries its requirements', () => {
  ok(root, 'revise', 'h-001', 'A better world where');
  const u = loadUnit(root);
  assert.equal(u.horizon.find((h) => h.id === 'h-001').status, 'revised');
  assert.equal(u.horizon.find((h) => h.id === 'h-002').parent, 'h-001');
  assert.ok(u.requirement.every((r) => r.horizons.includes('h-002')));
});

// ---------- the protocol enforcing itself ----------

test('editing the protocol directly after founding fails the check', () => {
  const f = path.join(root, 'protocol/TRADITIONS.md');
  const original = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, original + '2. Sneaky.\n');
  assert.ok(errors(root).some((p) => /edited without a ratified proposal/.test(p.msg)));
  assert.notEqual(run(root, 'build').code, 0, 'build refuses');
  fs.writeFileSync(f, original);
  assert.equal(errors(root).length, 0);
});

test('changing quorum by hand fails the check', () => {
  const f = path.join(root, 'unit.md');
  const original = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, original.replace('threshold: 0.66', 'threshold: 0.1'));
  assert.ok(errors(root).some((p) => /without a ratified proposal/.test(p.msg)));
  fs.writeFileSync(f, original);
});

test('propose → vote → ratify changes the text and re-locks', () => {
  const draft = path.join(root, 'draft.md');
  fs.writeFileSync(draft, '1. One.\n2. Two.\n');
  ok(root, 'propose', 'Add two', '--target', 'protocol/TRADITIONS.md', '--text', draft);
  ok(root, 'vote', 'p-001', 'ada', 'yes');
  assert.notEqual(run(root, 'ratify', 'p-001').code, 0, 'one vote of three is not quorate');
  assert.notEqual(run(root, 'vote', 'p-001', 'stranger', 'yes').code, 0);
  ok(root, 'vote', 'p-001', 'ben', 'yes');
  ok(root, 'ratify', 'p-001');
  assert.equal(fs.readFileSync(path.join(root, 'protocol/TRADITIONS.md'), 'utf8'), '1. One.\n2. Two.\n');
  assert.equal(errors(root).length, 0, 'lock updated');
  assert.notEqual(run(root, 'vote', 'p-001', 'cy', 'no').code, 0, 'closed proposals take no votes');
});

test('a proposal goes stale if its target changed underneath it', () => {
  const d1 = path.join(root, 'd1.md'), d2 = path.join(root, 'd2.md');
  fs.writeFileSync(d1, 'We meet weekly.\n');
  fs.writeFileSync(d2, 'We meet monthly.\n');
  ok(root, 'propose', 'Weekly', '--target', 'protocol/MEETING.md', '--text', d1);
  ok(root, 'propose', 'Monthly', '--target', 'protocol/MEETING.md', '--text', d2);
  for (const p of ['p-002', 'p-003']) for (const m of ['ada', 'ben']) ok(root, 'vote', p, m, 'yes');
  ok(root, 'ratify', 'p-002');
  const r = run(root, 'ratify', 'p-003');
  assert.notEqual(r.code, 0);
  assert.match(r.out, /changed since/);
});

test('governance proposals change the rules for changing rules', () => {
  ok(root, 'propose', 'Higher bar', '--governance', '--threshold', '0.9');
  for (const m of ['ada', 'ben', 'cy']) ok(root, 'vote', 'p-004', m, 'yes');
  ok(root, 'ratify', 'p-004');
  const u = loadUnit(root);
  assert.equal(u.unit.threshold, 0.9);
  assert.equal(errors(root).length, 0);
  ok(root, 'propose', 'Hopeless', '--governance', '--quorum', '0.9');
  ok(root, 'vote', 'p-005', 'ada', 'no');
  const t = tally(loadUnit(root), loadUnit(root).proposal.find((p) => p.id === 'p-005'));
  assert.equal(t.hopeless, true);
  ok(root, 'reject', 'p-005');
});

test('protocol files can only target protocol/', () => {
  assert.notEqual(run(root, 'propose', 'Escape', '--target', 'ledger/signals.csv').code, 0);
  assert.notEqual(run(root, 'propose', 'Escape', '--target', 'protocol/../unit.md').code, 0);
});

// ---------- compile ----------

test('build compiles a page and a JSON export', () => {
  ok(root, 'build');
  const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  assert.match(html, /test\.unit/);
  assert.match(html, /this was dead/);
  assert.ok(!/>ada</.test(html.split('id="acts"')[1].split('id="scores"')[0]), 'acts list shows counts, not names');
  const json = JSON.parse(fs.readFileSync(path.join(root, 'dist/unit.json'), 'utf8'));
  assert.equal(json.unit.name, 'test.unit');
});

// ---------- recursion ----------

test('fork: culture travels, people stay, history is kept without names', () => {
  const child = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-'));
  fs.cpSync(root, child, { recursive: true });
  assert.notEqual(run(child, 'fork', 'child.unit').code, 0, 'fork needs --yes');
  ok(child, 'fork', 'child.unit', '--yes', '--place', 'There');
  const u = loadUnit(child);
  assert.equal(u.unit.name, 'child.unit');
  assert.equal(u.unit.forked_from, 'test.unit');
  assert.deepEqual(u.unit.lineage, ['test.unit']);
  assert.equal(u.unit.founded, '');
  assert.equal(u.members.length, 0);
  assert.equal(u.act.length, 0);
  assert.equal(u.signals.length, 0);
  assert.ok(u.horizon.length >= 2 && u.requirement.length === 2);
  assert.equal(u.lock, null, 'a fork starts in founding mode');
  const inherited = parseCSV(fs.readFileSync(path.join(child, 'lineage/test.unit/signals.csv'), 'utf8'));
  assert.ok(inherited.length > 0 && inherited.every((r) => r.who === ''), 'inherited signals are anonymous');
  assert.equal(u.inherited[0].name, 'test.unit');
  assert.equal(errors(child).length, 0);
  // the fork can rewrite its protocol freely, then found itself
  fs.writeFileSync(path.join(child, 'protocol/MEETING.md'), 'Our own way.\n');
  ok(child, 'member', 'add', 'zed', '--met-by', 'founding');
  ok(child, 'found');
  assert.equal(errors(child).length, 0);
  ok(child, 'build');
});

test('adopt brings a horizon across units with provenance', () => {
  const other = freshUnit('other.unit');
  const src = path.join(root, loadUnit(root).horizon.find((h) => h.id === 'h-002').file);
  ok(other, 'adopt', src);
  const h = loadUnit(other).horizon[0];
  assert.equal(h.id, 'h-001');
  assert.equal(h.adopted_from, 'test.unit');
  assert.equal(h.original, 'h-002');
});

test('the shipped units pass their own checks', () => {
  const repo = path.join(here, '..');
  assert.equal(errors(repo).length, 0, 'starter');
  const demo = path.join(repo, 'examples/demo-unit');
  if (fs.existsSync(demo)) assert.equal(errors(demo).length, 0, 'demo unit');
});

test('founding refuses blank protocol texts before writing a lock', () => {
  const blank = freshUnit();
  ok(blank, 'member', 'add', 'ada', '--met-by', 'founding');
  fs.writeFileSync(path.join(blank, 'protocol/MEETING.md'), '<!-- Write this together. -->\n');
  assert.match(run(blank, 'found').out, /write protocol\/MEETING.md together/);
  assert.equal(loadUnit(blank).unit.founded, '');
  assert.equal(loadUnit(blank).lock, null);
});

test('unsafe fork names are refused before any files move', () => {
  const source = freshUnit('safe.unit');
  assert.notEqual(run(source, 'fork', '../../escape', '--yes').code, 0);
  assert.equal(loadUnit(source).unit.name, 'safe.unit');
  assert.ok(!fs.existsSync(path.join(source, 'lineage')));
  fs.writeFileSync(path.join(source, 'unit.md'), formatDoc({ name: '../escape' }, ''));
  assert.notEqual(run(source, 'fork', 'safe.child', '--yes').code, 0);
  assert.ok(!fs.existsSync(path.join(source, 'lineage')));
});

test('artist statement links retain balanced parentheses', () => {
  const html = markdown('[assemblage](https://en.wikipedia.org/wiki/Assemblage_(philosophy))');
  assert.equal(html, '<p><a href="https://en.wikipedia.org/wiki/Assemblage_(philosophy)">assemblage</a></p>');
});

test('starter publishes the statement and fictional example under a project path', () => {
  const repo = path.join(here, '..');
  ok(path.join(repo, 'examples/demo-unit'), 'build');
  const starter = freshUnit('recursion.kernel');
  fs.writeFileSync(path.join(starter, 'unit.md'), formatDoc({ name: 'recursion.kernel', template: true }, ''));
  fs.writeFileSync(path.join(starter, 'ARTIST-STATEMENT.md'), '# emancipatory generativity\n\nBy dreaming a better future, its error informs the present while the present informs the dream.\n\nSeize the future for all!\n');
  fs.cpSync(path.join(repo, 'examples/demo-unit'), path.join(starter, 'examples/demo-unit'), { recursive: true });
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-site-'));
  ok(starter, 'build', '--out', output);
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  assert.match(html, /<title>recursion kernel<\/title>/);
  assert.match(html, /By dreaming a better future, its error informs the present while the present informs the dream\./);
  assert.match(html, /Seize the future for all!/);
  assert.match(html, /href="example\/index.html"/);
  assert.ok(fs.existsSync(path.join(output, 'example/index.html')));
  assert.ok(fs.existsSync(path.join(output, 'example/unit.json')));
  assert.ok(!html.includes('id="acts"'), 'starter does not present empty activity as a real unit');
  assert.ok(!html.includes('ccru.boulder'));
  const child = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-starter-'));
  fs.cpSync(starter, child, { recursive: true, filter: (source) => !source.split(path.sep).includes('dist') });
  ok(child, 'fork', 'ccru.here', '--yes');
  assert.equal(loadUnit(child).unit.template, false);
  ok(child, 'build');
  assert.match(fs.readFileSync(path.join(child, 'dist/index.html'), 'utf8'), /id="horizons"/);
});

console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`);
