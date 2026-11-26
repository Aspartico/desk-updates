# Selettore del motore: fase 1 (misurare)

Questa fase **non sceglie ancora nulla**: raccoglie i dati veri che serviranno alle fasi successive.
Tutto gira in locale e **non consuma token di Claude**.

## Cosa fa

| Script | Quando gira | Cosa produce |
|---|---|---|
| `catalogo.mjs` | All'avvio di Claude Code, al massimo una volta ogni 7 giorni | `catalogo.json`: livelli di effort, alias dei modelli, modelli esistenti, tutte le opzioni e modalità della CLI. Niente nomi scritti nel codice: legge `claude --help`, la documentazione pubblica, i propri log e (se c'è una chiave API) `/v1/models`. |
| `registro.mjs` | Alla chiusura di ogni sessione | `registro-<PC>.csv` e `.json`: per ogni sessione e modello, chiamate, token di input, cache, output, ragionamento, subagent e un **peso** stimato del consumo. |

Il **peso** usa il rapporto dei prezzi pubblici (input 1, scrittura cache 1,25, lettura cache 0,1, output 5).
Serve a confrontare i compiti tra loro anche con l'abbonamento, dove conta il limite d'uso e non gli euro.

## Installazione su ogni PC

1. Serve Node.js (`winget install OpenJS.NodeJS.LTS` se manca).
2. Doppio clic su `motore\installa.cmd` (oppure `node motore/installa.mjs`).

L'installer cerca da solo la cartella MEGA (es. `D:\MEGA\AI`) e salva i dati in `claude-motore` lì dentro, così il report unisce i tre PC.
Se MEGA è altrove: `node motore/installa.mjs --dati "X:\percorso\MEGA\claude-motore"`.

Si può rilanciare quante volte si vuole: non duplica gli hook. Fa una copia di `settings.json` in `settings.json.bak-motore`.
Per togliere tutto: `node motore/installa.mjs --rimuovi`.

## Vedere i dati

```
node %USERPROFILE%\.claude\motore\bin\registro.mjs --report
node %USERPROFILE%\.claude\motore\bin\catalogo.mjs --mostra
```

Il CSV si apre direttamente in Excel.

## Fase 2: il consiglio del motore

`consiglia.mjs` gira a ogni messaggio che invii (hook `UserPromptSubmit`) e ti mostra una riga di consiglio.
La riga la vedi solo tu: **non entra nel contesto di Claude, quindi non costa token**.

- **Primo messaggio** di una conversazione, anche di una vecchia ripresa con `claude --resume`: consiglia motore ed effort,
  oppure conferma che quello in uso va bene.
- **Messaggi successivi**: parla solo se serve.
  - Se il compito è più difficile del motore in uso, consiglia di salire con `/model`. Il contesto resta e si evitano giri di correzioni.
  - Consiglia di scendere solo se il salto è netto e la conversazione è ancora corta. Cambiando motore, la cache si rifà da zero
    e con molto contesto il cambio costerebbe più di quanto fa risparmiare.
  - Oltre i 150k token di contesto suggerisce `/compact` o una conversazione nuova.
- Se il compito si può fare con l'IA locale (tradurre, riassumere, riformulare) e Ollama è acceso, te lo dice.

Come decide: i motori disponibili e i loro prezzi li legge `catalogo.mjs` dalla documentazione ufficiale.
Il prezzo serve da misura della capacità, quindi un motore nuovo entra da solo nella fascia giusta.
Al primo messaggio la difficoltà la valuta l'IA locale (il modello Ollama più piccolo installato); se Ollama è spento, usa regole semplici.
Nei messaggi successivi usa sempre le regole, per non rallentarti.

Il consiglio funziona in Claude Code (terminale e app desktop). Le chat di claude.ai non eseguono hook.
