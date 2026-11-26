#!/usr/bin/env node
// Hook UserPromptSubmit: consiglia motore ed effort, senza consumare token di Claude.
// - Primo messaggio della conversazione: consiglio sempre.
// - Messaggi successivi: avvisa solo se il motore in uso e' chiaramente sbagliato.
// Il consiglio esce come "systemMessage": lo vedi tu, ma NON entra nel contesto di Claude.
// La classificazione la fa l'IA locale (Ollama) se c'e', altrimenti regole semplici.
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR, DATI_DIR, leggiJson, scriviJson } from './comune.mjs';

const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const CONTESTO_PICCOLO = 30000; // sotto questa soglia cambiare motore costa poco (la cache si rifa' in fretta)
const CONTESTO_GRANDE = 150000;

// ---------- classificazione ----------
const ALTA = /\b(architettur|progett|strategi|piano|pianific|debug|perch[eé]|analizz|ottimizz|refactor|migra|sicurezz|algoritm|ragiona|valuta|confronta|decid|design|why|plan|architect|investigat)/i;
const BASSA = /\b(rinomina|traduci|formatta|elenca|correggi (?:il )?(?:testo|refuso)|sposta|copia|riassumi|trascriv|converti|cerca|trova|leggi|mostra|rename|translate|format|list|summari[sz]e|convert|find|show)/i;
const LOCALE = /\b(traduci|riassumi|trascriv|converti|riformula|translate|summari[sz]e|transcribe)/i;

export function classificaRegole(testo) {
  const t = testo.trim();
  let punteggio = 0.55; // media
  if (BASSA.test(t) && !ALTA.test(t)) punteggio = t.length < 200 ? 0.1 : 0.2;
  if (ALTA.test(t)) punteggio = 0.85;
  if (t.length > 1500) punteggio = Math.max(punteggio, 0.85); // richieste lunghe = molti vincoli
  return { punteggio, locale: LOCALE.test(t) && !ALTA.test(t), fonte: 'regole' };
}

async function modelloOllama() {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(1500) });
    const { models = [] } = await r.json();
    return models.filter((m) => !/embed/i.test(m.name)).sort((a, b) => a.size - b.size)[0]?.name;
  } catch { return undefined; }
}

async function classificaOllama(testo, modello) {
  const domanda = `Classifica questa richiesta per un assistente di programmazione. Rispondi solo con JSON {"complessita":"bassa|media|alta","locale":true|false}. "locale" e' true se basta un piccolo modello locale (tradurre, riassumere, riformulare).\nRichiesta: """${testo.slice(0, 2000)}"""`;
  try {
    const r = await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST',
      body: JSON.stringify({ model: modello, prompt: domanda, stream: false, format: 'json', options: { temperature: 0 } }),
      signal: AbortSignal.timeout(12000),
    });
    const j = JSON.parse((await r.json()).response);
    const punteggio = { bassa: 0.2, media: 0.55, alta: 0.85 }[j.complessita];
    if (punteggio === undefined) return undefined;
    return { punteggio, locale: !!j.locale, fonte: `IA locale (${modello})` };
  } catch { return undefined; }
}

// ---------- lettura conversazione ----------
export function statoConversazione(transcript) {
  let messaggiUtente = 0, modello = '', contesto = 0;
  let testo = '';
  try { testo = fs.readFileSync(transcript, 'utf8'); } catch { return { messaggiUtente, modello, contesto }; }
  for (const riga of testo.split('\n')) {
    if (!riga) continue;
    let d; try { d = JSON.parse(riga); } catch { continue; }
    if (d.isSidechain) continue;
    if (d.type === 'user' && typeof d.message?.content === 'string') messaggiUtente++;
    const u = d.message?.usage;
    if (u && d.message.model && !d.message.model.startsWith('<')) {
      modello = d.message.model;
      contesto = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    }
  }
  return { messaggiUtente, modello, contesto };
}

// ---------- decisione ----------
export function scegli(c, fasce, livelli) {
  const i = Math.round(c.punteggio * (fasce.length - 1));
  const effortUsabili = livelli.slice(0, Math.min(3, livelli.length)); // i livelli piu' alti solo a mano
  const e = effortUsabili[Math.round(c.punteggio * (effortUsabili.length - 1))];
  return { fascia: i, motore: fasce[i], effort: e };
}

