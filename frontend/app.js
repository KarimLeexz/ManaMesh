/**
 * ManaMesh - Main Application Coordinator
 * Multiplayer MTG Card Scanner with WebRTC
 *
 * This is the main entry point that coordinates all modules:
 * - camera-manager.js: Camera setup and stream management
 * - webrtc-manager.js: WebRTC peer connections and signaling
 * - ui-controller.js: UI updates and visual effects
 * - recognition-handler.js: Card recognition and scanning
 */

// ES6 Module Imports
import {
    initializeCameraSetup,
    enableCamera,
    disableCamera,
    stopSetupStream
} from './camera-manager.js';

import {
    initializeSocketIO,
    createPeerConnection,
    streamStats
} from './webrtc-manager.js';

import {
    addCamera,
    removeCamera,
    showOnMainFeed,
    showToast,
    toggleFlipHorizontal,
    toggleFlipVertical
} from './ui-controller.js';

import {
    setupClickHandler,
    scanAt,
    displayCard,
    checkHealth,
    setupCardSearch
} from './recognition-handler.js';

// The backend serves the frontend, so the API lives on the same origin
const API_URL = window.location.origin;

// Global application state
const state = {
    socket: null,
    localStream: null,
    selectedDeviceId: null,
    username: 'Player',
    cameras: new Map(), // userId -> {stream, element, username, peer, flipH, flipV, hasStream}
    currentMainCamera: null,
    isScanning: false,
    peers: new Map(), // userId -> SimplePeer instance
    cameraEnabled: false,
    hasJoinedRoom: false
};

/**
 * Callbacks shared by the camera and WebRTC modules. Each module picks the
 * ones it needs (enableCamera, disableCamera, initializeSocketIO and
 * createPeerConnection all destructure a subset of this object).
 */
const scan = (fx, fy, click) => scanAt(fx, fy, click, API_URL, state, displayCard, showToast);
const showMain = (userId) => showOnMainFeed(userId, state, () => setupClickHandler(state, scan));

const handlers = {
    showToast,
    showOnMainFeed: showMain,
    addCamera: (userId, stream, username, isLocal) => addCamera(userId, stream, username, isLocal, state, showMain),
    removeCamera: (userId) => removeCamera(userId, state),
    createPeerConnection: (userId, username, initiator) =>
        createPeerConnection(userId, username, initiator, state, handlers)
};

/**
 * Initialize application on page load
 */
window.addEventListener('DOMContentLoaded', async () => {
    initializeTheme();
    await checkHealth(API_URL);
    await initializeCameraSetup(state, showToast);
    setupCardSearch();
});

/**
 * Initialize theme from localStorage
 */
function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dim';
    document.documentElement.setAttribute('data-theme', savedTheme);

    const themeController = document.querySelector('.theme-controller');
    if (themeController) {
        themeController.checked = savedTheme === 'fantasy';

        themeController.addEventListener('change', (e) => {
            const newTheme = e.target.checked ? 'fantasy' : 'dim';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
        });
    }
}

/**
 * Read the username, stop the setup preview and close the setup modal
 */
function beginJoin() {
    state.username = document.getElementById('usernameInput').value || 'Player';
    stopSetupStream();
    document.getElementById('setupModal').classList.remove('modal-open');
}

function addLocalPlaceholder() {
    handlers.addCamera('local', null, state.username + ' (You)', true);
}

function hideNoCamerasMessage() {
    const noCamerasMsg = document.getElementById('noCamerasMessage');
    if (noCamerasMsg) noCamerasMsg.style.display = 'none';
}

/**
 * Join the room with selected camera
 */
async function joinRoom() {
    beginJoin();

    // Enable camera FIRST (before connecting to socket)
    try {
        if (state.selectedDeviceId) {
            await enableCamera(state, handlers);
        }
    } catch (err) {
        console.error('Failed to enable camera on join:', err);
    }

    // Initialize Socket.IO connection
    if (!state.socket || !state.socket.connected) {
        initializeSocketIO(API_URL, state, handlers);

        // Add local user if camera not enabled
        if (!state.cameraEnabled) {
            addLocalPlaceholder();
        }

        hideNoCamerasMessage();
    }

    showToast(`Welcome, ${state.username}!`, 'success');
}

/**
 * Join room without camera
 */
async function joinRoomWithoutCamera() {
    beginJoin();

    initializeSocketIO(API_URL, state, handlers);
    addLocalPlaceholder();
    hideNoCamerasMessage();

    showToast(`Welcome, ${state.username}! Enable camera when ready.`, 'success');
}

/**
 * Reopen camera setup modal
 */
function reopenCameraSetup() {
    const modal = document.getElementById('setupModal');
    if (modal) {
        modal.classList.add('modal-open');
        // Reinitialize camera preview
        initializeCameraSetup(state, showToast);
    }
}

/**
 * Toggle camera enabled/disabled via checkbox
 */
function toggleCameraEnabled(checkbox) {
    if (checkbox.checked && !state.cameraEnabled) {
        enableCamera(state, handlers);
    } else if (!checkbox.checked && state.cameraEnabled) {
        disableCamera(state, handlers);
    }
}

// Make functions available globally for onclick handlers
window.joinRoom = joinRoom;
window.joinRoomWithoutCamera = joinRoomWithoutCamera;
window.reopenCameraSetup = reopenCameraSetup;
window.toggleCameraEnabled = toggleCameraEnabled;
window.streamStats = () => streamStats(state);
window.toggleFlipHorizontal = (userId) => toggleFlipHorizontal(userId, state, showToast);
window.toggleFlipVertical = (userId) => toggleFlipVertical(userId, state, showToast);
