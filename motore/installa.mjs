#!/usr/bin/env node
// Installa su questo PC: copia gli script e aggiunge tre hook a ~/.claude/settings.json.
//   - SessionStart: aggiorna il catalogo dei motori se ha piu' di 7 giorni (non stampa nulla, zero token).
//   - SessionEnd:   salva i consumi della sessione appena chiusa.
//   - UserPromptSubmit: consiglia motore ed effort (lo vedi solo tu, zero token).
// Uso: node installa.mjs          (si puo' rilanciare: non duplica nulla)
//      node installa.mjs --rimuovi
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_DIR, CONFIG, cercaMega, leggiJson, scriviJson } from './comune.mjs';

const qui = path.dirname(fileURLToPath(import.meta.url));
const dest = path.join(CLAUDE_DIR, 'motore', 'bin');
const settings = path.join(CLAUDE_DIR, 'settings.json');
const MARCA = 'motore/bin/';

const conf = fs.existsSync(settings) ? JSON.parse(fs.readFileSync(settings, 'utf8')) : {};
if (fs.existsSync(settings)) fs.copyFileSync(settings, settings + '.bak-motore');

conf.hooks ??= {};
for (const evento of ['SessionStart', 'SessionEnd', 'UserPromptSubmit']) {
  conf.hooks[evento] = (conf.hooks[evento] || []).filter((g) => !JSON.stringify(g).includes(MARCA));
  if (!conf.hooks[evento].length) delete conf.hooks[evento];
}

if (process.argv.includes('--rimuovi')) {
  fs.writeFileSync(settings, JSON.stringify(conf, null, 2));
  console.log('Hook rimossi. I dati restano dove erano.');
  process.exit(0);
}

fs.mkdirSync(dest, { recursive: true });
for (const f of ['comune.mjs', 'catalogo.mjs', 'registro.mjs', 'consiglia.mjs']) fs.copyFileSync(path.join(qui, f), path.join(dest, f));

const cmd = (file, extra = '') => `node "${path.join(dest, file).split(path.sep).join('/')}"${extra}`;
const hook = (command) => ({ hooks: [{ type: 'command', command, timeout: 60 }] });
(conf.hooks.SessionStart ??= []).push(hook(cmd('catalogo.mjs', ' --se-vecchio')));
(conf.hooks.SessionEnd ??= []).push(hook(cmd('registro.mjs')));
(conf.hooks.UserPromptSubmit ??= []).push(hook(cmd('consiglia.mjs')));
fs.writeFileSync(settings, JSON.stringify(conf, null, 2));

// Cartella dati: --dati <cartella>, altrimenti MEGA se c'e', altrimenti locale.
const i = process.argv.indexOf('--dati');
const scelta = i > 0 ? process.argv[i + 1] : leggiJson(CONFIG, {}).dati || (cercaMega() && path.join(cercaMega(), 'claude-motore'));
if (scelta) { fs.mkdirSync(scelta, { recursive: true }); scriviJson(CONFIG, { dati: scelta }); }

console.log('Installato in', dest);
console.log('Dati in', process.env.MOTORE_DIR || scelta || path.join(CLAUDE_DIR, 'motore'),
  scelta ? '(cartella sincronizzata: i PC vedono i dati uno dell\'altro)' : '(nessuna cartella MEGA trovata: per sceglierne una usa --dati "D:\\MEGA\\AI\\claude-motore")');
