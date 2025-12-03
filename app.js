// ✅ UZH Map Guessr – Timed Mode Edition + Sound Effects
const TOTAL_QUESTIONS = 5;
const ROUND_TIME = 15;

let currentIndex = 0, points = 0, userGuess = null, guessLocked = false;
let QUESTIONS = [], gameQuestions = [];
let totalDistanceKm = 0, gamesPlayed = 0, streak = 0;
let currentGameGuesses = [], scoreSaved = false;
let lastSavedName = null;
let gameFinished = false; 

let timerInterval = null, timeLeft = 0;
let hintUsed = false;
const STATS_DOC_ID = "gamesPlayed";


// --- Multiplayer state ---
let isMultiplayer = false;
let isHost = false;
let roomId = null;
let roomCode = null;
let playerId = "p_" + Math.random().toString(36).slice(2, 9);
let creatingRoom = false;

let roomUnsub = null;
let playersUnsub = null;
let guessesUnsub = null;

let multiplayerPlayers = [];   // cached players in room
let globalHostId = null;   // ⭐ store host ID for all UI functions
let multiplayerGuesses = [];   // cached guesses for current round

let alreadyLeavingRoom = false;


let hostMissingSince = null;
const HOST_DISCONNECT_DELAY = 2000; // ms buffer to avoid false disconnects

// UI
const screenStart = document.getElementById("screen-start");
const screenGame = document.getElementById("screen-game");
const screenResult = document.getElementById("screen-result");
const btnStart = document.getElementById("btn-start");
const btnNext = document.getElementById("btn-next");
const btnRestart = document.getElementById("btn-restart");
const questionText = document.getElementById("question-text");
const roundIndicator = document.getElementById("round-indicator");
const scoreIndicator = document.getElementById("score-indicator");
const resultSummary = document.getElementById("result-summary");
const questionImage = document.getElementById("question-image");
const nameEntry = document.getElementById("name-entry-final");
const playerNameInput = document.getElementById("player-name-final");
const btnSaveScore = document.getElementById("btn-save-score-final");
const leaderboardBody = document.getElementById("leaderboard-body");
const leaderboardBodyStart = document.getElementById("leaderboard-body-start");
const btnConfirmGuess = document.getElementById("btn-confirm-guess");
const btnClearGuess = document.getElementById("btn-clear-guess");
const gamesPlayedDisplay = document.getElementById("games-played");
const timerDisplay = document.getElementById("timer-display");
const streakBar = document.getElementById("streak-bar");
const streakIndicator = document.getElementById("streak-indicator");
const screenMpRound = document.getElementById("screen-mp-round");


// 🆕 Hint system elements
const btnHint = document.getElementById("btn-hint");
const hintText = document.getElementById("hint-text");

// 🧱 Theme toggle
const btnTheme = document.getElementById("btn-theme");

// Load saved theme or default to dark
let currentTheme = localStorage.getItem("theme") || "dark";

// Apply selected theme
document.body.classList.toggle("light", currentTheme === "light");

// Update button label
btnTheme.textContent =
  currentTheme === "light" ? "🌙 Dark Mode" : "🌞 Light Mode";

// Show the theme button
btnTheme.style.display = "inline-block";

// Button click handler
btnTheme.addEventListener("click", () => {
  document.body.classList.toggle("light");

  const newTheme = document.body.classList.contains("light")
    ? "light"
    : "dark";

  localStorage.setItem("theme", newTheme);

  btnTheme.textContent =
    newTheme === "light" ? "🌙 Dark Mode" : "🌞 Light Mode";
});

// 🆕 Sound elements
const soundCorrect = document.getElementById("sound-correct");
const soundWrong = document.getElementById("sound-wrong");
const soundStreak = document.getElementById("sound-streak");
const btnSound = document.getElementById("btn-sound");


let soundEnabled = true;
if (btnSound) {
  btnSound.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    btnSound.textContent = soundEnabled ? "🔊 Sound On" : "🔇 Sound Off";
  });
}

function playSound(name) {
  if (!soundEnabled) return;
  let s;
  if (name === "correct") s = soundCorrect;
  else if (name === "wrong") s = soundWrong;
  else if (name === "streak") s = soundStreak;
  if (!s) return;
  s.currentTime = 0;
  s.volume = 0.35;
  s.play().catch(() => {});
}

// Firebase helpers
const db = window.db;
const fbCollection = window.fbCollection;
const fbAddDoc = window.fbAddDoc;
const fbGetDocs = window.fbGetDocs;
const fbQuery = window.fbQuery;
const fbOrderBy = window.fbOrderBy;
const fbDoc = window.fbDoc;
const fbIncrement = window.fbIncrement;
const fbGetDoc = window.fbGetDoc;
const fbSetDoc = window.fbSetDoc;
const deleteDoc = window.deleteDoc;

// Leaflet
let mapInitialized = false;
let map, guessMarker, correctMarker, lineLayer;
let previousGuesses = L.layerGroup();


function scrollToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
}