export function fasciaDi(modello, fasce) {
  const fam = modello.split('-')[1];
  return fasce.findIndex((f) => f.famiglia === fam);
}

export function componiMessaggio({ primo, scelta, attuale, fasce, conv, c, ollama }) {
  const nome = (f) => f.famiglia;
  const righe = [];
  if (c.locale && ollama) righe.push(`Gratis: questo lo puo' fare l'IA locale (ollama run ${ollama}), zero token Claude.`);
  if (primo) {
    // Conversazione ripresa con molto contesto: scendere di motore costerebbe la rilettura di tutto.
    const scendereNonConviene = attuale > scelta.fascia && conv.contesto >= CONTESTO_PICCOLO;
    const giusto = attuale >= 0 && (attuale === scelta.fascia || scendereNonConviene);
    righe.push(giusto
      ? `Motore ok: ${nome(fasce[attuale])}. Effort consigliato: ${scelta.effort}.`
      : `Motore consigliato: ${nome(scelta.motore)}, effort ${scelta.effort}. Scrivi /model ${nome(scelta.motore)} e /effort ${scelta.effort}.`);
    return righe.join(' ') + ` [${c.fonte}]`;
  }
  if (attuale < 0) return righe.join(' ');
  if (scelta.fascia > attuale) {
    righe.push(`Questo compito e' piu' difficile del motore in uso (${nome(fasce[attuale])}): con /model ${nome(scelta.motore)} eviti giri di correzioni. Il contesto resta.`);
  } else if (attuale - scelta.fascia >= 2 && conv.contesto < CONTESTO_PICCOLO) { // scendere solo se il salto e' netto
    righe.push(`Per questo basta ${nome(scelta.motore)}: /model ${nome(scelta.motore)} consuma meno (contesto ancora piccolo, cambio quasi gratis).`);
  }
  if (conv.contesto > CONTESTO_GRANDE) {
    righe.push(`Conversazione lunga (${Math.round(conv.contesto / 1000)}k token riletti a ogni messaggio): /compact o una nuova conversazione fa risparmiare.`);
  }
  return righe.join(' ');
}

async function principale() {
  let input = {};
  // PowerShell 5 aggiunge un BOM allo stdin: lo tolgo prima di leggere il JSON.
  try { input = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '')); } catch { return; }
  const prompt = input.prompt || '';
  if (prompt.trim().length < 15 || prompt.trim().startsWith('/')) return; // "ok", "si'", comandi
  const catalogo = leggiJson(path.join(DATI_DIR, 'catalogo.json'), null);
  const fasce = catalogo?.fasce || [];
  if (fasce.length < 2) return;

  const conv = statoConversazione(input.transcript_path);
  // Motore non ancora visibile nel log (conversazione nuova): lo prendo dalle impostazioni.
  conv.modello ||= process.env.ANTHROPIC_MODEL || leggiJson(path.join(CLAUDE_DIR, 'settings.json'), {}).model || '';
  if (conv.modello && !conv.modello.startsWith('claude-')) conv.modello = `claude-${conv.modello}`; // alias -> famiglia

  // "Primo" = primo messaggio che vedo in questa conversazione: vale anche per quelle vecchie riprese.
  const fileStato = path.join(DATI_DIR, 'stato', `${input.session_id || 'x'}.json`);
  const stato = leggiJson(fileStato, {});
  const primo = !stato.ultimo;
  const ollama = await modelloOllama();
  const c = (primo && ollama && (await classificaOllama(prompt, ollama))) || classificaRegole(prompt);
  const scelta = scegli(c, fasce, catalogo.livelli_effort?.length ? catalogo.livelli_effort : ['low', 'medium', 'high']);
  const attuale = conv.modello ? fasciaDi(conv.modello, fasce) : -1;

  // Non ripetere lo stesso avviso nella stessa conversazione.
  const msg = componiMessaggio({ primo, scelta, attuale, fasce, conv, c, ollama });
  if (!msg || (!primo && msg === stato.ultimo)) return;
  scriviJson(fileStato, { ultimo: msg, quando: new Date().toISOString(), consigliato: scelta.motore.id, effort: scelta.effort, punteggio: c.punteggio, fonte: c.fonte });
  process.stdout.write(JSON.stringify({ systemMessage: msg }));
}

const avviato = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (avviato) principale().catch(() => {});
