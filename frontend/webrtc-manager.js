/**
 * WebRTC Manager Module
 * Handles Socket.IO connections, WebRTC peer connections, signaling, and the shared
 * table state the server keeps (life totals, commanders, orientation, rolls, resets).
 */

import { IS_MOBILE } from './camera-manager.js';

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
 *                              showToast, logEvent, showRoll, receiveChatMessage }
 */
function initializeSocketIO(API_URL, state, handlers) {
    const { upsertPlayer, setPlayerStream, removePlayer, createPeerConnection, showToast, logEvent, showRoll, setTurn, receiveChatMessage } = handlers;
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

    state.socket.on('existing-users', ({ users, you, startingLife, turn }) => {
        console.log(`Found ${users.length} existing users:`, users);
        state.startingLife = startingLife;
        upsertPlayer('local', you, { quiet: true });

        // Create peer connections to existing users
        users.forEach(user => {
            upsertPlayer(user.userId, user, { quiet: true });
            createPeerConnection(user.userId, true);
        });
        setTurn(turn);
    });

    state.socket.on('user-joined', (user) => {
        console.log(`New user joined: ${user.username} (${user.userId})`);
        showToast(`${user.username} joined the table`, 'info');
        logEvent(`<b>${escape(user.username)}</b> joined`);

        // Placeholder tile until their video arrives; the peer is created on their signal
        upsertPlayer(user.userId, user, { quiet: true });
        setTurn(user.turn);
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
        } else if (signal.type === 'offer' && peer.initiator && !peer.connected) {
            // Both sides tried to open the connection at once: keep ours.
            // (Any other offer on an existing connection is a renegotiation and must go through:
            // e.g. a player who joined without a camera only receives our video that way.)
            console.warn(`Ignoring offer from ${from} - our own connection attempt is still pending`);
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
        setTurn({ order: [], current: null, number: 0 });
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

    // Someone's life, commanders, name or orientation changed (possibly our own).
    // upsertPlayer -> updateTile logs life and commander changes itself.
    state.socket.on('player-updated', (player) => {
        const id = keyOf(player.userId, state);
        if (!state.players.get(id)) return;
        upsertPlayer(id, player);
    });

    state.socket.on('table-reset', ({ what, by, startingLife, players, turn }) => {
        state.startingLife = startingLife;
        for (const player of players) upsertPlayer(keyOf(player.userId, state), player, { quiet: true });

        const label = { life: `life (${startingLife})`, commanders: 'commanders', all: 'everything' }[what];
        showToast(`${by} reset ${label}`, 'info');
        logEvent(`<b>${escape(by)}</b> reset ${label}`);
        // A reset of life starts a new game, with a newly shuffled turn order
        setTurn(turn, what === 'commanders' ? {} : { action: 'start', by });
    });

    state.socket.on('turn-changed', ({ turn, action, by }) => setTurn(turn, { action, by }));

    state.socket.on('rolled', ({ userId, username, kind, result }) => {
        showRoll({ userId, username, kind, result });
    });

    state.socket.on('chat-message', ({ userId, username, message }) => {
        receiveChatMessage({ userId, username, message });
    });
}

function escape(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Outgoing video: high bitrate and resolution capped at 1080p so peers see card text clearly
// without every player having to encode 4K for every other player
const MAX_VIDEO_BITRATE = IS_MOBILE ? 4_000_000 : 8_000_000;   // bits per second
const MAX_SEND_WIDTH = 1920;

/**
 * Configure the outgoing video of a peer connection for detail: a high bitrate ceiling,
 * and when bandwidth or CPU runs short, drop frame rate rather than resolution.
 * (The browser's defaults favour smooth motion and quietly shrink the picture.)
 * Phones run short on CPU all the time, and dropping frames makes them stutter, so they
 * keep the browser's balance between sharpness and smoothness.
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
        params.degradationPreference = IS_MOBILE ? 'balanced' : 'maintain-resolution';

        try {
            await sender.setParameters(params);
            console.log(`[QUALITY] Sending ${Math.round(width / params.encodings[0].scaleResolutionDownBy)}px wide, up to ${MAX_VIDEO_BITRATE / 1e6} Mbps, ${params.degradationPreference}`);
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
            const sending = s.type === 'outbound-rtp';
            report.push({
                peer: userId,
                direction: sending ? 'sending' : 'receiving',
                codec: stats.get(s.codecId)?.mimeType || '?',
                // e.g. "libvpx" / "OpenH264" (software) or "MediaCodec" / "VideoToolbox" (hardware)
                implementation: (sending ? s.encoderImplementation : s.decoderImplementation) || '?',
                hardware: sending ? s.powerEfficientEncoder : s.powerEfficientDecoder,
                size: `${s.frameWidth}x${s.frameHeight}`,
                fps: Math.round(s.framesPerSecond || 0),
                bytes: sending ? s.bytesSent : s.bytesReceived,
                limitedBy: s.qualityLimitationReason || 'none'
            });
        });
    }
    return report;
}

/**
 * Put H.264 first in the video codecs of an offer or answer. Phones encode and decode
 * H.264 in hardware, while the browser's default (VP8) runs in software on iPhones and on
 * many Android phones: several VP8 streams at once is what makes phone video stutter.
 * Constrained-baseline H.264 (packetization-mode=1) goes first, as every hardware codec
 * supports it. If one side has no H.264, the other codecs are still there to fall back on.
 * @param {string} sdp
 * @returns {string}
 */
function preferH264(sdp) {
    const lines = sdp.split('\r\n');
    lines.forEach((line, start) => {
        if (!line.startsWith('m=video')) return;
        let end = lines.findIndex((l, i) => i > start && l.startsWith('m='));
        if (end < 0) end = lines.length;
        const section = lines.slice(start, end);

        const fmtp = (pt) => section.find(l => l.startsWith(`a=fmtp:${pt} `)) || '';
        const h264 = section
            .map(l => l.match(/^a=rtpmap:(\d+) H264\/90000/i)?.[1])
            .filter(Boolean);
        if (!h264.length) return;
        const rank = (pt) => (fmtp(pt).includes('packetization-mode=1') ? 0 : 2) +
                             (/profile-level-id=42e0/i.test(fmtp(pt)) ? 0 : 1);
        const preferred = [...h264].sort((a, b) => rank(a) - rank(b));

        const [media, port, proto, ...payloads] = line.split(' ');
        lines[start] = [media, port, proto,
            ...preferred.filter(pt => payloads.includes(pt)),
            ...payloads.filter(pt => !preferred.includes(pt))].join(' ');
    });
    return lines.join('\r\n');
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
            // window.MANAMESH_TURN is set by frontend/turn-config.js (gitignored, holds a
            // credential - see turn-config.js.example) for peers behind strict NAT/CGNAT
            // where STUN alone can't establish a direct link. Falls back to STUN-only if absent.
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' },
                ...(window.MANAMESH_TURN ? [window.MANAMESH_TURN] : [])
            ]
        }
    };

    // Add stream if we have one
    if (state.localStream) {
        peerConfig.stream = state.localStream;
    }

    // Any connection a phone is part of uses H.264: the phone lists it first in its offers
    // and answers, and the other side then sends that way too
    if (IS_MOBILE) peerConfig.sdpTransform = preferH264;

    const peer = new SimplePeer(peerConfig);
    const nameOf = () => state.players.get(userId)?.username || 'a player';

    peer.on('signal', signal => {
        state.socket.emit('signal', {
            to: userId,
            signal: signal
        });
        // Cap the outgoing video as soon as it is negotiated, not only once connected:
        // otherwise the first seconds go out at full capture size (4K on some cameras)
        if (signal.type === 'offer' || signal.type === 'answer') tuneVideoSender(peer);
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