// --- Helpers ---
function makePulseIcon(color) {
  return L.divIcon({
    className: "animated-pulse-marker",
    html: `
      <div class="pulse-outer" style="background:${color}33; box-shadow:0 0 10px ${color}66;"></div>
      <div class="pulse-inner" style="background:${color}; box-shadow:0 0 10px ${color};"></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}
function clearGuessArtifacts() {
  [guessMarker, correctMarker, lineLayer].forEach(m => m && map.removeLayer(m));
  guessMarker = correctMarker = lineLayer = null;
}

async function ensureQuestionsLoaded() {
  if (QUESTIONS.length > 0) return true;

  try {
    const res = await fetch("data/questions.json");
    QUESTIONS = await res.json();
    console.log("✅ QUESTIONS loaded");
    return true;
  } catch (err) {
    console.error("❌ Failed to load QUESTIONS:", err);
    return false;
  }
}

// 🧹 Automatically delete a room once it's empty for 15 minutes

async function scheduleRoomCleanup(roomId) {
  const ref = fbDoc(db, "rooms", roomId);

  // Mark emptySince on the room — only if not yet marked
  try {
    await safeUpdateRoom(roomId, { emptySince: Date.now() });
  } catch (e) {
    console.warn("Could not mark emptySince", e);
  }

  // After 15 minutes → check again
  setTimeout(async () => {
    const snap = await fbGetDoc(ref);
    if (!snap.exists()) return;

    const data = snap.data();
    const players = data.players || {};

    // If host already set deleted: remove immediately
    if (data.deleted === true) {
      console.log(`🔥 Removing deleted room ${roomId}`);
      await deleteDoc(ref).catch(() => {});
      return;
    }

    if (
      Object.keys(players).length === 0 &&
      data.emptySince &&
      Date.now() - data.emptySince >= 15 * 60 * 1000
    ) {
      console.log(`🧹 Auto-removing empty room ${roomId}`);
      await deleteDoc(ref).catch(() => {});
    }
  }, 15 * 60 * 1000);
}


// --- Multiplayer DOM ---
const mpNameInput = document.getElementById("mp-name");
const btnCreateRoom = document.getElementById("btn-create-room");
const btnJoinRoom = document.getElementById("btn-join-room");
const mpJoinCodeInput = document.getElementById("mp-join-code");
const mpRoomInfo = document.getElementById("mp-room-info");
const mpRoomCodeEl = document.getElementById("mp-room-code");
const mpPlayerCountEl = document.getElementById("mp-player-count");
const mpPlayerListEl = document.getElementById("mp-player-list");
const btnMpStart = document.getElementById("btn-mp-start");

const fbOnSnapshot = window.fbOnSnapshot;
const fbWhere = window.fbWhere;
const fbUpdateDoc = window.fbUpdateDoc;


const btnOpenMp = document.getElementById("btn-open-mp");
const screenMpMenu = document.getElementById("screen-mp-menu"); 
const btnBackToStart = document.getElementById("btn-back-to-start");
const btnJoinRoomToggle = document.getElementById("btn-join-room-toggle");
const mpJoinBox = document.getElementById("mp-join-box");


const mpRoomListEl = document.getElementById("mp-room-list");
let roomsUnsub = null;


function enterGameMode() {
  document.body.classList.add("in-game");
}

function exitGameMode() {
  document.body.classList.remove("in-game");
}


// Live browser of all open rooms
function startRoomBrowser() {
  const title = document.getElementById("mp-open-rooms-title");

  // 🚫 If QR-join mode → hide everything
  if (window.mpQrJoinMode) {
    if (title) title.style.display = "none";
    if (mpRoomListEl) {
      mpRoomListEl.style.display = "none";
      mpRoomListEl.innerHTML = "";
    }
    return;
  }

  // Normal mode → show title + list
  if (title) title.style.display = "block";
  if (mpRoomListEl) mpRoomListEl.style.display = "block";

  if (roomsUnsub) roomsUnsub();

  const roomsRef = fbCollection(db, "rooms");
  const qRooms = fbQuery(
  roomsRef,
  fbWhere("stage", "==", "waiting"),
  fbWhere("deleted", "==", false)
  );

  roomsUnsub = fbOnSnapshot(qRooms, snap => {
    const rooms = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRoomBrowser(rooms);
  });
}

function renderRoomBrowser(rooms) {
  const list = document.getElementById("mp-room-list");
  list.innerHTML = "";

  rooms.forEach(room => {
    const li = document.createElement("li");
    li.classList.add("mp-room-item");

    const count = typeof room.playerCount === "number" ? room.playerCount : 0;

    li.innerHTML = `
      <div class="mp-room-entry">
        <div class="mp-room-left">
          <span class="diamond-icon"></span>
          <span class="mp-room-name">Room ${room.code}</span>
        </div>
        <div class="mp-room-right">
          <span class="mp-room-count">${count}/10 players</span>
        </div>
      </div>
    `;

    li.addEventListener("click", () => {
      const name = getPlayerName();
      if (!name) {
        alert("Please enter a name first!");
        mpNameInput.focus();
        return;
      }

      joinRoom(room.code);
    });

    list.appendChild(li);
  });
}


btnOpenMp.addEventListener("click", () => {
  window.mpQrJoinMode = false;
  setScreen(document.getElementById("screen-mp-menu"));
  startRoomBrowser();
});

btnBackToStart.addEventListener("click", () => {
  setScreen(screenStart);
});

btnJoinRoomToggle.addEventListener("click", () => {
  mpJoinBox.style.display = mpJoinBox.style.display === "none" ? "block" : "none";
});

// random 4–5 letter room code
function generateRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 5; i++) c += letters[Math.floor(Math.random() * letters.length)];
  return c;
}

function getPlayerName() {
  const raw =
    (mpNameInput?.value || playerNameInput?.value || "").trim();

  if (!raw) return null;  // 🚫 No name → not allowed

  return raw.slice(0, 20);
}


function hideRoomQR() {
  const box = document.getElementById("mp-qr-box");
  const canvas = document.getElementById("mp-qr");
  if (!box || !canvas) return;
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  box.style.display = "none";
}


function showRoomQR(code) {
  const box = document.getElementById("mp-qr-box");
  const canvas = document.getElementById("mp-qr");
  if (!box || !canvas) return;

  // ⭐ Add glow effect AFTER canvas is defined
  canvas.classList.add("qr-glow");

  // ⭐ Add animated arrow AFTER box exists
  if (!document.getElementById("qr-arrow")) {
    const arrow = document.createElement("div");
    arrow.id = "qr-arrow";
    arrow.textContent = "⬆";
    box.appendChild(arrow);
  }

  const joinUrl = `${location.origin}${location.pathname}?join=${code}`;

  new QRious({
    element: canvas,
    value: joinUrl,
    size: 180,
    level: "H"
  });

  box.style.display = "block";
}



async function createRoom() {
  if (creatingRoom) return; // ⛔ Prevent double-click
  creatingRoom = true;

  const btn = btnCreateRoom;
  if (btn) btn.disabled = true;

  try {
    const name = getPlayerName();
    if (!name) throw new Error("Please enter a name first!");

    hideRoomQR();

    isMultiplayer = true;
    isHost = true;

    const generatedCode = Math.floor(100000 + Math.random() * 900000).toString();

    const roomRef = await fbAddDoc(fbCollection(db, "rooms"), {
      createdAt: Date.now(),
      stage: "waiting",
      hostId: playerId,
      code: generatedCode,
      deleted: false,
      playerCount: 1
    });


    await fbUpdateDoc(roomRef, { playerCount: 1 });


    roomId = roomRef.id;

    await fbSetDoc(
      fbDoc(db, "rooms", roomId, "players", playerId),
      {
        name,
        color: "#" + Math.floor(Math.random()*16777215).toString(16).padStart(6,"0"),
        score: 0,
        totalDistance: 0,
        ready: true,
        joinedAt: Date.now(),
        lastRoundFinished: -1
      }
    );

    cancelCleanupIfNeeded(roomId);

    setScreen(document.getElementById("screen-mp-lobby"));
    mpRoomCodeEl.textContent = generatedCode;
    showRoomQR(generatedCode);

    mpPlayerListEl.innerHTML = `<li><strong>Loading room…</strong></li>`;

    startRoomListeners();
  }

  catch (err) {
    console.error("Room creation failed:", err);
    alert(err.message || "Failed to create room.");

    // allow retry ONLY on failure
    creatingRoom = false;
    if (btn) btn.disabled = false;
    return;
  }

  // 🚫 Do NOT reset creatingRoom on success — prevents duplicates forever
}



async function joinRoom(code) {
  hideRoomQR();

  const name = getPlayerName();
  if (!name) return alert("Please enter a name first!");

  // ⭐ Correct Firestore query: filter by code
  const roomsRef = fbCollection(db, "rooms");
  const q = fbQuery(roomsRef, fbWhere("code", "==", code));

  const snap = await fbGetDocs(q);

  if (snap.empty) {
    return alert("Room not found!");
  }

  // There should be exactly one room with that code
  const doc = snap.docs[0];
  const foundRoom = { id: doc.id, ...doc.data() };

  // ⭐ Correct state
  roomId = foundRoom.id;
  roomCode = foundRoom.code;
  isMultiplayer = true;
  isHost = false;

  // Add/merge this player
  await fbSetDoc(
    fbDoc(db, "rooms", roomId, "players", playerId),
    {
      name,
      color: "#" + Math.floor(Math.random()*16777215).toString(16).padStart(6,"0"),
      score: 0,
      totalDistance: 0,
      ready: true,
      joinedAt: Date.now(),
      lastRoundFinished: -1
    },
    { merge: true }
  );

  // Update count
  const playersSnap = await fbGetDocs(
    fbCollection(db, "rooms", roomId, "players")
  );
  await fbUpdateDoc(fbDoc(db, "rooms", roomId), {
    playerCount: playersSnap.docs.length
  });

  cancelCleanupIfNeeded(roomId);

  // Switch UI
  setScreen(document.getElementById("screen-mp-lobby"));

  showRoomQR(roomCode);
  mpPlayerListEl.innerHTML = `<li><strong>Joining room…</strong></li>`;

  startRoomListeners();
}


async function leaveRoom() {
  if (alreadyLeavingRoom) return;   // ⭐ prevents duplicate calls
  alreadyLeavingRoom = true;

  if (!roomId) return;

  const thisRoomId = roomId;
  const wasHost = isHost;

  // Stop listeners
  if (roomUnsub) roomUnsub();
  if (playersUnsub) playersUnsub();
  if (guessesUnsub) guessesUnsub();

  // 🔥 HOST LOGIC:
  // Do NOT delete the room here.
  // The auto-close logic in startRoomListeners() will handle it.
  if (!wasHost) {
    try {
      // Remove this guest from the room
      const playerRef = fbDoc(db, "rooms", thisRoomId, "players", playerId);
      await deleteDoc(playerRef).catch(() => {});

      // Update count
      const playersSnap = await fbGetDocs(
        fbCollection(db, "rooms", thisRoomId, "players")
      );

      const newCount = playersSnap.docs.length;

      // Update the room count
      await fbUpdateDoc(fbDoc(db, "rooms", thisRoomId), {
        playerCount: newCount
      }).catch(() => {});

      // Guests: if they are the last player, UI auto-close will detect empty room
    } catch (err) {
      console.error("Error removing player:", err);
    }
    setTimeout(() => {
    alreadyLeavingRoom = false;   // reset after UI settles
  }, 500);
  }

  // Reset creation lock
  creatingRoom = false;
  if (btnCreateRoom) btnCreateRoom.disabled = false;

  // Reset local multiplayer state
  isMultiplayer = false;
  isHost = false;
  roomId = null;
  roomCode = null;
  multiplayerPlayers = [];
  multiplayerGuesses = [];

  hideRoomQR();
  setScreen(screenStart);
}



async function mpJoinRoomById(roomIdValue, codeValue) {
  hideRoomQR();
  const name = getPlayerName();

  roomId = roomIdValue;
  roomCode = codeValue;
  isMultiplayer = true;

  const roomRef = fbDoc(db, "rooms", roomId);
  const snap = await fbGetDoc(roomRef);

  if (!snap.exists()) return alert("Room no longer exists.");

  const data = snap.data();
  isHost = (data.hostId === playerId);

  // Add or update player
  await fbSetDoc(
    fbDoc(db, "rooms", roomId, "players", playerId),
    {
      name,
      color: "#"+Math.floor(Math.random()*16777215).toString(16).padStart(6,"0"),
      score: 0,
      totalDistance: 0,
      joinedAt: Date.now(),
      ready: true,
      lastRoundFinished: -1
    },
    { merge: true }
  );


  const playersSnap = await fbGetDocs(
      fbCollection(db, "rooms", roomId, "players")
  );
  const newCount = playersSnap.docs.length;

  await fbUpdateDoc(fbDoc(db, "rooms", roomId), {
      playerCount: newCount
  });

  cancelCleanupIfNeeded(roomId);

  // ⭐⭐⭐ THIS IS THE FIX ⭐⭐⭐
  setScreen(document.getElementById("screen-mp-lobby"));

  startRoomListeners();
  showLobbyInfo();

  // Show QR for joiners
  showRoomQR(codeValue);
}




function safeInvalidate(m) {
  if (!m || !m.invalidateSize) return;

  setTimeout(() => { m.invalidateSize(true); scrollToTop(); }, 100);
  setTimeout(() => { m.invalidateSize(true); scrollToTop(); }, 300);
  setTimeout(() => { m.invalidateSize(true); scrollToTop(); }, 700);
}


function showLobbyInfo() {
  if (!mpRoomInfo) return;
  mpRoomInfo.style.display = "block";
  mpRoomCodeEl.textContent = roomCode || "";
}

async function safeUpdateRoom(roomId, payload) {
  const roomRef = fbDoc(db, "rooms", roomId);
  const snap = await fbGetDoc(roomRef);
  if (!snap.exists()) {
    console.warn("⚠️ Tried to update a room that no longer exists:", roomId);
    return;
  }
  return fbUpdateDoc(roomRef, payload).catch(err => {
    console.warn("⚠️ Update failed:", err);
  });
}

async function startRoomListeners() {

  const roomRef = fbDoc(db, "rooms", roomId);
  const roomSnap = await fbGetDoc(roomRef);
  if (!roomSnap.exists()) return;
  const roomData = roomSnap.data();
  globalHostId = roomData.hostId;


  if (!roomId) return;

  // Stop old listeners
  if (roomUnsub) roomUnsub();
  if (playersUnsub) playersUnsub();

  const playersRef = fbCollection(db, "rooms", roomId, "players");

  // --- PLAYERS SNAPSHOT LISTENER ---
  playersUnsub = fbOnSnapshot(playersRef, async snap => {

    multiplayerPlayers = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    })).filter(p => p.name);

    const realCount = multiplayerPlayers.length;

    // Update Firestore playerCount
    await safeUpdateRoom(roomId, { playerCount: realCount });

    // -------------------------------------------------
    // ⭐ HOST DISCONNECTED AUTO-CLOSE LOGIC
    // -------------------------------------------------
    const hostStillHere = multiplayerPlayers.some(p => p.id === globalHostId);

    // ⭐ Debounced REAL HOST DISCONNECT detection
    if (!isHost && !hostStillHere) {
        if (!hostMissingSince) hostMissingSince = Date.now();
        
        const missingFor = Date.now() - hostMissingSince;

        // Only treat as REAL disconnect if missing > delay
        if (missingFor > HOST_DISCONNECT_DELAY) {
            console.warn("Host disconnected — closing room.");

            await safeUpdateRoom(roomId, { deleted: true });

            if (!alreadyLeavingRoom) {
                alert("The host has disconnected. The room has been closed.");
                leaveRoom();
            }
            return;
        }
    } else {
        // Host is present again → reset the timer
        hostMissingSince = null;
    }

    // ⚠ If YOU are the host but your Firestore doc vanished (rare)
    if (isHost && !hostStillHere) {
        console.warn("Host doc missing, restoring…");
        await fbSetDoc(
            fbDoc(db, "rooms", roomId, "players", playerId),
            { name: getPlayerName(), restored: true },
            { merge: true }
        );
    }

    // -------------------------------------------------
    // AUTO-DELETE WHEN EMPTY
    // -------------------------------------------------
    if (realCount === 0) {
        console.warn("Room empty → deleting room", roomId);

        const snapPlayers = await fbGetDocs(playersRef);
        snapPlayers.forEach(p => deleteDoc(p.ref).catch(() => {}));

        const guessesRef = fbCollection(db, "rooms", roomId, "guesses");
        const snapGuesses = await fbGetDocs(guessesRef);
        snapGuesses.forEach(g => deleteDoc(g.ref).catch(() => {}));

        await deleteDoc(roomRef).catch(() => {});
        leaveRoom();
        return;
    }

    renderLobbyPlayers();

    // Host advances rounds
    if (isHost) {
        const rs = await fbGetDoc(roomRef);
        if (rs.exists()) {
            const room = rs.data();
            if (room.stage === "playing") {
                maybeHostAdvanceFromPlaying(room);
            }
        }
    }
});



  // --- ROOM SNAPSHOT LISTENER ---
  roomUnsub = fbOnSnapshot(roomRef, snap => {

    if (!snap.exists()) return;

    const data = snap.data();

    // Room closed by host
    if (data.deleted === true) {

        if (!alreadyLeavingRoom) {
            if (!isHost) {
                alert("The host ended the game. The room has been closed.");
            }
            leaveRoom();
        }

        return; // do NOT process anything else
    }

    // Update lobby room code display
    const codeField = document.getElementById("mp-room-code");
    if (codeField) codeField.textContent = data.code;

    // Host/joiner UI
    document.getElementById("btn-mp-start").style.display =
      isHost ? "block" : "none";
    document.getElementById("mp-wait-host").style.display =
      isHost ? "none" : "block";

    // Stage switch logic
    switch (data.stage) {
      case "waiting":
        break;

      case "playing":
        hideLobbyUI();
        handleRoomPlaying(data);
        break;

      case "showing_results":
        handleRoomResults(data);
        break;

      case "finished":
        handleRoomFinished(data);
        break;
    }
  });
}



function fullyInvalidateMap() {
  if (!map) return;
  setTimeout(() => {
    map.invalidateSize(true);
    setTimeout(() => map.invalidateSize(true), 200);
    setTimeout(() => map.invalidateSize(true), 500);
  }, 100);
}


function renderLobbyPlayers() {


  const maxPlayers = 10;
  const count = multiplayerPlayers.length;
  const prog = (count / maxPlayers) * 100;

  document.getElementById("mp-lobby-progress-bar").style.width = `${prog}%`;
  document.getElementById("mp-lobby-status").textContent =
    `Waiting for players… ${count}/${maxPlayers}`;

  if (!mpPlayerListEl) return;

  const oldIds = new Set(
    [...mpPlayerListEl.querySelectorAll("li")].map(li => li.dataset.id)
  );

  const newHtml = multiplayerPlayers
    .map(p => `
      <li class="mp-player-item" data-id="${p.id}">
        ${avatarBubble(p.name, p.color)}
        <span>${p.name}${p.id === globalHostId ? " ⭐" : ""}</span>
      </li>
    `)
    .join("");

  mpPlayerListEl.innerHTML = newHtml;

  // identify animations
  multiplayerPlayers.forEach(p => {
    const li = mpPlayerListEl.querySelector(`[data-id="${p.id}"]`);
    if (!oldIds.has(p.id)) {
      li.classList.add("fade-in");
      setTimeout(() => li.classList.remove("fade-in"), 300);
    }
  });

  oldIds.forEach(id => {
    if (!multiplayerPlayers.some(p => p.id === id)) {
      const li = mpPlayerListEl.querySelector(`[data-id="${id}"]`);
      if (li) {
        li.classList.add("fade-out");
        setTimeout(() => li.remove(), 250);
      }
    }
  });

  mpPlayerCountEl.textContent = multiplayerPlayers.length.toString();
}


if (btnCreateRoom) btnCreateRoom.addEventListener("click", createRoom);
if (btnJoinRoom) btnJoinRoom.addEventListener("click", () => {
  const code = mpJoinCodeInput.value.trim();
  joinRoom(code);
});
if (btnMpStart) btnMpStart.addEventListener("click", () => {
  enterGameMode();
  hostStartMultiplayerGame();
});



async function hostStartMultiplayerGame() {
  if (!isHost || !roomId) return;

  // 🔥 Make sure QUESTIONS are loaded
  await ensureQuestionsLoaded();

  // 🔥 Generate list of question indices
  const questionIndices = [...Array(QUESTIONS.length).keys()]
    .sort(() => Math.random() - 0.5)
    .slice(0, TOTAL_QUESTIONS);

  const roomRef = fbDoc(db, "rooms", roomId);
  const now = Date.now();

  await safeUpdateRoom(roomId, {
    stage: "playing",
    currentIndex: 0,
    questions: questionIndices,
    totalRounds: TOTAL_QUESTIONS,
    roundStartedAt: now,
    roundEndsAt: now + ROUND_TIME * 1000
  });
}

function startGuessesListener(roundIndex) {
  if (guessesUnsub) guessesUnsub();

  const guessesRef = fbCollection(db, "rooms", roomId, "guesses");
  const qg = fbQuery(guessesRef, fbWhere("round", "==", roundIndex));

  guessesUnsub = fbOnSnapshot(qg, snap => {
    multiplayerGuesses = snap.docs.map(d => d.data());

    // Host checks if round should move forward
    if (isHost) {
      const roomRef = fbDoc(db, "rooms", roomId);
      fbGetDoc(roomRef).then(rSnap => {
        if (!rSnap.exists()) return;
        const room = rSnap.data();
        maybeHostAdvanceFromPlaying(room);
      });
    }
  });
}

async function handleRoomPlaying(room) {
  enterGameMode();
  const roundStandingsBox = document.getElementById("mp-round-standings");
  const finalBox = document.getElementById("mp-final");
  if (roundStandingsBox) roundStandingsBox.style.display = "none";
  if (finalBox) finalBox.style.display = "none";

  isMultiplayer = true;
  console.log("🔵 handleRoomPlaying triggered for round:", room.currentIndex);

  // Ensure we have loaded question data
  await ensureQuestionsLoaded();
  if (!QUESTIONS.length) {
    console.error("❌ Still no QUESTIONS loaded!");
    return;
  }

  // Build gameQuestions only once
  if (isMultiplayer && room.questions && gameQuestions.length === 0) {
      gameQuestions = room.questions;  // store only indexes!
  }
  // Reset previous guess UI
  clearGuessArtifacts();
  previousGuesses.clearLayers();
  guessLocked = false;

  // Set current round
  currentIndex = room.currentIndex;

  // Sync timer with host
  const now = Date.now();
  timeLeft = Math.max(0, Math.round((room.roundEndsAt - now) / 1000));

  // Switch to game screen
  // ⭐ Ensure map exists in multiplayer
  initGameMap();

  // Switch screen
  setScreen(screenGame);

  // Render UI
  renderRound();

  // Fix tile loading
  fullyInvalidateMap();

  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 200);

    // Timeout behaviour
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      timerDisplay.textContent = "⏰ Time's up!";

      // This player hasn't answered yet → mark as finished with 0 pts
      if (!guessLocked) {
        handleTimeout();
      }

      // 🔥 Host: force a progression check as soon as time is up
      if (isHost && roomId) {
        const roomRef = fbDoc(db, "rooms", roomId);
        fbGetDoc(roomRef).then(snap => {
          if (!snap.exists()) return;
          const latestRoom = snap.data();

          // Only try to advance if we're still in this round + playing
          if (latestRoom.stage === "playing") {
            maybeHostAdvanceFromPlaying(latestRoom);
          }
        });
      }
    }

  // 🔥 Listen for all players' guesses for this round
  startGuessesListener(room.currentIndex);

  renderRound();
  fullyInvalidateMap();
}



async function markRoundFinishedForPlayer() {
  console.log("📌 markRoundFinishedForPlayer() called for", playerId, "round", currentIndex);

  if (!isMultiplayer || !roomId) return;

  const playerRef = fbDoc(db, "rooms", roomId, "players", playerId);

  await fbUpdateDoc(playerRef, {
    lastRoundFinished: currentIndex,
    score: points,
    totalDistance: totalDistanceKm
  });

  console.log("✅ Saved lastRoundFinished:", currentIndex);
}

async function saveMultiplayerGuess(q, meters, pointsGained) {
  if (!roomId) return;
  const guessId = `r${currentIndex}_${playerId}`;
  const km = meters / 1000;
  const guessesRef = fbDoc(db, "rooms", roomId, "guesses", guessId);
  await fbSetDoc(guessesRef, {
    round: currentIndex,
    playerId,
    name: getPlayerName(),
    lat: userGuess.lat,
    lng: userGuess.lng,
    correctLat: q.lat,
    correctLng: q.lng,
    distance: Math.round(meters),
    points: pointsGained,
    km,
    ts: Date.now(),

    // 🔥 NEW FIELDS
    questionId: q.id,
    question: q.answer       // optional but useful
  });

}


async function maybeHostAdvanceFromPlaying(room) {
  if (!isHost || !roomId) return;

  const now = Date.now();

  // Always fetch fresh players
  const listSnap = await fbGetDocs(
    fbCollection(db, "rooms", roomId, "players")
  );
  const freshPlayers = listSnap.docs.map(d => d.data());

  const everyoneDone =
    freshPlayers.length > 0 &&
    freshPlayers.every(p => p.lastRoundFinished >= room.currentIndex);

  console.log("HOST CHECK → everyoneDone:", everyoneDone);

  if (!everyoneDone && now < room.roundEndsAt) return;

  // Advance!
  const roomRef = fbDoc(db, "rooms", roomId);
  await safeUpdateRoom(roomId, {
    stage: "showing_results",
    resultsUntil: now + 5000
  });

  console.log("✅ HOST → advancing to showing_results");
}


function updateMultiplayerStandings() {
  const box = document.getElementById("mp-round-standings");
  const body = document.getElementById("mp-standings-body");

  if (!box || !body) return;

  // Show the standings box
  box.style.display = "block";

  // Sort players by score (high → low)
  const sorted = [...multiplayerPlayers].sort((a, b) => b.score - a.score);

  // Fill table
  body.innerHTML = sorted
    .map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${p.name}</td>
        <td>${p.score}</td>
      </tr>
    `)
    .join("");
}



async function handleRoomResults(room) {

  // Hide singleplayer-focused UI during multiplayer round results
  const leaderboardEl = document.getElementById("leaderboard");
  const mpFinalEl = document.getElementById("mp-final");
  const nameEntryEl = document.getElementById("name-entry");
  if (leaderboardEl) leaderboardEl.style.display = "none";
  if (mpFinalEl) mpFinalEl.style.display = "none";
  if (nameEntryEl) nameEntryEl.style.display = "none";

  console.log("📊 Showing results for round", room.currentIndex);

  // Ensure we are on the multiplayer round results screen
  setScreen(screenMpRound);
  scrollToTop();

  // Small delay so the screen is visible before creating the map
  setTimeout(() => {
    showMultiplayerRoundMap(room.currentIndex);
  }, 150);

  updateMultiplayerStandings();        // cumulative standings side panel
  renderMpRoundStandingsTotals();      // 🆕 total-score standings in the results screen

  const SHOW_TIME = 7000;

  // Host controls progression of the game
  if (isHost) {
    const roomRef = fbDoc(db, "rooms", roomId);

    setTimeout(async () => {
      const nextRound = room.currentIndex + 1;

      if (nextRound >= room.totalRounds) {
        // Game finished
        await safeUpdateRoom(roomId, { stage: "finished" });
      } else {
        // Advance to next round
        const now = Date.now();
        await safeUpdateRoom(roomId, {
          stage: "playing",
          currentIndex: nextRound,
          roundStartedAt: now,
          roundEndsAt: now + ROUND_TIME * 1000
        });
      }
    }, SHOW_TIME);
  }

  // Clean up the round results map just before the next round starts
  setTimeout(() => {
    destroyLeafletMap(document.getElementById("mp-round-map"));
  }, SHOW_TIME - 100);
}


async function showMultiplayerRoundMap(roundIndex) {
  const el = document.getElementById("mp-round-map");
  if (!el) return;

  // Switch screen first
  setScreen(document.getElementById("screen-mp-round"));

  // Clear old map
  el.innerHTML = "";
  if (el._leaflet_id) el._leaflet_id = null;

  // Load guesses
  const guessesRef = fbCollection(db, "rooms", roomId, "guesses");
  const q = fbQuery(guessesRef, fbWhere("round", "==", roundIndex));
  const snap = await fbGetDocs(q);
  const guesses = snap.docs.map(d => d.data());

  if (guesses.length === 0) {
    el.innerHTML = "<p style='text-align:center;color:var(--muted);margin-top:1rem'>No guesses this round.</p>";
    return;
  }

  // ⭐⭐⭐ THE FIX: WAIT FOR BROWSER TO RENDER THE SCREEN ⭐⭐⭐
  setTimeout(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {

        // --- Create the map AFTER the DOM is visible ---
        const roundMap = L.map(el, {
          center: [47.3788, 8.5481],
          zoom: 13,
          zoomControl: true,
          attributionControl: false
        });

        L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", {
          subdomains: "abcd",
          maxZoom: 19,
        }).addTo(roundMap);

        const bounds = [];

        guesses.forEach(g => {
          const crossIcon = L.divIcon({
            className: "cross-marker",
            html: `<div class="cross-shape"></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8]
          });

          L.marker([g.lat, g.lng], { icon: crossIcon })
            .bindTooltip(`${g.name}<br>${g.distance}m`, { direction: "top" })
            .addTo(roundMap);
          bounds.push([g.lat, g.lng]);

          const squareIcon = L.divIcon({
            className: "square-marker",
            html: `<div class="square-shape"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7]
          });

          L.marker([g.correctLat, g.correctLng], { icon: squareIcon })
            .bindTooltip(`Correct`, { direction: "top" })
            .addTo(roundMap);
          bounds.push([g.correctLat, g.correctLng]);

          L.polyline(
            [[g.lat, g.lng], [g.correctLat, g.correctLng]],
            { color: "#76e4f7", weight: 2, opacity: 0.8 }
          ).addTo(roundMap);
        });

        if (bounds.length) {
          roundMap.fitBounds(bounds, { padding: [30, 30] });
        }

        // Final layout fix
        setTimeout(() => roundMap.invalidateSize(true), 120);

        el.classList.add("ready");

      });
    });
  }, 50);
}



