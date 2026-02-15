const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const PORT = 8000;
const COUNTDOWN_SECONDS = 15;
const TOTAL_LAPS = 3;

const MAP_W = 4000;
const MAP_H = 4000;

// Aumentado para tolerar a inércia da nova física
const MAX_SPEED_UNITS_PER_SEC = 4000; 
const MIN_LAP_MS = 8000; 
const CAR_R = 18;
const PICKUP_RESPAWN_MS = 5000;

const GAME_STATE = { WAITING: "WAITING", COUNTDOWN: "COUNTDOWN", RACING: "RACING" };

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// --- 10 PISTAS (Mantive as mesmas com obstáculos) ---
const TRACKS = [
  {
    id: 0,
    name: "Grande Prémio Real",
    path: [
      { cmd: "moveTo", x: 400, y: 400 },
      { cmd: "lineTo", x: 2000, y: 400 },
      { cmd: "bezierCurveTo", cp1x: 3500, cp1y: 400, cp2x: 3500, cp2y: 1500, x: 3000, y: 2000 },
      { cmd: "bezierCurveTo", cp1x: 2500, cp1y: 2500, cp2x: 3500, cp2y: 3500, x: 2000, y: 3600 },
      { cmd: "lineTo", x: 1000, y: 3600 },
      { cmd: "bezierCurveTo", cp1x: 200, cp1y: 3600, cp2x: 200, cp2y: 2000, x: 600, y: 2000 },
      { cmd: "bezierCurveTo", cp1x: 1000, cp1y: 2000, cp2x: 1000, cp2y: 1000, x: 400, y: 400 }
    ],
    checkpoints: [
      { x: 1200, y: 250, w: 100, h: 300 },
      { x: 3200, y: 1200, w: 300, h: 300 },
      { x: 2800, y: 2200, w: 300, h: 300 },
      { x: 2000, y: 3450, w: 300, h: 300 },
      { x: 1400, y: 3450, w: 100, h: 300 },
      { x: 300, y: 2000, w: 300, h: 300 },
      { x: 600, y: 1200, w: 300, h: 300 }
    ],
    finish: { x: 350, y: 250, w: 100, h: 300 },
    pickups: [
      { id: "p1", type: "boost", x: 1500, y: 400, r: 15 },
      { id: "p2", type: "slow", x: 3100, y: 1500, r: 15 },
      { id: "p3", type: "boost", x: 2000, y: 3600, r: 15 },
      { id: "p4", type: "boost", x: 800, y: 3600, r: 15 }
    ],
    obstacles: [
      { x: 1200, y: 350, r: 30 },
      { x: 3000, y: 1800, r: 40 },
      { x: 1500, y: 3700, r: 35 }
    ]
  },
  {
    id: 1,
    name: "Oval Superspeed",
    path: [
      { cmd: "moveTo", x: 600, y: 600 },
      { cmd: "lineTo", x: 3400, y: 600 },
      { cmd: "bezierCurveTo", cp1x: 3900, cp1y: 600, cp2x: 3900, cp2y: 3400, x: 3400, y: 3400 },
      { cmd: "lineTo", x: 600, y: 3400 },
      { cmd: "bezierCurveTo", cp1x: 100, cp1y: 3400, cp2x: 100, cp2y: 600, x: 600, y: 600 }
    ],
    checkpoints: [
      { x: 2000, y: 450, w: 100, h: 300 },
      { x: 3400, y: 600, w: 300, h: 300 },
      { x: 3600, y: 2000, w: 300, h: 300 },
      { x: 3400, y: 3250, w: 300, h: 300 },
      { x: 2000, y: 3250, w: 100, h: 300 },
      { x: 300, y: 3000, w: 300, h: 300 },
      { x: 100, y: 2000, w: 300, h: 300 }
    ],
    finish: { x: 550, y: 450, w: 100, h: 300 },
    pickups: [
      { id: "p1", type: "boost", x: 2000, y: 600, r: 15 },
      { id: "p2", type: "boost", x: 3600, y: 2000, r: 15 },
      { id: "p3", type: "boost", x: 2000, y: 3400, r: 15 },
      { id: "p4", type: "slow", x: 3000, y: 600, r: 15 }
    ],
    obstacles: [
      { x: 2000, y: 500, r: 25 },
      { x: 2000, y: 700, r: 25 },
      { x: 3800, y: 2000, r: 50 },
      { x: 2000, y: 3300, r: 25 },
      { x: 2000, y: 3500, r: 25 }
    ]
  },
  {
    id: 2,
    name: "Serpente Longa",
    path: [
      { cmd: "moveTo", x: 400, y: 3600 },
      { cmd: "lineTo", x: 400, y: 400 },
      { cmd: "lineTo", x: 1200, y: 400 },
      { cmd: "lineTo", x: 1200, y: 3000 },
      { cmd: "lineTo", x: 2000, y: 3000 },
      { cmd: "lineTo", x: 2000, y: 400 },
      { cmd: "lineTo", x: 2800, y: 400 },
      { cmd: "lineTo", x: 2800, y: 3000 },
      { cmd: "lineTo", x: 3600, y: 3000 },
      { cmd: "lineTo", x: 3600, y: 400 },
      { cmd: "bezierCurveTo", cp1x: 3900, cp1y: 400, cp2x: 3900, cp2y: 3600, x: 3600, y: 3600 },
      { cmd: "lineTo", x: 400, y: 3600 }
    ],
    checkpoints: [
      { x: 250, y: 2000, w: 300, h: 200 },
      { x: 600, y: 400, w: 300, h: 300 },
      { x: 1050, y: 1500, w: 300, h: 200 },
      { x: 1200, y: 2800, w: 300, h: 300 },
      { x: 1850, y: 1500, w: 300, h: 200 },
      { x: 2200, y: 400, w: 300, h: 300 },
      { x: 2650, y: 1500, w: 300, h: 200 },
      { x: 2800, y: 2800, w: 300, h: 300 },
      { x: 3450, y: 2000, w: 300, h: 200 },
      { x: 2000, y: 3450, w: 200, h: 300 }
    ],
    finish: { x: 300, y: 3450, w: 200, h: 300 },
    pickups: [
      { id: "p1", type: "boost", x: 400, y: 2000, r: 15 },
      { id: "p2", type: "boost", x: 2000, y: 2000, r: 15 },
      { id: "p3", type: "boost", x: 3600, y: 2000, r: 15 }
    ],
    obstacles: [
      { x: 400, y: 1500, r: 30 },
      { x: 1200, y: 2000, r: 30 },
      { x: 2000, y: 1500, r: 30 },
      { x: 2800, y: 2000, r: 30 },
      { x: 3600, y: 1500, r: 30 }
    ]
  },
  {
    id: 3,
    name: "O Oito Gigante",
    path: [
      { cmd: "moveTo", x: 2000, y: 2000 },
      { cmd: "bezierCurveTo", cp1x: 3000, cp1y: 3000, cp2x: 4000, cp2y: 1000, x: 2000, y: 500 },
      { cmd: "bezierCurveTo", cp1x: 1000, cp1y: 0, cp2x: 0, cp2y: 1000, x: 1000, y: 2000 },
      { cmd: "bezierCurveTo", cp1x: 2000, cp1y: 3000, cp2x: 3000, cp2y: 3000, x: 3500, y: 3500 },
      { cmd: "bezierCurveTo", cp1x: 4000, cp1y: 4000, cp2x: 1000, cp2y: 4000, x: 500, y: 3500 },
      { cmd: "bezierCurveTo", cp1x: 0, cp1y: 3000, cp2x: 1000, cp2y: 1000, x: 2000, y: 2000 }
    ],
    checkpoints: [
      { x: 2800, y: 1500, w: 300, h: 300 },
      { x: 2000, y: 500, w: 300, h: 300 },
      { x: 800, y: 1200, w: 300, h: 300 },
      { x: 2500, y: 3000, w: 300, h: 300 },
      { x: 3000, y: 3500, w: 300, h: 300 },
      { x: 2000, y: 3800, w: 300, h: 300 },
      { x: 800, y: 3200, w: 300, h: 300 }
    ],
    finish: { x: 1900, y: 1900, w: 200, h: 200 },
    pickups: [
      { id: "p1", type: "boost", x: 2000, y: 500, r: 15 },
      { id: "p2", type: "boost", x: 3500, y: 3500, r: 15 },
      { id: "p3", type: "boost", x: 500, y: 3500, r: 15 }
    ],
    obstacles: [
      { x: 2000, y: 2000, r: 50 },
      { x: 2800, y: 2800, r: 35 },
      { x: 1200, y: 1200, r: 35 }
    ]
  },
  {
    id: 4,
    name: "Maratona do Deserto",
    path: [
      { cmd: "moveTo", x: 200, y: 2000 },
      { cmd: "lineTo", x: 3800, y: 2000 },
      { cmd: "bezierCurveTo", cp1x: 4000, cp1y: 2000, cp2x: 4000, cp2y: 3800, x: 3800, y: 3800 },
      { cmd: "lineTo", x: 200, y: 3800 },
      { cmd: "bezierCurveTo", cp1x: 0, cp1y: 3800, cp2x: 0, cp2y: 200, x: 200, y: 200 },
      { cmd: "lineTo", x: 3800, y: 200 },
      { cmd: "bezierCurveTo", cp1x: 4000, cp1y: 200, cp2x: 4000, cp2y: 1800, x: 3800, y: 1800 },
      { cmd: "lineTo", x: 200, y: 1800 },
      { cmd: "lineTo", x: 200, y: 2000 }
    ],
    checkpoints: [
      { x: 1500, y: 1850, w: 200, h: 300 },
      { x: 3000, y: 1850, w: 200, h: 300 },
      { x: 3800, y: 3000, w: 300, h: 300 },
      { x: 2000, y: 3650, w: 200, h: 300 },
      { x: 100, y: 2000, w: 300, h: 300 },
      { x: 100, y: 1000, w: 300, h: 300 },
      { x: 2000, y: 50, w: 200, h: 300 },
      { x: 3800, y: 1000, w: 300, h: 300 }
    ],
    finish: { x: 200, y: 1850, w: 200, h: 300 },
    pickups: [
      { id: "p1", type: "boost", x: 2000, y: 2000, r: 15 },
      { id: "p2", type: "boost", x: 3800, y: 3800, r: 15 },
      { id: "p3", type: "boost", x: 2000, y: 3800, r: 15 },
      { id: "p4", type: "boost", x: 200, y: 200, r: 15 }
    ],
    obstacles: [
      { x: 2000, y: 2000, r: 40 },
      { x: 1000, y: 2000, r: 40 },
      { x: 3000, y: 2000, r: 40 },
      { x: 2000, y: 3800, r: 40 },
      { x: 2000, y: 200, r: 40 }
    ]
  },
  {
    id: 5,
    name: "Labirinto Extremo",
    path: [
      { cmd: "moveTo", x: 500, y: 500 },
      { cmd: "lineTo", x: 3500, y: 500 },
      { cmd: "lineTo", x: 3500, y: 1500 },
      { cmd: "lineTo", x: 1000, y: 1500 },
      { cmd: "lineTo", x: 1000, y: 2500 },
      { cmd: "lineTo", x: 3500, y: 2500 },
      { cmd: "lineTo", x: 3500, y: 3500 },
      { cmd: "lineTo", x: 500, y: 3500 },
      { cmd: "lineTo", x: 500, y: 500 }
    ],
    checkpoints: [
      { x: 2000, y: 350, w: 200, h: 300 },
      { x: 3350, y: 1000, w: 300, h: 200 },
      { x: 2000, y: 1350, w: 200, h: 300 },
      { x: 850, y: 2000, w: 300, h: 200 },
      { x: 2000, y: 2350, w: 200, h: 300 },
      { x: 3350, y: 3000, w: 300, h: 200 },
      { x: 2000, y: 3350, w: 200, h: 300 },
      { x: 350, y: 2000, w: 300, h: 200 }
    ],
    finish: { x: 450, y: 400, w: 200, h: 300 },
    pickups: [
      { id: "p1", type: "boost", x: 2000, y: 500, r: 15 },
      { id: "p2", type: "boost", x: 3500, y: 1000, r: 15 },
      { id: "p3", type: "boost", x: 2000, y: 1500, r: 15 },
      { id: "p4", type: "boost", x: 1000, y: 2000, r: 15 }
    ],
    obstacles: [
      { x: 2000, y: 400, r: 25 },
      { x: 3500, y: 1000, r: 25 },
      { x: 2000, y: 1600, r: 25 },
      { x: 1000, y: 2000, r: 25 },
      { x: 2000, y: 2400, r: 25 },
      { x: 3500, y: 3000, r: 25 },
      { x: 2000, y: 3600, r: 25 }
    ]
  },
  {
    id: 6,
    name: "Espiral da Loucura",
    path: [
      { cmd: "moveTo", x: 2000, y: 2000 },
      { cmd: "bezierCurveTo", cp1x: 1000, cp1y: 2000, cp2x: 500, cp2y: 500, x: 2000, y: 500 },
      { cmd: "bezierCurveTo", cp1x: 3500, cp1y: 500, cp2x: 3500, cp2y: 3500, x: 2000, y: 3500 },
      { cmd: "bezierCurveTo", cp1x: 500, cp1y: 3500, cp2x: 500, cp2y: 1000, x: 2000, y: 1000 },
      { cmd: "bezierCurveTo", cp1x: 3000, cp1y: 1000, cp2x: 3000, cp2y: 3000, x: 2000, y: 3000 },
      { cmd: "bezierCurveTo", cp1x: 1500, cp1y: 3000, cp2x: 1500, cp2y: 1500, x: 2000, y: 2000 }
    ],
    checkpoints: [
      { x: 1000, y: 1200, w: 300, h: 300 },
      { x: 2000, y: 400, w: 300, h: 300 },
      { x: 3400, y: 2000, w: 300, h: 300 },
      { x: 2000, y: 3400, w: 300, h: 300 },
      { x: 700, y: 2000, w: 300, h: 300 },
      { x: 2000, y: 900, w: 300, h: 300 },
      { x: 2800, y: 2000, w: 300, h: 300 },
      { x: 2000, y: 2900, w: 300, h: 300 }
    ],
    finish: { x: 1900, y: 1900, w: 200, h: 200 },
    pickups: [
      { id: "p1", type: "boost", x: 2000, y: 500, r: 15 },
      { id: "p2", type: "slow", x: 3400, y: 2000, r: 15 }
    ],
    obstacles: [
      { x: 2000, y: 700, r: 35 },
      { x: 3200, y: 2000, r: 35 },
      { x: 2000, y: 3300, r: 35 },
      { x: 900, y: 2000, r: 35 }
    ]
  },
  {
    id: 7,
    name: "Trevo XL",
    path: [
      { cmd: "moveTo", x: 2000, y: 2000 },
      { cmd: "bezierCurveTo", cp1x: 2000, cp1y: 0, cp2x: 4000, cp2y: 0, x: 4000, y: 2000 },
      { cmd: "bezierCurveTo", cp1x: 4000, cp1y: 4000, cp2x: 2000, cp2y: 4000, x: 2000, y: 2000 },
      { cmd: "bezierCurveTo", cp1x: 2000, cp1y: 4000, cp2x: 0, cp2y: 4000, x: 0, y: 2000 },
      { cmd: "bezierCurveTo", cp1x: 0, cp1y: 0, cp2x: 2000, cp2y: 0, x: 2000, y: 2000 }
    ],
    checkpoints: [
      { x: 2800, y: 800, w: 300, h: 300 },
      { x: 3800, y: 2000, w: 300, h: 300 },
      { x: 2800, y: 3000, w: 300, h: 300 },
      { x: 2000, y: 2200, w: 300, h: 300 },
      { x: 1200, y: 3000, w: 300, h: 300 },
      { x: 200, y: 2000, w: 300, h: 300 },
      { x: 1200, y: 800, w: 300, h: 300 }
    ],
    finish: { x: 1900, y: 1800, w: 200, h: 400 },
    pickups: [
      { id: "p1", type: "boost", x: 3500, y: 2000, r: 15 },
      { id: "p2", type: "boost", x: 500, y: 2000, r: 15 }
    ],
    obstacles: [
      { x: 3500, y: 1500, r: 40 },
      { x: 3500, y: 2500, r: 40 },
      { x: 500, y: 1500, r: 40 },
      { x: 500, y: 2500, r: 40 }
    ]
  },
  {
    id: 8,
    name: "Canyon Profundo",
    path: [
      { cmd: "moveTo", x: 200, y: 1000 },
      { cmd: "lineTo", x: 3800, y: 1000 },
      { cmd: "bezierCurveTo", cp1x: 4000, cp1y: 1000, cp2x: 4000, cp2y: 3000, x: 3800, y: 3000 },
      { cmd: "bezierCurveTo", cp1x: 2000, cp1y: 2000, cp2x: 2000, cp2y: 4000, x: 200, y: 3000 },
      { cmd: "bezierCurveTo", cp1x: 0, cp1y: 2000, cp2x: 0, cp2y: 1000, x: 200, y: 1000 }
    ],
    checkpoints: [
      { x: 1500, y: 850, w: 100, h: 300 },
      { x: 3000, y: 850, w: 100, h: 300 },
      { x: 3800, y: 2000, w: 300, h: 300 },
      { x: 3000, y: 2850, w: 100, h: 300 },
      { x: 2000, y: 2850, w: 100, h: 300 },
      { x: 1000, y: 2850, w: 100, h: 300 }
    ],
    finish: { x: 200, y: 850, w: 100, h: 300 },
    pickups: [
      { id: "p1", type: "boost", x: 2000, y: 1000, r: 15 },
      { id: "p2", type: "slow", x: 3800, y: 2000, r: 15 },
      { id: "p3", type: "boost", x: 2000, y: 3000, r: 15 }
    ],
    obstacles: [
      { x: 2500, y: 1000, r: 35 },
      { x: 3800, y: 2500, r: 35 },
      { x: 2500, y: 3000, r: 35 },
      { x: 500, y: 2000, r: 40 }
    ]
  },
  {
    id: 9,
    name: "Autódromo Mundial",
    path: [
      { cmd: "moveTo", x: 500, y: 3500 },
      { cmd: "lineTo", x: 3500, y: 3500 },
      { cmd: "bezierCurveTo", cp1x: 3900, cp1y: 3500, cp2x: 3900, cp2y: 2500, x: 3500, y: 2500 },
      { cmd: "lineTo", x: 1500, y: 2500 },
      { cmd: "bezierCurveTo", cp1x: 1000, cp1y: 2500, cp2x: 1000, cp2y: 1500, x: 1500, y: 1500 },
      { cmd: "lineTo", x: 3500, y: 1500 },
      { cmd: "bezierCurveTo", cp1x: 3900, cp1y: 1500, cp2x: 3900, cp2y: 500, x: 3500, y: 500 },
      { cmd: "lineTo", x: 500, y: 500 },
      { cmd: "bezierCurveTo", cp1x: 100, cp1y: 500, cp2x: 100, cp2y: 3500, x: 500, y: 3500 }
    ],
    checkpoints: [
      { x: 2000, y: 3350, w: 100, h: 300 },
      { x: 3600, y: 3000, w: 300, h: 300 },
      { x: 2000, y: 2350, w: 100, h: 300 },
      { x: 1300, y: 2000, w: 300, h: 300 },
      { x: 2000, y: 1350, w: 100, h: 300 },
      { x: 3600, y: 1000, w: 300, h: 300 },
      { x: 2000, y: 350, w: 100, h: 300 },
      { x: 400, y: 2000, w: 300, h: 300 }
    ],
    finish: { x: 450, y: 3350, w: 100, h: 300 },
    pickups: [
      { id: "p1", type: "boost", x: 2000, y: 3500, r: 15 },
      { id: "p2", type: "boost", x: 3500, y: 2500, r: 15 },
      { id: "p3", type: "boost", x: 2500, y: 1500, r: 15 },
      { id: "p4", type: "boost", x: 2000, y: 500, r: 15 }
    ],
    obstacles: [
      { x: 2000, y: 3450, r: 30 },
      { x: 3600, y: 2500, r: 30 },
      { x: 2000, y: 1550, r: 30 },
      { x: 3600, y: 500, r: 30 },
      { x: 400, y: 1500, r: 30 }
    ]
  }
];

