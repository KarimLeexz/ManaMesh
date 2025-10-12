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
    createPeerConnection
} from './webrtc-manager.js';

import {
    addCamera,
    removeCamera,
    showOnMainFeed,
    showToast,
    toggleFlipHorizontal,
    toggleFlipVertical,
    updateCameraTransform
} from './ui-controller.js';

import {
    setupClickHandler,
    scanRegion,
    displayCard,
    checkHealth,
    setupCardSearch
} from './recognition-handler.js';

// API URL configuration
const API_URL = window.MANAMESH_API_URL || window.location.origin;

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
 * Join the room with selected camera
 */
async function joinRoom() {
    const usernameInput = document.getElementById('usernameInput');
    state.username = usernameInput.value || 'Player';
    
    // Stop setup stream
    stopSetupStream();
    
    // Close modal
    document.getElementById('setupModal').classList.remove('modal-open');
    
    // Enable camera FIRST (before connecting to socket)
    try {
        if (state.selectedDeviceId) {
            await enableCamera(state, {
                removeCamera: (userId) => removeCamera(userId, state),
                addCamera: (userId, stream, username, isLocal) => 
                    addCamera(userId, stream, username, isLocal, state, 
                        (uid) => showOnMainFeed(uid, state, () => setupClickHandler(state, 
                            (x, y, w, h) => scanRegion(x, y, w, h, API_URL, state, displayCard, showToast), 
                            showToast))),
                showOnMainFeed: (userId) => showOnMainFeed(userId, state, 
                    () => setupClickHandler(state, 
                        (x, y, w, h) => scanRegion(x, y, w, h, API_URL, state, displayCard, showToast), 
                        showToast)),
                createPeerConnection: (userId, username, initiator) =>
                    createPeerConnection(userId, username, initiator, state, {
                        removeCamera: (uid) => removeCamera(uid, state),
                        addCamera: (uid, stream, uname, isLocal) => 
                            addCamera(uid, stream, uname, isLocal, state, 
                                (u) => showOnMainFeed(u, state, () => setupClickHandler(state,
                                    (x, y, w, h) => scanRegion(x, y, w, h, API_URL, state, displayCard, showToast),
                                    showToast))),
                        showToast
                    }),
                showToast
            });
        }
    } catch (err) {
        console.error('Failed to enable camera on join:', err);
    }
    
    // Initialize Socket.IO connection
    if (!state.socket || !state.socket.connected) {
        initializeSocketIO(API_URL, state, {
            createPeerConnection: (userId, username, initiator) =>
                createPeerConnection(userId, username, initiator, state, {
                    removeCamera: (uid) => removeCamera(uid, state),
                    addCamera: (uid, stream, uname, isLocal) => 
                        addCamera(uid, stream, uname, isLocal, state, 
                            (u) => showOnMainFeed(u, state, () => setupClickHandler(state,
                                (x, y, w, h) => scanRegion(x, y, w, h, API_URL, state, displayCard, showToast),
                                showToast))),
                    showToast
                }),
            addCamera: (userId, stream, username, isLocal) => 
                addCamera(userId, stream, username, isLocal, state, 
                    (uid) => showOnMainFeed(uid, state, () => setupClickHandler(state,
                        (x, y, w, h) => scanRegion(x, y, w, h, API_URL, state, displayCard, showToast),
                        showToast))),
            removeCamera: (userId) => removeCamera(userId, state),
            showToast
        });
        
        // Add local user if camera not enabled
        if (!state.cameraEnabled) {
            addCamera('local', null, state.username + ' (You)', true, state, 
                (uid) => showOnMainFeed(uid, state, () => setupClickHandler(state,
                    (x, y, w, h) => scanRegion(x, y, w, h, API_URL, state, displayCard, showToast),
                    showToast)));
        }
        
        // Hide "no cameras" message
        const noCamerasMsg = document.getElementById('noCamerasMessage');
        if (noCamerasMsg) noCamerasMsg.style.display = 'none';
    }
    
    showToast(`Welcome, ${state.username}!`, 'success');
}

/**
 * Join room without camera
 */