async function showFinalMultiplayerMap() {
  const container = document.getElementById("result-map");
  if (!container) return;

  document.getElementById("screen-result").style.display = "block";

  // Reset old map
  if (container._leaflet_id) container._leaflet_id = null;
  container.innerHTML = "";

  // Load building info (photos + hints)
  let allQuestions = [];
  try {
    const res = await fetch("data/questions.json");
    allQuestions = await res.json();
  } catch (err) {
    console.error("Failed to load questions.json:", err);
  }

  // 🔥 Fetch ALL guesses for this room — every round
  const guessesRef = fbCollection(db, "rooms", roomId, "guesses");
  const snap = await fbGetDocs(guessesRef);
  const allGuesses = snap.docs.map(d => d.data());

  // Build map
  setTimeout(() => {
    const mapFinal = L.map(container, {
      center: [47.3769, 8.5417],
      zoom: 13
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", {
      subdomains: "abcd",
      maxZoom: 19
    }).addTo(mapFinal);

    const bounds = [];

    const guessLayer = L.layerGroup().addTo(mapFinal);
    const correctLayer = L.layerGroup().addTo(mapFinal);

    // Helper: player colors
    const playerColorMap = {};
    multiplayerPlayers.forEach(p => {
      playerColorMap[p.id] = p.color || "#8aa1ff";
    });

    allGuesses.forEach(g => {
      const color = playerColorMap[g.playerId] || "#8aa1ff";

      // --- Guess marker ✖ ---
      if (g.lat != null && g.lng != null) {
        L.marker([g.lat, g.lng], {
          icon: L.divIcon({
            className: "cross-marker",
            html: `<div class="cross-shape" style="background:${color}"></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8]
          })
        })
          .bindPopup(`<strong>${g.name}</strong><br>${g.distance}m`)
          .addTo(guessLayer);

        bounds.push([g.lat, g.lng]);
      }

      // --- Find building info ---
      const qInfo = allQuestions.find(q => q.id === g.questionId);

      const title = qInfo?.answer || "Unknown building";
      const img = qInfo?.image || "";
      const hint = qInfo?.hint || "No hint available.";

      // --- Correct marker ■ ---
      L.marker([g.correctLat, g.correctLng], {
        icon: L.divIcon({
          className: "square-marker",
          html: `<div class="square-shape"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7]
        })
      })
        .bindPopup(`
          <div class="guess-popup">
            <div class="popup-header" style="background:#60d394;">🏢 ${title}</div>
            <div class="popup-body">
              ${img ? `<img src="${img}" style="width:100%;border-radius:8px;margin-bottom:6px;">` : ""}
              <div>💡 ${hint}</div>
            </div>
          </div>
        `)
        .addTo(correctLayer);

      bounds.push([g.correctLat, g.correctLng]);

      // --- ⭐ connection line from guess → correct ---
      if (g.lat != null && g.lng != null) {
        L.polyline(
          [
            [g.lat, g.lng],
            [g.correctLat, g.correctLng]
          ],
          {
            color,
            weight: 2.5,
            opacity: 0.9,
            dashArray: "6,4"
          }
        ).addTo(correctLayer);
      }
    });

    if (bounds.length > 0) {
      mapFinal.fitBounds(bounds, { padding: [40, 40] });
    }

    setTimeout(() => mapFinal.invalidateSize(), 200);

  }, 50);
}




