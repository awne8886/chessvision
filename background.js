'use strict';
const api = typeof browser !== 'undefined' ? browser : chrome;
const ENGINE_FILE = 'engine/stockfish.js';

let worker = null;
let readyPromise = null;
let current = null; // job currently searching
let next = null;    // job waiting for the current one to stop

function initEngine() {
  worker = new Worker(api.runtime.getURL(ENGINE_FILE));
  readyPromise = new Promise((resolve) => {
    worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : '';
      if (line === 'readyok') resolve();
      if (line.startsWith('bestmove')) onBestMove(line.split(' ')[1]);
    };
  });
  worker.postMessage('uci');
  worker.postMessage('isready');
}

function startJob(job) {
  current = job;
  worker.postMessage('ucinewgame');
  worker.postMessage('position fen ' + job.fen);
  worker.postMessage('go depth ' + job.depth);
}

function onBestMove(move) {
  const job = current;
  current = null;
  if (next) {
    const n = next;
    next = null;
    if (job) job.resolve(null); // superseded
    startJob(n);
  } else if (job) {
    job.resolve(move);
  }
}

async function analyze(fen, depth) {
  await readyPromise;
  return new Promise((resolve) => {
    const job = { fen, depth: Math.max(1, Math.min(20, depth || 10)), resolve };
    if (current) {
      if (next) next.resolve(null);
      next = job;
      worker.postMessage('stop');
    } else {
      startJob(job);
    }
  });
}

api.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'analyze') return analyze(msg.fen, msg.depth);
});

initEngine();
