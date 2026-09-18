/**
 * WebRTC Manager Module
 * Handles Socket.IO connections, WebRTC peer connections, and signaling
 */

/**
 * Initialize Socket.IO connection and set up event handlers
 * @param {string} API_URL - Server API URL
 * @param {Object} state - Application state object
 * @param {Function} createPeerConnection - Function to create peer connection
 * @param {Function} addCamera - Function to add camera to UI
 * @param {Function} removeCamera - Function to remove camera from UI
 * @param {Function} showToast - Toast notification function
 */
function initializeSocketIO(API_URL, state, { createPeerConnection, addCamera, removeCamera, showToast }) {
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

// Outgoing video: high bitrate and resolution capped at 1080p so peers see card text clearly
// without every player having to encode 4K for every other player
const MAX_VIDEO_BITRATE = 8_000_000;   // bits per second
const MAX_SEND_WIDTH = 1920;

/**
 * Configure the outgoing video of a peer connection for detail: a high bitrate ceiling,
 * and when bandwidth or CPU runs short, drop frame rate rather than resolution.
 * (The browser's defaults favour smooth motion and quietly shrink the picture.)
 * @param {SimplePeer} peer
 */
async function tuneVideoSender(peer) {
    const pc = peer._pc;   // SimplePeer keeps its RTCPeerConnection here
    if (!pc) return;

    for (const sender of pc.getSenders()) {
        if (!sender.track || sender.track.kind !== 'video') continue;

        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];

        const width = sender.track.getSettings().width || MAX_SEND_WIDTH;
        params.encodings[0].maxBitrate = MAX_VIDEO_BITRATE;
        params.encodings[0].scaleResolutionDownBy = Math.max(1, width / MAX_SEND_WIDTH);
        params.degradationPreference = 'maintain-resolution';

        try {
            await sender.setParameters(params);
            console.log(`[QUALITY] Sending ${Math.round(width / params.encodings[0].scaleResolutionDownBy)}px wide, up to ${MAX_VIDEO_BITRATE / 1e6} Mbps`);
        } catch (err) {
            console.warn('[QUALITY] Could not tune video sender:', err);
        }
    }
}

/**
 * Summarise what every peer connection is really sending and receiving right now.
 * Handy in the browser console: `await streamStats()`
 * @param {Object} state - Application state object
 * @returns {Promise<Object[]>}
 */
async function streamStats(state) {
    const report = [];
    for (const [userId, peer] of state.peers) {
        if (!peer._pc) continue;
        const stats = await peer._pc.getStats();
        stats.forEach(s => {
            if (s.kind !== 'video' || (s.type !== 'outbound-rtp' && s.type !== 'inbound-rtp')) return;
            report.push({
                peer: userId,
                direction: s.type === 'outbound-rtp' ? 'sending' : 'receiving',
                size: `${s.frameWidth}x${s.frameHeight}`,
                fps: Math.round(s.framesPerSecond || 0),
                bytes: s.type === 'outbound-rtp' ? s.bytesSent : s.bytesReceived,
                limitedBy: s.qualityLimitationReason || 'none'
            });
        });
    }
    return report;
}

/**
 * Create WebRTC peer connection with SimplePeer
 * @param {string} userId - Remote user ID
 * @param {string} username - Remote username
 * @param {boolean} initiator - Whether this peer initiates the connection
 * @param {Object} state - Application state object
 * @param {Function} removeCamera - Function to remove camera from UI
 * @param {Function} addCamera - Function to add camera to UI
 * @param {Function} showToast - Toast notification function
 * @returns {SimplePeer} - The created peer instance
 */
function createPeerConnection(userId, username, initiator, state, { removeCamera, addCamera, showToast }) {
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
        tuneVideoSender(peer);
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

// ES6 Module Exports
export {
    initializeSocketIO,
    createPeerConnection,
    streamStats
};