function renderRoundStandings() {
  const box = document.getElementById("mp-round-standings");
  const body = document.getElementById("mp-standings-body");

  if (!box || !body) return;

  // Sort based on current scores
  const sorted = [...multiplayerPlayers].sort((a,b) => b.score - a.score);

  body.innerHTML = sorted.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${p.score}</td>
    </tr>
  `).join("");

  box.style.display = "block";
}



function handleRoomFinished(room) {
  console.log("🏁 Game finished → showing final results");

  gameFinished = true;   // 🔥 NEW: multiplayer session is finished too

  // Switch to the final multiplayer results screen
  const finalScreen = document.getElementById("screen-result");
  setScreen(finalScreen);

  scrollToTop();

  // UI cleanup
  const leaderboardEl = document.getElementById("leaderboard");
  const nameEntryEl = document.getElementById("name-entry");
  const roundStandings = document.getElementById("mp-round-standings");
  const roundMap = document.getElementById("mp-round-map");

  if (leaderboardEl) leaderboardEl.style.display = "none";
  if (nameEntryEl) nameEntryEl.style.display = "none";
  if (roundStandings) roundStandings.style.display = "none";
  if (roundMap) roundMap.innerHTML = "";

  // Show final block
  const finalBox = document.getElementById("mp-final");
  const finalBody = document.getElementById("mp-final-body");
  if (finalBox) finalBox.style.display = "block";

  // Sort by total score
  const sorted = [...multiplayerPlayers].sort((a, b) => b.score - a.score);
  const winner = sorted[0];

  // Winner banner
  const resultSummary = document.getElementById("result-summary");
  if (resultSummary) {
    resultSummary.style.display = "block";
    resultSummary.textContent = `🏆 Winner: ${winner.name} — ${winner.score} points`;
  }

  // Fill final table
  finalBody.innerHTML = sorted
    .map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(p.name)}</td>
        <td>${p.score}</td>
        <td>${(p.totalDistance || 0).toFixed(2)} km</td>
      </tr>
    `)
    .join("");

  console.log("✅ Final standings rendered");

  // 🆕 Show the full replay map
  showFinalMultiplayerMap();

}

