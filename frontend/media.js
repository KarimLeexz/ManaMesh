/**
 * Media Module
 * The cameras, through the video server (LiveKit, an SFU): every player sends their camera
 * up once, and the server forwards each viewer what they need.
 *
 * - Each camera is sent in three qualities at once (simulcast): full size, 540p and 216p.
 * - adaptiveStream: every tile receives the quality that fits its size on screen (the big
 *   camera sharp enough to read and scan cards, small tiles a smaller version) and nothing
 *   while it isn't visible. dynacast: a quality nobody watches isn't even sent.
 * - Spectators cost the players nothing: they receive from the server, not from them.
 *
 * The table's state (life, turns, chat...) doesn't go through here but through Socket.IO,
 * which also hands out the ticket (token) for the video room.
 */

import { IS_MOBILE } from './camera-manager.js';

const LK = window.LivekitClient;

// Upload for our camera's sharpest version, 1080p (the 540p and 216p versions add about
// 1 Mbit/s). Sent once, whoever watches. Card text survives compression far better with
// room to spare: LiveKit's own 1080p default (3 Mbit/s at 30 fps) is meant for faces.
const UPLOAD_BITRATES = { low: 1_500_000, normal: 4_000_000, high: 8_000_000 };
const MAX_FRAMERATE = 24;   // cards lie still: bits are better spent on sharpness

let state = null;
let handlers = null;
let room = null;
let connecting = null;
let publication = null;        // our camera, once it is published
let connectedAs = null;        // the role our ticket was for
const remoteTracks = new Map();   // player id -> their camera track

/**
 * @param {Object} appState - Application state
 * @param {Object} appHandlers - { setPlayerStream, showToast }
 */
function initMedia(appState, appHandlers) {
    state = appState;
    handlers = appHandlers;
    if (!LK) console.error('livekit-client did not load: no cameras');
}

function keyOf(identity) {
    return identity === state.playerId ? 'local' : identity;
}

/**
 * Join the table's video room (again). Called once we've sat down (or taken a seat, which
 * needs a new ticket that allows sending).
 */