let gameState = GAME_STATE.WAITING;
let countdownEndAt = 0;
let raceStartAt = 0;
let countdownTimer = null;
let raceTicker = null;

const players = {};
const participants = new Set();
let finishOrder = [];

let currentTrackIndex = -1;
let currentPickups = [];

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    score: p.score,
    isParticipant: p.isParticipant,
    finished: p.finished,
    lapsCompleted: p.lapsCompleted,
    lastLapMs: p.lastLapMs,
    bestLapMs: p.bestLapMs,
    x: p.x,
    y: p.y,
    angle: p.angle,
    carType: p.carType,
    ping: p.ping || 0
  };
}

function getLeaderboard() {
  return Object.values(players)
    .map(publicPlayer)
    .sort((a, b) => (b.score - a.score) || (b.lapsCompleted - a.lapsCompleted));
}

function emitLobby() {
  const lobbyTrack = TRACKS[(currentTrackIndex + 1 + TRACKS.length) % TRACKS.length];
  io.emit("lobbyUpdate", {
    gameState,
    countdownEndAt,
    raceStartAt,
    totalLaps: TOTAL_LAPS,
    leaderboard: getLeaderboard(),
    participants: Array.from(participants),
    currentTrack: { id: lobbyTrack.id, name: lobbyTrack.name, obstacles: lobbyTrack.obstacles },
  });
}

function stopCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

function stopRaceTicker() {
  if (raceTicker) clearInterval(raceTicker);
  raceTicker = null;
}

function startCountdown() {
  if (gameState !== GAME_STATE.WAITING) return;

  gameState = GAME_STATE.COUNTDOWN;
  countdownEndAt = Date.now() + COUNTDOWN_SECONDS * 1000;

  emitLobby();
  io.emit("countdown", { countdownEndAt });

  stopCountdown();
  countdownTimer = setInterval(() => {
    io.emit("countdown", { countdownEndAt });
    if (Date.now() >= countdownEndAt) {
      stopCountdown();
      startRace();
    }
  }, 250);
}

function awardPointsForPlace(place) {
  if (place === 1) return 10;
  if (place === 2) return 5;
  if (place === 3) return 3;
  return 1;
}

function startRace() {
  currentTrackIndex = (currentTrackIndex + 1) % TRACKS.length;
  const track = TRACKS[currentTrackIndex];

  currentPickups = track.pickups.map(p => ({ ...p, active: true }));

  gameState = GAME_STATE.RACING;
  raceStartAt = Date.now();
  finishOrder = [];

  let i = 0;
  for (const id of participants) {
    const p = players[id];
    if (!p) continue;

    p.finished = false;
    p.lapsCompleted = 0;
    p.lastLapMs = null;
    p.bestLapMs = null;
    p.lastLapServerAt = raceStartAt;

    p.x = 400;
    p.y = 400 + i * 80;
    p.angle = 0;

    p.lastMoveAt = Date.now();
    p.lastMoveX = p.x;
    p.lastMoveY = p.y;

    i++;
  }

  emitLobby();

  io.emit("raceStarted", {
    raceStartAt,
    totalLaps: TOTAL_LAPS,
    track: {
      id: track.id,
      name: track.name,
      path: track.path,
      checkpoints: track.checkpoints,
      finish: track.finish,
      obstacles: track.obstacles || []
    },
    pickups: currentPickups,
  });

  stopRaceTicker();
  raceTicker = setInterval(() => {
    if (gameState !== GAME_STATE.RACING) return;

    const now = Date.now();
    const stats = Array.from(participants)
      .map(id => players[id])
      .filter(Boolean)
      .map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        score: p.score,
        finished: p.finished,
        lapsCompleted: p.lapsCompleted,
        lastLapMs: p.lastLapMs,
        bestLapMs: p.bestLapMs,
        currentLapMs: p.finished ? 0 : (now - (p.lastLapServerAt || raceStartAt)),
        x: p.x,
        y: p.y,
        angle: p.angle,
        carType: p.carType,
        ping: p.ping
      }));

    io.emit("raceStats", { now, stats, serverTime: Date.now() });

    const active = Array.from(participants).map(id => players[id]).filter(Boolean);
    if (active.length === 0) {
      gameState = GAME_STATE.WAITING;
      stopRaceTicker();
      emitLobby();
      return;
    }

    if (active.every(p => p.finished)) {
      gameState = GAME_STATE.WAITING;
      stopRaceTicker();
      emitLobby();
    }
  }, 250);
}