// --- Game Counter ---
async function loadGameCounter() {
  try {
    const ref = fbDoc(db, "stats", STATS_DOC_ID);
    const snap = await fbGetDoc(ref);
    if (snap.exists()) gamesPlayed = snap.data().gamesPlayed || 0;
    else await fbSetDoc(ref, { gamesPlayed: 0 });
    gamesPlayedDisplay.textContent = `Total Games Played: ${gamesPlayed}`;
  } catch { gamesPlayedDisplay.textContent = ""; }
}
async function incrementGamePlays() {
  try {
    await fbSetDoc(fbDoc(db, "stats", STATS_DOC_ID), { gamesPlayed: fbIncrement(1) }, { merge: true });
    gamesPlayed++;
    gamesPlayedDisplay.textContent = `Total Games Played: ${gamesPlayed}`;
  } catch {}
}


function initGameMap() {
  if (mapInitialized && map) {
    return; // already created
  }
  mapInitialized = true;

  map = L.map("map", {
    center: [47.3788, 8.5481],
    zoom: 13,
    zoomControl: true,
    attributionControl: false
  });

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", {
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(map);

  previousGuesses.addTo(map);

  map.on("click", e => {
    if (!guessLocked) placeGuess(e.latlng.lat, e.latlng.lng);
  });

  setTimeout(() => map.invalidateSize(true), 200);
}


// 🔥 Only load scores + leaderboard at startup
document.addEventListener("DOMContentLoaded", () => {
  loadGameCounter();
  renderLeaderboard();
  renderStartLeaderboard();
});


// --- 🌐 QR JOIN HANDLER (NO AUTOJOIN) ---
document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const joinCode = urlParams.get("join");

  if (joinCode) {
    window.mpQrJoinMode = true;

    setScreen(screenMpMenu);

    mpJoinBox.style.display = "block";
    mpJoinCodeInput.value = joinCode;

    // 🎯 Hide open rooms title + list
    document.getElementById("mp-open-rooms-title").style.display = "none";
    mpRoomListEl.style.display = "none";

    mpNameInput.focus();
  }
});


// --- Timer ---
function startTimer() {
  clearInterval(timerInterval);
  timeLeft = ROUND_TIME;
  timerDisplay.style.display = "block";
  timerDisplay.textContent = `Time left: ${timeLeft}s`;

  timerInterval = setInterval(() => {
    timeLeft--;
    timerDisplay.textContent = `Time left: ${timeLeft}s`;

    if (timeLeft <= 10 && timeLeft > 5) timerDisplay.className = "warning";
    else if (timeLeft <= 5) timerDisplay.className = "critical";
    else timerDisplay.className = "";

    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      timerDisplay.textContent = "⏰ Time's up!";
      if (!guessLocked) handleTimeout();
    }
  }, 1000);
}
function stopTimer() {
  clearInterval(timerInterval);
  timerDisplay.style.display = "none";
  timerDisplay.className = "";
}

// --- Handle Timeout ---
async function handleTimeout() {
  guessLocked = true;
  stopTimer();

  const q = isMultiplayer
    ? QUESTIONS[ gameQuestions[currentIndex] ]
    : gameQuestions[currentIndex];

  clearGuessArtifacts();
  const correct = [q.lat, q.lng];
  correctMarker = L.marker(correct, { icon: makePulseIcon("#ff6b6b") }).addTo(previousGuesses);
  correctMarker
    .bindPopup(`<strong>⏰ Time's up!</strong><br>${q.answer}<br>+0 points`)
    .openPopup();

  // Store local round info (single-player history)
  currentGameGuesses.push({
    question: q.answer,
    lat: null,
    lng: null,
    correctLat: q.lat,
    correctLng: q.lng,
    distance: null
  });

  streak = 0;
  updateStreakUI(0);

  playSound("wrong");

  btnConfirmGuess.disabled = true;
  btnClearGuess.disabled = true;

  if (!isMultiplayer) {
    // 🟦 Single-player → show local round results
    setTimeout(() => {
      showSingleplayerRoundResults();
    }, 500);
  } else {
    // 🟪 MULTIPLAYER → mark this player as finished and let host advance

    // 1) Mark this player as done for this round (0 points)
    await markRoundFinishedForPlayer();

    // 2) If we're the host, force a progression check immediately
    if (isHost && roomId) {
      const roomRef = fbDoc(db, "rooms", roomId);
      const snap = await fbGetDoc(roomRef);
      if (snap.exists()) {
        const latestRoom = snap.data();
        if (latestRoom.stage === "playing") {
          await maybeHostAdvanceFromPlaying(latestRoom);
        }
      }
    }
  }
}


