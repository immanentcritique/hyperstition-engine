// Builds examples/demo-unit from nothing, using only kernel commands,
// so you can see what a unit looks like after a month of meetings.
// Everything in it is made up. Run: node examples/build-demo.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const kernel = path.join(here, '..', 'kernel.mjs');
const root = path.join(here, 'demo-unit');

const k = (...args) => execFileSync('node', [kernel, ...args, '--root', root], { encoding: 'utf8' }).trim();
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const body = (rel, text) => {
  const file = fs.readdirSync(path.join(root, path.dirname(rel))).find((f) => f.startsWith(path.basename(rel)));
  const full = path.join(root, path.dirname(rel), file);
  fs.writeFileSync(full, fs.readFileSync(full, 'utf8').replace(/<!--[\s\S]*?-->/, text));
};

fs.rmSync(root, { recursive: true, force: true });
put('unit.md', `---
name: unit.example
place: "Anytown"
color: "#0a7d5a"
founded:
lineage: [recursion.kernel]
forked_from: recursion.kernel
quorum: 0.5
threshold: 0.66
---

This is a demonstration unit. Every person, act and signal in it is made up, so you can see what a unit's page looks like after a month of meetings.
`);
put('members.csv', 'handle,joined,met_by,status\n');
put('ledger/signals.csv', 'act,who,requirement,felt,before,after,note\n');
put('protocol/MEETING.md', `Demo text, standing in for a meeting format a real unit writes itself.

We meet weekly. Someone brings a score; we do it together. Afterwards everyone signals how it felt and whether it moved anything.
`);
put('protocol/TRADITIONS.md', `Demo text, standing in for traditions a real unit writes itself.

1. Every member was met in person by someone already here.
2. Any unit can fork; the fork owes us nothing.
`);

// people: three founders, then two vouched in afterwards
for (const h of ['ada', 'ben', 'cy']) k('member', 'add', h, '--met-by', 'founding', '--date', '2026-09-12');
k('found', '--date', '2026-09-12');
k('member', 'add', 'dee', '--met-by', 'ada', '--date', '2026-09-26');
k('member', 'add', 'eli', '--met-by', 'cy', '--date', '2026-10-03');

// culture adopted from the parent unit (they get local ids: s-001, s-002, s-003)
const parentScores = path.join(here, '..', 'scores');
for (const f of ['s-001', 's-002', 's-012']) {
  k('adopt', path.join(parentScores, fs.readdirSync(parentScores).find((x) => x.startsWith(f))), '--from', 'recursion.kernel');
}

// futures
k('horizon', 'A town where nobody eats alone', '--by', 'ada,ben', '--date', '2026-09-12');
body('horizons/h-001', 'Every evening there is a table somewhere with a free seat and food on it, and everyone knows where to find it.\nNobody has to ask.');
k('horizon', 'Our block grows a third of its own food', '--by', 'cy', '--date', '2026-09-12');
body('horizons/h-002', 'Front lawns are gardens. What we can’t eat moves through a shelf on the corner that anyone can stock or take from.');
k('horizon', 'A night market every full moon', '--by', 'eli', '--date', '2026-10-03');
k('compost', 'h-003');

k('require', 'A weekly shared meal anyone can find', '--horizon', 'h-001', '--date', '2026-09-12');
k('require', 'Ten households that cook for more than themselves', '--horizon', 'h-001', '--date', '2026-09-12');
k('require', 'A map of every unused yard on the block', '--horizon', 'h-002', '--date', '2026-09-12');
k('require', 'Three neighbours who can start seeds', '--horizon', 'h-002', '--date', '2026-09-19');
k('require', 'A corner shelf people restock', '--horizon', 'h-002', '--date', '2026-09-19');

// a month of acts, each followed by signals from whoever was there
// each signal: [who ('' = anonymous), felt -2..2, [requirement:before:after, ...], note]
const acts = [
  ['Cooked for twelve in ada’s yard', '2026-09-19', 's-002', 'r-001,r-002', 'ada,ben,cy', [
    ['ada', 2, ['r-001:0.15:0.35']], ['ben', 1, ['r-001:0.2:0.3']], ['', 1, ['r-001:0.1:0.25', 'r-002:0.05:0.1']],
  ]],
  ['Walked the block and drew the yards', '2026-09-24', 's-001', 'r-003', 'cy,ben', [
    ['cy', 2, ['r-003:0.3:0.7']], ['ben', 1, ['r-003:0.3:0.6']],
  ]],
  ['Two-hour planning meeting', '2026-09-30', '', 'r-001,r-004', 'ada,ben,cy,dee', [
    ['ada', -1, ['r-001:0.35:0.35']], ['', -2, ['r-004:0.2:0.15'], 'We talked for two hours and did nothing.'], ['dee', 0, ['r-001:0.3:0.3']],
  ]],
  ['Seed-starting with dee’s grandmother', '2026-10-04', 's-003', 'r-004', 'dee,cy,eli', [
    ['dee', 2, ['r-004:0.15:0.5']], ['cy', 2, ['r-004:0.2:0.45']], ['eli', 1, ['r-004:0.1:0.4']],
  ]],
  ['Second shared meal, at ben’s', '2026-10-10', 's-002', 'r-001,r-002', 'ada,ben,dee,eli', [
    ['ada', 1, ['r-001:0.35:0.5', 'r-002:0.1:0.2']], ['ben', 2, ['r-001:0.3:0.55']], ['eli', 1, ['r-001:0.2:0.4', 'r-002:0.1:0.15']],
  ]],
  ['Built the corner shelf', '2026-10-17', 's-001', 'r-005', 'cy,eli,ben', [
    ['cy', 1, ['r-005:0.2:0.45']], ['', 1, ['r-005:0.25:0.4']],
  ]],
];
acts.forEach(([title, date, score, reqs, people, signals], i) => {
  k('act', title, '--date', date, ...(score ? ['--score', score] : []), '--req', reqs, '--with', people);
  const id = `a-${String(i + 1).padStart(3, '0')}`;
  for (const [who, felt, forecasts, note] of signals) {
    k('signal', id, ...(who ? ['--who', who] : []), '--felt', String(felt), ...forecasts.flatMap((s) => ['--req', s]), ...(note ? ['--note', note] : []));
  }
});
body('acts/a-003', 'We sat in a circle and argued about a logo. Nobody cooked. Dee suggested we never plan without doing something with our hands in the same meeting.');

// the protocol changing itself
k('propose', 'Raise the bar for changing the rules', '--governance', '--threshold', '0.75');
for (const [who, v] of [['ada', 'yes'], ['ben', 'yes'], ['cy', 'yes'], ['dee', 'yes'], ['eli', 'no']]) k('vote', 'p-001', who, v);
k('ratify', 'p-001');

const draft = path.join(root, '.draft-traditions.md');
fs.writeFileSync(draft, fs.readFileSync(path.join(root, 'protocol/TRADITIONS.md'), 'utf8') + '3. No planning meeting without something made by hand in the same meeting.\n');
k('propose', 'Plan only while making', '--target', 'protocol/TRADITIONS.md', '--text', draft);
fs.rmSync(draft);
k('vote', 'p-002', 'dee', 'yes');
k('vote', 'p-002', 'cy', 'yes');

console.log(k('check'));
console.log(k('build'));
