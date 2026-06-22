import { joinRoom, selfId } from 'https://esm.sh/trystero@0.21.0/mqtt';

const APP_ID = 'bsntas-bingo-v1';
const ROOM_CONFIG = {
  appId: APP_ID,
  brokerUrl: 'wss://broker.hivemq.com:8884/mqtt',
};

// ── Bingo engine ──────────────────────────────────────────────────────────

function generateKit(N) {
  const total = N * N;
  const nums = Array.from({ length: total }, (_, i) => i + 1);
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  const kit = [];
  for (let i = 0; i < N; i++) kit.push(nums.slice(i * N, i * N + N));
  return kit;
}

// Rows + columns only. Win at score >= N.
function calcScore(kit, calledSet) {
  const N = kit.length;
  let s = 0;
  for (let r = 0; r < N; r++) if (kit[r].every(n => calledSet.has(n))) s++;
  for (let c = 0; c < N; c++) if (kit.every(row => calledSet.has(row[c]))) s++;
  return s;
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── App ───────────────────────────────────────────────────────────────────

class BingoApp {
  constructor() {
    this.myName = '';
    this.isHost = false;
    this.trRoom = null;
    this.sendMsg = null;
    this.hostPeerId = null;
    this.roomCode = null;
    this.gridSize = 5;

    // Host-only: full authoritative game state
    this.gameState = null;

    // Client display state (received from host)
    this.publicState = null;
    this.myKit = null;

    this._toastTimer = null;
    this._heartbeatInterval = null;
    this._disconnectTimers = new Map();
    this._reconnecting = false;

    this._bindUI();
    this._syncRoleUI();
    this._readGridSize();
  }

  // ── Utilities ─────────────────────────────────────────────────────────

  $(id) { return document.getElementById(id); }

  showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    this.$(`${name}-screen`).classList.add('active');
  }

  showToast(msg) {
    clearTimeout(this._toastTimer);
    const t = this.$('toast');
    t.textContent = msg;
    t.classList.add('show');
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  }

  showError(msg) {
    this.$('start-error').textContent = msg;
    const btn = this.$('continue-btn');
    btn.disabled = false;
    btn.textContent = 'Continue';
  }

  _syncRoleUI() {
    const host = this.$('radio-host').checked;
    this.$('lbl-host').classList.toggle('selected', host);
    this.$('lbl-join').classList.toggle('selected', !host);
    this.$('room-input-wrap').style.display = host ? 'none' : '';
    this.$('grid-size-wrap').style.display = host ? '' : 'none';
  }

  _readGridSize() {
    let val = parseInt(this.$('grid-size-input').value, 10);
    if (isNaN(val)) val = 5;
    val = Math.max(5, Math.min(15, val));
    this.gridSize = val;
    this.$('grid-size-hint').textContent = `${val} × ${val} grid · ${val * val} numbers`;
    return val;
  }

  // ── Host flow ──────────────────────────────────────────────────────────

  createGame() {
    const name = this.$('name-input').value.trim();
    if (!name) { this.showError('Please enter your name.'); return; }
    this._readGridSize();

    this.myName = name;
    this.isHost = true;
    this.roomCode = genCode();

    const btn = this.$('continue-btn');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    this.gameState = {
      phase: 'lobby',
      players: [{ id: selfId, name, isHost: true, kit: null, score: 0 }],
      turnIndex: 0,
      calledNumbers: new Set(),
      winner: null,
      gridSize: this.gridSize,
    };

    this.trRoom = joinRoom(ROOM_CONFIG, this.roomCode);
    const [sendMsg, onMsg] = this.trRoom.makeAction('msg');
    this.sendMsg = sendMsg;

    // Keep MQTT alive when tab is backgrounded
    this._heartbeatInterval = setInterval(() => {
      if (this.trRoom && this.gameState) this._broadcastState();
    }, 25000);

    this.trRoom.onPeerJoin(peerId => {
      sendMsg({ type: 'host-hello', name: this.myName }, peerId);
    });

    this.trRoom.onPeerLeave(peerId => {
      const gs = this.gameState;
      const player = gs.players.find(p => p.id === peerId);
      if (!player) return;

      if (gs.phase === 'lobby') {
        gs.players = gs.players.filter(p => p.id !== peerId);
        this._broadcastState();
        return;
      }

      // In-game: 45 s reconnect window
      this.showToast(`${player.name} disconnected — waiting…`);
      const timer = setTimeout(() => {
        this._disconnectTimers.delete(peerId);
        const idx = gs.players.findIndex(p => p.id === peerId);
        if (idx === -1) return;
        gs.players.splice(idx, 1);
        if (gs.players.length < 2) {
          gs.phase = 'game_over';
          gs.winner = gs.players[0]?.name || null;
        } else {
          if (idx < gs.turnIndex) gs.turnIndex--;
          gs.turnIndex = gs.turnIndex % gs.players.length;
        }
        this._broadcastState();
      }, 45000);
      this._disconnectTimers.set(peerId, timer);
    });

    onMsg((data, peerId) => {
      if (!this.isHost) return;

      if (data.type === 'guest-join') {
        const gs = this.gameState;
        // Reconnect: find a disconnected player with the same name
        const disconnId = [...this._disconnectTimers.keys()].find(id =>
          gs.players.find(p => p.id === id)?.name === data.name);
        if (disconnId !== undefined) {
          clearTimeout(this._disconnectTimers.get(disconnId));
          this._disconnectTimers.delete(disconnId);
          const player = gs.players.find(p => p.id === disconnId);
          if (player) {
            player.id = peerId;
            this.showToast(`${data.name} reconnected!`);
            this._broadcastState();
            return;
          }
        }

        if (gs.phase !== 'lobby') { sendMsg({ type: 'error', message: 'Game already started.', fatal: true }, peerId); return; }
        if (gs.players.length >= 5) { sendMsg({ type: 'error', message: 'Room is full (max 5 players).', fatal: true }, peerId); return; }
        if (gs.players.some(p => p.name === data.name)) { sendMsg({ type: 'error', message: 'Name already taken in this room.', fatal: true }, peerId); return; }

        gs.players.push({ id: peerId, name: data.name, isHost: false, kit: null, score: 0 });
        this._broadcastState();
        return;
      }

      if (data.type === 'action') { this._processAction(peerId, data); return; }
      if (data.type === 'ping') { this._broadcastState(); }
    });

    this._enterLobby();
    this._saveSession();
  }

  _enterLobby() {
    this.showScreen('lobby');
    this.$('room-code-box').style.display = '';
    this.$('room-code-text').textContent = this.roomCode;
    const startBtn = this.$('start-btn');
    if (this.isHost) {
      startBtn.style.display = '';
      startBtn.disabled = true;
      startBtn.textContent = 'Waiting for players…';
    } else {
      startBtn.style.display = 'none';
    }
    this._renderLobby();
  }

  // ── Guest flow ────────────────────────────────────────────────────────

  joinGame() {
    const name = this.$('name-input').value.trim();
    const code = this.$('room-input').value.trim().toUpperCase();
    if (!name) { this.showError('Please enter your name.'); return; }
    if (!code) { this.showError('Please enter a room code.'); return; }

    this.myName = name;
    this.isHost = false;
    this.hostPeerId = null;
    this.roomCode = code;

    const btn = this.$('continue-btn');
    btn.disabled = true;
    btn.textContent = 'Searching…';

    this.trRoom = joinRoom(ROOM_CONFIG, code);
    const [sendMsg, onMsg] = this.trRoom.makeAction('msg');
    this.sendMsg = sendMsg;

    const joinTimeout = setTimeout(() => {
      if (!this.hostPeerId) {
        this.showError(`Room \"${code}\" not found — check the code and retry.`);
        this.trRoom?.leave?.();
        this.trRoom = null;
      }
    }, 30000);

    this.trRoom.onPeerLeave(peerId => {
      if (peerId === this.hostPeerId && this.publicState?.phase !== 'game_over') {
        this.showToast('Connection lost — reconnecting…');
        this._attemptReconnect();
      }
    });

    onMsg((data, peerId) => {
      if (this.isHost) return;

      if (data.type === 'host-hello' && !this.hostPeerId) {
        clearTimeout(joinTimeout);
        this.hostPeerId = peerId;
        sendMsg({ type: 'guest-join', name: this.myName }, peerId);
        // Show lobby immediately while waiting for first state
        this.showScreen('lobby');
        this.$('room-code-box').style.display = '';
        this.$('room-code-text').textContent = code;
        this.$('start-btn').style.display = 'none';
        this.$('lobby-status').textContent = 'Connecting…';
        btn.disabled = false;
        btn.textContent = 'Continue';
        this._saveSession();
        return;
      }

      if (peerId !== this.hostPeerId) return;

      if (data.type === 'state') {
        this.publicState = data.public;
        if (data.kit) {
          this.myKit = data.kit;
          this.gridSize = data.public.gridSize || 5;
        }
        this._render();
        return;
      }

      if (data.type === 'error') {
        this.showError(data.message);
        if (data.fatal) {
          this.trRoom?.leave?.();
          this.trRoom = null;
          this.showScreen('start');
        }
      }
    });
  }

  _attemptReconnect() {
    if (this._reconnecting) return;
    this._reconnecting = true;
    const { roomCode, myName } = this;
    try { this.trRoom?.leave?.(); } catch (_) {}
    this.trRoom = null;
    this.sendMsg = null;
    this.hostPeerId = null;
    setTimeout(() => {
      this._reconnecting = false;
      this.$('name-input').value = myName;
      this.$('room-input').value = roomCode;
      this.$('radio-join').checked = true;
      this._syncRoleUI();
      this.joinGame();
    }, 2000);
  }

  // ── Action processing (host only) ────────────────────────────────────

  _processAction(playerId, data) {
    const gs = this.gameState;
    if (gs.phase !== 'game') return;

    const cur = gs.players[gs.turnIndex];
    if (!cur || cur.id !== playerId) {
      const err = "It's not your turn.";
      if (playerId === selfId) this.showToast(err);
      else this.sendMsg({ type: 'error', message: err }, playerId);
      return;
    }

    if (data.action !== 'commit') return;

    const num = data.number;
    const total = gs.gridSize * gs.gridSize;
    if (!Number.isInteger(num) || num < 1 || num > total) return;
    if (gs.calledNumbers.has(num)) {
      const err = 'That number was already called.';
      if (playerId === selfId) this.showToast(err);
      else this.sendMsg({ type: 'error', message: err }, playerId);
      return;
    }

    gs.calledNumbers.add(num);

    let winner = null;
    for (const p of gs.players) {
      p.score = calcScore(p.kit, gs.calledNumbers);
      if (p.score >= gs.gridSize && !winner) winner = p;
    }

    if (winner) {
      gs.phase = 'game_over';
      gs.winner = winner.name;
    } else {
      gs.turnIndex = (gs.turnIndex + 1) % gs.players.length;
    }

    this._broadcastState();
  }

  // ── State management ──────────────────────────────────────────────────

  _buildPublicState() {
    const gs = this.gameState;
    return {
      phase: gs.phase,
      players: gs.players.map(p => ({ id: p.id, name: p.name, isHost: p.isHost, score: p.score })),
      turnIndex: gs.turnIndex,
      calledNumbers: [...gs.calledNumbers],
      winner: gs.winner,
      gridSize: gs.gridSize,
    };
  }

  _broadcastState() {
    const pub = this._buildPublicState();
    this.publicState = pub;

    const gs = this.gameState;
    if (gs.phase === 'game') {
      const me = gs.players.find(p => p.id === selfId);
      if (me) { this.myKit = me.kit; this.gridSize = gs.gridSize; }
    }

    for (const player of gs.players) {
      if (player.id === selfId) continue;
      const msg = { type: 'state', public: pub };
      if (gs.phase === 'game' && player.kit) msg.kit = player.kit;
      this.sendMsg(msg, player.id);
    }

    this._render();
  }

  sendAction(action) {
    if (this.isHost) this._processAction(selfId, action);
    else if (this.hostPeerId && this.sendMsg) this.sendMsg({ type: 'action', ...action }, this.hostPeerId);
  }

  // ── Game control ──────────────────────────────────────────────────────

  startGame() {
    if (!this.isHost) return;
    const gs = this.gameState;
    if (gs.phase !== 'lobby' || gs.players.length < 2) { this.showToast('Need at least 2 players.'); return; }

    gs.phase = 'game';
    gs.turnIndex = 0;
    gs.calledNumbers = new Set();
    gs.winner = null;
    for (const p of gs.players) { p.kit = generateKit(gs.gridSize); p.score = 0; }

    this._broadcastState();
  }

  exitGame() { this._reset(); }

  playAgain() {
    if (this.isHost) {
      const gs = this.gameState;
      gs.phase = 'lobby';
      gs.turnIndex = 0;
      gs.calledNumbers = new Set();
      gs.winner = null;
      for (const p of gs.players) { p.kit = null; p.score = 0; }
      this.myKit = null;
      this._broadcastState();
    } else {
      this._reset();
    }
  }

  _reset() {
    clearInterval(this._heartbeatInterval);
    this._heartbeatInterval = null;
    for (const t of this._disconnectTimers.values()) clearTimeout(t);
    this._disconnectTimers.clear();
    try { this.trRoom?.leave?.(); } catch (_) {}
    this.trRoom = null;
    this.sendMsg = null;
    this.hostPeerId = null;
    this.roomCode = null;
    this.gameState = null;
    this.publicState = null;
    this.myKit = null;
    this.isHost = false;
    this.myName = '';
    this.gridSize = 5;
    this._clearSession();

    this.$('start-error').textContent = '';
    const btn = this.$('continue-btn');
    btn.disabled = false;
    btn.textContent = 'Continue';
    this.$('radio-host').checked = true;
    this._syncRoleUI();
    this.$('room-code-box').style.display = 'none';
    this.$('start-btn').style.display = 'none';
    this.$('lobby-player-list').innerHTML = '';
    this.$('game-player-list').innerHTML = '';
    this.$('bingo-board').innerHTML = '';
    const goBoard = this.$('gameover-board');
    if (goBoard) goBoard.innerHTML = '';
    this._updateScore(0);
    this.showScreen('start');
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  _render() {
    if (!this.publicState) return;
    const { phase } = this.publicState;

    if (phase === 'lobby') {
      this._enterLobby();
    } else if (phase === 'game') {
      this.showScreen('game');
      this._renderGame();
    } else if (phase === 'game_over') {
      this.showScreen('gameover');
      this._renderGameOver();
    }
  }

  _renderLobby() {
    const players = this.isHost
      ? this.gameState.players
      : (this.publicState?.players || []);

    const ul = this.$('lobby-player-list');
    ul.innerHTML = '';
    players.forEach(p => {
      const li = document.createElement('li');
      li.textContent = p.name;
      if (p.isHost) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'host';
        li.appendChild(badge);
      }
      ul.appendChild(li);
    });

    this.$('player-count').textContent = players.length;

    if (this.isHost) {
      const startBtn = this.$('start-btn');
      const ready = players.length >= 2;
      startBtn.disabled = !ready;
      startBtn.textContent = ready ? 'Start Game' : 'Waiting for players…';
      this.$('lobby-status').textContent = ready
        ? 'Ready — you can start the game!'
        : 'Waiting for at least one more player…';
    } else {
      this.$('lobby-status').textContent = 'Waiting for host to start the game…';
    }
  }

  _renderGame() {
    const st = this.publicState;
    const N = st.gridSize || this.gridSize || 5;
    const myIdx = st.players.findIndex(p => p.id === selfId);
    const isMyTurn = st.turnIndex === myIdx;
    const curName = st.players[st.turnIndex]?.name || '';
    const myScore = st.players[myIdx]?.score ?? 0;

    this._updateScore(myScore);

    const instr = this.$('instruction');
    if (isMyTurn) {
      instr.textContent = 'Your turn — tap a number!';
      instr.classList.add('my-turn');
    } else {
      instr.textContent = `${curName}'s turn…`;
      instr.classList.remove('my-turn');
    }

    this._buildBoard(N, isMyTurn, new Set(st.calledNumbers || []));
    this._renderGamePlayers(st);
  }

  _buildBoard(N, isMyTurn, calledSet) {
    const board = this.$('bingo-board');
    if (!this.myKit) { board.innerHTML = ''; return; }

    board.style.gridTemplateColumns = `repeat(${N}, 1fr)`;
    board.style.fontSize = `${Math.max(0.6, 7 / N).toFixed(2)}rem`;
    board.innerHTML = '';

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const num = this.myKit[r][c];
        const isMarked = calledSet.has(num);
        const cell = document.createElement('div');
        cell.className = 'cell' + (isMarked ? ' marked' : '');
        cell.textContent = num;
        cell.dataset.num = num;
        board.appendChild(cell);
      }
    }

    board.classList.toggle('active', isMyTurn);
    if (isMyTurn) {
      board.querySelectorAll('.cell:not(.marked)').forEach(cell => {
        cell.addEventListener('click', () => this._onCellClick(parseInt(cell.dataset.num, 10)));
      });
    }
  }

  _onCellClick(num) {
    const st = this.publicState;
    if (!st || st.phase !== 'game') return;
    const myIdx = st.players.findIndex(p => p.id === selfId);
    if (st.turnIndex !== myIdx) { this.showToast("It's not your turn."); return; }
    const instr = this.$('instruction');
    instr.textContent = `Calling ${num}…`;
    instr.classList.remove('my-turn');
    this.$('bingo-board').classList.remove('active');
    this.sendAction({ action: 'commit', number: num });
  }

  _renderGamePlayers(st) {
    const ul = this.$('game-player-list');
    ul.innerHTML = '';
    st.players.forEach((p, i) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'turn-dot';
      li.appendChild(dot);
      li.appendChild(document.createTextNode(p.name));
      if (i === st.turnIndex) li.classList.add('active-turn');
      ul.appendChild(li);
    });
  }

  _updateScore(score) {
    [0,1,2,3,4].forEach(i => {
      this.$(`bl-${i}`)?.classList.toggle('scored', i < Math.min(score, 5));
    });
  }

  _renderGameOver() {
    const st = this.publicState;
    const el = this.$('winner-text');
    const isWinner = st.winner === this.myName;
    el.textContent = isWinner ? 'You Win! 🎉' : `Winner: ${st.winner || 'Unknown'}`;
    el.style.color = isWinner ? 'var(--accent)' : 'var(--blue)';
    this._buildGameoverBoard(st);
  }

  _buildGameoverBoard(st) {
    const wrap = this.$('gameover-board-wrap');
    const boardEl = this.$('gameover-board');
    boardEl.innerHTML = '';
    if (!this.myKit) { if (wrap) wrap.style.display = 'none'; return; }
    if (wrap) wrap.style.display = '';
    const N = this.myKit.length;
    const calledSet = new Set(st.calledNumbers || []);
    boardEl.style.gridTemplateColumns = `repeat(${N}, 1fr)`;
    boardEl.style.fontSize = `${Math.max(0.55, 5 / N).toFixed(2)}rem`;
    if (wrap) wrap.style.maxWidth = `${N * 55}px`;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const num = this.myKit[r][c];
        const cell = document.createElement('div');
        cell.className = 'preview-cell' + (calledSet.has(num) ? ' marked' : '');
        cell.textContent = num;
        boardEl.appendChild(cell);
      }
    }
  }

  // ── Session persistence ───────────────────────────────────────────────

  _saveSession() {
    if (!this.roomCode) return;
    try {
      localStorage.setItem('bingo_session', JSON.stringify({
        name: this.myName,
        roomCode: this.roomCode,
        isHost: this.isHost,
        ts: Date.now(),
      }));
    } catch (_) {}
  }

  _clearSession() {
    try { localStorage.removeItem('bingo_session'); } catch (_) {}
  }

  // ── UI bindings ───────────────────────────────────────────────────────

  _bindUI() {
    const $ = id => document.getElementById(id);

    $('radio-host').addEventListener('change', () => this._syncRoleUI());
    $('radio-join').addEventListener('change', () => this._syncRoleUI());
    $('lbl-host').addEventListener('click', () => { $('radio-host').checked = true; this._syncRoleUI(); });
    $('lbl-join').addEventListener('click', () => { $('radio-join').checked = true; this._syncRoleUI(); });

    $('grid-size-input').addEventListener('input', () => this._readGridSize());
    $('grid-size-input').addEventListener('blur', () => {
      let v = parseInt($('grid-size-input').value, 10);
      if (isNaN(v) || v < 5) v = 5;
      if (v > 15) v = 15;
      $('grid-size-input').value = v;
      this._readGridSize();
    });

    $('continue-btn').addEventListener('click', () => {
      $('start-error').textContent = '';
      if ($('radio-host').checked) this.createGame();
      else this.joinGame();
    });

    $('name-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('continue-btn').click(); });
    $('room-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('continue-btn').click(); });

    $('start-btn').addEventListener('click', () => {
      if (!this.isHost) return;
      $('start-btn').disabled = true;
      this.startGame();
    });

    $('play-again-btn').addEventListener('click', () => this.playAgain());
    $('exit-btn').addEventListener('click', () => this.exitGame());
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new BingoApp();

  try {
    const raw = localStorage.getItem('bingo_session');
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && Date.now() - saved.ts < 4 * 60 * 60 * 1000) {
        if (saved.name) document.getElementById('name-input').value = saved.name;
        if (!saved.isHost && saved.roomCode) {
          document.getElementById('room-input').value = saved.roomCode;
          document.getElementById('radio-join').checked = true;
          window.app._syncRoleUI();
          window.app.showToast(`Tap \"Continue\" to rejoin ${saved.roomCode}`);
        }
      } else {
        localStorage.removeItem('bingo_session');
      }
    }
  } catch (_) {
    localStorage.removeItem('bingo_session');
  }
});
