# Bingo — Multiplayer

A real-time multiplayer Bingo game with two ways to play: directly in the browser with no install, or as a classic Java desktop app over a local network.

**Play in browser:** [bsntas.github.io/Bingo](https://bsntas.github.io/Bingo)

---

## Web version

### Features

- **2–5 players** over a peer-to-peer connection — no server, no accounts, no install
- **Configurable grid** — 5×5 up to 15×15 (set by the host before starting)
- Works on **mobile and desktop** — responsive, touch-friendly layout
- **No backend** — pure static site served from GitHub Pages
- **Reconnect** — players who background the tab and return within 45 seconds are restored seamlessly to their seat
- Win by completing **5 lines** (rows or columns)

### How to play

1. Open the game in a browser.
2. Enter your name and choose **Host a game** — you'll get a 4-character room code.
3. Share the code with friends. They enter the code, choose **Join a game**, and tap **Continue**.
4. Once 2–5 players have joined, the host taps **Start Game**.
5. Players take turns — on your turn, tap a number from your board to call it for everyone.
6. The number is automatically marked on every player's board.
7. First player to complete **5 lines** wins!

### Architecture

The web game is a **zero-backend static site** served from the `docs/` folder on GitHub Pages.

```
docs/
├── index.html   App shell + all screen markup (start / lobby / game / game-over)
└── game.js      BingoApp class — P2P networking, game engine, rendering
```

Multiplayer is powered by [Trystero](https://github.com/dmotz/trystero) with the MQTT strategy. Peers discover each other via HiveMQ's public MQTT broker (`wss://broker.hivemq.com:8884/mqtt`) and communicate directly over WebRTC data channels. No signalling server is owned or operated.

**Host-authoritative model:** the host tab runs the full game state and broadcasts it to all peers on every action. Guests send actions (`commit`) to the host which validates and rebroadcasts them.

### Self-hosted server version

A Node.js / WebSocket server version lives in `web/` for anyone who wants to self-host.

```bash
cd web
npm install
npm start        # runs on http://localhost:3000
```

---

## Java version (LAN)

The original Bingo — a desktop multiplayer game for local networks, built in Java.

### Requirements

Java 8.0 or higher.

### How to run

1. `cd` into the `Bingo-Binary` folder.
2. Make the script executable: `chmod +x bingo.sh`
3. Run: `./bingo.sh`
4. The **first player** (the host) selects "Host the game myself" and waits on the player list screen. Do not press **Start Game** until everyone has joined.
5. All other players select "Connect to remote host", enter the host's IP address, and press **Continue**.
6. Once all players have joined, the host presses **Start Game**.

---

## License

You are free to use the code. In reports / write-ups please mention this repository as a reference.