// --- UI Switch ---
function setScreen(s) {

  s.classList.add("screen-fade");
  setTimeout(() => s.classList.remove("screen-fade"), 500);

  // 🔥 NEW: Always force scroll to top when switching screens
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  setTimeout(() => window.scrollTo(0, 0), 30);
  setTimeout(() => window.scrollTo(0, 0), 150);

  // Hide ALL screens
  [
    screenStart,
    screenGame,
    screenResult,
    screenMpMenu,
    document.getElementById("screen-mp-lobby"),
    screenMpRound
  ].forEach(el => el && el.classList.remove("active"));

  // Show the requested one
  s.classList.add("active");

  // 🔥 Leaflet resize fix (needed after scroll)
  if (s === screenGame || s === screenMpRound || s === screenResult) {
      setTimeout(() => {
          if (map) map.invalidateSize(true);
          setTimeout(() => map?.invalidateSize(true), 150);
          setTimeout(() => map?.invalidateSize(true), 350);
      }, 50);
  }
}


function hideLobbyUI() {
  const lobby = document.getElementById("screen-mp-lobby");
  if (lobby) lobby.classList.remove("active");

  const mpMenu = document.getElementById("screen-mp-menu");
  if (mpMenu) mpMenu.classList.remove("active");

  const startScreen = document.getElementById("screen-start");
  if (startScreen) startScreen.classList.remove("active");

  const resultScreen = document.getElementById("screen-result");
  if (resultScreen) resultScreen.classList.remove("active");

  const browser = document.getElementById("mp-room-list");
  if (browser) browser.style.display = "none";

  // 🧹 NEW — clear QR if lobby is exited
  hideRoomQR();
}


function renderMpRoundStandingsTotals() {
  const box = document.getElementById("mp-round-standings");
  const body = document.getElementById("mp-round-standings-body");
  if (!box || !body) return;

  // Sort players by total points
  const sorted = [...multiplayerPlayers]
    .sort((a, b) => b.score - a.score);

  body.innerHTML = sorted.map((p, i) => {
    const medal =
      i === 0 ? "🥇" :
      i === 1 ? "🥈" :
      i === 2 ? "🥉" : "";

    return `
      <tr>
        <td>${medal ? `<span class="round-medal">${medal}</span>` : i + 1}</td>
        <td>${escapeHtml(p.name)}</td>
        <td><strong>${p.score}</strong></td>
        <td>${(p.totalDistance || 0).toFixed(2)} km</td>
      </tr>
    `;
  }).join("");

  box.style.display = "block";
}




// --- Start Game ---
async function startGame() {
  if (!QUESTIONS.length) {
    const res = await fetch("data/questions.json");
    QUESTIONS = await res.json();
  }

  incrementGamePlays();

  // 🔥 Make sure map is created BEFORE touching it
  initGameMap();

  if (map?.closePopup) map.closePopup();
  clearGuessArtifacts();
  previousGuesses.clearLayers();

  if (!isMultiplayer) {
      gameQuestions = [...QUESTIONS]
          .sort(() => Math.random() - 0.5)
          .slice(0, TOTAL_QUESTIONS);
  }
  currentIndex = 0;
  points = 0;
  totalDistanceKm = 0;
  streak = 0;
  currentGameGuesses = [];
  scoreSaved = false;
  gameFinished = false;        // 🔥 NEW: starting a fresh session

  playerNameInput.disabled = false;
  btnSaveScore.disabled = false;

  updateStreakUI(0);

  // 🔥 Map is guaranteed to exist now
  map.setView([47.3788, 8.5481], 13);

  // Screen switch BEFORE rendering
  setScreen(screenGame);

  // 🔥 AFTER the map is visible, invalidate size
  setTimeout(() => map?.invalidateSize(true), 250);
  setTimeout(() => map?.invalidateSize(true), 600);

  renderRound();
}


// --- Round ---
function renderRound() {
  scrollToTop();   // 🔥 Always reset scroll
  // Remove previous round maps (SP + MP) safely
  destroyLeafletMap(document.getElementById("result-map"));
  destroyLeafletMap(document.getElementById("mp-round-map"));
  clearGuessArtifacts();
  guessLocked = false;
  userGuess = null;
  hintUsed = false;

  if (hintText) hintText.style.display = "none";
  if (btnHint) btnHint.disabled = false;

  let q;

  if (isMultiplayer) {
      // room.questions already contains indices set by host
      const idx = gameQuestions[currentIndex];
      q = QUESTIONS[idx];  // get question from global QUESTIONS list
  } else {
      q = gameQuestions[currentIndex];
  }
  questionText.textContent = `Where is: ${q.answer}?`;
  roundIndicator.textContent = `Round ${currentIndex + 1}/${gameQuestions.length}`;
  // 🖼️ Update progress bar
  const progress = ((currentIndex) / gameQuestions.length) * 100;
  document.getElementById("progress-bar").style.width = `${progress}%`;
  questionImage.src = q.image;
  btnConfirmGuess.disabled = btnClearGuess.disabled = btnNext.disabled = true;

  // 🧭 Mini-map reveal effect
  const mapEl = document.getElementById("map");
  mapEl.classList.remove("active");
  mapEl.classList.add("map-reveal");
  setTimeout(() => {
    mapEl.classList.add("active");
  }, 100);
  setTimeout(() => {
    mapEl.classList.remove("map-reveal", "active");
  }, 1100);

  safeInvalidate(map);

  startTimer();
}

// --- 💡 Hint System (uses hint from data/questions.json)
if (btnHint) {
  btnHint.addEventListener("click", () => {
    if (hintUsed || guessLocked) return;
    hintUsed = true;
    btnHint.disabled = true;

    // Deduct cost: -5 points or -5 seconds
    if (points >= 5) points -= 5;
    else if (timeLeft > 5) timeLeft -= 5;

    const q = isMultiplayer
        ? QUESTIONS[ gameQuestions[currentIndex] ]
        : gameQuestions[currentIndex];

    const hintMessage = q.hint || "No hint available for this location.";

    // Display the hint from JSON
    hintText.textContent = `💡 Hint: ${hintMessage}`;
    hintText.style.display = "block";

    // Update the points display
    scoreIndicator.textContent = `Points: ${points}`;
  });
}

// --- Guess ---
function placeGuess(lat, lng) {
  userGuess = { lat, lng };
  if (guessMarker) map.removeLayer(guessMarker);
  guessMarker = L.circleMarker([lat, lng], {
    radius: 8, color: "#c9a600", weight: 3,
    fillColor: "#ffeb3b", fillOpacity: 1,
  }).addTo(map).bindTooltip("Your Guess", { permanent: true, direction: "top", offset: [0, -6] });
  btnConfirmGuess.disabled = false; btnClearGuess.disabled = false;
}

// --- Confirm Guess ---
function confirmGuess() {
  if (!userGuess || guessLocked) return;
  guessLocked = true;
  stopTimer();

  // Load current question
  const q = isMultiplayer
    ? QUESTIONS[ gameQuestions[currentIndex] ]
    : gameQuestions[currentIndex];
  const correct = [q.lat, q.lng];

  // Distance & scoring
  const meters = map.distance([userGuess.lat, userGuess.lng], correct);
  const gained = scoreFromDistance(meters);
  const km = meters / 1000;

  const prevStreak = streak;
  if (gained >= 70) streak++;
  else streak = 0;

  updateStreakUI(streak, prevStreak);

  const streakBonus = Math.min(streak * 5, 25);
  const totalGained = gained + streakBonus;

  points += totalGained;
  totalDistanceKm += km;

  scoreIndicator.textContent = `Points: ${points}`;
  scoreIndicator.classList.add("bump");
  setTimeout(() => scoreIndicator.classList.remove("bump"), 300);

  // Marker + polyline styling
  const { label, color } = accuracyRating(meters);

  lineLayer = L.polyline(
    [[userGuess.lat, userGuess.lng], correct],
    { color, weight: 3, opacity: 0.8 }
  ).addTo(map);

  correctMarker = L.marker(correct, { icon: makePulseIcon(color) })
    .addTo(previousGuesses);

  if (guessMarker) map.removeLayer(guessMarker);

  // Popup UI
  correctMarker.bindPopup(`
    <div class="guess-popup">
      <div class="popup-header" style="background:${color};">
        ${label}
      </div>
      <div class="popup-body">
        <div style="font-weight:600;font-size:1.05rem;">${q.answer}</div>
        <div style="font-size:0.85rem;opacity:0.85;margin-top:2px;">
          ${km.toFixed(2)} km away
        </div>
        <hr>
        <div style="font-size:0.85rem;">
          <span style="color:${color};font-weight:600;">+${totalGained} pts</span>
        </div>
      </div>
    </div>
  `).openPopup();

  // Sound feedback
  if (gained >= 40) playSound("correct");
  else playSound("wrong");

  // -----------------------------
  // SAVE THE GUESS
  // -----------------------------
  if (isMultiplayer) {
    // Save guess to Firebase
    saveMultiplayerGuess(q, meters, totalGained);
    markRoundFinishedForPlayer();
  } else {
    // Store locally for single-player results screen
    currentGameGuesses.push({
      question: q.answer,
      lat: userGuess.lat,
      lng: userGuess.lng,
      correctLat: q.lat,
      correctLng: q.lng,
      distance: Math.round(meters)
    });
  }

  // Enable next round (single-player only; MP is host-controlled)
  btnNext.disabled = false;
  btnConfirmGuess.disabled = true;
}


