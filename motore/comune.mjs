// Funzioni condivise. Nessuna dipendenza esterna: basta Node 18+.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
// Cartella dati: se sta in MEGA (o altra cartella sincronizzata) unisce i dati dei PC gratis.
// Ordine: variabile MOTORE_DIR, poi la scelta salvata dall'installer, poi ~/.claude/motore.
export const CONFIG = path.join(CLAUDE_DIR, 'motore', 'config.json');
export const DATI_DIR = process.env.MOTORE_DIR || leggiJson(CONFIG, {}).dati || path.join(CLAUDE_DIR, 'motore');

// Possibili cartelle MEGA su questo PC (la prima che esiste vince).
export function cercaMega() {
  const casa = os.homedir();
  const candidati = [
    'D:\\MEGA\\AI', 'D:\\MEGA', 'E:\\MEGA\\AI', 'E:\\MEGA', 'C:\\MEGA\\AI', 'C:\\MEGA',
    path.join(casa, 'MEGA', 'AI'), path.join(casa, 'MEGA'), path.join(casa, 'Documents', 'MEGA'),
  ];
  return candidati.find((c) => { try { return fs.statSync(c).isDirectory(); } catch { return false; } });
}
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