io.on("connection", (socket) => {
  const id = socket.id;

  players[id] = {
    id,
    name: `Piloto ${Object.keys(players).length}`,
    color: "#999",
    score: 0,
    isParticipant: false,
    finished: false,
    x: 400,
    y: 400,
    angle: 0,
    lapsCompleted: 0,
    lastLapMs: null,
    bestLapMs: null,
    lastLapServerAt: 0,
    lastMoveAt: Date.now(),
    lastMoveX: 400,
    lastMoveY: 400,
    carType: "agile",
    ping: 0
  };

  const lobbyTrack = TRACKS[(currentTrackIndex + 1 + TRACKS.length) % TRACKS.length];

  socket.emit("welcome", {
    yourId: id,
    gameState,
    countdownEndAt,
    raceStartAt,
    totalLaps: TOTAL_LAPS,
    map: { w: MAP_W, h: MAP_H },
    players: Object.values(players).map(publicPlayer),
    currentTrack: { ...lobbyTrack, obstacles: lobbyTrack.obstacles },
    pickups: currentPickups,
  });
  
  socket.on("ping", (data) => {
    socket.emit("pong", { serverTime: Date.now() });
    if(data && data.timestamp) {
        players[id].ping = Date.now() - data.timestamp;
    }
  });

  emitLobby();

  socket.on("joinRace", ({ carType }) => {
    if (gameState === GAME_STATE.RACING) return;

    const p = players[id];
    if (!p || p.isParticipant) return;

    p.isParticipant = true;
    p.finished = false;
    p.carType = (carType === "rocket" || carType === "agile") ? carType : "agile";
    p.color = `hsl(${Math.floor(Math.random() * 360)}, 90%, 55%)`;

    const idx = participants.size;
    p.x = 400;
    p.y = 400 + idx * 80;
    p.angle = 0;

    p.lastMoveAt = Date.now();
    p.lastMoveX = p.x;
    p.lastMoveY = p.y;

    participants.add(id);
    io.emit("playerJoined", publicPlayer(p));
    emitLobby();
  });

  socket.on("leaveRace", () => {
    const p = players[id];
    if (!p || !p.isParticipant) return;

    participants.delete(id);
    p.isParticipant = false;
    p.finished = true;

    io.emit("playerLeft", { id: p.id });
    emitLobby();

    if (gameState === GAME_STATE.RACING && participants.size === 0) {
      gameState = GAME_STATE.WAITING;
      stopRaceTicker();
      emitLobby();
    }
  });

  socket.on("startRaceRequest", () => {
    if (gameState !== GAME_STATE.WAITING) return;
    if (participants.size < 1) return;
    startCountdown();
  });

  socket.on("playerMovement", (data) => {
    if (gameState !== GAME_STATE.RACING) return;

    const p = players[id];
    if (!p || !p.isParticipant || p.finished) return;

    const now = Date.now();
    const dt = Math.max(0.001, (now - p.lastMoveAt) / 1000);

    const nx = clamp(Number(data?.x) || p.x, 0, MAP_W);
    const ny = clamp(Number(data?.y) || p.y, 0, MAP_H);

    const dx = nx - p.lastMoveX;
    const dy = ny - p.lastMoveY;
    const speed = Math.sqrt(dx * dx + dy * dy) / dt;

    if (speed > MAX_SPEED_UNITS_PER_SEC) return;

    p.x = nx;
    p.y = ny;
    p.angle = Number(data?.angle) || 0;

    p.lastMoveAt = now;
    p.lastMoveX = nx;
    p.lastMoveY = ny;
    
    if(data.pingTimestamp) {
       p.ping = Date.now() - data.pingTimestamp;
    }

    socket.broadcast.emit("playerMoved", { id: p.id, x: p.x, y: p.y, angle: p.angle });
  });

  socket.on("tryPickup", ({ pickupId }) => {
    if (gameState !== GAME_STATE.RACING) return;

    const pl = players[id];
    if (!pl || !pl.isParticipant || pl.finished) return;

    const pk = currentPickups.find(p => p.id === pickupId);
    if (!pk || !pk.active) return;

    const dx = pl.x - pk.x;
    const dy = pl.y - pk.y;
    const rad = CAR_R + pk.r + 6;

    if ((dx * dx + dy * dy) > rad * rad) return;

    pk.active = false;
    io.emit("pickupState", { id: pk.id, active: false });

    if (pk.type === "boost") {
      io.to(id).emit("applyEffect", { type: "boost", durationMs: 2500, impulse: 500, mult: 1.3 });
    } else {
      io.to(id).emit("applyEffect", { type: "slow", durationMs: 2200, impulse: 0, mult: 0.65 });
    }

    setTimeout(() => {
      pk.active = true;
      io.emit("pickupState", { id: pk.id, active: true });
    }, PICKUP_RESPAWN_MS);
  });

  socket.on("lapFinished", (payload) => {
    if (gameState !== GAME_STATE.RACING) return;

    const p = players[id];
    if (!p || !p.isParticipant || p.finished) return;

    const now = Date.now();
    const serverLap = now - (p.lastLapServerAt || raceStartAt);
    const clientLap = Math.max(0, Number(payload?.lapMs) || 0);

    if (serverLap < MIN_LAP_MS) return;

    const lapMs = (Math.abs(serverLap - clientLap) > 3000) ? serverLap : clientLap;

    p.lapsCompleted += 1;
    p.lastLapMs = lapMs;
    p.bestLapMs = (p.bestLapMs == null) ? lapMs : Math.min(p.bestLapMs, lapMs);
    p.lastLapServerAt = now;

    if (p.lapsCompleted >= TOTAL_LAPS) {
      p.finished = true;

      if (!finishOrder.includes(id)) finishOrder.push(id);
      const place = finishOrder.length;
      const points = awardPointsForPlace(place);
      p.score += points;

      io.emit("playerFinished", { id: p.id, place, points });
    }

    emitLobby();
  });

  socket.on("disconnect", () => {
    if (players[id]?.isParticipant) participants.delete(id);

    delete players[id];
    io.emit("playerDisconnected", { id });

    if (participants.size === 0 && gameState !== GAME_STATE.WAITING) {
      gameState = GAME_STATE.WAITING;
      stopCountdown();
      stopRaceTicker();
    }

    emitLobby();
  });
});

server.listen(PORT, () => {
  console.log(`🏁 Servidor a rodar em http://localhost:${PORT}`);
});
