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
 * - counters.js: Counters, commander damage, monarch / initiative, out of the game
 *
 * Every table has its own link, /t/<code>; tables are created in the lobby (lobby.js, at /).
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
    updateTurnMarkers,
    serverId,
    showToast
} from './table-view.js';

import { initGameTools, showRoll, logEvent, setTurn, giveTurn } from './game-tools.js';
import { setupCommanderPicker, openCommanderPicker } from './commander-picker.js';
import { initChat, receiveChatMessage } from './chat.js';
import { initCounters, openCounters, refreshCounters } from './counters.js';

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

/**
 * The table in the URL (/t/<code>). Without one there is nothing to sit down at: back to
 * the lobby.
 */
function tableFromUrl() {
    const match = location.pathname.match(/^\/t\/([a-z0-9-]{3,40})\/?$/i);
    if (match) return match[1].toLowerCase();
    location.replace('/');
    return null;
}

/** A table that has closed (or never existed): back to the lobby, which says so */
function tableClosed() {
    location.replace('/?closed=1');
}

/**
 * This tab's player id. It survives a reload (sessionStorage), so the server gives us our
 * seat back; another tab is another player.
 */
function tabPlayerId() {
    try {
        let id = sessionStorage.getItem('playerId');
        if (!id) {
            id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
            sessionStorage.setItem('playerId', id);
        }
        return id;
    } catch {
        return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    }
}

// Global application state
const state = {
    room: tableFromUrl(),
    tableInfo: { name: '', private: false },   // shown in the top bar; brought along after a server restart
    playerId: tabPlayerId(),
    role: 'player',       // or 'spectator': watching only
    spectators: new Map(),  // player id -> name, of everyone watching
    markers: { monarch: null, initiative: null },   // player id holding each
    socket: null,
    localStream: null,
    selectedDeviceId: load('cameraId', null),
    username: load('username', ''),
    flipH: load('flipH', 'false') === 'true',   // how our camera is shown to everyone
    flipV: load('flipV', 'false') === 'true',
    players: new Map(),   // 'local' or player id -> player (see table-view.js)
    peers: new Map(),     // player id -> SimplePeer instance
    cameraEnabled: false,
    hasJoinedRoom: false,
    layout: load('layout', 'grid') === 'focus' ? 'focus' : 'grid',
    focusId: null,
    turn: null,           // { order, current, number } from the server
    turnId: null,         // whose turn it is ('local' or a player id)
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
    applyTable,
    tableClosed,
    setSpectators,
    roleChanged,
    createPeerConnection: (userId, initiator) => createPeerConnection(userId, initiator, state, handlers)
};

/**
 * Table-wide state from the server: starting life, markers (the turn goes through setTurn)
 */
function applyTable(table) {
    if (table.name !== undefined) showTableName({ name: table.name, private: table.private });
    if (table.startingLife !== undefined) state.startingLife = table.startingLife;
    if (table.markers) {
        state.markers = table.markers;
        updateTurnMarkers();
        refreshCounters();
    }
}

function showTableName(info) {
    state.tableInfo = info;
    document.title = `${info.name} · ManaMesh`;
    document.getElementById('tableName').textContent = info.name;
    document.getElementById('tablePrivate').classList.toggle('hidden', !info.private);
    document.getElementById('setupTableName').textContent = info.name;
}

/**
 * Before the join dialog: does the table still exist, and what is it called?
 */
async function loadTableInfo() {
    try {
        const response = await fetch(`${API_URL}/api/tables/${encodeURIComponent(state.room)}`);
        if (response.status === 404) return tableClosed();
        if (response.ok) showTableName(await response.json());
    } catch (err) {
        console.warn('Could not load the table:', err);   // the join itself will tell
    }
}

/** Who is watching, in the top bar */
function setSpectators() {
    const names = [...state.spectators.values()];
    const badge = document.getElementById('spectatorBadge');
    badge.classList.toggle('hidden', names.length === 0);
    document.getElementById('spectatorCount').textContent = names.length;
    document.getElementById('spectatorTip').dataset.tip = `Watching: ${names.join(', ')}`;
}

/** Playing or watching: watchers don't get the controls that change the game */
function roleChanged() {
    document.body.classList.toggle('is-spectator', state.role === 'spectator');
    refreshCounters();
}

/** Send a change for any player at the table */
function updatePlayer(id, changes) {
    if (!state.socket?.connected) return;
    state.socket.emit('player-update', { target: serverId(id), ...changes });
}

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
            updatePlayer(id, { hpDelta: delta });
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
    openCounters,
    playerUpdated: (id) => refreshCounters(id),
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
    if (!state.room) return;   // on the way to the lobby
    loadTableInfo();
    initializeTheme();
    initTableView(state, tileHooks);
    initGameTools(state, { showToast, upsertPlayer });
    initChat(state);
    initCounters(state, {
        changeCounter: (id, name, delta) => updatePlayer(id, { counter: { name, delta } }),
        changeCommanderDamage: (id, source, index, delta) => updatePlayer(id, { cmdDamage: { source, index, delta } }),
        setMarker: (marker, id) => state.socket?.emit('set-marker', { marker, target: id === null ? null : serverId(id) }),
        setConceded: (id, conceded) => updatePlayer(id, { conceded })
    });
    setupInvite();
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
    document.getElementById('watchButton').addEventListener('click', () => submitSetup(false, 'spectator'));
    document.getElementById('takeSeatButton').addEventListener('click', () => state.socket?.emit('take-seat'));
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
 * The table's link: in the join dialog and behind the invite button
 */
function setupInvite() {
    const link = () => `${location.origin}/t/${state.room}`;
    document.getElementById('tableCode').textContent = `/t/${state.room}`;

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(link());
            showToast('Invite link copied. Send it to your friends!', 'success');
        } catch {
            window.prompt('Copy this link and send it to your friends:', link());
        }
    };
    document.getElementById('inviteButton').addEventListener('click', copy);
    document.getElementById('copyTableLink').addEventListener('click', copy);
}

/**
 * @param {boolean} withCamera - Join (or carry on) with the camera from the preview
 * @param {string} role - 'player', or 'spectator' to only watch
 */
async function submitSetup(withCamera, role = 'player') {
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
        state.role = role;
        roleChanged();
        if (role === 'player') {
            upsertPlayer('local', { username, flipH, flipV, hp: state.startingLife });
            if (stream) await useStream(state, stream, handlers);
        }
        initializeSocketIO(API_URL, state, handlers);
        showToast(role === 'player' ? `Welcome, ${username}!` : `Welcome, ${username}! You're watching.`, 'success');
        return;
    }

    if (Object.keys(changes).length) updateMe(changes);
    if (stream) await useStream(state, stream, handlers);
    else if (!withCamera) disableCamera(state, handlers);
}

// Handy in the browser console: `await streamStats()`
window.streamStats = () => streamStats(state);
