(() => {
  'use strict';
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const DEBUG = true;
  const log = (...a) => DEBUG && console.log('[ChessVision]', ...a);
  const FILES = 'abcdefgh';

  let cfg = { enabled: false, depth: 10, minDelay: 300, maxDelay: 800 };
  let board = null, observer = null, debounceTimer = null;
  let busy = false, lastHandledKey = null, attempts = 0, lastPieceCount = 0;
  let rights = { K: true, Q: true, k: true, q: true };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------- Board / FEN ----------
  function findBoard() {
    return document.querySelector('wc-chess-board') ||
           document.querySelector('chess-board') ||
           document.querySelector('.board');
  }

  function squareFromClasses(el) {
    for (const c of el.classList) {
      const m = c.match(/^square-(\d)(\d)$/);
      if (m) return [+m[1], +m[2]]; // [file, rank]
    }
    return null;
  }

  function readPosition() {
    const grid = Array.from({ length: 8 }, () => Array(8).fill(null)); // grid[rank-1][file-1]
    let count = 0;
    board.querySelectorAll('.piece').forEach((el) => {
      let piece = null;
      for (const c of el.classList) if (/^[wb][pnbrqk]$/.test(c)) piece = c;
      const sq = squareFromClasses(el);
      if (!piece || !sq) return;
      grid[sq[1] - 1][sq[0] - 1] = piece[0] === 'w' ? piece[1].toUpperCase() : piece[1];
      count++;
    });
    const highlights = [...board.querySelectorAll('.highlight')]
      .map(squareFromClasses).filter(Boolean);
    return { grid, count, highlights };
  }

  function analyzeHighlights(grid, highlights) {
    let lastMover = null, ep = '-';
    const occupied = highlights.filter(([f, r]) => grid[r - 1][f - 1]);
    const empty = highlights.filter(([f, r]) => !grid[r - 1][f - 1]);
    if (occupied.length) {
      const p = grid[occupied[0][1] - 1][occupied[0][0] - 1];
      lastMover = p === p.toUpperCase() ? 'w' : 'b';
      if (occupied.length === 1 && empty.length === 1 && p.toLowerCase() === 'p') {
        const [tf, tr] = occupied[0], [ff, fr] = empty[0];
        if (tf === ff && Math.abs(tr - fr) === 2) ep = FILES[tf - 1] + (tr + fr) / 2;
      }
    }
    return { lastMover, ep };
  }

  function updateRights(grid) {
    const at = (f, r) => grid[r - 1][f - 1];
    if (at(5, 1) !== 'K') rights.K = rights.Q = false;
    if (at(8, 1) !== 'R') rights.K = false;
    if (at(1, 1) !== 'R') rights.Q = false;
    if (at(5, 8) !== 'k') rights.k = rights.q = false;
    if (at(8, 8) !== 'r') rights.k = false;
    if (at(1, 8) !== 'r') rights.q = false;
  }

  function buildFen() {
    if (!board) return null;
    const { grid, count, highlights } = readPosition();
    if (!count) return null;
    const { lastMover, ep } = analyzeHighlights(grid, highlights);

    // New game detected -> reset castling rights
    if ((count === 32 && !highlights.length) || count > lastPieceCount) {
      rights = { K: true, Q: true, k: true, q: true };
    }
    lastPieceCount = count;
    updateRights(grid);

    const rows = [];
    for (let r = 8; r >= 1; r--) {
      let row = '', empty = 0;
      for (let f = 1; f <= 8; f++) {
        const p = grid[r - 1][f - 1];
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += p;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    const turn = lastMover ? (lastMover === 'w' ? 'b' : 'w') : 'w';
    const castle = ['K', 'Q', 'k', 'q'].filter((k) => rights[k]).join('') || '-';
    const myColor = board.classList.contains('flipped') ? 'b' : 'w';
    return { fen: `${rows.join('/')} ${turn} ${castle} ${ep} 0 1`, turn, myColor };
  }

  // ---------- Move execution ----------
  function squareCenter(file, rank) {
    const rect = board.getBoundingClientRect();
    const s = rect.width / 8;
    const flipped = board.classList.contains('flipped');
    const x = flipped ? (8 - file + 0.5) * s : (file - 0.5) * s;
    const y = flipped ? (rank - 0.5) * s : (8 - rank + 0.5) * s;
    return [rect.left + x, rect.top + y];
  }

  function fire(el, type, x, y) {
    const isPointer = type.startsWith('pointer');
    const Ctor = isPointer && typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button: 0, buttons: type.endsWith('down') ? 1 : 0,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
    }));
  }

  async function clickAt(x, y) {
    const el = document.elementFromPoint(x, y) || board;
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      fire(el, t, x, y);
      await sleep(15);
    }
  }

  async function executeMove(uci, color) {
    const f1 = FILES.indexOf(uci[0]) + 1, r1 = +uci[1];
    const f2 = FILES.indexOf(uci[2]) + 1, r2 = +uci[3];
    await clickAt(...squareCenter(f1, r1));
    await sleep(rand(80, 160));
    await clickAt(...squareCenter(f2, r2));
    if (uci.length === 5) { // promotion
      await sleep(300);
      const cls = color + uci[4];
      const el = document.querySelector(`.promotion-window .${cls}`) ||
                 document.querySelector(`[class*="promotion"] [class~="${cls}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        await clickAt(r.left + r.width / 2, r.top + r.height / 2);
      } else log('promotion picker not found');
    }
  }

  // ---------- Main loop ----------
  async function play(pos) {
    busy = true;
    lastHandledKey = pos.fen;
    try {
      const delay = rand(cfg.minDelay, Math.max(cfg.minDelay, cfg.maxDelay));
      // Engine thinks WHILE the human-like delay runs
      const [uci] = await Promise.all([
        api.runtime.sendMessage({ type: 'analyze', fen: pos.fen, depth: cfg.depth }),
        sleep(delay),
      ]);
      if (!cfg.enabled) return;
      if (!uci || uci === '(none)') { log('no move returned', uci); return; }
      const now = buildFen();
      if (!now || now.fen !== pos.fen) { log('position changed, discarding', uci); return; }
      log('playing', uci, 'for', pos.fen);
      await executeMove(uci, pos.myColor);
    } catch (e) {
      console.error('[ChessVision]', e);
    } finally {
      busy = false;
    }
    // If the move didn't register, retry a few times
    setTimeout(() => {
      const now = buildFen();
      if (cfg.enabled && now && now.fen === pos.fen && attempts < 3) {
        attempts++;
        lastHandledKey = null;
        schedule(0);
      }
    }, 1800);
  }

  function check() {
    if (!cfg.enabled || busy) return;
    const pos = buildFen();
    if (!pos) return;
    if (pos.turn !== pos.myColor) { attempts = 0; return; }
    if (pos.fen === lastHandledKey) return;
    play(pos);
  }

  function schedule(ms) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(check, ms);
  }

  function attach() {
    const b = findBoard();
    if (b === board && observer) return;
    if (observer) observer.disconnect();
    board = b;
    observer = null;
    if (!b) return;
    observer = new MutationObserver(() => schedule(250));
    observer.observe(b, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['class'],
    });
    log('board attached');
    schedule(300);
  }

  // ---------- Settings ----------
  api.storage.local.get(cfg).then((v) => { cfg = { ...cfg, ...v }; schedule(0); });
  api.storage.onChanged.addListener((changes) => {
    for (const k in changes) cfg[k] = changes[k].newValue;
    if (cfg.enabled) { lastHandledKey = null; schedule(100); }
  });

  setInterval(attach, 1000); // re-attach if chess.com swaps the board element
  attach();
})();
