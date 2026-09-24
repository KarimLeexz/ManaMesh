/**
 * ManaMesh - Main Application Coordinator
 * Multiplayer MTG table with WebRTC cameras and card scanning
 *
 * This is the main entry point that coordinates all modules:
 * - camera-manager.js: Join / settings dialog, local camera stream
 * - webrtc-manager.js: WebRTC peer connections, signaling and shared table state
 * - table-view.js: Player tiles (camera, life, commanders), layouts, toasts
 * - game-tools.js: Dice, coin, reset, table log, side panel
 * - commander-picker.js: Choosing a commander
 * - recognition-handler.js: Card recognition, scanned cards, card search
 * - chat.js: Table-wide text chat
 */

// ES6 Module Imports
import {
    openSetup,
    closeSetup,
    takePreviewStream,
    setupCameraDialog,
    useStream,
    enableCamera,
    disableCamera
} from './camera-manager.js';

import {
    initializeSocketIO,
    createPeerConnection,
    streamStats
} from './webrtc-manager.js';

import {
    initTableView,
    upsertPlayer,
    setPlayerStream,
    removePlayer,
    setLayout,
    showToast
} from './table-view.js';

import { initGameTools, showRoll, logEvent, setTurn, giveTurn } from './game-tools.js';
import { setupCommanderPicker, openCommanderPicker } from './commander-picker.js';
import { initChat, receiveChatMessage } from './chat.js';

import {
    scanTile,
    openCardModal,
    checkHealth,
    setupCardSearch
} from './recognition-handler.js';

// The backend serves the frontend, so the API lives on the same origin
const API_URL = window.location.origin;

// Remembered between visits
function load(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

// Global application state
const state = {
    socket: null,
    localStream: null,
    selectedDeviceId: load('cameraId', null),
    username: load('username', ''),
    flipH: load('flipH', 'false') === 'true',   // how our camera is shown to everyone
    flipV: load('flipV', 'false') === 'true',
    players: new Map(),   // 'local' or socket id -> player (see table-view.js)
    peers: new Map(),     // socket id -> SimplePeer instance
    cameraEnabled: false,
    hasJoinedRoom: false,
    layout: load('layout', 'grid') === 'focus' ? 'focus' : 'grid',
    focusId: null,
    turn: null,           // { order, current, number } from the server
    turnId: null,         // player id ('local' or socket id) whose turn it is
    startingLife: 40,
    isScanning: false
};

/**
 * Callbacks shared by the camera and WebRTC modules. Each module picks the
 * ones it needs.
 */
const handlers = {
    showToast,
    logEvent,
    showRoll,
    setTurn,
    upsertPlayer,
    setPlayerStream,
    removePlayer,
    receiveChatMessage,
    createPeerConnection: (userId, initiator) => createPeerConnection(userId, initiator, state, handlers)
};

/**
 * Send a change of our own player to the table (or just apply it while offline)
 */
function updateMe(changes) {
    if (state.socket?.connected) {
        state.socket.emit('player-update', changes);
    } else {
        upsertPlayer('local', changes);
    }
}

/**
 * What the tiles can ask for
 */
const tileHooks = {
    changeLife(id, delta) {
        if (state.socket?.connected) {
            const target = id === 'local' ? state.socket.id : id;
            state.socket.emit('player-update', { target, hpDelta: delta });
        } else {
            const player = state.players.get(id);
            if (player) upsertPlayer(id, { hp: player.hp + delta });
        }
    },
    scanTile: (id, x, y) => scanTile(state, id, x, y, API_URL, showToast),
    openCommanderPicker: () => openCommanderPicker(state.players.get('local')?.commanders || []),
    showCommander(id, index) {
        const player = state.players.get(id);
        const card = player?.commanders[index];
        if (!card) return;
        openCardModal(card, player.isLocal
            ? [{ label: 'Change commander', className: 'btn-primary', onClick: tileHooks.openCommanderPicker }]
            : []);
    },
    openSetup: () => openSetup(state, showToast),
    toggleCamera() {
        if (state.cameraEnabled) disableCamera(state, handlers);
        else enableCamera(state, handlers);
    },
    giveTurn,
    logEvent,
    setOwnFlip(key, value) {
        state[key] = value;
        save(key, String(value));
        updateMe({ [key]: value });
    }
};

/**
 * Initialize application on page load
 */
window.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    initTableView(state, tileHooks);
    initGameTools(state, { showToast, upsertPlayer });
    initChat(state);
    setupCommanderPicker(commanders => updateMe({ commanders }));
    setupCameraDialog(state, showToast);
    setupSetupForm();
    setupCardSearch();
    setLayout(state.layout);

    document.querySelectorAll('button[data-layout]').forEach(button => {
        button.addEventListener('click', () => setLayout(button.dataset.layout));
    });
    document.getElementById('settingsButton').addEventListener('click', () => openSetup(state, showToast));

    checkHealth(API_URL);
    openSetup(state, showToast);
});

