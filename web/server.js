const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Generate a 5x5 bingo card with numbers 1-25, all unique, in random positions
function generateKit() {
  const numbers = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  const kit = [];
  for (let i = 0; i < 5; i++) {
    kit.push(numbers.slice(i * 5, i * 5 + 5));
  }
  return kit;
}

// Score = number of complete patterns (rows + columns + diagonals). Win at score >= 5.
function calculateScore(kit, markedNumbers) {
  let score = 0;
  for (let r = 0; r < 5; r++) {
    if (kit[r].every(n => markedNumbers.has(n))) score++;
  }
  for (let c = 0; c < 5; c++) {
    if (kit.every(row => markedNumbers.has(row[c]))) score++;
  }
  if (kit.every((row, i) => markedNumbers.has(row[i]))) score++;
  if (kit.every((row, i) => markedNumbers.has(row[4 - i]))) score++;
  return score;
}

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(room, message) {
  const msg = JSON.stringify(message);
  room.players.forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(msg);
  });
}

function handlePlayerLeave(ws, playerState) {
  if (!playerState.roomCode) return;
  const room = rooms.get(playerState.roomCode);
  if (!room) return;

  const idx = room.players.findIndex(p => p.ws === ws);
  if (idx === -1) return;

  const [removed] = room.players.splice(idx, 1);
  playerState.roomCode = null;

  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }

  broadcast(room, { type: 'REMOVE_PLAYER', name: removed.name });

  if (room.started) {
    if (room.players.length < 2) {
      broadcast(room, { type: 'GAME_OVER', winner: room.players[0]?.name });
      rooms.delete(room.code);
      return;
    }
    if (idx < room.turn) {
      room.turn--;
    } else if (idx === room.turn) {
      room.turn = room.turn % room.players.length;
      broadcast(room, { type: 'TURN', name: room.players[room.turn].name });
    }
  }
}

wss.on('connection', (ws) => {
  const playerState = { roomCode: null };

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {
      case 'HOST': {
        const name = (msg.name || '').trim();
        if (!name) { send(ws, { type: 'ALERT', message: 'Please enter your name.' }); return; }
        if (playerState.roomCode) { send(ws, { type: 'ALERT', message: 'You are already in a room.' }); return; }

        let roomCode;
        let attempts = 0;
        do { roomCode = generateRoomCode(); attempts++; } while (rooms.has(roomCode) && attempts < 200);

        const player = { ws, name, isHost: true, kit: null, markedNumbers: new Set(), score: 0 };
        const room = { code: roomCode, players: [player], started: false, turn: 0, calledNumbers: new Set() };
        rooms.set(roomCode, room);
        playerState.roomCode = roomCode;

        send(ws, { type: 'ROOM_CREATED', room: roomCode });
        send(ws, { type: 'ALL_PLAYERS', players: [{ name, isHost: true }] });
        break;
      }

      case 'JOIN': {
        const name = (msg.name || '').trim();
        const roomCode = (msg.room || '').trim().toUpperCase();

        if (!name) { send(ws, { type: 'ALERT', message: 'Please enter your name.' }); return; }
        if (!roomCode) { send(ws, { type: 'ALERT', message: 'Please enter a room code.' }); return; }
        if (playerState.roomCode) { send(ws, { type: 'ALERT', message: 'You are already in a room.' }); return; }

        const room = rooms.get(roomCode);
        if (!room) { send(ws, { type: 'ALERT', message: 'Room not found. Check the code and try again.' }); return; }
        if (room.started) { send(ws, { type: 'ALERT', message: 'Game already started in this room.' }); return; }
        if (room.players.length >= 5) { send(ws, { type: 'ALERT', message: 'Room is full (max 5 players).' }); return; }
        if (room.players.some(p => p.name === name)) { send(ws, { type: 'ALERT', message: 'That name is already taken in this room.' }); return; }

        // Send current player list to new joiner before adding them
        send(ws, { type: 'ALL_PLAYERS', players: room.players.map(p => ({ name: p.name, isHost: p.isHost })) });

        const player = { ws, name, isHost: false, kit: null, markedNumbers: new Set(), score: 0 };
        room.players.push(player);
        playerState.roomCode = roomCode;

        // Notify everyone (including the new joiner) about the new player
        broadcast(room, { type: 'ADD_PLAYER', name });
        break;
      }

      case 'START': {
        if (!playerState.roomCode) return;
        const room = rooms.get(playerState.roomCode);
        if (!room) return;

        const player = room.players.find(p => p.ws === ws);
        if (!player?.isHost) { send(ws, { type: 'ALERT', message: 'Only the host can start the game.' }); return; }
        if (room.players.length < 2) { send(ws, { type: 'ALERT', message: 'Need at least 2 players to start.' }); return; }
        if (room.started) { send(ws, { type: 'ALERT', message: 'Game already started.' }); return; }

        room.started = true;
        room.turn = 0;
        room.calledNumbers = new Set();

        room.players.forEach(p => {
          p.kit = generateKit();
          p.markedNumbers = new Set();
          p.score = 0;
          send(p.ws, { type: 'KIT', kit: p.kit });
        });

        broadcast(room, { type: 'GAME_STARTED', turn: room.players[0].name });
        break;
      }

      case 'COMMIT': {
        if (!playerState.roomCode) return;
        const room = rooms.get(playerState.roomCode);
        if (!room || !room.started) return;

        const currentPlayer = room.players[room.turn];
        if (!currentPlayer || currentPlayer.ws !== ws) {
          send(ws, { type: 'ALERT', message: "It's not your turn." });
          return;
        }

        const number = msg.number;
        if (!Number.isInteger(number) || number < 1 || number > 25) return;
        if (room.calledNumbers.has(number)) {
          send(ws, { type: 'ALERT', message: 'That number was already called.' });
          return;
        }

        room.calledNumbers.add(number);
        broadcast(room, { type: 'COMMIT', number, by: currentPlayer.name });

        let winner = null;
        room.players.forEach(p => {
          if (!p.kit) return;
          p.markedNumbers.add(number);
          const newScore = calculateScore(p.kit, p.markedNumbers);
          if (newScore !== p.score) {
            p.score = newScore;
            send(p.ws, { type: 'SCORE_UPDATE', score: newScore });
          }
          if (p.score >= 5 && !winner) winner = p;
        });

        if (winner) {
          broadcast(room, { type: 'GAME_OVER', winner: winner.name });
          rooms.delete(room.code);
          return;
        }

        room.turn = (room.turn + 1) % room.players.length;
        broadcast(room, { type: 'TURN', name: room.players[room.turn].name });
        break;
      }

      case 'WITHDRAW': {
        handlePlayerLeave(ws, playerState);
        break;
      }
    }
  });

  ws.on('close', () => handlePlayerLeave(ws, playerState));
  ws.on('error', () => handlePlayerLeave(ws, playerState));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Bingo server running at http://localhost:${PORT}`);
});