// --- 🔥 Streak / Combo Visuals ---
function updateStreakUI(newStreak, oldStreak = 0) {
  streakIndicator.textContent = `🔥 Streak: ${newStreak}`;
  if (newStreak > 0) {
    streakBar.style.width = `${Math.min(newStreak * 10, 100)}%`;
    streakBar.style.opacity = 0.8;
  } else {
    streakBar.style.width = "0%";
    streakBar.style.opacity = 0.3;
  }

  if (newStreak > oldStreak) {
    streakIndicator.classList.add("flash");
    streakBar.classList.add("glow");
    showComboBadge(newStreak);
    playSound("streak"); // 🆕 play streak sound
    setTimeout(() => {
      streakIndicator.classList.remove("flash");
      streakBar.classList.remove("glow");
    }, 800);
  }
}


function showComboBadge(value) {
  const badge = document.createElement("div");
  badge.textContent = `🔥 Combo x${value}`;
  badge.style.position = "absolute";
  badge.style.right = "0";
  badge.style.top = "-1.2rem";
  badge.style.fontWeight = "700";
  badge.style.color = "#ffb366";
  badge.style.textShadow = "0 0 8px rgba(255,180,0,0.6)";
  badge.style.animation = "flamePop 1s ease-out forwards";
  badge.style.pointerEvents = "none";
  streakBar.parentElement.appendChild(badge);
  setTimeout(() => badge.remove(), 1000);
}


function destroyLeafletMap(el) {
  if (!el) return;

  const map = el._leaflet_map;
  if (map && map.remove) {
    try {
      map.off();
      map.remove();
    } catch (e) {
      console.warn("Leaflet cleanup warning:", e);
    }
  }

  el._leaflet_map = null;
  el._leaflet_id = null;
  el.innerHTML = "";
}