/**
 * Initialize theme from localStorage
 */
function initializeTheme() {
    const savedTheme = load('theme', 'dim');
    document.documentElement.setAttribute('data-theme', savedTheme);

    const themeController = document.querySelector('.theme-controller');
    if (themeController) {
        themeController.checked = savedTheme === 'fantasy';

        themeController.addEventListener('change', (e) => {
            const newTheme = e.target.checked ? 'fantasy' : 'dim';
            document.documentElement.setAttribute('data-theme', newTheme);
            save('theme', newTheme);
        });
    }
}

// Set once the player has left the join dialog for the table
let inGame = false;

/**
 * The join / settings dialog: joining the first time, changing name or camera later
 */
function setupSetupForm() {
    const modal = document.getElementById('setupModal');

    document.getElementById('setupForm').addEventListener('submit', (e) => {
        e.preventDefault();
        submitSetup(true);
    });
    document.getElementById('joinWithoutCameraButton').addEventListener('click', () => submitSetup(false));
    document.getElementById('setupCancelButton').addEventListener('click', () => closeSetup(state));

    // Before joining, the dialog is the way in: it can't be dismissed. (Browsers don't
    // always let 'cancel' be prevented, so it simply reopens.)
    modal.addEventListener('cancel', (e) => {
        if (!inGame) e.preventDefault();
        else closeSetup(state);
    });
    modal.addEventListener('close', () => {
        if (!inGame) modal.showModal();
    });
}

/**
 * @param {boolean} withCamera - Join (or carry on) with the camera from the preview
 */
async function submitSetup(withCamera) {
    const username = document.getElementById('usernameInput').value.trim().slice(0, 24) || 'Player';
    const flipH = document.getElementById('flipHInput').checked;
    const flipV = document.getElementById('flipVInput').checked;
    const stream = withCamera ? takePreviewStream() : null;
    inGame = true;
    closeSetup(state);

    save('username', username);
    save('flipH', String(flipH));
    save('flipV', String(flipV));
    if (stream) save('cameraId', stream.getVideoTracks()[0]?.getSettings().deviceId || '');

    const changes = {};
    if (username !== state.username) changes.username = username;
    if (flipH !== state.flipH) changes.flipH = flipH;
    if (flipV !== state.flipV) changes.flipV = flipV;
    Object.assign(state, { username, flipH, flipV });

    if (!state.hasJoinedRoom) {
        upsertPlayer('local', { username, flipH, flipV, hp: state.startingLife });
        if (stream) await useStream(state, stream, handlers);
        initializeSocketIO(API_URL, state, handlers);
        showToast(`Welcome, ${username}!`, 'success');
        return;
    }

    if (Object.keys(changes).length) updateMe(changes);
    if (stream) await useStream(state, stream, handlers);
    else if (!withCamera) disableCamera(state, handlers);
}

// Handy in the browser console: `await streamStats()`
window.streamStats = () => streamStats(state);
