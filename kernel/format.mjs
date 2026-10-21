// format.mjs — the kernel's file formats. Zero dependencies.
//
// Documents are Markdown with a small frontmatter block:
//
//   ---
//   id: h-001
//   title: "A world where…"
//   horizons: [h-001, h-002]
//   ---
//   prose body
//
// Ledgers are plain CSV so they can be edited in any spreadsheet.

import { createHash } from 'node:crypto';

export class KernelError extends Error {}

// ---------- frontmatter ----------

export function parseDoc(text, where = 'document') {
  text = String(text).replace(/\r\n?/g, '\n');
  if (!text.startsWith('---\n')) return { meta: {}, body: text.trim() };
  const close = /\n---[ \t]*(\n|$)/g;
  close.lastIndex = 3;
  const m = close.exec(text);
  if (!m) throw new KernelError(`${where}: frontmatter opened with --- but never closed`);
  const head = text.slice(4, m.index);
  const body = text.slice(m.index + m[0].length);
  return { meta: parseMeta(head, where), body: body.trim() };
}

function parseMeta(head, where) {
  const meta = {};
  let listKey = null;
  const lines = head.split('\n');
  lines.forEach((raw, i) => {
    if (!raw.trim() || raw.trim().startsWith('#')) return;
    const item = raw.match(/^\s*-\s+(.*)$/) || raw.match(/^\s*-$/);
    if (item && listKey) {
      meta[listKey].push(parseScalar(item[1] ?? ''));
      return;
    }
    const kv = raw.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) throw new KernelError(`${where}: can't read frontmatter line ${i + 2}: "${raw}"`);
    const [, key, value] = kv;
    if (value.trim() === '') {
      meta[key] = [];
      listKey = key;
    } else {
      listKey = null;
      meta[key] = parseValue(value.trim());
    }
  });
  // a key with nothing under it is an empty string, not an empty list
  for (const [k, v] of Object.entries(meta)) if (Array.isArray(v) && v.length === 0) meta[k] = '';
  return meta;
}

function parseValue(v) {
  if (v.startsWith('[') && v.endsWith(']')) {
    return splitInline(v.slice(1, -1)).map(parseScalar).filter((x) => x !== '');
  }
  return parseScalar(v);
}

function splitInline(s) {
  const out = [];
  let cur = '', quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === '\\' && quote === '"') { cur += s[++i] ?? ''; continue; }
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") { quote = c; cur += c; }
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function parseScalar(s) {
  s = String(s).trim();
  if (s === '') return '';
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  return s;
}

export function formatDoc(meta, body = '') {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) lines.push(`${k}: [${v.map(fmtScalar).join(', ')}]`);
    else lines.push(`${k}: ${fmtScalar(v)}`.trimEnd());
  }
  lines.push('---', '');
  if (body && body.trim()) lines.push(body.trim(), '');
  return lines.join('\n');
}

function fmtScalar(v) {
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  v = String(v);
  if (v === '') return '';
  const plain = /^[A-Za-z0-9_./@+-][A-Za-z0-9_./@+: -]*$/.test(v) && v.trim() === v && !v.includes(': ') && !v.endsWith(':');
  const looksTyped = /^(true|false|null|~|-?\d+(\.\d+)?)$/.test(v);
  return plain && !looksTyped && !v.startsWith('- ') ? v : JSON.stringify(v);
}

export const asList = (v) => (Array.isArray(v) ? v : v === '' || v == null ? [] : [v]).map(String);

// ---------- CSV ----------

export function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', quoted = false, line = 1, rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else { if (c === '\n') line++; field += c; }
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push({ cells: row, line: rowLine });
      row = []; field = ''; line++; rowLine = line;
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push({ cells: row, line: rowLine }); }
  const real = rows.filter((r) => r.cells.some((f) => f.trim() !== ''));
  if (!real.length) return [];
  const keys = real[0].cells.map((h) => h.trim());
  return real.slice(1).map((r) => {
    const o = { _line: r.line };
    keys.forEach((k, j) => (o[k] = (r.cells[j] ?? '').trim()));
    return o;
  });
}

const csvCell = (v) => {
  v = v == null ? '' : String(v);
  return /[",\n\r]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v;
};

export function formatCSV(header, rows) {
  return [header.join(','), ...rows.map((r) => header.map((k) => csvCell(r[k])).join(','))].join('\n') + '\n';
}

// ---------- small helpers ----------

export const hashText = (s) =>
  createHash('sha256').update(String(s).replace(/\r\n?/g, '\n')).digest('hex');

export const slug = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'untitled';

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(String(s)));

export const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
