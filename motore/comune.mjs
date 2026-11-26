// Funzioni condivise. Nessuna dipendenza esterna: basta Node 18+.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
// Cartella dati: puo' stare in Dropbox/OneDrive per unire i dati di piu' PC gratis.
export const DATI_DIR = process.env.MOTORE_DIR || path.join(CLAUDE_DIR, 'motore');
export const HOST = os.hostname().toUpperCase();

export function dispositivo() {
  return {
    nome: HOST,
    sistema: `${os.platform()} ${os.release()}`,
    cpu: os.cpus()[0]?.model?.trim() || '',
    core: os.cpus().length,
    ram_gb: Math.round(os.totalmem() / 1e9),
  };
}

export function leggiJson(file, predefinito) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return predefinito; }
}

export function scriviJson(file, dati) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(dati, null, 2));
  fs.renameSync(tmp, file);
}
