// ManaMesh - Multiplayer MTG Card Scanner with WebRTC
// API URL configuration: uses environment variable or falls back to current origin for local dev
const API_URL = window.MANAMESH_API_URL || window.location.origin;

// State management
const state = {
    socket: null,
    localStream: null,
    selectedDeviceId: null,
    username: 'Player',
    cameras: new Map(), // Map of userId -> {stream, element, username, peer, flipH: bool, flipV: bool}
    currentMainCamera: null,
    isScanning: false,
    peers: new Map(), // Map of userId -> SimplePeer instance
    cameraEnabled: false, // Track if camera is currently enabled
    hasJoinedRoom: false // Track if we've joined the room (to prevent peer recreation on initial setup)
};

/**
 * Initialize on page load
 */
window.addEventListener('DOMContentLoaded', async () => {
    checkHealth();
    await initializeSetup();
});

/**
 * Initialize camera setup modal
 */
async function initializeSetup() {
    const setupVideo = document.getElementById('setupVideo');
    const cameraSelect = document.getElementById('cameraSelect');
    
    try {
        // First, request camera permissions with a basic stream
        console.log('Requesting camera permission...');
        const tempStream = await navigator.mediaDevices.getUserMedia({ 
            video: true,
            audio: false 
        });
        
        console.log('Camera permission granted!');
        
        // Show preview immediately
        setupVideo.srcObject = tempStream;
        
        // Now enumerate devices (labels will be available after permission)
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        
        console.log(`Found ${videoDevices.length} cameras:`, videoDevices);
        
        // Populate camera dropdown
        cameraSelect.innerHTML = '';
        
        if (videoDevices.length === 0) {
            cameraSelect.innerHTML = '<option>No cameras found</option>';
            showToast('No cameras detected', 'warning');
            return;
        }
        
        videoDevices.forEach((device, index) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Camera ${index + 1}`;
            cameraSelect.appendChild(option);
        });
        
        // Set first camera as default
        state.selectedDeviceId = videoDevices[0].deviceId;
        cameraSelect.value = state.selectedDeviceId;
        
        // Listen for camera changes
        cameraSelect.addEventListener('change', async (e) => {
            const newDeviceId = e.target.value;
            console.log(`Switching to camera: ${newDeviceId}`);
            
            state.selectedDeviceId = newDeviceId;
            
            // Stop old stream
            const oldStream = setupVideo.srcObject;
            if (oldStream) {
                oldStream.getTracks().forEach(track => {
                    track.stop();
                    console.log('Stopped track:', track.label);
                });
            }
            
            // Start new stream with selected camera
            try {
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: { 
                        deviceId: { exact: newDeviceId },
                        width: { ideal: 1920 },
                        height: { ideal: 1080 }
                    }
                });
                setupVideo.srcObject = newStream;
                console.log('Switched to new camera successfully');
            } catch (err) {
                console.error('Error switching camera:', err);
                showToast('Failed to switch camera', 'error');
            }
        });
        
        showToast('Camera ready! Select your camera and click Join Room.', 'success');
        
    } catch (err) {
        console.error('Error accessing camera:', err);
        
        // More specific error messages
        if (err.name === 'NotAllowedError') {
            showToast('Camera access denied. Please allow camera permissions in your browser.', 'error');
            cameraSelect.innerHTML = '<option>Permission denied</option>';
        } else if (err.name === 'NotFoundError') {
            showToast('No camera found. Please connect a camera.', 'error');
            cameraSelect.innerHTML = '<option>No camera found</option>';
        } else {
            showToast(`Camera error: ${err.message}`, 'error');
            cameraSelect.innerHTML = '<option>Error loading cameras</option>';
        }
    }
}

/**
 * Join the room with selected camera
 */
async function joinRoom() {
    const usernameInput = document.getElementById('usernameInput');
    state.username = usernameInput.value || 'Player';
    
    // Stop setup stream
    const setupVideo = document.getElementById('setupVideo');
    if (setupVideo.srcObject) {
        setupVideo.srcObject.getTracks().forEach(track => track.stop());
    }
    
    // Close modal
    document.getElementById('setupModal').classList.remove('modal-open');
    
    // Enable camera FIRST (before connecting to socket)
    try {
        if (state.selectedDeviceId) {
            await enableCamera();
        }
    } catch (err) {
        console.error('Failed to enable camera on join:', err);
    }
    
    // Only initialize socket if not already connected
    if (!state.socket || !state.socket.connected) {
        // Initialize Socket.IO connection (AFTER camera is enabled)
        initializeSocketIO();
        
        // Always add local user to camera list (even without camera)
        if (!state.cameraEnabled) {
            addCamera('local', null, state.username + ' (You)', true);
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
    
    // Stop setup stream if any
    const setupVideo = document.getElementById('setupVideo');
    if (setupVideo.srcObject) {
        setupVideo.srcObject.getTracks().forEach(track => track.stop());
    }
    
    // Close modal
    document.getElementById('setupModal').classList.remove('modal-open');
    
    // Initialize Socket.IO connection
    initializeSocketIO();
    
    // Always add local user to camera list (without camera)
    addCamera('local', null, state.username + ' (You)', true);
    
    // Hide "no cameras" message
    const noCamerasMsg = document.getElementById('noCamerasMessage');
    if (noCamerasMsg) noCamerasMsg.style.display = 'none';
    
    showToast(`Welcome, ${state.username}! Enable camera when ready.`, 'success');
}

/**
 * Initialize Socket.IO connection and event handlers
 */
function initializeSocketIO() {
    console.log('Connecting to Socket.IO server...');
    
    state.socket = io(API_URL, {
        transports: ['websocket', 'polling']
    });
    
    state.socket.on('connect', () => {
        console.log('✓ Connected to signaling server');
        
        // Join the room
        state.socket.emit('join', { username: state.username });
        state.hasJoinedRoom = true;
    });
    
    state.socket.on('existing-users', ({ users }) => {
        console.log(`Found ${users.length} existing users:`, users);
        
        // Create peer connections to existing users
        users.forEach(user => {
            createPeerConnection(user.userId, user.username, true);
        });
    });
    
    state.socket.on('user-joined', ({ userId, username }) => {
        console.log(`New user joined: ${username} (${userId})`);
        showToast(`${username} joined the room`, 'info');
        
        // Store their info - peer will be created when we receive their signal
        state.cameras.set(userId, { username, stream: null, element: null });
        
        // Add placeholder camera for the new user
        addCamera(userId, null, username, false);
    });
    
    state.socket.on('user-left', ({ userId }) => {
        console.log(`User left: ${userId}`);
        
        // Clean up peer connection
        const peer = state.peers.get(userId);
        if (peer) {
            peer.destroy();
            state.peers.delete(userId);
        }
        
        // Remove camera
        removeCamera(userId);
        
        const camera = state.cameras.get(userId);
        if (camera) {
            showToast(`${camera.username} left the room`, 'info');
        }
    });
    
    state.socket.on('signal', ({ from, signal }) => {
        console.log(`Received signal from ${from}`, signal.type);
        
        let peer = state.peers.get(from);
        
        // If we don't have a peer yet, create one (they initiated)
        if (!peer) {
            console.log(`Creating new peer connection for incoming signal from ${from}`);
            const camera = state.cameras.get(from);
            const username = camera ? camera.username : 'Unknown';
            peer = createPeerConnection(from, username, false);
        } else if (signal.type === 'offer' && peer && !peer.destroyed) {
            // Ignore duplicate offers if peer already exists and is connecting
            console.warn(`Ignoring duplicate offer from ${from} - peer already exists`);
            return;
        }
        
        try {
            // Check if peer is destroyed before signaling
            if (peer.destroyed) {
                console.warn(`Peer ${from} is destroyed, ignoring signal`);
                return;
            }
            // Handle the signal
            peer.signal(signal);
        } catch (err) {
            console.error(`Error handling signal from ${from}:`, err);
        }
    });
    
    state.socket.on('disconnect', () => {
        console.log('✗ Disconnected from signaling server');
        showToast('Disconnected from server', 'warning');
    });
    
    state.socket.on('camera-status-changed', ({ userId, enabled, username }) => {
        console.log('[CAMERA STATUS] Received camera-status-changed event:', { userId, enabled, username });
        
        if (enabled) {
            // They enabled camera - they will recreate peer connection as initiator
            // We should destroy our old peer and wait for their new offer
            const existingPeer = state.peers.get(userId);
            if (existingPeer) {
                console.log(`[CAMERA STATUS] Destroying old peer for ${username} - waiting for new connection with camera`);
                existingPeer.destroy();
                state.peers.delete(userId);
            }
            // Show placeholder temporarily until stream arrives
            removeCamera(userId);
            addCamera(userId, null, username, false);
        } else {
            // They disabled camera - just show placeholder
            console.log(`[CAMERA STATUS] ${username} disabled camera - showing placeholder`);
            removeCamera(userId);
            addCamera(userId, null, username, false);
        }
    });
}

/**
 * Enable local camera
 */
async function enableCamera() {
    // Prevent multiple enables or re-enabling while already enabled
    if (state.cameraEnabled && state.localStream) {
        console.log('Camera already enabled, skipping...');
        return;
    }
    
    try {
        const constraints = {
            video: {
                deviceId: state.selectedDeviceId ? { exact: state.selectedDeviceId } : undefined,
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        };
        
        state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        state.cameraEnabled = true;
        
        console.log('✓ Local camera enabled', state.localStream);
        
        // Remove placeholder and add real camera
        removeCamera('local');
        addCamera('local', state.localStream, state.username + ' (You)', true);
        
        // Show on main feed
        showOnMainFeed('local');
        
        // If we have existing connected peers, we need to recreate connections to add stream
        const connectedPeers = Array.from(state.peers.entries()).filter(([_, peer]) => peer.connected);
        if (connectedPeers.length > 0) {
            console.log('Recreating peer connections to add camera stream');
            for (const [userId, oldPeer] of connectedPeers) {
                const camera = state.cameras.get(userId);
                if (camera) {
                    // Destroy old peer
                    oldPeer.destroy();
                    state.peers.delete(userId);
                    
                    // Create new peer with stream as initiator
                    createPeerConnection(userId, camera.username, true);
                }
            }
            
            // Notify peers that camera is enabled
            state.socket.emit('camera-status-changed', {
                enabled: true,
                username: state.username
            });
        }
        
        showToast('Camera enabled', 'success');
    } catch (err) {
        console.error('Error enabling camera:', err);
        state.cameraEnabled = false;
        showToast('Failed to enable camera', 'error');
    }
}

/**
 * Disable local camera
 */
function disableCamera() {
    console.log('[DISABLE] disableCamera() called, state.cameraEnabled:', state.cameraEnabled);
    if (state.localStream && state.cameraEnabled) {
        console.log('[DISABLE] Stopping camera tracks...');
        state.localStream.getTracks().forEach(track => track.stop());
        state.localStream = null;
        state.cameraEnabled = false;
        
        // Remove camera with stream and add placeholder
        removeCamera('local');
        addCamera('local', null, state.username + ' (You)', true);
        
        // Update main feed if showing local camera
        if (state.currentMainCamera === 'local') {
            showOnMainFeed('local');
        }
        
        // Notify all peers that camera is disabled
        console.log('[DISABLE] Emitting camera-status-changed event');
        state.socket.emit('camera-status-changed', {
            enabled: false,
            username: state.username
        });
        
        showToast('Camera disabled', 'info');
    } else {
        console.log('[DISABLE] Camera not enabled or no stream, skipping');
    }
}

/**
 * Create WebRTC peer connection
 */
function createPeerConnection(userId, username, initiator) {
    console.log(`[CREATE PEER] Attempting to create peer for ${username} (${userId}, initiator: ${initiator})`);
    
    // Check if peer already exists
    const existingPeer = state.peers.get(userId);
    if (existingPeer && !existingPeer.destroyed) {
        console.log(`[CREATE PEER] Peer already exists for ${userId}, returning existing peer`);
        return existingPeer;
    }
    
    if (existingPeer && existingPeer.destroyed) {
        console.log(`[CREATE PEER] Old peer exists but is destroyed, creating new one`);
    }
    
    console.log(`[CREATE PEER] Creating new SimplePeer for ${username}`);
    
    const peerConfig = {
        initiator: initiator,
        trickle: true,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        }
    };
    
    // Add stream if we have one
    if (state.localStream) {
        peerConfig.stream = state.localStream;
        console.log('[CREATE PEER] Adding local stream to peer');
    }
    
    const peer = new SimplePeer(peerConfig);
    
    peer.on('signal', signal => {
        console.log(`Sending signal to ${userId}:`, signal.type);
        state.socket.emit('signal', {
            to: userId,
            signal: signal
        });
    });
    
    peer.on('stream', remoteStream => {
        console.log(`✓ Received stream from ${username}`);
        console.log('Remote stream tracks:', remoteStream.getTracks());
        
        // Check if stream has active tracks
        const hasActiveTracks = remoteStream.getTracks().some(track => track.enabled && track.readyState === 'live');
        
        if (hasActiveTracks) {
            // Add remote camera with stream
            if (state.cameras.has(userId)) {
                removeCamera(userId);
            }
            addCamera(userId, remoteStream, username, false);
            showToast(`Connected to ${username}`, 'success');
        } else {
            // No active tracks - show placeholder
            if (state.cameras.has(userId)) {
                removeCamera(userId);
            }
            addCamera(userId, null, username, false);
            console.log(`${username} joined without camera`);
        }
    });
    
    peer.on('connect', () => {
        console.log(`✓ Peer connected: ${username}`);
    });
    
    peer.on('error', err => {
        console.error(`Peer connection error with ${userId}:`, err);
        showToast(`Connection error with ${username}`, 'error');
    });
    
    peer.on('close', () => {
        console.log(`Peer connection closed with ${userId}`);
        removeCamera(userId);
    });
    
    state.peers.set(userId, peer);
    
    // Update or create camera info
    const existingCamera = state.cameras.get(userId);
    if (existingCamera) {
        existingCamera.peer = peer;
    } else {
        state.cameras.set(userId, { username, peer, stream: null, element: null });
    }
    
    return peer;
}

/**
 * Add camera to the list
 */
function addCamera(userId, stream, username, isLocal = false) {
    // Check if stream is null (no camera) - show placeholder instead
    const hasStream = stream !== null;
    
    // Create video element or placeholder
    let mediaElement;
    if (hasStream) {
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsinline = true;
        video.srcObject = stream;
        video.style.transform = 'scaleX(-1)';
        video.muted = isLocal; // Mute local to avoid feedback
        video.className = 'w-full h-full object-cover';
        mediaElement = video;
    } else {
        // Create placeholder for no camera
        const placeholder = document.createElement('div');
        placeholder.className = 'w-full h-full flex items-center justify-center bg-base-300';
        placeholder.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2"/>
            </svg>
        `;
        mediaElement = placeholder;
    }
    
    // Store in state with flip info
    state.cameras.set(userId, { 
        stream, 
        element: mediaElement, 
        username,
        flipH: false,
        flipV: false,
        hasStream
    });
    
    // Create thumbnail container
    const container = document.createElement('div');
    container.id = `camera-${userId}`;
    container.className = 'relative rounded-lg flex-shrink-0 w-48 h-36 group';
    
    // Video wrapper (clickable) - this has overflow-hidden
    const videoWrapper = document.createElement('div');
    videoWrapper.className = 'w-full h-full cursor-pointer hover:ring-2 hover:ring-primary transition-all rounded-lg overflow-hidden';
    if (hasStream) {
        videoWrapper.onclick = () => showOnMainFeed(userId);
    }
    videoWrapper.appendChild(mediaElement);
    container.appendChild(videoWrapper);
    
    // Add name badge
    const badge = document.createElement('div');
    badge.className = 'absolute bottom-1 left-1 badge badge-sm badge-neutral pointer-events-none';
    badge.textContent = username;
    container.appendChild(badge);
    
    // Three-dot menu button - ALWAYS visible on hover, with high z-index
    const menuBtn = document.createElement('div');
    menuBtn.className = 'dropdown dropdown-end absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity z-50';
    menuBtn.innerHTML = `
        <label tabindex="0" class="btn btn-xs btn-circle btn-neutral">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
        </label>
        <ul tabindex="0" class="dropdown-content z-[1000] menu p-2 shadow bg-base-200 rounded-box w-52 text-sm">
            ${hasStream ? `
            <li><a onclick="event.stopPropagation(); toggleFlipHorizontal('${userId}')">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                Flip Horizontally
            </a></li>
            <li><a onclick="event.stopPropagation(); toggleFlipVertical('${userId}')">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
                Flip Vertically
            </a></li>
            ` : ''}
            ${isLocal ? `
                <div class="divider my-1"></div>
                <li><a onclick="event.stopPropagation(); reopenCameraSetup()">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Configure Inputs
                </a></li>
                <li>
                    <label class="label cursor-pointer justify-start gap-2 px-4 hover:bg-base-300 rounded-lg">
                        <input type="checkbox" class="checkbox checkbox-sm" ${state.cameraEnabled ? 'checked' : ''} onchange="toggleCameraEnabled(this)" />
                        <span class="label-text">Camera Enabled</span>
                    </label>
                </li>
            ` : ''}
        </ul>
    `;
    container.appendChild(menuBtn);
    
    // Add to list
    document.getElementById('cameraList').appendChild(container);
    
    // Hide "no cameras" message when any camera is added
    const noCamerasMsg = document.getElementById('noCamerasMessage');
    if (noCamerasMsg) {
        noCamerasMsg.style.display = 'none';
    }
}

/**
 * Remove camera from list
 */
function removeCamera(userId) {
    const container = document.getElementById(`camera-${userId}`);
    if (container) {
        container.remove();
    }
    state.cameras.delete(userId);
    
    // If this was on main feed, clear it
    if (state.currentMainCamera === userId) {
        const mainVideo = document.getElementById('mainVideo');
        mainVideo.srcObject = null;
        document.getElementById('mainPlayerName').textContent = 'Select a camera';
        state.currentMainCamera = null;
        
        // Hide main camera menu
        const mainCameraMenu = document.getElementById('mainCameraMenu');
        if (mainCameraMenu) {
            mainCameraMenu.style.display = 'none';
        }
    }
    
    // Show "no cameras" message if no cameras left
    if (state.cameras.size === 0) {
        const noCamerasMsg = document.getElementById('noCamerasMessage');
        if (noCamerasMsg) noCamerasMsg.style.display = 'block';
    }
}

/**
 * Show camera on main feed
 */
function showOnMainFeed(userId) {
    const camera = state.cameras.get(userId);
    if (!camera) return;
    
    const mainVideo = document.getElementById('mainVideo');
    
    // Only set video if there's a stream
    if (camera.stream && camera.hasStream) {
        mainVideo.srcObject = camera.stream;
        mainVideo.style.display = 'block';
        
        // Apply flip settings
        const scaleX = camera.flipH ? -1 : 1;
        const scaleY = camera.flipV ? -1 : 1;
        mainVideo.style.transform = `scale(${scaleX}, ${scaleY})`;
    } else {
        // No stream - hide video
        mainVideo.style.display = 'none';
    }
    
    document.getElementById('mainPlayerName').textContent = camera.username;
    state.currentMainCamera = userId;
    
    // Update main camera menu
    updateMainCameraMenu(userId);
    
    // Setup click handler for scanning (only if has stream)
    if (camera.hasStream) {
        setupClickHandler();
    }
}

/**
 * Update the main camera menu with appropriate controls
 */
function updateMainCameraMenu(userId) {
    const camera = state.cameras.get(userId);
    if (!camera) return;
    
    const isLocal = (userId === 'local' || userId === state.socket?.id);
    const hasStream = camera.hasStream;
    const menuContainer = document.getElementById('mainCameraMenu');
    const menuContent = document.getElementById('mainCameraMenuContent');
    
    // Show the menu
    menuContainer.style.display = 'block';
    
    // Build menu content
    menuContent.innerHTML = `
        ${hasStream ? `
        <li><a onclick="event.stopPropagation(); toggleFlipHorizontal('${userId}')">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Flip Horizontally
        </a></li>
        <li><a onclick="event.stopPropagation(); toggleFlipVertical('${userId}')">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
            Flip Vertically
        </a></li>
        ` : ''}
        ${isLocal ? `
            ${hasStream ? '<div class="divider my-1"></div>' : ''}
            <li><a onclick="event.stopPropagation(); reopenCameraSetup()">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Configure Inputs
            </a></li>
            <li>
                <label class="label cursor-pointer justify-start gap-2 px-4 hover:bg-base-300 rounded-lg">
                    <input type="checkbox" class="checkbox checkbox-sm" ${state.cameraEnabled ? 'checked' : ''} onchange="toggleCameraEnabled(this)" />
                    <span class="label-text">Camera Enabled</span>
                </label>
            </li>
        ` : ''}
    `;
}

/**
 * Setup click handler on main video for card scanning
 */
function setupClickHandler() {
    const container = document.getElementById('mainFeedContainer');
    const mainVideo = document.getElementById('mainVideo');
    
    // Remove old listener
    container.onclick = null;
    
    // Add click listener
    container.onclick = async (e) => {
        if (state.isScanning) return;
        
        const rect = mainVideo.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Show click indicator
        showClickIndicator(x, y);
        
        // Scan at clicked position
        await scanAtPosition(x, y);
    };
}

/**
 * Show visual indicator where user clicked
 */
function showClickIndicator(x, y) {
    const indicator = document.getElementById('clickIndicator');
    indicator.style.left = `${x - 24}px`;
    indicator.style.top = `${y - 24}px`;
    indicator.classList.remove('hidden');
    
    setTimeout(() => {
        indicator.classList.add('hidden');
    }, 1000);
}

/**
 * Scan card at clicked position
 */
async function scanAtPosition(x, y) {
    if (!state.currentMainCamera || state.isScanning) return;
    
    state.isScanning = true;
    document.getElementById('scanningIndicator').style.display = 'flex';
    
    try {
        const mainVideo = document.getElementById('mainVideo');
        const canvas = document.createElement('canvas');
        canvas.width = mainVideo.videoWidth;
        canvas.height = mainVideo.videoHeight;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(mainVideo, 0, 0);
        
        // Calculate relative position
        const relX = (x / mainVideo.clientWidth) * canvas.width;
        const relY = (y / mainVideo.clientHeight) * canvas.height;
        
        // Extract region around click (300x400 px card area)
        const cardWidth = 300;
        const cardHeight = 400;
        const regionX = Math.max(0, relX - cardWidth / 2);
        const regionY = Math.max(0, relY - cardHeight / 2);
        
        const regionCanvas = document.createElement('canvas');
        regionCanvas.width = cardWidth;
        regionCanvas.height = cardHeight;
        const regionCtx = regionCanvas.getContext('2d');
        
        regionCtx.drawImage(
            canvas,
            regionX, regionY, cardWidth, cardHeight,
            0, 0, cardWidth, cardHeight
        );
        
        // Convert to blob
        const blob = await new Promise(resolve => regionCanvas.toBlob(resolve, 'image/jpeg', 0.95));
        
        // Send to API
        const formData = new FormData();
        formData.append('file', blob, 'card.jpg');
        
        const response = await fetch(`${API_URL}/api/recognize`, {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            displayCard(result.card);
            showToast(`Found: ${result.card.name}`, 'success');
        } else {
            showToast(result.message || 'Card not recognized', 'warning');
        }
        
    } catch (err) {
        console.error('Error scanning card:', err);
        showToast('Failed to scan card', 'error');
    } finally {
        state.isScanning = false;
        document.getElementById('scanningIndicator').style.display = 'none';
    }
}

/**
 * Display recognized card
 */
function displayCard(card) {
    const confidencePercent = (card.confidence * 100).toFixed(1);
    const confidenceClass = card.confidence > 0.9 ? 'badge-success' : 
                           card.confidence > 0.7 ? 'badge-warning' : 'badge-error';
    
    const cardHTML = `
        <div class="card-result">
            <div class="card bg-base-200 shadow-sm image-full">
                <figure><img src="${card.image_url}" alt="${card.name}" /></figure>
                <div class="card-body p-2">
                    <h3 class="card-title text-xs">${card.name}</h3>
                    <div class="flex gap-1 text-xs">
                        <span class="badge badge-xs badge-outline">${card.set.toUpperCase()}</span>
                        <span class="badge badge-xs ${confidenceClass}">${confidencePercent}%</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    const resultDiv = document.getElementById('result');
    
    // Replace empty state or add to top
    if (resultDiv.children[0]?.classList.contains('text-center')) {
        resultDiv.innerHTML = cardHTML;
    } else {
        resultDiv.insertAdjacentHTML('afterbegin', cardHTML);
    }
}

/**
 * Check API health
 */
async function checkHealth() {
    try {
        const response = await fetch(`${API_URL}/health`);
        const health = await response.json();
        
        const statusEl = document.getElementById('dbStatus');
        const statsEl = document.getElementById('dbStats');
        
        if (health.database_loaded) {
            statusEl.textContent = '✓ Ready';
            statusEl.classList.add('text-success');
            statsEl.textContent = `${health.stats.total_cards.toLocaleString()} cards`;
        } else {
            statusEl.textContent = '⚠ No DB';
            statusEl.classList.add('text-warning');
            statsEl.textContent = 'Build database';
        }
    } catch (err) {
        console.error('Health check failed:', err);
        document.getElementById('dbStatus').textContent = '✗ Offline';
        document.getElementById('dbStats').textContent = 'Cannot connect';
    }
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `alert alert-${type} shadow-lg fixed bottom-4 right-4 w-auto max-w-sm z-50`;
    toast.style.animation = 'slideIn 0.3s ease-out';
    toast.innerHTML = `<div><span>${message}</span></div>`;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease-out reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Theme Management
 */
const savedTheme = localStorage.getItem('theme') || 'dim';
document.documentElement.setAttribute('data-theme', savedTheme);

window.addEventListener('DOMContentLoaded', () => {
    const themeController = document.querySelector('.theme-controller');
    if (themeController) {
        themeController.checked = savedTheme === 'fantasy';
        
        themeController.addEventListener('change', (e) => {
            const newTheme = e.target.checked ? 'fantasy' : 'dim';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
        });
    }
});

/**
 * Toggle horizontal flip for a camera (client-side only)
 */
function toggleFlipHorizontal(userId) {
    const camera = state.cameras.get(userId);
    if (!camera) return;
    
    camera.flipH = !camera.flipH;
    updateCameraTransform(userId);
    showToast(`Horizontal flip ${camera.flipH ? 'enabled' : 'disabled'}`, 'info');
}

/**
 * Toggle vertical flip for a camera (client-side only)
 */
function toggleFlipVertical(userId) {
    const camera = state.cameras.get(userId);
    if (!camera) return;
    
    camera.flipV = !camera.flipV;
    updateCameraTransform(userId);
    showToast(`Vertical flip ${camera.flipV ? 'enabled' : 'disabled'}`, 'info');
}

/**
 * Update camera transform based on flip settings
 */
function updateCameraTransform(userId) {
    const camera = state.cameras.get(userId);
    if (!camera || !camera.element) return;
    
    const scaleX = camera.flipH ? -1 : 1;
    const scaleY = camera.flipV ? -1 : 1;
    camera.element.style.transform = `scale(${scaleX}, ${scaleY})`;
    
    // Also update main video if this camera is currently shown
    if (state.currentMainCamera === userId) {
        const mainVideo = document.getElementById('mainVideo');
        if (mainVideo) {
            mainVideo.style.transform = `scale(${scaleX}, ${scaleY})`;
        }
    }
}

/**
 * Reopen camera setup modal
 */
function reopenCameraSetup() {
    const modal = document.getElementById('setupModal');
    if (modal) {
        modal.classList.add('modal-open');
        // Reinitialize camera preview
        initializeSetup();
    }
}

/**
 * Toggle camera enabled/disabled via checkbox
 */
function toggleCameraEnabled(checkbox) {
    if (checkbox.checked && !state.cameraEnabled) {
        enableCamera();
    } else if (!checkbox.checked && state.cameraEnabled) {
        disableCamera();
    }
}