function showSingleplayerRoundResults() {
  const el = document.getElementById("result-map");
  if (!el) return;

  // Switch to results screen
  setScreen(screenResult);
  scrollToTop();
  nameEntry.style.display = "block";

  // fill the all-time leaderboard
  renderFinalLeaderboard();
  resultSummary.textContent = `Round ${currentIndex + 1} results`;

  // --- CLEAN OLD MAP SAFELY ---
  destroyLeafletMap(el);

  let g = currentGameGuesses[currentIndex];

  // If missing guess — create a null entry for this round
  if (!g) {
      const q = isMultiplayer
          ? QUESTIONS[ gameQuestions[currentIndex] ]
          : gameQuestions[currentIndex];

      g = {
          question: q.answer,
          lat: null,
          lng: null,
          correctLat: q.lat,
          correctLng: q.lng,
          distance: null
      };

      currentGameGuesses[currentIndex] = g;
  }

  // --- CREATE A NEW RESULT MAP ---
  const resultMap = L.map(el, {
    center: [47.3788, 8.5481],
    zoom: 13,
    zoomControl: true,
    attributionControl: false,
  });

  // Save reference so destroyLeafletMap() can find it later
  el._leaflet_map = resultMap;

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", {
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(resultMap);

  const bounds = [];

  // ❌ Player's guess (cross)
  if (g.lat && g.lng) {
    const crossIcon = L.divIcon({
      className: "cross-marker",
      html: `<div class="cross-shape"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });

    L.marker([g.lat, g.lng], { icon: crossIcon })
      .bindTooltip(`❌ Your guess<br>${g.distance} m`, { direction: "top" })
      .addTo(resultMap);

    bounds.push([g.lat, g.lng]);
  }

  // 🟩 Correct location (square)
  const squareIcon = L.divIcon({
    className: "square-marker",
    html: `<div class="square-shape"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

  L.marker([g.correctLat, g.correctLng], { icon: squareIcon })
    .addTo(resultMap);

  bounds.push([g.correctLat, g.correctLng]);

  if (bounds.length) {
    resultMap.fitBounds(bounds, { padding: [30, 30] });
  }

  safeInvalidate(resultMap);

  // --- SHOW RESULTS FOR 7 SECONDS ---
  setTimeout(() => {
      destroyLeafletMap(document.getElementById("result-map"));

      const lastRoundIndex = gameQuestions.length - 1;

      if (currentIndex < lastRoundIndex) {
          currentIndex++;
          setScreen(screenGame);
          renderRound();
      } else {
          // ALWAYS finish the game here
          finish();
      }
  }, 10000);
}



// --- Finish ---
async function finish() {
  if (!currentGameGuesses.length) {
    console.warn("⚠️ force-finalizing the game because guesses array was empty");
  }


  // 🔧 Ensure all rounds exist in currentGameGuesses
  for (let i = 0; i < gameQuestions.length; i++) {
      if (!currentGameGuesses[i]) {
          const q = isMultiplayer
              ? QUESTIONS[gameQuestions[i]]
              : gameQuestions[i];

          currentGameGuesses[i] = {
              question: q.answer,
              lat: null,
              lng: null,
              correctLat: q.lat,
              correctLng: q.lng,
              distance: null
          };
      }
  }

  gameFinished = true;  // 🔥 NEW: this session is now officially finished

  document.getElementById("progress-bar").style.width = "100%";
  stopTimer();
  resultSummary.textContent = `You scored ${points} points 🎯 Total distance: ${totalDistanceKm.toFixed(2)} km`;
  setScreen(screenResult);
  scrollToTop();
  nameEntry.style.display = "block";

  await renderFinalLeaderboard();

  setTimeout(async () => {
    const el = document.getElementById("result-map");
    if (!el) return;

    // Reset old map
    destroyLeafletMap(el);
    el.style.display = "block";

    if (!currentGameGuesses.length) {
      el.innerHTML = "<p style='text-align:center;color:var(--muted)'>No map data for this round.</p>";
      return;
    }

    // Load question data for hints
    let allQuestions = [];
    try {
      const res = await fetch("data/questions.json");
      allQuestions = await res.json();
    } catch (err) {
      console.error("Failed to load questions.json:", err);
    }

    // Create map
    const resultMap = L.map(el, {
      center: [47.3788, 8.5481],
      zoom: 13,
      zoomControl: true,
      attributionControl: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", {
      subdomains: "abcd", maxZoom: 19,
    }).addTo(resultMap);


    const bounds = [];

    // 🎨 Palette for global guesses
    const palette = [
      "#ff6b6b", "#ffb366", "#ffd166", "#8aa1ff", "#76e4f7",
      "#60d394", "#f871a0", "#a0f76e", "#f1a6ff", "#66d9ff",
      "#ffa3a3", "#c1ff9f"
    ];

    // --- 🎯 Your Guesses + Correct Locations ---
    currentGameGuesses.forEach(g => {
      // ❌ Player's guess marker (cross)
      if (g.lat && g.lng) {
        const crossIcon = L.divIcon({
          className: "cross-marker",
          html: `<div class="cross-shape"></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        });
        L.marker([g.lat, g.lng], { icon: crossIcon })
          .bindTooltip(`❌ Your Guess: ${g.question}<br>${g.distance}m away`, { direction: "top" })
          .addTo(resultMap);
        bounds.push([g.lat, g.lng]);
      }

      // 🟩 Correct cube marker
      const match = allQuestions.find(q => q.answer === g.question);
      const hint = match?.hint || "No hint available.";
      const image = match?.image || null;

      const squareIcon = L.divIcon({
        className: "square-marker",
        html: `<div class="square-shape"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const correctMarker = L.marker([g.correctLat, g.correctLng], { icon: squareIcon }).addTo(resultMap);

      const popupContent = `
        <div class="guess-popup">
          <div class="popup-header" style="background:#60d394;">🏢 ${g.question}</div>
          <div class="popup-body">
            ${image ? `<img src="${image}" alt="${g.question}" style="width:100%;border-radius:8px;margin-bottom:6px;">` : ""}
            <div style="font-size:0.9rem;opacity:0.9;">💡 ${hint}</div>
          </div>
        </div>`;
      correctMarker.bindPopup(popupContent);

      bounds.push([g.correctLat, g.correctLng]);
    });

    // --- 🌈 Global hotspots with connection to correct buildings ---
    try {
      const snapAll = await fbGetDocs(fbCollection(db, "guesses"));
      const allGuesses = snapAll.docs.map(d => d.data());
      const grouped = {};

      allGuesses.forEach(g => {
        if (!g.question || !g.lat || !g.lng) return;
        if (!grouped[g.question]) grouped[g.question] = [];
        grouped[g.question].push(g);
      });

      const names = Object.keys(grouped);
      names.forEach((name, idx) => {
        const color = palette[idx % palette.length];
        const guesses = grouped[name];

        // 🎯 Find correct location from allQuestions
        const q = allQuestions.find(q => q.answer === name);
        if (!q) return;

        // --- Draw all hotspots ---
        const points = guesses.map(g => [g.lat, g.lng]);
        points.forEach(([lat, lng]) => {
          const hotspot = L.circleMarker([lat, lng], {
            radius: 10,
            fillColor: color,
            fillOpacity: 0.18,
            stroke: false,
            className: "hotspot"
          }).addTo(resultMap);

          hotspot.bindTooltip(name, {
            permanent: false,
            direction: "top",
            className: "hotspot-label",
            opacity: 0.95
          });

          // 🔥 Highlight on hover
          hotspot.on("mouseover", () => {
            hotspot.setStyle({ fillOpacity: 0.4 });
          });
          hotspot.on("mouseout", () => {
            hotspot.setStyle({ fillOpacity: 0.18 });
          });
        });

        // --- Compute centroid of the cluster ---
        const avgLat = points.reduce((sum, p) => sum + p[0], 0) / points.length;
        const avgLng = points.reduce((sum, p) => sum + p[1], 0) / points.length;

        // --- Draw connecting line ---
        L.polyline([[avgLat, avgLng], [q.lat, q.lng]], {
          color: color,
          weight: 2,
          opacity: 0.3,
          dashArray: "3,6"
        }).addTo(resultMap);

        // --- Halo around correct cube ---
        L.circle([q.lat, q.lng], {
          radius: 80,
          color: color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.05,
          dashArray: "4,6"
        }).addTo(resultMap);
      });
    } catch (err) {
      console.warn("Could not load global guesses:", err);
    }

    // --- 🗺️ Legend ---
    const legend = L.control({ position: "bottomleft" });
    legend.onAdd = () => {
      const div = L.DomUtil.create("div", "map-legend");
      div.innerHTML = `
        <div class="legend-item"><span class="legend-symbol cross-sample"></span>Your Guesses</div>
        <div class="legend-item"><span class="legend-symbol square-sample"></span>Correct Locations</div>`;
      return div;
    };
    legend.addTo(resultMap);

    if (bounds.length > 0) resultMap.fitBounds(bounds, { padding: [30, 30] });
    setTimeout(() => resultMap.invalidateSize(), 300);
    el.classList.add("ready");
  }, 400);
}


async function cancelCleanupIfNeeded(roomId) {
  const ref = fbDoc(db, "rooms", roomId);
  await safeUpdateRoom(roomId, { emptySince: null });
}

function avatarBubble(name, color) {
  const letter = name?.trim()?.[0]?.toUpperCase() || "?";
  return `
    <div class="avatar-bubble" style="background:${color}">
      ${letter}
    </div>
  `;
}


// --- Utilities ---
function scoreFromDistance(m) {
  if (m <= 100) return 100;
  if (m <= 250) return 70;
  if (m <= 500) return 40;
  if (m <= 1000) return 10;
  return 0;
}
function accuracyRating(m) {
  if (m <= 100) return { label: "🎯 PERFECT!", color: "#60d394" };
  if (m <= 250) return { label: "✅ Very Close", color: "#76e4f7" };
  if (m <= 500) return { label: "👍 Good Guess", color: "#8aa1ff" };
  if (m <= 1000) return { label: "😅 Off a Bit", color: "#ffb366" };
  return { label: "❌ Way Off", color: "#ff6b6b" };
}
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// --- Leaderboards ---
async function loadLeaderboard() {
  try {
    const q = fbQuery(fbCollection(db, "leaderboard"), fbOrderBy("points", "desc"));
    const snap = await fbGetDocs(q);
    return snap.docs.map(d => d.data());
  } catch { return []; }
}

window.loadLeaderboard = loadLeaderboard;

async function renderLeaderboard() {
  const data = await loadLeaderboard();
  const highlightName = lastSavedName || localStorage.getItem("lastSavedName") || playerNameInput.value.trim();
  leaderboardBody.innerHTML = data.map((e, i) => {
    const name = e.name || "";
    const isSelf = highlightName && name.toLowerCase().trim() === highlightName.toLowerCase().trim();
    return `<tr class="${isSelf ? "leaderboard-self pulse-highlight" : ""}">
      <td>${i + 1}</td>
      <td>${escapeHtml(name)}</td>
      <td>${e.points}</td>
      <td>${Number(e.distance).toFixed(2)}</td>
    </tr>`;
  }).join("");
  setTimeout(() => {
    document.querySelectorAll(".pulse-highlight").forEach(el => el.classList.remove("pulse-highlight"));
  }, 1500);
}

async function renderStartLeaderboard() {
  const data = await loadLeaderboard();
  if (!leaderboardBodyStart) return;
  leaderboardBodyStart.innerHTML = data.slice(0, 10).map((e, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(e.name || "")}</td>
      <td>${e.points}</td>
      <td>${Number(e.distance).toFixed(2)}</td>
    </tr>
  `).join("");
}


function computeRoundStandings(guesses) {
  // guesses = documents from /guesses where round == currentIndex

  return guesses
    .map(g => ({
      playerId: g.playerId,
      name: g.name,
      points: g.points || 0,
      distance: g.distance || 0
    }))
    .sort((a, b) => b.points - a.points);
}

function renderMpRoundStandings(roundIndex) {
  const box = document.getElementById("mp-round-standings");
  const body = document.getElementById("mp-round-standings-body");
  if (!box || !body) return;

  // Load guesses for this round
  const guesses = multiplayerGuesses.filter(g => g.round === roundIndex);
  if (!guesses.length) {
    box.style.display = "none";
    return;
  }

  const standings = computeRoundStandings(guesses);

  body.innerHTML = standings.map((g, i) => {
    const medal =
      i === 0 ? "🥇" :
      i === 1 ? "🥈" :
      i === 2 ? "🥉" : "";

    return `
      <tr>
        <td>${medal ? `<span class="round-medal">${medal}</span>` : i + 1}</td>
        <td>${g.name}</td>
        <td><strong>${g.points}</strong></td>
        <td>${g.distance}m</td>
      </tr>
    `;
  }).join("");

  box.style.display = "block";
}


// --- Events --


btnConfirmGuess.addEventListener("click", confirmGuess);
btnClearGuess.addEventListener("click", () => {
  if (!guessLocked && guessMarker) {
    map.removeLayer(guessMarker);
    guessMarker = null;
    userGuess = null;
    btnConfirmGuess.disabled = btnClearGuess.disabled = true;
  }
});
btnNext.addEventListener("click", () => {
  // 🚫 Multiplayer: NEXT BUTTON DOES NOTHING
  if (isMultiplayer) {
    console.log("⛔ Next button disabled in multiplayer — host controls progression.");
    return;
  }

  // ✅ Single-player normal flow
  if (currentIndex < gameQuestions.length - 1) {
    currentIndex++;
    renderRound(currentIndex);
  } else {
    finish();
  }

  const progress = (currentIndex / gameQuestions.length) * 100;
  document.getElementById("progress-bar").style.width = `${progress}%`;
});
if (btnStart) {
  btnStart.addEventListener("click", () => {
    enterGameMode();
    startGame();
  });
}
btnRestart.addEventListener("click", () => {
  exitGameMode();
  setScreen(screenStart);
});

// Leave Room button
document.getElementById("btn-mp-leave").addEventListener("click", leaveRoom);

// --- Save Score ---
btnSaveScore.addEventListener("click", async () => {
  if (scoreSaved) return alert("Score already saved ✅");

  // 🔥 Only block if the game is clearly not finished AND we have no data
  if (!gameFinished && !currentGameGuesses.length) {
    return alert("Finish a game before saving.");
  }

  const name = (playerNameInput.value.trim() || "Anonymous").slice(0, 20);
  const gameId = `game_${Date.now()}`;

  try {
    await fbAddDoc(fbCollection(db, "leaderboard"), {
      name,
      points,
      distance: Number(totalDistanceKm.toFixed(2)),
      ts: Date.now()
    });

    // If there are guesses, save them; if not (e.g. multiplayer), this loop is just skipped
    for (const g of currentGameGuesses) {
      await fbAddDoc(fbCollection(db, "guesses"), {
        user: name,
        lat: g.lat,
        lng: g.lng,
        question: g.question,
        distance: g.distance,
        ts: Date.now()
      });
    }

    const userRef = fbDoc(db, "user_guesses", name);
    const snap = await fbGetDoc(userRef);
    const data = snap.exists() ? snap.data() : { games: [] };
    data.games.push({ gameId, guesses: currentGameGuesses, timestamp: Date.now() });
    await fbSetDoc(userRef, data);

    scoreSaved = true;
    lastSavedName = name;
    localStorage.setItem("lastSavedName", name);

    playerNameInput.disabled = true;
    btnSaveScore.disabled = true;

    await renderLeaderboard();
    await renderStartLeaderboard();

    alert("Score saved ✅");
  } catch (err) {
    console.error(err);
    alert("Error saving score.");
  }
});

window.addEventListener("resize", () => map && map.invalidateSize());