async function connectMedia() {
    if (!LK || !state.socket) return;
    if (connecting) return connecting;
    // Already in with the right ticket (e.g. only the table connection dropped): just
    // hand the cameras to the new tiles
    if (room?.state === LK.ConnectionState.Connected && connectedAs === state.role) {
        syncTracks();
        return;
    }
    connecting = (async () => {
        await disconnectMedia();

        const ticket = await state.socket.emitWithAck('media-token');
        if (!ticket?.token) {
            handlers.showToast(ticket?.error || 'The video server cannot be reached', 'error');
            return;
        }
        const url = ticket.url || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/livekit`;

        room = new LK.Room({
            // Twice the tile's size on screen: the big camera gets the full 1080p version,
            // sharp enough to scan cards from; small tiles the 540p one
            adaptiveStream: { pixelDensity: 2 },
            dynacast: true,
            disconnectOnPageLeave: true
        });
        room
            .on(LK.RoomEvent.TrackSubscribed, (track, _publication, participant) => {
                if (track.kind !== LK.Track.Kind.Video) return;
                remoteTracks.set(participant.identity, track);
                showTrack(participant.identity);
            })
            .on(LK.RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
                if (remoteTracks.get(participant.identity) !== track) return;
                remoteTracks.delete(participant.identity);
                if (state.players.has(keyOf(participant.identity))) handlers.setPlayerStream(keyOf(participant.identity), null);
            })
            .on(LK.RoomEvent.Reconnecting, () => handlers.showToast('Video connection lost, reconnecting…', 'warning'))
            .on(LK.RoomEvent.Reconnected, () => handlers.showToast('Video is back', 'success'))
            .on(LK.RoomEvent.Disconnected, (reason) => console.log('[MEDIA] Disconnected', reason));

        try {
            await room.connect(url, ticket.token);
            connectedAs = state.role;
            console.log(`[MEDIA] Connected to ${url} as ${state.role}`);
        } catch (err) {
            console.error('[MEDIA] Could not connect:', err);
            handlers.showToast('Could not connect to the video server', 'error');
            room = null;
            return;
        }
        if (state.localStream) await publishCamera(state.localStream);
    })();
    try {
        await connecting;
    } finally {
        connecting = null;
    }
}

async function disconnectMedia() {
    publication = null;
    for (const identity of [...remoteTracks.keys()]) {
        remoteTracks.delete(identity);
        if (state.players.has(keyOf(identity))) handlers.setPlayerStream(keyOf(identity), null);
    }
    if (room) {
        const old = room;
        room = null;
        await old.disconnect();
    }
}

/** Put a player's camera on their tile, if both are there */
function showTrack(identity) {
    const id = keyOf(identity);
    const track = remoteTracks.get(identity);
    const player = state.players.get(id);
    if (track && player && player.track !== track) handlers.setPlayerStream(id, track);
}

/**
 * Tiles come and go with the table state, cameras with the video room: whichever arrives
 * second connects the two
 */
function syncTracks() {
    for (const identity of remoteTracks.keys()) showTrack(identity);
}

function publishOptions() {
    return {
        source: LK.Track.Source.Camera,
        name: 'camera',
        simulcast: true,
        videoSimulcastLayers: [LK.VideoPresets.h216, LK.VideoPresets.h540],
        videoEncoding: {
            maxBitrate: UPLOAD_BITRATES[state.uploadLevel] || UPLOAD_BITRATES.normal,
            maxFramerate: MAX_FRAMERATE
        },
        // Phones encode H.264 in hardware; everything decodes it
        videoCodec: IS_MOBILE ? 'h264' : 'vp8',
        // Keep the picture sharp and give up frames when short; phones keep the balance
        degradationPreference: IS_MOBILE ? 'balanced' : 'maintain-resolution'
    };
}

/**
 * Send our camera to the table (or a different one: the running stream's track is swapped)
 * @param {MediaStream} stream
 */
async function publishCamera(stream) {
    if (!room || room.state !== LK.ConnectionState.Connected || state.role !== 'player') return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    if (publication?.track) {
        if (publication.track.mediaStreamTrack !== track) await publication.track.replaceTrack(track, true);
        return;
    }
    try {
        publication = await room.localParticipant.publishTrack(track, publishOptions());
        console.log(`[MEDIA] Camera published (${publishOptions().videoCodec}, up to ${publishOptions().videoEncoding.maxBitrate / 1e6} Mbps)`);
    } catch (err) {
        console.error('[MEDIA] Could not send the camera:', err);
        handlers.showToast('Could not send your camera to the table', 'error');
    }
}

/** Stop sending our camera (the track itself belongs to camera-manager.js) */
async function unpublishCamera() {
    const track = publication?.track;
    publication = null;
    if (room && track) await room.localParticipant.unpublishTrack(track, false);
}

/** The upload setting changed: send the camera again with the new limit */
async function setUploadLevel() {
    if (!publication || !state.localStream) return;
    await unpublishCamera();
    await publishCamera(state.localStream);
}

/**
 * What goes out and comes in right now. Handy in the browser console: `await streamStats()`
 * @returns {Object[]}
 */
function mediaStats() {
    if (!room) return [{ connected: false }];
    const rows = [];
    if (publication?.track) {
        const { width, height } = publication.track.dimensions || {};
        rows.push({ who: 'you (sending)', size: `${width}x${height}`, kbps: Math.round(publication.track.currentBitrate / 1000) });
    }
    for (const [identity, track] of remoteTracks) {
        const video = track.attachedElements?.[0];
        const [width, height] = [video?.videoWidth, video?.videoHeight];
        rows.push({ who: state.players.get(keyOf(identity))?.username || identity, size: `${width}x${height}`, kbps: Math.round(track.currentBitrate / 1000) });
    }
    return rows;
}

// ES6 Module Exports
export {
    initMedia,
    connectMedia,
    disconnectMedia,
    syncTracks,
    publishCamera,
    unpublishCamera,
    setUploadLevel,
    mediaStats
};
