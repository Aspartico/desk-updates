#!/usr/bin/env node
// Scopre cosa e' disponibile ADESSO (motori, effort, modalita') senza nomi scritti nel codice.
// Fonti, tutte gratuite (zero token di Claude):
//   1. `claude --help`: livelli di effort, alias dei modelli, opzioni e comandi (modalita').
//   2. API /v1/models, solo se c'e' ANTHROPIC_API_KEY.
//   3. Pagina pubblica della documentazione sui modelli.
//   4. Modelli visti davvero nei log delle sessioni.
// Uso: node catalogo.mjs [--se-vecchio] [--mostra]
//   --se-vecchio: aggiorna (in background) solo se il catalogo ha piu' di un giorno o c'e' un motore nuovo.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLAUDE_DIR, DATI_DIR, HOST, leggiJson, scriviJson } from './comune.mjs';

const FILE = path.join(DATI_DIR, 'catalogo.json');
const UN_GIORNO = 24 * 3600e3; // costa zero token: solo una lettura della documentazione
const DOCS = 'https://docs.claude.com/en/docs/about-claude/models/overview';
const PREZZI = 'https://docs.claude.com/en/docs/about-claude/pricing';
const ID_MODELLO = /\bclaude-[a-z0-9]+(?:-[a-z0-9]+)*\b/g;

export function analizzaHelp(testo) {
  const righe = testo.split(/\r?\n/);
  const blocco = (flag) => {
    const i = righe.findIndex((r) => r.trimStart().startsWith(flag));
    if (i < 0) return '';
    let out = righe[i];
    for (let j = i + 1; j < righe.length && /^\s{20,}\S/.test(righe[j]); j++) out += ' ' + righe[j].trim();
    return out;
  };
  const effort = blocco('--effort');
  const livelli = (effort.match(/\(([^)]+)\)/)?.[1] || '').split(/[,|]/).map((s) => s.trim()).filter(Boolean);
  const alias = [...blocco('--model').matchAll(/'([a-z0-9.-]+)'/gi)].map((m) => m[1]);
  // Ogni opzione e comando e' una possibile "modalita'": li salviamo tutti con la descrizione,
  // cosi' una modalita' nuova compare da sola anche se non ne conosciamo il nome.
  const opzioni = [];
  for (const r of righe) {
    const m = r.match(/^\s{2}(--?[a-z][\w-]*(?:,\s*--[\w-]+)?|[a-z][\w-]*)(?:\s+[<[][^\s]+[>\]])*\s{2,}(\S.*)$/i);
    if (m) opzioni.push({ nome: m[1], descrizione: m[2].trim() });
  }
  return { livelli_effort: livelli, alias_modelli: alias, opzioni };
}

// Il comando `claude` non sempre e' nel PATH (l'app desktop non ce lo mette): lo cerco anche
// nei posti dove lo installano l'installer nativo, npm e l'app desktop.
function candidatiClaude() {
  const casa = os.homedir();
  const out = [process.env.CLAUDE_BIN, 'claude'];
  if (process.platform === 'win32') {
    const app = process.env.APPDATA || path.join(casa, 'AppData', 'Roaming');
    out.push(path.join(casa, '.local', 'bin', 'claude.exe'), path.join(app, 'npm', 'claude.cmd'));
    // App desktop: ...\claude-code\<versione>\[<hash>\]claude.exe, sotto %APPDATA%\Claude oppure
    // %LOCALAPPDATA%\Claude-Data\<profilo>. La cartella cambia a ogni versione: le cerco tutte
    // e provo prima la versione piu' alta.
    const locale = process.env.LOCALAPPDATA || path.join(casa, 'AppData', 'Local');
    const radici = [path.join(app, 'Claude', 'claude-code')];
    try { for (const p of fs.readdirSync(path.join(locale, 'Claude-Data'))) radici.push(path.join(locale, 'Claude-Data', p, 'claude-code')); } catch {}
    const trovati = [];
    const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
    for (const r of radici) for (const v of ls(r)) {
      const dv = path.join(r, v);
      for (const f of [path.join(dv, 'claude.exe'), ...ls(dv).map((h) => path.join(dv, h, 'claude.exe'))]) {
        if (fs.existsSync(f)) trovati.push({ v: v.split('.').map(Number), f });
      }
    }
    const cmp = (a, b) => { for (let i = 0; i < 4; i++) if ((a.v[i] || 0) !== (b.v[i] || 0)) return (b.v[i] || 0) - (a.v[i] || 0); return 0; };
    out.push(...trovati.sort(cmp).map((t) => t.f));
  } else {
    out.push(path.join(casa, '.local', 'bin', 'claude'), path.join(casa, '.claude', 'local', 'claude'));
  }
  return out.filter(Boolean);
}

function eseguiHelp() {
  for (const bin of candidatiClaude()) {
    try {
      const opz = { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true };
      // I .cmd e il nome nudo su Windows passano da cmd /c (niente shell:true, deprecato in Node 24).
      const testo = process.platform === 'win32' && !bin.endsWith('.exe')
        ? execFileSync('cmd', ['/d', '/c', bin, '--help'], opz)
        : execFileSync(bin, ['--help'], opz);
      if (testo.includes('--model')) return testo;
    } catch {}
  }
  return '';
}

async function modelliDaApi() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return [];
  try {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    });
    const j = await r.json();
    return (j.data || []).map((m) => ({ id: m.id, nome: m.display_name, creato: m.created_at }));
  } catch { return []; }
}

