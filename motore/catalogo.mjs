#!/usr/bin/env node
// Scopre cosa e' disponibile ADESSO (motori, effort, modalita') senza nomi scritti nel codice.
// Fonti, tutte gratuite (zero token di Claude):
//   1. `claude --help`: livelli di effort, alias dei modelli, opzioni e comandi (modalita').
//   2. API /v1/models, solo se c'e' ANTHROPIC_API_KEY.
//   3. Pagina pubblica della documentazione sui modelli.
//   4. Modelli visti davvero nei log delle sessioni.
// Uso: node catalogo.mjs [--se-vecchio] [--mostra]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR, DATI_DIR, leggiJson, scriviJson } from './comune.mjs';

const FILE = path.join(DATI_DIR, 'catalogo.json');
const SETTE_GIORNI = 7 * 24 * 3600e3;
const DOCS = 'https://docs.claude.com/en/docs/about-claude/models/overview';
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

function eseguiHelp() {
  try {
    return execFileSync('claude', ['--help'], { encoding: 'utf8', timeout: 20000, shell: process.platform === 'win32' });
  } catch { return ''; }
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
  const [api, docs] = await Promise.all([modelliDaApi(), modelliDaDocs()]);
  const log = modelliDaLog();
  const ids = new Set([...api.map((m) => m.id), ...docs, ...log]);
  const catalogo = {
    aggiornato: new Date().toISOString(),
    livelli_effort: help.livelli_effort,
    alias_modelli: help.alias_modelli,
    modelli: [...ids].sort().map((id) => ({
      id,
      fonti: [api.some((m) => m.id === id) && 'api', docs.includes(id) && 'docs', log.includes(id) && 'usato'].filter(Boolean),
    })),
    modalita: help.opzioni,
  };
  scriviJson(FILE, catalogo);
  return catalogo;
}

const principale = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (principale) {
  const args = process.argv.slice(2);
  const vecchio = leggiJson(FILE, null);
  if (args.includes('--se-vecchio') && vecchio && Date.now() - Date.parse(vecchio.aggiornato) < SETTE_GIORNI) process.exit(0);
  const c = await aggiorna();
  if (args.includes('--mostra')) {
    console.log(`Effort: ${c.livelli_effort.join(', ') || '?'}`);
    console.log(`Alias modelli: ${c.alias_modelli.join(', ') || '?'}`);
    console.log(`Modelli (${c.modelli.length}):`);
    for (const m of c.modelli) console.log(`  ${m.id}  [${m.fonti.join(', ')}]`);
    console.log(`Opzioni/modalita' trovate: ${c.modalita.length}  -> ${FILE}`);
  }
}