async function joinRoomWithoutCamera() {
    const usernameInput = document.getElementById('usernameInput');
    state.username = usernameInput.value || 'Player';
    
    // Stop setup stream
    stopSetupStream();
    
    // Close modal
    document.getElementById('setupModal').classList.remove('modal-open');
    
    // Initialize Socket.IO connection
    initializeSocketIO(API_URL, state, {
        createPeerConnection: (userId, username, initiator) =>
            createPeerConnection(userId, username, initiator, state, {
                removeCamera: (uid) => removeCamera(uid, state),
                addCamera: (uid, stream, uname, isLocal) => 
                    addCamera(uid, stream, uname, isLocal, state, 
                        (u) => showOnMainFeed(u, state, () => setupClickHandler(state,
                            (x, y, w, h) => scanRegion(x, y, w, h, API_URL, state, displayCard, showToast),
                            showToast))),
                showToast
            }),
        addCamera: (userId, stream, username, isLocal) => 
            addCamera(userId, stream, username, isLocal, state, 
                (uid) => showOnMainFeed(uid, state, () => setupClickHandler(state,
                    (x, y, w, h) => scanRegion(x, y, w, h, API_URL, state, displayCard, showToast),
                    showToast))),
        removeCamera: (userId) => removeCamera(userId, state),
        showToast
    });
    
    // Add local user without camera
    addCamera('local', null, state.username + ' (You)', true, state, 
        (uid) => showOnMainFeed(uid, state, () => setupClickHandler(state,
            (x, y, w, h) => scanRegion(x, y, w, h, API_URL, state, displayCard, showToast),
            showToast)));
    
    // Hide "no cameras" message
    const noCamerasMsg = document.getElementById('noCamerasMessage');
    if (noCamerasMsg) noCamerasMsg.style.display = 'none';
    
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
        enableCamera(state, {
            removeCamera: (userId) => removeCamera(userId, state),
            addCamera: (userId, stream, username, isLocal) => 
                addCamera(userId, stream, username, isLocal, state, 
                    (uid) => showOnMainFeed(uid, state, () => setupClickHandler(state,
                        (x, y, w, h) => scanRegion(x, y, w, h, API_URL, state, displayCard, showToast),
                        showToast))),
            showOnMainFeed: (userId) => showOnMainFeed(userId, state, 
                () => setupClickHandler(state,
                    (x, y, w, h) => scanRegion(x, y, w, h, API_URL, state, displayCard, showToast),
                    showToast)),
            createPeerConnection: (userId, username, initiator) =>
                createPeerConnection(userId, username, initiator, state, {
                    removeCamera: (uid) => removeCamera(uid, state),
                    addCamera: (uid, stream, uname, isLocal) => 
                        addCamera(uid, stream, uname, isLocal, state, 
                            (u) => showOnMainFeed(u, state, () => setupClickHandler(state,
                                (x, y, w, h) => scanRegion(x, y, w, h, API_URL, state, displayCard, showToast),
                                showToast))),
                    showToast
                }),
            showToast
        });
    } else if (!checkbox.checked && state.cameraEnabled) {
        disableCamera(state, {
            removeCamera: (userId) => removeCamera(userId, state),
            addCamera: (userId, stream, username, isLocal) => 
                addCamera(userId, stream, username, isLocal, state, 
                    (uid) => showOnMainFeed(uid, state, () => setupClickHandler(state,
                        (x, y, w, h) => scanRegion(x, y, w, h, API_URL, state, displayCard, showToast),
                        showToast))),
            showOnMainFeed: (userId) => showOnMainFeed(userId, state, 
                () => setupClickHandler(state,
                    (x, y, w, h) => scanRegion(x, y, w, h, API_URL, state, displayCard, showToast),
                    showToast)),
            showToast
        });
    }
}

// Make functions available globally for onclick handlers
window.joinRoom = joinRoom;
window.joinRoomWithoutCamera = joinRoomWithoutCamera;
window.reopenCameraSetup = reopenCameraSetup;
window.toggleCameraEnabled = toggleCameraEnabled;
window.toggleFlipHorizontal = (userId) => toggleFlipHorizontal(userId, state, showToast);
window.toggleFlipVertical = (userId) => toggleFlipVertical(userId, state, showToast);