async function modelliDaDocs() {
  try {
    const r = await fetch(DOCS, { signal: AbortSignal.timeout(15000) });
    const html = await r.text();
    // Teniamo solo id nella forma famiglia-versione (es. claude-xxx-5-2): scarta link e titoli.
    return [...new Set(html.match(ID_MODELLO) || [])].filter((id) => /^claude-[a-z]+(?:-\d+)+$/.test(id));
  } catch { return []; }
}

// Legge la tabella prezzi pubblica: per ogni "Claude <Famiglia> <versione>" i primi due prezzi
// trovati sono input e output ($ per milione di token). Nessun nome di famiglia scritto qui.
export function analizzaPrezzi(html) {
  const t = html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const parti = t.split(/Claude ([A-Z][a-z]+) (\d+(?:\.\d+)*)\b/);
  const out = {};
  for (let i = 1; i < parti.length; i += 3) {
    const p = [...parti[i + 2].slice(0, 400).matchAll(/\$([\d.]+) \/ MTok/g)].map((m) => +m[1]);
    if (p.length < 2) continue;
    const id = `claude-${parti[i].toLowerCase()}-${parti[i + 1].replace(/\./g, '-')}`;
    out[id] ??= { input: p[0], output: p[1] };
  }
  return out;
}

async function prezziDaDocs() {
  try {
    const r = await fetch(PREZZI, { signal: AbortSignal.timeout(15000) });
    return analizzaPrezzi(await r.text());
  } catch { return {}; }
}

// Fasce: per ogni famiglia la versione piu' recente che compare anche tra i modelli attuali,
// ordinate dal prezzo piu' basso al piu' alto. Il prezzo fa da misura della capacita'.
export function calcolaFasce(prezzi, idAttuali) {
  const ver = (id) => id.split('-').slice(2).map(Number);
  const piuNuovo = (a, b) => {
    const x = ver(a), y = ver(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  };
  const perFamiglia = {};
  for (const id of Object.keys(prezzi)) {
    if (!idAttuali.includes(id)) continue;
    const fam = id.split('-')[1];
    if (!perFamiglia[fam] || piuNuovo(id, perFamiglia[fam])) perFamiglia[fam] = id;
  }
  return Object.entries(perFamiglia)
    .map(([famiglia, id]) => ({ famiglia, id, ...prezzi[id] }))
    .sort((a, b) => a.output - b.output || a.input - b.input);
}

function modelliDaLog() {
  const visti = new Set();
  const radice = path.join(CLAUDE_DIR, 'projects');
  const giro = (dir) => {
    let voci = [];
    try { voci = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const v of voci) {
      const p = path.join(dir, v.name);
      if (v.isDirectory()) giro(p);
      else if (v.name.endsWith('.jsonl')) {
        const testo = fs.readFileSync(p, 'utf8');
        for (const m of testo.matchAll(/"model":"([^"]+)"/g)) if (m[1].startsWith('claude')) visti.add(m[1]);
      }
    }
  };
  giro(radice);
  return [...visti];
}

export async function aggiorna() {
  const help = analizzaHelp(eseguiHelp());
  const prima = leggiJson(FILE, {});
  const [api, docs, prezzi] = await Promise.all([modelliDaApi(), modelliDaDocs(), prezziDaDocs()]);
  const log = modelliDaLog();
  const ids = new Set([...api.map((m) => m.id), ...docs, ...log]);
  const catalogo = {
    aggiornato: new Date().toISOString(),
    // Se `claude --help` non e' raggiungibile tengo quanto trovato la volta prima.
    livelli_effort: help.livelli_effort.length ? help.livelli_effort : prima.livelli_effort || [],
    alias_modelli: help.alias_modelli.length ? help.alias_modelli : prima.alias_modelli || [],
    modelli: [...ids].sort().map((id) => ({
      id,
      fonti: [api.some((m) => m.id === id) && 'api', docs.includes(id) && 'docs', log.includes(id) && 'usato'].filter(Boolean),
    })),
    prezzi,
    fasce: calcolaFasce(prezzi, [...ids]),
    modalita: help.opzioni.length ? help.opzioni : prima.modalita || [],
  };
  scriviJson(FILE, catalogo);
  return catalogo;
}

const principale = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (principale) {
  const args = process.argv.slice(2);
  const vecchio = leggiJson(FILE, null);
  if (args.includes('--se-vecchio')) {
    // Aggiorno se il catalogo ha piu' di un giorno, oppure se nei consumi compare un motore che
    // il catalogo non conosce ancora (vuol dire che ne e' uscito uno nuovo).
    const noti = new Set((vecchio?.modelli || []).map((m) => m.id));
    const reg = leggiJson(path.join(DATI_DIR, `registro-${HOST}.json`), { sessioni: {} });
    const nuovo = Object.values(reg.sessioni).some((s) => Object.keys(s.modelli || {}).some((id) => !noti.has(id)));
    const fresco = vecchio && Date.now() - Date.parse(vecchio.aggiornato) < UN_GIORNO;
    if (fresco && !nuovo) process.exit(0);
    // Aggiorno in background: l'avvio di Claude Code non aspetta.
    spawn(process.execPath, [process.argv[1]], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    process.exit(0);
  }
  const c = await aggiorna();
  if (args.includes('--mostra')) {
    console.log(`Effort: ${c.livelli_effort.join(', ') || '?'}`);
    console.log(`Alias modelli: ${c.alias_modelli.join(', ') || '?'}`);
    console.log(`Modelli (${c.modelli.length}):`);
    for (const m of c.modelli) console.log(`  ${m.id}  [${m.fonti.join(', ')}]`);
    console.log('Fasce (dalla piu economica):');
    for (const f of c.fasce) console.log(`  ${f.id}  $${f.input}/$${f.output} per M token`);
    console.log(`Opzioni/modalita' trovate: ${c.modalita.length}  -> ${FILE}`);
  }
}
