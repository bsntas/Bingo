(() => {
  // ── State ────────────────────────────────────────────────────
  let ws = null;
  let myName = '';
  let isHost = false;
  let currentTurn = '';
  let kit = null;           // int[5][5]
  let markedNumbers = new Set();
  let myScore = 0;
  let players = [];         // [{name, isHost}]
  let gameStarted = false;
  let toastTimer = null;

  // ── DOM refs ─────────────────────────────────────────────────
  const screens = {
    start:    document.getElementById('start-screen'),
    lobby:    document.getElementById('lobby-screen'),
    game:     document.getElementById('game-screen'),
    gameover: document.getElementById('gameover-screen'),
  };

  const nameInput       = document.getElementById('name-input');
  const roomInput       = document.getElementById('room-input');
  const roleHostLabel   = document.getElementById('role-host-label');
  const roleJoinLabel   = document.getElementById('role-join-label');
  const roleHostRadio   = document.getElementById('role-host');
  const roleJoinRadio   = document.getElementById('role-join');
  const roomInputGroup  = document.getElementById('room-input-group');
  const continueBtn     = document.getElementById('continue-btn');
  const startError      = document.getElementById('start-error');

  const roomCodeBox     = document.getElementById('room-code-box');
  const roomCodeDisplay = document.getElementById('room-code-display');
  const lobbyPlayerList = document.getElementById('lobby-player-list');
  const playerCount     = document.getElementById('player-count');
  const startBtn        = document.getElementById('start-btn');
  const lobbyStatus     = document.getElementById('lobby-status');

  const bingoLetters    = [0,1,2,3,4].map(i => document.getElementById(`bl-${i}`));
  const bingoBoard      = document.getElementById('bingo-board');
  const instruction     = document.getElementById('instruction');
  const gamePlayerList  = document.getElementById('game-player-list');

  const winnerText      = document.getElementById('winner-text');
  const playAgainBtn    = document.getElementById('play-again-btn');
  const toast           = document.getElementById('toast');

  // ── Screen switching ─────────────────────────────────────────
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // ── Toast ────────────────────────────────────────────────────
  function showToast(msg) {
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.classList.add('visible');
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
  }

  // ── Role selection ───────────────────────────────────────────
  function updateRoleUI() {
    const host = roleHostRadio.checked;
    roleHostLabel.classList.toggle('selected', host);
    roleJoinLabel.classList.toggle('selected', !host);
    roomInputGroup.style.display = host ? 'none' : '';
  }
  roleHostRadio.addEventListener('change', updateRoleUI);
  roleJoinRadio.addEventListener('change', updateRoleUI);
  roleHostLabel.addEventListener('click', () => { roleHostRadio.checked = true; updateRoleUI(); });
  roleJoinLabel.addEventListener('click', () => { roleJoinRadio.checked = true; updateRoleUI(); });

  // ── WebSocket connection ──────────────────────────────────────
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.addEventListener('open', onOpen);
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', () => showToast('Connection error.'));
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function onOpen() {
    startError.textContent = '';
    const name = nameInput.value.trim();
    const role = roleHostRadio.checked ? 'host' : 'join';
    myName = name;
    isHost = role === 'host';

    if (isHost) {
      send({ type: 'HOST', name });
    } else {
      const room = roomInput.value.trim().toUpperCase();
      send({ type: 'JOIN', name, room });
    }
  }

  function onClose() {
    if (gameStarted) {
      showToast('Connection lost.');
    }
    ws = null;
  }

  // ── Message handler ───────────────────────────────────────────
  function onMessage(event) {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {
      case 'ROOM_CREATED':
        roomCodeBox.style.display = '';
        roomCodeDisplay.textContent = msg.room;
        showScreen('lobby');
        startBtn.disabled = true;
        if (isHost) {
          startBtn.disabled = false;
          startBtn.style.display = '';
        } else {
          startBtn.style.display = 'none';
        }
        break;

      case 'ALL_PLAYERS':
        players = msg.players.map(p => ({ name: p.name, isHost: p.isHost }));
        renderLobbyPlayers();
        if (!isHost) {
          roomCodeBox.style.display = 'none';
          startBtn.style.display = 'none';
          showScreen('lobby');
        }
        break;

      case 'ADD_PLAYER': {
        const exists = players.some(p => p.name === msg.name);
        if (!exists) players.push({ name: msg.name, isHost: false });
        renderLobbyPlayers();
        break;
      }

      case 'REMOVE_PLAYER':
        players = players.filter(p => p.name !== msg.name);
        renderLobbyPlayers();
        renderGamePlayers();
        break;

      case 'KIT':
        kit = msg.kit;
        markedNumbers = new Set();
        myScore = 0;
        break;

      case 'GAME_STARTED':
        gameStarted = true;
        currentTurn = msg.turn;
        buildBoard();
        renderGamePlayers();
        updateInstruction();
        updateBingoScore(0);
        showScreen('game');
        break;

      case 'COMMIT':
        markNumber(msg.number);
        break;

      case 'SCORE_UPDATE':
        myScore = msg.score;
        updateBingoScore(myScore);
        break;

      case 'TURN':
        currentTurn = msg.name;
        renderGamePlayers();
        updateInstruction();
        enableBoard(currentTurn === myName);
        break;

      case 'GAME_OVER':
        showGameOver(msg.winner);
        break;

      case 'ALERT':
        showToast(msg.message);
        if (!gameStarted) startError.textContent = msg.message;
        continueBtn.disabled = false;
        break;

      case 'EXIT':
        showToast('Host closed the server.');
        resetToStart();
        break;
    }
  }

  // ── Lobby rendering ───────────────────────────────────────────
  function renderLobbyPlayers() {
    lobbyPlayerList.innerHTML = '';
    playerCount.textContent = players.length;
    players.forEach(p => {
      const li = document.createElement('li');
      li.textContent = p.name;
      if (p.isHost) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'host';
        li.appendChild(badge);
      }
      lobbyPlayerList.appendChild(li);
    });

    if (isHost) {
      startBtn.disabled = players.length < 2;
      lobbyStatus.textContent = players.length < 2
        ? 'Waiting for at least one more player…'
        : 'Ready to start!';
    } else {
      lobbyStatus.textContent = 'Waiting for host to start the game…';
    }
  }

  // ── Board building ────────────────────────────────────────────
  function buildBoard() {
    bingoBoard.innerHTML = '';
    if (!kit) return;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const num = kit[r][c];
        const cell = document.createElement('div');
        cell.className = 'cell disabled';
        cell.textContent = num;
        cell.dataset.num = num;
        cell.addEventListener('click', onCellClick);
        bingoBoard.appendChild(cell);
      }
    }
    enableBoard(currentTurn === myName);
  }

  function enableBoard(myTurn) {
    document.querySelectorAll('.cell').forEach(cell => {
      if (cell.classList.contains('marked')) return;
      cell.classList.toggle('disabled', !myTurn);
    });
  }

  function onCellClick(e) {
    const cell = e.currentTarget;
    if (cell.classList.contains('marked') || cell.classList.contains('disabled')) return;
    if (currentTurn !== myName) {
      showToast("It's not your turn.");
      return;
    }
    const num = parseInt(cell.dataset.num, 10);
    send({ type: 'COMMIT', number: num });
    instruction.textContent = `Calling ${num}… please wait`;
    instruction.classList.remove('your-turn');
  }

  function markNumber(num) {
    markedNumbers.add(num);
    document.querySelectorAll('.cell').forEach(cell => {
      if (parseInt(cell.dataset.num, 10) === num) {
        cell.classList.add('marked');
        cell.classList.remove('disabled');
      }
    });
  }

  // ── BINGO score display ───────────────────────────────────────
  function updateBingoScore(score) {
    const capped = Math.min(score, 5);
    bingoLetters.forEach((el, i) => {
      el.classList.toggle('scored', i < capped);
    });
  }

  // ── Instruction bar ───────────────────────────────────────────
  function updateInstruction() {
    if (currentTurn === myName) {
      instruction.textContent = 'Your turn — click a number to call it!';
      instruction.classList.add('your-turn');
    } else {
      instruction.textContent = `${currentTurn}'s turn…`;
      instruction.classList.remove('your-turn');
    }
  }

  // ── Game player list ──────────────────────────────────────────
  function renderGamePlayers() {
    gamePlayerList.innerHTML = '';
    players.forEach(p => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'turn-dot';
      li.appendChild(dot);
      li.appendChild(document.createTextNode(p.name));
      if (p.name === currentTurn) li.classList.add('active-turn');
      gamePlayerList.appendChild(li);
    });
  }

  // ── Game over ─────────────────────────────────────────────────
  function showGameOver(winner) {
    gameStarted = false;
    if (winner === myName) {
      winnerText.textContent = 'You Win! 🎉';
      winnerText.style.color = 'var(--accent)';
    } else {
      winnerText.textContent = `Winner: ${winner}`;
      winnerText.style.color = 'var(--blue)';
    }
    showScreen('gameover');
  }

  // ── Play again / reset ────────────────────────────────────────
  function resetToStart() {
    if (ws) {
      send({ type: 'WITHDRAW' });
      ws.close();
      ws = null;
    }
    players = [];
    kit = null;
    markedNumbers = new Set();
    myScore = 0;
    gameStarted = false;
    currentTurn = '';
    isHost = false;
    startError.textContent = '';
    continueBtn.disabled = false;
    lobbyPlayerList.innerHTML = '';
    gamePlayerList.innerHTML = '';
    bingoBoard.innerHTML = '';
    updateBingoScore(0);
    showScreen('start');
  }

  playAgainBtn.addEventListener('click', resetToStart);

  // ── Start / Continue button ───────────────────────────────────
  continueBtn.addEventListener('click', () => {
    startError.textContent = '';
    const name = nameInput.value.trim();
    if (!name) { startError.textContent = 'Please enter your name.'; return; }
    if (roleJoinRadio.checked && !roomInput.value.trim()) {
      startError.textContent = 'Please enter a room code.';
      return;
    }
    continueBtn.disabled = true;
    connect();
  });

  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') continueBtn.click(); });
  roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') continueBtn.click(); });

  // ── Start game button ─────────────────────────────────────────
  startBtn.addEventListener('click', () => {
    if (players.length < 2) { showToast('Need at least 2 players.'); return; }
    send({ type: 'START' });
    startBtn.disabled = true;
  });

})();
