/**
 * WebRTC Manager Module
 * Handles Socket.IO connections, WebRTC peer connections, signaling, and the shared
 * table state the server keeps (life totals, commanders, orientation, rolls, resets).
 */

/**
 * The table knows this browser as 'local'; the server knows it by its socket id
 */
function keyOf(userId, state) {
    return userId === state.socket?.id ? 'local' : userId;
}

/**
 * Initialize Socket.IO connection and set up event handlers
 * @param {string} API_URL - Server API URL
 * @param {Object} state - Application state object
 * @param {Object} handlers - { upsertPlayer, setPlayerStream, removePlayer, createPeerConnection,
 *                              showToast, logEvent, showRoll }
 */
function initializeSocketIO(API_URL, state, handlers) {
    const { upsertPlayer, setPlayerStream, removePlayer, createPeerConnection, showToast, logEvent, showRoll } = handlers;
    console.log('Connecting to Socket.IO server...');

    state.socket = io(API_URL, {
        transports: ['websocket', 'polling']
    });

    state.socket.on('connect', () => {
        console.log('✓ Connected to signaling server');

        // Join the room. After a dropped connection our life total and commanders come
        // along, so the server carries on where it was.
        const me = state.players.get('local');
        state.socket.emit('join', {
            username: state.username,
            flipH: state.flipH,
            flipV: state.flipV,
            ...(state.hasJoinedRoom && me ? { hp: me.hp, commanders: me.commanders } : {})
        });
        state.hasJoinedRoom = true;
    });

    state.socket.on('existing-users', ({ users, you, startingLife }) => {
        console.log(`Found ${users.length} existing users:`, users);
        state.startingLife = startingLife;
        upsertPlayer('local', you, { quiet: true });

        // Create peer connections to existing users
        users.forEach(user => {
            upsertPlayer(user.userId, user, { quiet: true });
            createPeerConnection(user.userId, true);
        });
    });

    state.socket.on('user-joined', (user) => {
        console.log(`New user joined: ${user.username} (${user.userId})`);
        showToast(`${user.username} joined the table`, 'info');
        logEvent(`<b>${escape(user.username)}</b> joined`);

        // Placeholder tile until their video arrives; the peer is created on their signal
        upsertPlayer(user.userId, user, { quiet: true });
    });

    state.socket.on('user-left', ({ userId }) => {
        console.log(`User left: ${userId}`);

        // Clean up peer connection
        const peer = state.peers.get(userId);
        if (peer) {
            peer.destroy();
            state.peers.delete(userId);
        }

        const player = state.players.get(userId);
        if (player) {
            showToast(`${player.username} left the table`, 'info');
            logEvent(`<b>${escape(player.username)}</b> left`);
        }
        removePlayer(userId);
    });

    state.socket.on('signal', ({ from, signal }) => {
        console.log(`Received signal from ${from}`, signal.type);

        let peer = state.peers.get(from);

        // If we don't have a peer yet, create one (they initiated)
        if (!peer || peer.destroyed) {
            console.log(`Creating new peer connection for incoming signal from ${from}`);
            peer = createPeerConnection(from, false);
        } else if (signal.type === 'offer') {
            // Ignore duplicate offers if peer already exists and is connecting
            console.warn(`Ignoring duplicate offer from ${from} - peer already exists`);
            return;
        }

        try {
            peer.signal(signal);
        } catch (err) {
            console.error(`Error handling signal from ${from}:`, err);
        }
    });

    state.socket.on('disconnect', () => {
        console.log('✗ Disconnected from signaling server');
        showToast('Lost the connection to the table, reconnecting…', 'warning');

        // Everyone gets a new id when we're back, so start from a clean table
        for (const peer of state.peers.values()) peer.destroy();
        state.peers.clear();
        for (const id of [...state.players.keys()]) {
            if (id !== 'local') removePlayer(id);
        }
    });

    state.socket.on('camera-status-changed', ({ userId, enabled }) => {
        console.log('[CAMERA STATUS] Received camera-status-changed event:', { userId, enabled });

        if (enabled) {
            // They enabled camera - they will recreate peer connection as initiator
            // We should destroy our old peer and wait for their new offer
            const existingPeer = state.peers.get(userId);
            if (existingPeer) {
                existingPeer.destroy();
                state.peers.delete(userId);
            }
        }
        // Placeholder until (if) the new video arrives
        setPlayerStream(userId, null);
    });

    // Someone's life, commanders, name or orientation changed (possibly our own)
    state.socket.on('player-updated', (player) => {
        const id = keyOf(player.userId, state);
        const before = state.players.get(id);
        if (!before) return;
        const oldCommanders = before.commanders.map(c => c.name).join(' & ');
        upsertPlayer(id, player);

        const newCommanders = player.commanders.map(c => c.name).join(' & ');
        if (newCommanders && newCommanders !== oldCommanders) {
            logEvent(`<b>${escape(player.username)}</b> plays <b>${escape(newCommanders)}</b>`);
        }
    });

    state.socket.on('table-reset', ({ what, by, startingLife, players }) => {
        state.startingLife = startingLife;
        for (const player of players) upsertPlayer(keyOf(player.userId, state), player, { quiet: true });

        const label = { life: `life (${startingLife})`, commanders: 'commanders', all: 'everything' }[what];
        showToast(`${by} reset ${label}`, 'info');
        logEvent(`<b>${escape(by)}</b> reset ${label}`);
    });

    state.socket.on('rolled', ({ userId, username, kind, result }) => {
        showRoll({ userId, username, kind, result });
    });
}

function escape(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
 * @param {boolean} initiator - Whether this peer initiates the connection
 * @param {Object} state - Application state object
 * @param {Object} handlers - { upsertPlayer, setPlayerStream, showToast }
 * @returns {SimplePeer} - The created peer instance
 */
function createPeerConnection(userId, initiator, state, { upsertPlayer, setPlayerStream, showToast }) {
    // Check if peer already exists
    const existingPeer = state.peers.get(userId);
    if (existingPeer && !existingPeer.destroyed) {
        return existingPeer;
    }

    console.log(`[CREATE PEER] Creating new SimplePeer for ${userId} (initiator: ${initiator})`);

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
    }

    const peer = new SimplePeer(peerConfig);
    const nameOf = () => state.players.get(userId)?.username || 'a player';

    peer.on('signal', signal => {
        state.socket.emit('signal', {
            to: userId,
            signal: signal
        });
    });

    peer.on('stream', remoteStream => {
        console.log(`✓ Received stream from ${nameOf()}`, remoteStream.getTracks());
        if (!state.players.has(userId)) upsertPlayer(userId, {});

        // Check if stream has active tracks
        const hasActiveTracks = remoteStream.getTracks().some(track => track.enabled && track.readyState === 'live');
        setPlayerStream(userId, hasActiveTracks ? remoteStream : null, peer);
    });

    peer.on('connect', () => {
        console.log(`✓ Peer connected: ${nameOf()}`);
        tuneVideoSender(peer);
    });

    peer.on('error', err => {
        console.error(`Peer connection error with ${userId}:`, err);
        showToast(`Connection problem with ${nameOf()}`, 'error');
    });

    peer.on('close', () => {
        console.log(`Peer connection closed with ${userId}`);
        if (state.peers.get(userId) === peer) state.peers.delete(userId);
        // Only clear the video this connection delivered (a newer one may have replaced it)
        if (state.players.get(userId)?.streamPeer === peer) setPlayerStream(userId, null);
    });

    state.peers.set(userId, peer);
    return peer;
}

// ES6 Module Exports
export {
    initializeSocketIO,
    createPeerConnection,
    streamStats,
    keyOf
};
