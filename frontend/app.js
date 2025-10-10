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
    cameraEnabled: false // Track if camera is currently enabled
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
    
    // Initialize Socket.IO connection
    initializeSocketIO();
    
    // Start local camera
    await enableCamera();
    
    showToast(`Welcome, ${state.username}!`, 'success');
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
        
        // We don't initiate here - they will connect to us
        // Just store their info for when they connect
        if (!state.cameras.has(userId)) {
            state.cameras.set(userId, { username, stream: null, element: null });
        }
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
        }
        
        try {
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
}

/**
 * Enable local camera
 */
async function enableCamera() {
    // Prevent multiple enables
    if (state.cameraEnabled) {
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
        
        // Add to camera list
        addCamera('local', state.localStream, state.username + ' (You)', true);
        
        // Show on main feed by default
        showOnMainFeed('local');
        
        // Update all existing peer connections with new stream
        state.peers.forEach((peer, userId) => {
            console.log(`Adding stream to existing peer: ${userId}`);
            peer.addStream(state.localStream);
        });
        
        // Update buttons
        const enableBtn = document.getElementById('enableCameraBtn');
        enableBtn.style.display = 'none';
        
        // Hide "no cameras" message
        const noCamerasMsg = document.getElementById('noCamerasMessage');
        if (noCamerasMsg) noCamerasMsg.style.display = 'none';
        
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
    if (state.localStream && state.cameraEnabled) {
        state.localStream.getTracks().forEach(track => track.stop());
        state.localStream = null;
        state.cameraEnabled = false;
        
        // Remove from camera list
        removeCamera('local');
        
        // Update buttons
        const enableBtn = document.getElementById('enableCameraBtn');
        enableBtn.style.display = 'flex';
        
        // Show "no cameras" message if no other cameras
        if (state.cameras.size === 0) {
            const noCamerasMsg = document.getElementById('noCamerasMessage');
            if (noCamerasMsg) noCamerasMsg.style.display = 'block';
        }
        
        // Notify peers that we removed our stream
        state.peers.forEach((peer, userId) => {
            console.log(`Removing stream from peer: ${userId}`);
            peer.removeStream(state.localStream);
        });
        
        showToast('Camera disabled', 'info');
    }
}

/**
 * Create WebRTC peer connection
 */
function createPeerConnection(userId, username, initiator) {
    console.log(`Creating peer connection with ${username} (userId: ${userId}, initiator: ${initiator})`);
    
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
        console.log('Adding local stream to peer');
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
        
        // Add remote camera to list
        addCamera(userId, remoteStream, username, false);
        
        showToast(`Connected to ${username}`, 'success');
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
    // Create video element
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsinline = true;
    video.srcObject = stream;
    video.style.transform = 'scaleX(-1)';
    video.muted = isLocal; // Mute local to avoid feedback
    video.className = 'w-full h-full object-cover';
    
    // Store in state with flip info
    state.cameras.set(userId, { 
        stream, 
        element: video, 
        username,
        flipH: false,
        flipV: false
    });
    
    // Create thumbnail container
    const container = document.createElement('div');
    container.id = `camera-${userId}`;
    container.className = 'relative rounded-lg flex-shrink-0 w-48 h-36 group';
    
    // Video wrapper (clickable) - this has overflow-hidden
    const videoWrapper = document.createElement('div');
    videoWrapper.className = 'w-full h-full cursor-pointer hover:ring-2 hover:ring-primary transition-all rounded-lg overflow-hidden';
    videoWrapper.onclick = () => showOnMainFeed(userId);
    videoWrapper.appendChild(video);
    container.appendChild(videoWrapper);
    
    // Add name badge
    const badge = document.createElement('div');
    badge.className = 'absolute bottom-1 left-1 badge badge-sm badge-neutral pointer-events-none';
    badge.textContent = username;
    container.appendChild(badge);
    
    // Three-dot menu button
    const menuBtn = document.createElement('div');
    menuBtn.className = 'dropdown dropdown-end absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity';
    menuBtn.innerHTML = `
        <label tabindex="0" class="btn btn-xs btn-circle btn-neutral">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
        </label>
        <ul tabindex="0" class="dropdown-content z-[100] menu p-2 shadow bg-base-200 rounded-box w-52 text-sm">
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
    mainVideo.srcObject = camera.stream;
    
    // Apply flip settings
    const scaleX = camera.flipH ? -1 : 1;
    const scaleY = camera.flipV ? -1 : 1;
    mainVideo.style.transform = `scale(${scaleX}, ${scaleY})`;
    
    document.getElementById('mainPlayerName').textContent = camera.username;
    state.currentMainCamera = userId;
    
    // Update main camera menu
    updateMainCameraMenu(userId);
    
    // Setup click handler for scanning
    setupClickHandler();
}

/**
 * Update the main camera menu with appropriate controls
 */
function updateMainCameraMenu(userId) {
    const camera = state.cameras.get(userId);
    if (!camera) return;
    
    const isLocal = (userId === state.socket?.id);
    const menuContainer = document.getElementById('mainCameraMenu');
    const menuContent = document.getElementById('mainCameraMenuContent');
    
    // Show the menu
    menuContainer.style.display = 'block';
    
    // Build menu content
    menuContent.innerHTML = `
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
