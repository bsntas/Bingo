import { joinRoom, selfId } from 'https://esm.sh/trystero@0.21.0/mqtt';

const APP_ID = 'bsntas-bingo-v1';
const ROOM_CONFIG = {
  appId: APP_ID,
  brokerUrl: 'wss://broker.hivemq.com:8884/mqtt',
};

// ── Bingo engine ──────────────────────────────────────────────────────────

function generateKit() {
  const numbers = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  const kit = [];
  for (let i = 0; i < 5; i++) kit.push(numbers.slice(i * 5, i * 5 + 5));
  return kit;
}

function calculateScore(kit, calledSet) {
  let score = 0;
  for (let r = 0; r < 5; r++) {
    if (kit[r].every(n => calledSet.has(n))) score++;
  }
  for (let c = 0; c < 5; c++) {
    if (kit.every(row => calledSet.has(row[c]))) score++;
  }
  if (kit.every((row, i) => calledSet.has(row[i]))) score++;
  if (kit.every((row, i) => calledSet.has(row[4 - i]))) score++;
  return score;
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

    // Host-only: full game state
    this.gameState = null;

    // Client display state (populated from host broadcasts)
    this.publicState = null;
    this.myKit = null;

    this._toastTimer = null;
    this._heartbeatInterval = null;
    this._disconnectTimers = new Map();
    this._reconnecting = false;

    this.bindUI();
    this.updateRoleUI();
  }

  // ── Utilities ─────────────────────────────────────────────────────────

  genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id + '-screen').classList.add('active');
  }

  showToast(msg) {
    clearTimeout(this._toastTimer);
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('visible');
    this._toastTimer = setTimeout(() => t.classList.remove('visible'), 3500);
  }

  updateRoleUI() {
    const host = document.getElementById('role-host').checked;
    document.getElementById('role-host-label').classList.toggle('selected', host);
    document.getElementById('role-join-label').classList.toggle('selected', !host);
    document.getElementById('room-input-group').style.display = host ? 'none' : '';
  }

  // ── Host flow ──────────────────────────────────────────────────────────

  createGame() {
    const name = document.getElementById('name-input').value.trim();
    if (!name) { document.getElementById('start-error').textContent = 'Please enter your name.'; return; }

    this.myName = name;
    this.isHost = true;
    this.roomCode = this.genCode();

    this.gameState = {
      phase: 'lobby',
      players: [{ id: selfId, name, kit: null, score: 0 }],
      turnIndex: 0,
      calledNumbers: new Set(),
      winner: null,
    };

    this.trRoom = joinRoom(ROOM_CONFIG, this.roomCode);
    const [sendMsg, onMsg] = this.trRoom.makeAction('msg');
    this.sendMsg = sendMsg;

    // Keep MQTT connection alive when tab is backgrounded
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

      // In-game: allow 45 s to reconnect before removing
      this.showToast(`${player.name} disconnected — waiting…`);
      const timer = setTimeout(() => {
        this._disconnectTimers.delete(peerId);
        const idx = gs.players.findIndex(p => p.id === peerId);
        if (idx === -1) return;
        gs.players.splice(idx, 1);
        if (gs.players.length < 2) {
          gs.phase = 'game_over';
          gs.winner = gs.players[0] ? { id: gs.players[0].id, name: gs.players[0].name } : null;
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
        // Check if a disconnected player is rejoining under the same name
        const disconnectedId = [...this._disconnectTimers.keys()].find(id =>
          gs.players.find(p => p.id === id)?.name === data.name);
        if (disconnectedId !== undefined) {
          clearTimeout(this._disconnectTimers.get(disconnectedId));
          this._disconnectTimers.delete(disconnectedId);
          const player = gs.players.find(p => p.id === disconnectedId);
          if (player) {
            player.id = peerId;
            this.showToast(`${data.name} reconnected!`);
            this._broadcastState();
            return;
          }
        }

        if (gs.phase !== 'lobby') {
          sendMsg({ type: 'error', message: 'Game already started.', fatal: true }, peerId);
          return;
        }
        if (gs.players.length >= 5) {
          sendMsg({ type: 'error', message: 'Room is full (max 5 players).', fatal: true }, peerId);
          return;
        }
        if (gs.players.some(p => p.name === data.name)) {
          sendMsg({ type: 'error', message: 'Name already taken in this room.', fatal: true }, peerId);
          return;
        }

        gs.players.push({ id: peerId, name: data.name, kit: null, score: 0 });
        this._broadcastState();
        return;
      }

      if (data.type === 'action') {
        this._processAction(peerId, data);
        return;
      }

      if (data.type === 'ping') {
        this._broadcastState();
      }
    });

    this._showLobbyScreen();
    this.saveSession();
  }

  _showLobbyScreen() {
    this.showScreen('lobby');
    document.getElementById('room-code-display').textContent = this.roomCode;
    document.getElementById('room-code-box').style.display = '';
    const startBtn = document.getElementById('start-btn');
    if (this.isHost) {
      startBtn.style.display = '';
      startBtn.disabled = true;
    } else {
      startBtn.style.display = 'none';
    }
    this._renderLobby();
  }

  // ── Guest flow ────────────────────────────────────────────────────────

  joinGame() {
    const name = document.getElementById('name-input').value.trim();
    const code = document.getElementById('room-input').value.trim().toUpperCase();
    if (!name) { document.getElementById('start-error').textContent = 'Please enter your name.'; return; }
    if (!code) { document.getElementById('start-error').textContent = 'Please enter a room code.'; return; }

    this.myName = name;
    this.isHost = false;
    this.hostPeerId = null;
    this.roomCode = code;

    const btn = document.getElementById('continue-btn');
    btn.disabled = true;
    btn.textContent = 'Searching…';

    this.trRoom = joinRoom(ROOM_CONFIG, code);
    const [sendMsg, onMsg] = this.trRoom.makeAction('msg');
    this.sendMsg = sendMsg;

    const joinTimeout = setTimeout(() => {
      if (!this.hostPeerId) {
        this.showToast(`Room \"${code}\" not found — check the code and retry.`);
        btn.disabled = false;
        btn.textContent = 'Continue';
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

        // Show lobby immediately; state message will populate player list
        this.showScreen('lobby');
        document.getElementById('room-code-display').textContent = code;
        document.getElementById('room-code-box').style.display = '';
        document.getElementById('start-btn').style.display = 'none';
        document.getElementById('lobby-status').textContent = 'Connecting…';
        btn.disabled = false;
        btn.textContent = 'Continue';
        this.saveSession();
        return;
      }

      if (peerId !== this.hostPeerId) return;

      if (data.type === 'state') {
        this.publicState = data.public;
        if (data.kit) this.myKit = data.kit;
        this.render();
        return;
      }

      if (data.type === 'error') {
        this.showToast(data.message);
        document.getElementById('start-error').textContent = data.message;
        if (data.fatal) {
          btn.disabled = false;
          btn.textContent = 'Continue';
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
      document.getElementById('name-input').value = myName;
      document.getElementById('room-input').value = roomCode;
      document.getElementById('role-join').checked = true;
      this.updateRoleUI();
      this.joinGame();
    }, 2000);
  }

  // ── Action processing (host only) ────────────────────────────────────

  _processAction(playerId, data) {
    const gs = this.gameState;
    if (gs.phase !== 'game') return;

    const currentPlayer = gs.players[gs.turnIndex];
    if (!currentPlayer || currentPlayer.id !== playerId) {
      const errMsg = "It's not your turn.";
      if (playerId === selfId) this.showToast(errMsg);
      else this.sendMsg({ type: 'error', message: errMsg }, playerId);
      return;
    }

    if (data.action !== 'commit') return;

    const num = data.number;
    if (!Number.isInteger(num) || num < 1 || num > 25) return;
    if (gs.calledNumbers.has(num)) {
      const errMsg = 'That number was already called.';
      if (playerId === selfId) this.showToast(errMsg);
      else this.sendMsg({ type: 'error', message: errMsg }, playerId);
      return;
    }

    gs.calledNumbers.add(num);

    let winner = null;
    for (const p of gs.players) {
      p.score = calculateScore(p.kit, gs.calledNumbers);
      if (p.score >= 5 && !winner) winner = p;
    }

    if (winner) {
      gs.phase = 'game_over';
      gs.winner = { id: winner.id, name: winner.name };
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
      players: gs.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
      turnIndex: gs.turnIndex,
      calledNumbers: [...gs.calledNumbers],
      winner: gs.winner,
    };
  }

  _broadcastState() {
    const pub = this._buildPublicState();
    this.publicState = pub;

    const gs = this.gameState;
    if (gs.phase === 'game') {
      const me = gs.players.find(p => p.id === selfId);
      if (me) this.myKit = me.kit;
    }

    for (const player of gs.players) {
      if (player.id === selfId) continue;
      const msg = { type: 'state', public: pub };
      // Always send kit during game so reconnecting guests can rebuild their board
      if (gs.phase === 'game' && player.kit) msg.kit = player.kit;
      this.sendMsg(msg, player.id);
    }

    this.render();
  }

  sendAction(action) {
    if (this.isHost) {
      this._processAction(selfId, action);
    } else if (this.hostPeerId && this.sendMsg) {
      this.sendMsg({ type: 'action', ...action }, this.hostPeerId);
    }
  }

  // ── Game control ──────────────────────────────────────────────────────

  startGame() {
    if (!this.isHost) return;
    const gs = this.gameState;
    if (gs.phase !== 'lobby' || gs.players.length < 2) {
      this.showToast('Need at least 2 players.');
      return;
    }

    gs.phase = 'game';
    gs.turnIndex = 0;
    gs.calledNumbers = new Set();
    gs.winner = null;

    for (const p of gs.players) {
      p.kit = generateKit();
      p.score = 0;
    }

    this._broadcastState();
  }

  playAgain() {
    if (this.isHost) {
      const gs = this.gameState;
      gs.phase = 'lobby';
      gs.turnIndex = 0;
      gs.calledNumbers = new Set();
      gs.winner = null;
      for (const p of gs.players) {
        p.kit = null;
        p.score = 0;
      }
      this.myKit = null;
      this._broadcastState();
    } else {
      // Guest: leave and go back to start screen
      this.resetToStart();
    }
  }

  resetToStart() {
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

    this.clearSession();

    document.getElementById('name-input').value = '';
    document.getElementById('room-input').value = '';
    document.getElementById('start-error').textContent = '';
    const btn = document.getElementById('continue-btn');
    btn.disabled = false;
    btn.textContent = 'Continue';
    document.getElementById('role-host').checked = true;
    this.updateRoleUI();
    this.showScreen('start');
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  render() {
    if (!this.publicState) return;
    const { phase } = this.publicState;

    if (phase === 'lobby') {
      this._showLobbyScreen();
    } else if (phase === 'game') {
      this.showScreen('game');
      this._renderGame();
    } else if (phase === 'game_over') {
      this.showScreen('gameover');
      this._showGameOver();
    }
  }

  _renderLobby() {
    const players = this.isHost
      ? this.gameState.players
      : (this.publicState?.players || []);

    const ul = document.getElementById('lobby-player-list');
    ul.innerHTML = '';
    players.forEach((p, i) => {
      const li = document.createElement('li');
      li.textContent = p.name;
      if (i === 0) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'host';
        li.appendChild(badge);
      }
      ul.appendChild(li);
    });

    document.getElementById('player-count').textContent = players.length;

    if (this.isHost) {
      const startBtn = document.getElementById('start-btn');
      startBtn.disabled = players.length < 2;
      startBtn.textContent = players.length >= 2 ? 'Start Game' : 'Waiting for players…';
      document.getElementById('lobby-status').textContent = players.length < 2
        ? 'Waiting for at least one more player…'
        : 'Ready to start!';
    } else {
      document.getElementById('lobby-status').textContent = 'Waiting for host to start the game…';
    }
  }

  _renderGame() {
    const st = this.publicState;
    const myIdx = st.players.findIndex(p => p.id === selfId);
    const isMyTurn = st.turnIndex === myIdx;
    const currentPlayerName = st.players[st.turnIndex]?.name || '';

    // BINGO score letters for the local player
    const myScore = st.players[myIdx]?.score ?? 0;
    [0,1,2,3,4].forEach(i => {
      document.getElementById(`bl-${i}`)?.classList.toggle('scored', i < Math.min(myScore, 5));
    });

    // Instruction bar
    const instruction = document.getElementById('instruction');
    if (isMyTurn) {
      instruction.textContent = 'Your turn — click a number to call it!';
      instruction.classList.add('your-turn');
    } else {
      instruction.textContent = `${currentPlayerName}'s turn…`;
      instruction.classList.remove('your-turn');
    }

    this._buildBoard(isMyTurn);
    this._renderGamePlayers(st);
  }

  _buildBoard(isMyTurn) {
    const board = document.getElementById('bingo-board');
    if (!this.myKit) { board.innerHTML = ''; return; }

    const calledSet = new Set(this.publicState?.calledNumbers || []);
    board.innerHTML = '';

    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const num = this.myKit[r][c];
        const isMarked = calledSet.has(num);
        const cell = document.createElement('div');
        cell.className = 'cell' + (isMarked ? ' marked' : isMyTurn ? '' : ' disabled');
        cell.textContent = num;
        cell.dataset.num = num;
        if (!isMarked && isMyTurn) {
          cell.addEventListener('click', () => this._onCellClick(num));
        }
        board.appendChild(cell);
      }
    }
  }

  _onCellClick(num) {
    const st = this.publicState;
    if (!st || st.phase !== 'game') return;
    if ((st.calledNumbers || []).includes(num)) {
      this.showToast('Already called.');
      return;
    }
    this.sendAction({ action: 'commit', number: num });
    const instruction = document.getElementById('instruction');
    instruction.textContent = `Calling ${num}… please wait`;
    instruction.classList.remove('your-turn');
  }

  _renderGamePlayers(st) {
    const ul = document.getElementById('game-player-list');
    ul.innerHTML = '';
    st.players.forEach((p, i) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'turn-dot';
      li.appendChild(dot);
      li.appendChild(document.createTextNode(
        p.name + (p.score > 0 ? ` (${p.score}/5)` : '')
      ));
      if (i === st.turnIndex) li.classList.add('active-turn');
      ul.appendChild(li);
    });
  }

  _showGameOver() {
    const st = this.publicState;
    const isWinner = st.winner?.id === selfId;
    const el = document.getElementById('winner-text');
    el.textContent = isWinner ? 'You Win! 🎉' : `Winner: ${st.winner?.name || 'Unknown'}`;
    el.style.color = isWinner ? 'var(--accent)' : 'var(--blue)';
  }

  // ── Session persistence ───────────────────────────────────────────────

  saveSession() {
    if (!this.roomCode) return;
    try {
      sessionStorage.setItem('bingo-session', JSON.stringify({
        roomCode: this.roomCode,
        playerName: this.myName,
        isHost: this.isHost,
      }));
    } catch (_) {}
  }

  clearSession() {
    sessionStorage.removeItem('bingo-session');
  }

  // ── UI bindings ───────────────────────────────────────────────────────

  bindUI() {
    const $ = id => document.getElementById(id);

    $('role-host').addEventListener('change', () => this.updateRoleUI());
    $('role-join').addEventListener('change', () => this.updateRoleUI());
    $('role-host-label').addEventListener('click', () => { $('role-host').checked = true; this.updateRoleUI(); });
    $('role-join-label').addEventListener('click', () => { $('role-join').checked = true; this.updateRoleUI(); });

    $('continue-btn').addEventListener('click', () => {
      $('start-error').textContent = '';
      if ($('role-host').checked) {
        this.createGame();
      } else {
        this.joinGame();
      }
    });

    $('name-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('continue-btn').click(); });
    $('room-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('continue-btn').click(); });

    $('btn-copy').addEventListener('click', () => {
      const code = $('room-code-display').textContent;
      navigator.clipboard.writeText(code)
        .then(() => this.showToast('Room code copied!'))
        .catch(() => this.showToast('Code: ' + code));
    });

    $('start-btn').addEventListener('click', () => {
      if (!this.isHost) return;
      $('start-btn').disabled = true;
      this.startGame();
    });

    $('play-again-btn').addEventListener('click', () => this.playAgain());
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new BingoApp();

  try {
    const raw = sessionStorage.getItem('bingo-session');
    if (raw) {
      const { roomCode, playerName, isHost } = JSON.parse(raw);
      if (playerName) document.getElementById('name-input').value = playerName;
      if (!isHost && roomCode) {
        document.getElementById('room-input').value = roomCode;
        document.getElementById('role-join').checked = true;
        window.app.updateRoleUI();
        window.app.showToast(`Tap \"Continue\" to rejoin ${roomCode}`);
      }
    }
  } catch (_) {
    sessionStorage.removeItem('bingo-session');
  }
});
