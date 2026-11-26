#!/usr/bin/env node
// Registra i consumi REALI di ogni sessione di Claude Code, per modello e per PC.
// Legge i log che Claude Code scrive gia' (~/.claude/projects/**/*.jsonl): zero token.
// I log vengono cancellati da Claude Code dopo un po', quindi teniamo uno storico nostro.
// Uso:
//   node registro.mjs            aggiorna lo storico (lo fa l'hook a fine sessione)
//   node registro.mjs --report   riepilogo per PC e per modello
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR, DATI_DIR, HOST, dispositivo, leggiJson, scriviJson } from './comune.mjs';

const STORICO = path.join(DATI_DIR, `registro-${HOST}.json`);
const CSV = path.join(DATI_DIR, `registro-${HOST}.csv`);

// Peso relativo dei token sul consumo, uguale al rapporto dei prezzi API pubblici
// (input = 1). Con l'abbonamento i limiti d'uso seguono la stessa logica:
// l'output e la scrittura in cache pesano di piu', la lettura da cache quasi nulla.
// E' una stima: la fase 2 la sostituira' con i dati reali.
const PESI = { input: 1, cache_scrittura: 1.25, cache_lettura: 0.1, output: 5 };

export function analizzaSessione(testo) {
  const visti = new Set();
  const perModello = {};
  let inizio = null, fine = null, cwd = '', versione = '', sessione = '', utente = 0;
  for (const riga of testo.split('\n')) {
    if (!riga.trim()) continue;
    let d; try { d = JSON.parse(riga); } catch { continue; }
    if (d.timestamp) { inizio ??= d.timestamp; fine = d.timestamp; }
    if (d.sessionId) sessione ||= d.sessionId;
    if (d.cwd) cwd ||= d.cwd;
    if (d.version) versione = d.version;
    if (d.type === 'user' && !d.isSidechain && typeof d.message?.content === 'string') utente++;
    const m = d.message;
    if (!m?.usage || !m.model || m.model.startsWith('<')) continue;
    const chiave = m.id || d.requestId || d.uuid; // la stessa risposta puo' comparire su piu' righe
    if (visti.has(chiave)) continue;
    visti.add(chiave);
    const u = m.usage;
    const t = (perModello[m.model] ??= { chiamate: 0, input: 0, cache_scrittura: 0, cache_lettura: 0, output: 0, ragionamento: 0, subagent: 0 });
    t.chiamate++;
    if (d.isSidechain) t.subagent++;
    t.input += u.input_tokens || 0;
    t.cache_scrittura += u.cache_creation_input_tokens || 0;
    t.cache_lettura += u.cache_read_input_tokens || 0;
    t.output += u.output_tokens || 0;
    t.ragionamento += u.output_tokens_details?.thinking_tokens || 0;
  }
  for (const t of Object.values(perModello)) t.peso = Math.round(Object.entries(PESI).reduce((s, [k, p]) => s + t[k] * p, 0));
  return { sessione, inizio, fine, cwd, versione, messaggi_utente: utente, modelli: perModello };
}

function fileLog() {
  const out = [];
  const giro = (dir) => {
    let voci = [];
    try { voci = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const v of voci) {
      const p = path.join(dir, v.name);
      if (v.isDirectory()) giro(p);
      else if (v.name.endsWith('.jsonl')) out.push(p);
    }
  };
  giro(path.join(CLAUDE_DIR, 'projects'));
  return out;
}

export function aggiorna() {
  const storico = leggiJson(STORICO, { dispositivo: null, file: {}, sessioni: {} });
  storico.dispositivo = dispositivo();
  for (const f of fileLog()) {
    const st = fs.statSync(f);
    const firma = `${st.size}:${st.mtimeMs}`;
    if (storico.file[f] === firma) continue; // gia' letto e non cambiato
    const s = analizzaSessione(fs.readFileSync(f, 'utf8'));
    if (!Object.keys(s.modelli).length) { storico.file[f] = firma; continue; }
    // I log dei subagent sono file separati con lo stesso id di sessione: li sommiamo.
    const id = `${s.sessione || path.basename(f, '.jsonl')}|${f}`;
    storico.sessioni[id] = s;
    storico.file[f] = firma;
  }
  scriviJson(STORICO, storico);
  scriviCsv(storico);
  return storico;
}

function scriviCsv(storico) {
  const col = ['dispositivo', 'sessione', 'inizio', 'fine', 'cartella', 'versione', 'messaggi_utente', 'modello', 'chiamate', 'subagent', 'input', 'cache_scrittura', 'cache_lettura', 'output', 'ragionamento', 'peso'];
  const esc = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const righe = [col.join(',')];
  for (const s of Object.values(storico.sessioni)) {
    for (const [modello, t] of Object.entries(s.modelli)) {
      righe.push([HOST, s.sessione, s.inizio, s.fine, s.cwd, s.versione, s.messaggi_utente, modello, t.chiamate, t.subagent, t.input, t.cache_scrittura, t.cache_lettura, t.output, t.ragionamento, t.peso].map(esc).join(','));
    }
  }
  fs.writeFileSync(CSV, righe.join('\n') + '\n');
}

function report() {
  // Unisce tutti i PC che scrivono nella stessa cartella (es. MEGA).
  const tot = {};
  let file = [];
  try { file = fs.readdirSync(DATI_DIR).filter((n) => /^registro-.+\.json$/.test(n)); } catch {}
  for (const n of file) {
    const st = leggiJson(path.join(DATI_DIR, n), null);
    if (!st) continue;
    const pc = st.dispositivo?.nome || n;
    for (const s of Object.values(st.sessioni)) for (const [mod, t] of Object.entries(s.modelli)) {
      const k = `${pc}  ${mod}`;
      const a = (tot[k] ??= { sessioni: new Set(), chiamate: 0, output: 0, cache_lettura: 0, peso: 0 });
      a.sessioni.add(s.sessione); a.chiamate += t.chiamate; a.output += t.output; a.cache_lettura += t.cache_lettura; a.peso += t.peso;
    }
  }
  const righe = Object.entries(tot).sort((a, b) => b[1].peso - a[1].peso);
  if (!righe.length) return console.log('Ancora nessun dato. Lavora una sessione e riprova.');
  const fmt = (n) => n.toLocaleString('it-IT');
  console.log('PC  modello | sessioni | chiamate | output | peso stimato');
  for (const [k, a] of righe) console.log(`${k} | ${a.sessioni.size} | ${fmt(a.chiamate)} | ${fmt(a.output)} | ${fmt(a.peso)}`);
}

const principale = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (principale) {
  // L'hook passa dati su stdin: non servono, ma va letto per non bloccare.
  if (!process.stdin.isTTY) { try { fs.readFileSync(0); } catch {} }
  if (process.argv.includes('--report')) { aggiorna(); report(); }
  else aggiorna();
}
