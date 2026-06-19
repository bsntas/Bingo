(() => {
  const db = firebase.database();

  // ── State ─────────────────────────────────────────────────────
  let myName       = '';
  let myRoomCode   = '';
  let myIsHost     = false;
  let myKit        = null;   // int[5][5]
  let seenNums     = new Set();  // numbers already processed locally
  let myScore      = 0;
  let playerOrder  = [];    // ordered list of names (join order)
  let activePlayers = {};   // { safeKey: {name, isHost, score, kit} }
  let currentTurn  = '';
  let gameStarted  = false;
  let gameOver     = false;
  let roomRef      = null;
  let toastTimer   = null;

  // ── DOM ───────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const screens     = { start: $('start-screen'), lobby: $('lobby-screen'), game: $('game-screen'), gameover: $('gameover-screen') };
  const nameInput   = $('name-input');
  const roomInput   = $('room-input');
  const lblHost     = $('lbl-host');
  const lblJoin     = $('lbl-join');
  const radioHost   = $('radio-host');
  const radioJoin   = $('radio-join');
  const roomWrap    = $('room-input-wrap');
  const continueBtn = $('continue-btn');
  const startError  = $('start-error');
  const roomCodeBox = $('room-code-box');
  const roomCodeTxt = $('room-code-text');
  const lobbyList   = $('lobby-player-list');
  const playerCount = $('player-count');
  const startBtn    = $('start-btn');
  const lobbyStatus = $('lobby-status');
  const bingoLetters = [0,1,2,3,4].map(i => $(`bl-${i}`));
  const board       = $('bingo-board');
  const instruction = $('instruction');
  const gameList    = $('game-player-list');
  const winnerText  = $('winner-text');
  const playAgainBtn = $('play-again-btn');
  const toastEl     = $('toast');

  // ── Utilities ─────────────────────────────────────────────────

  // Firebase keys cannot contain . $ # [ ] /
  function safeKey(name) {
    return name.replace(/[.$#[\]/]/g, '_');
  }

  function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  function generateKit() {
    const nums = Array.from({ length: 25 }, (_, i) => i + 1);
    for (let i = 24; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nums[i], nums[j]] = [nums[j], nums[i]];
    }
    const kit = [];
    for (let i = 0; i < 5; i++) kit.push(nums.slice(i * 5, i * 5 + 5));
    return kit;
  }

  // Count completed rows + columns. Win at 5.
  function calcScore(kit, marked) {
    let s = 0;
    for (let r = 0; r < 5; r++) if (kit[r].every(n => marked.has(n))) s++;
    for (let c = 0; c < 5; c++) if (kit.every(row => marked.has(row[c]))) s++;
    return s;
  }

  // ── UI helpers ────────────────────────────────────────────────

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
    document.body.classList.toggle('in-game', name === 'game');
  }

  function showToast(msg) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
  }

  function showError(msg) {
    startError.textContent = msg;
    continueBtn.disabled = false;
  }

  // ── Session persistence (survive mobile tab kills) ────────────

  function saveSession() {
    if (!myRoomCode || !myName || !myKit) return;
    try {
      localStorage.setItem('bingo_session', JSON.stringify({
        name: myName, roomCode: myRoomCode, isHost: myIsHost,
        kit: myKit, ts: Date.now()
      }));
    } catch (e) {}
  }

  function clearSession() {
    try { localStorage.removeItem('bingo_session'); } catch (e) {}
  }

  async function tryRestore() {
    let saved;
    try {
      const raw = localStorage.getItem('bingo_session');
      if (!raw) return false;
      saved = JSON.parse(raw);
    } catch (e) { return false; }

    if (!saved || Date.now() - saved.ts > 4 * 60 * 60 * 1000) {
      clearSession(); return false;
    }

    const { name, roomCode, isHost, kit } = saved;
    let snap;
    try { snap = await db.ref(`rooms/${roomCode}`).once('value'); }
    catch (e) { return false; }

    if (!snap.exists()) { clearSession(); return false; }

    const room = snap.val();
    if (room.winner) { clearSession(); return false; }

    myName = name; myRoomCode = roomCode; myIsHost = isHost; myKit = kit;

    const playerKey = safeKey(name);
    if (!room.players?.[playerKey]) {
      await db.ref(`rooms/${roomCode}/players/${playerKey}`).set({
        name, isHost, score: 0,
        kit: room.started && kit ? JSON.stringify(kit) : ''
      });
    }
    db.ref(`rooms/${roomCode}/players/${playerKey}`).onDisconnect().remove();

    if (isHost) {
      roomCodeBox.style.display = '';
      roomCodeTxt.textContent = roomCode;
      startBtn.style.display = '';
      startBtn.disabled = !!room.started;
    }

    attachRoomListener(roomCode);
    if (!room.started) showScreen('lobby');
    return true;
  }

  // ── Role toggle ───────────────────────────────────────────────

  function syncRoleUI() {
    const host = radioHost.checked;
    lblHost.classList.toggle('selected', host);
    lblJoin.classList.toggle('selected', !host);
    roomWrap.style.display = host ? 'none' : '';
  }
  radioHost.addEventListener('change', syncRoleUI);
  radioJoin.addEventListener('change', syncRoleUI);
  lblHost.addEventListener('click', () => { radioHost.checked = true; syncRoleUI(); });
  lblJoin.addEventListener('click', () => { radioJoin.checked = true; syncRoleUI(); });

  // ── Host game ─────────────────────────────────────────────────

  async function hostGame(name) {
    continueBtn.disabled = true;
    let code, snap;
    let tries = 0;
    do {
      code = generateRoomCode();
      snap = await db.ref(`rooms/${code}`).once('value');
      tries++;
    } while (snap.exists() && tries < 20);

    myName = name;
    myRoomCode = code;
    myIsHost = true;

    await db.ref(`rooms/${code}`).set({
      host: name,
      started: false,
      turn: '',
      winner: '',
      playerOrder: name,
      players: { [safeKey(name)]: { name, isHost: true, score: 0, kit: '' } }
    });

    // Remove host's player record on disconnect (full room cleanup is handled by reset())
    db.ref(`rooms/${code}/players/${safeKey(name)}`).onDisconnect().remove();

    attachRoomListener(code);
    roomCodeBox.style.display = '';
    roomCodeTxt.textContent = code;
    startBtn.style.display = '';
    startBtn.disabled = true;
    showScreen('lobby');
  }

  // ── Join game ──────────────────────────────────────────────────

  async function joinGame(name, code) {
    continueBtn.disabled = true;
    const snap = await db.ref(`rooms/${code}`).once('value');

    if (!snap.exists()) { showError('Room not found. Check the code.'); return; }

    const room = snap.val();
    if (room.started) { showError('Game already started in this room.'); return; }
    if (room.winner)  { showError('That game is already over.'); return; }

    const players = room.players || {};
    if (Object.keys(players).length >= 5) { showError('Room is full (max 5 players).'); return; }
    if (Object.values(players).some(p => p.name === name)) { showError('That name is already taken.'); return; }

    myName = name;
    myRoomCode = code;
    myIsHost = false;

    // Atomically append name to the ordered list
    await db.ref(`rooms/${code}/playerOrder`).transaction(current => {
      if (!current) return name;
      return `${current},${name}`;
    });

    await db.ref(`rooms/${code}/players/${safeKey(name)}`).set({ name, isHost: false, score: 0, kit: '' });
    db.ref(`rooms/${code}/players/${safeKey(name)}`).onDisconnect().remove();

    attachRoomListener(code);
    showScreen('lobby');
  }

  // ── Start game (host only) ────────────────────────────────────

  async function startGame() {
    startBtn.disabled = true;
    const snap = await db.ref(`rooms/${myRoomCode}`).once('value');
    const room = snap.val();
    const players = room.players || {};
    const activeNames = Object.values(players).map(p => p.name);

    if (activeNames.length < 2) {
      showToast('Need at least 2 players.');
      startBtn.disabled = false;
      return;
    }

    // Preserve join order, keep only currently active players
    const order = (room.playerOrder || '').split(',').filter(n => activeNames.includes(n));

    const updates = { started: true, turn: order[0], playerOrder: order.join(',') };

    // Host generates and assigns every player's bingo card
    activeNames.forEach(n => {
      updates[`players/${safeKey(n)}/kit`] = JSON.stringify(generateKit());
    });

    await db.ref(`rooms/${myRoomCode}`).update(updates);
  }

  // ── Call a number ─────────────────────────────────────────────

  async function callNumber(num) {
    if (gameOver || !gameStarted || currentTurn !== myName) {
      showToast("It's not your turn.");
      return;
    }

    const snap = await db.ref(`rooms/${myRoomCode}/calledNumbers/${num}`).once('value');
    if (snap.exists()) { showToast('Number already called.'); return; }

    // Advance turn to next active player
    const activeOrder = playerOrder.filter(n => activePlayers[safeKey(n)]);
    const idx = activeOrder.indexOf(myName);
    const nextTurn = activeOrder[(idx + 1) % activeOrder.length];

    instruction.textContent = `Calling ${num}…`;
    instruction.classList.remove('my-turn');

    await db.ref(`rooms/${myRoomCode}`).update({
      [`calledNumbers/${num}`]: true,
      turn: nextTurn
    });
  }

  // ── Firebase room listener ────────────────────────────────────

  function attachRoomListener(code) {
    roomRef = db.ref(`rooms/${code}`);
    roomRef.on('value', snap => {
      if (!snap.exists()) return;
      const room = snap.val();

      activePlayers = room.players || {};
      playerOrder   = (room.playerOrder || '').split(',').filter(Boolean);

      renderLobbyPlayers();

      if (room.winner && !gameOver) {
        gameOver = true;
        showGameOver(room.winner);
        return;
      }

      if (!gameStarted && room.started) {
        gameStarted  = true;
        currentTurn  = room.turn;
        seenNums     = new Set();
        myScore      = 0;

        const me = activePlayers[safeKey(myName)];
        myKit = me?.kit ? JSON.parse(me.kit) : null;
        saveSession();

        buildBoard();
        renderGamePlayers();
        updateScore(0);
        updateInstruction();
        showScreen('game');
      }

      if (gameStarted && !gameOver) {
        // Process any numbers called since last snapshot
        const serverNums = Object.keys(room.calledNumbers || {}).map(Number);
        const fresh = serverNums.filter(n => !seenNums.has(n));
        fresh.forEach(n => {
          seenNums.add(n);
          markCell(n);
        });

        if (fresh.length > 0 && myKit) {
          const newScore = calcScore(myKit, seenNums);
          if (newScore !== myScore) {
            myScore = newScore;
            updateScore(myScore);
          }
          // Claim win via transaction so only the first writer wins
          if (myScore >= 5) {
            db.ref(`rooms/${code}/winner`).transaction(current => {
              if (current === null || current === '') return myName;
              return undefined; // abort — someone already claimed it
            });
          }
        }

        // Always sync turn state on every snapshot — handles reconnects
        // and window/tab switches where Firebase re-fires the listener
        currentTurn = room.turn || currentTurn;
        renderGamePlayers();
        updateInstruction();
        setBoardEnabled(currentTurn === myName);
      }

      // Update start button state for host
      if (myIsHost && !room.started) {
        startBtn.disabled = Object.keys(activePlayers).length < 2;
        lobbyStatus.textContent = Object.keys(activePlayers).length < 2
          ? 'Waiting for at least one more player…'
          : 'Ready — you can start the game!';
      }
    });
  }

  // ── Render helpers ────────────────────────────────────────────

  function renderLobbyPlayers() {
    const list = Object.values(activePlayers);
    playerCount.textContent = list.length;
    lobbyList.innerHTML = '';
    playerOrder.forEach(name => {
      const p = activePlayers[safeKey(name)];
      if (!p) return;
      const li = document.createElement('li');
      li.textContent = p.name;
      if (p.isHost) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'host';
        li.appendChild(badge);
      }
      lobbyList.appendChild(li);
    });

    if (!myIsHost) {
      lobbyStatus.textContent = 'Waiting for host to start the game…';
    }
  }

  function buildBoard() {
    board.innerHTML = '';
    if (!myKit) return;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const num = myKit[r][c];
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.textContent = num;
        cell.dataset.num = num;
        cell.addEventListener('click', () => callNumber(num));
        board.appendChild(cell);
      }
    }
    setBoardEnabled(currentTurn === myName);
  }

  function setBoardEnabled(enabled) {
    board.classList.toggle('active', enabled);
  }

  function markCell(num) {
    board.querySelectorAll('.cell').forEach(c => {
      if (parseInt(c.dataset.num, 10) === num) {
        c.classList.add('marked');
      }
    });
  }

  function updateScore(score) {
    const n = Math.min(score, 5);
    bingoLetters.forEach((el, i) => el.classList.toggle('scored', i < n));
  }

  function updateInstruction() {
    if (currentTurn === myName) {
      instruction.textContent = 'Your turn — tap a number!';
      instruction.classList.add('my-turn');
    } else {
      instruction.textContent = `${currentTurn}'s turn…`;
      instruction.classList.remove('my-turn');
    }
  }

  function renderGamePlayers() {
    gameList.innerHTML = '';
    playerOrder.forEach(name => {
      if (!activePlayers[safeKey(name)]) return;
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'turn-dot';
      li.appendChild(dot);
      li.appendChild(document.createTextNode(name));
      if (name === currentTurn) li.classList.add('active-turn');
      gameList.appendChild(li);
    });
  }

  function showGameOver(winner) {
    clearSession();
    if (winner === myName) {
      winnerText.textContent = 'You Win! 🎉';
      winnerText.style.color = 'var(--accent)';
    } else {
      winnerText.textContent = `Winner: ${winner}`;
      winnerText.style.color = 'var(--blue)';
    }
    buildGameoverBoard();
    showScreen('gameover');
  }

  function buildGameoverBoard() {
    const wrap = document.getElementById('gameover-board-wrap');
    const boardEl = document.getElementById('gameover-board');
    boardEl.innerHTML = '';
    if (!myKit) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const num = myKit[r][c];
        const cell = document.createElement('div');
        cell.className = 'preview-cell' + (seenNums.has(num) ? ' marked' : '');
        cell.textContent = num;
        boardEl.appendChild(cell);
      }
    }
  }

  // ── Reset ──────────────────────────────────────────────────────

  function reset() {
    clearSession();
    if (roomRef) { roomRef.off(); roomRef = null; }

    // Clean up Firebase so stale rooms don't affect future games
    if (myRoomCode && myName) {
      if (myIsHost) {
        db.ref(`rooms/${myRoomCode}`).remove();  // host leaving = end the room
      } else {
        db.ref(`rooms/${myRoomCode}/players/${safeKey(myName)}`).remove();
      }
    }

    myName = ''; myRoomCode = ''; myIsHost = false;
    myKit = null; seenNums = new Set(); myScore = 0;
    playerOrder = []; activePlayers = {}; currentTurn = '';
    gameStarted = false; gameOver = false;
    startError.textContent = '';
    continueBtn.disabled = false;
    startBtn.style.display = 'none';
    roomCodeBox.style.display = 'none';
    lobbyList.innerHTML = '';
    gameList.innerHTML = '';
    board.innerHTML = '';
    document.getElementById('gameover-board').innerHTML = '';
    updateScore(0);
    showScreen('start');
  }

  // ── Event wiring ───────────────────────────────────────────────

  continueBtn.addEventListener('click', async () => {
    startError.textContent = '';
    const name = nameInput.value.trim();
    if (!name) { showError('Please enter your name.'); return; }

    if (radioHost.checked) {
      await hostGame(name);
    } else {
      const code = roomInput.value.trim().toUpperCase();
      if (!code) { showError('Please enter a room code.'); return; }
      await joinGame(name, code);
    }
  });

  startBtn.addEventListener('click', startGame);
  playAgainBtn.addEventListener('click', reset);

  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') continueBtn.click(); });
  roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') continueBtn.click(); });

  // ── Auto-restore session on page load ─────────────────────────
  tryRestore();

})();
