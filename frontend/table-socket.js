/**
 * Table Socket Module
 * The Socket.IO connection to the table: the shared table state the server keeps (life
 * totals, counters, commanders, orientation, turns, rolls, resets, who is playing and who
 * is watching). The cameras go through the video server instead (media.js); this
 * connection only hands out the ticket for it.
 */

/**
 * The table knows this browser as 'local'; the server knows it by its player id
 */
function keyOf(userId, state) {
    return userId === state.playerId ? 'local' : userId;
}

/**
 * Initialize Socket.IO connection and set up event handlers
 * @param {string} API_URL - Server API URL
 * @param {Object} state - Application state object
 * @param {Object} handlers - { upsertPlayer, removePlayer, showToast, logEvent, showRoll, setTurn,
 *                              receiveChatMessage, applyTable, setSpectators, roleChanged,
 *                              tableClosed, connectMedia, answerScanRequest }
 */
function initializeSocketIO(API_URL, state, handlers) {
    const { upsertPlayer, removePlayer, showToast, logEvent,
            showRoll, setTurn, receiveChatMessage, applyTable, roleChanged } = handlers;
    console.log('Connecting to Socket.IO server...');

    state.socket = io(API_URL, {
        transports: ['websocket', 'polling']
    });

    const addSpectator = (user) => {
        state.spectators.set(user.userId, user.username);
        handlers.setSpectators();
    };
    const removeSpectator = (userId) => {
        if (state.spectators.delete(userId)) handlers.setSpectators();
    };

    state.socket.on('connect', () => {
        console.log('✓ Connected to signaling server');

        // Sit down at the table (or back in our seat: the server knows our player id).
        // After a server restart it doesn't, so our life total and commanders come along.
        const me = state.players.get('local');
        state.socket.emit('join', {
            room: state.room,
            playerId: state.playerId,
            role: state.role,
            username: state.username,
            flipH: state.flipH,
            flipV: state.flipV,
            // After a server restart our table is gone: we bring it (and our life total) back
            ...(state.hasJoinedRoom ? { recreate: state.tableInfo } : {}),
            ...(state.hasJoinedRoom && me ? { hp: me.hp, commanders: me.commanders } : {})
        });
        state.hasJoinedRoom = true;
    });

    state.socket.on('join-error', ({ code, message }) => {
        if (code === 'not-found') handlers.tableClosed();
        else showToast(message, 'error');
    });

    state.socket.on('existing-users', ({ users, you, table }) => {
        console.log(`Found ${users.length} others at the table:`, users);
        const wasRole = state.role;
        state.role = you.role;
        applyTable(table);
        if (you.role === 'player') upsertPlayer('local', you, { quiet: true });
        else removePlayer('local');
        if (wasRole !== you.role) roleChanged();

        users.forEach(user => {
            if (user.role === 'spectator') addSpectator(user);
            else upsertPlayer(user.userId, user, { quiet: true });
        });
        setTurn(table.turn);

        // Into the table's video room (also after a lost connection: the ticket is per seat)
        handlers.connectMedia();
    });

    state.socket.on('user-joined', ({ user, table, rejoined }) => {
        console.log(`${rejoined ? 'Back' : 'Joined'}: ${user.username} (${user.userId})`);

        if (user.role === 'spectator') {
            addSpectator(user);
            showToast(`${user.username} is watching`, 'info');
            logEvent(`<b>${escape(user.username)}</b> is watching`);
        } else {
            upsertPlayer(user.userId, user, { quiet: true });
            showToast(rejoined ? `${user.username} is back` : `${user.username} joined the table`, 'info');
            logEvent(`<b>${escape(user.username)}</b> ${rejoined ? 'is back' : 'joined'}`);
        }
        applyTable(table);
        setTurn(table.turn);
    });

    state.socket.on('user-left', ({ userId }) => {
        console.log(`User left: ${userId}`);

        const player = state.players.get(userId);
        if (player) {
            showToast(`${player.username} left the table`, 'info');
            logEvent(`<b>${escape(player.username)}</b> left`);
        }
        removePlayer(userId);
        removeSpectator(userId);
    });

    state.socket.on('disconnect', () => {
        console.log('✗ Disconnected from signaling server');
        showToast('Lost the connection to the table, reconnecting…', 'warning');

        // We get everybody again when we're back, so start from a clean table
        for (const id of [...state.players.keys()]) {
            if (id !== 'local') removePlayer(id);
        }
        state.spectators.clear();
        handlers.setSpectators();
        setTurn({ order: [], current: null, number: 0 });
    });

    // Someone's life, counters, commanders, name, orientation, connection or role changed
    // (possibly our own). upsertPlayer -> updateTile logs life and commander changes itself.
    state.socket.on('player-updated', (user) => {
        const id = keyOf(user.userId, state);

        if (user.role === 'spectator') {
            if (id !== 'local') addSpectator(user);
            return;
        }

        // A spectator took a seat
        const newPlayer = !state.players.has(id);
        if (newPlayer) {
            removeSpectator(user.userId);
            if (id === 'local') {
                state.role = 'player';
                roleChanged();
                // Our ticket only allowed watching: a new one lets us send our camera
                handlers.connectMedia();
            } else {
                logEvent(`<b>${escape(user.username)}</b> took a seat`);
            }
        }

        // (Dropped out: the seat stays, shown as reconnecting; the video server takes their
        // camera away by itself)
        upsertPlayer(id, user, { quiet: newPlayer });
    });

    state.socket.on('markers-changed', ({ markers, marker, by }) => {
        const holder = markers[marker];
        applyTable({ markers });
        const name = holder ? (holder === state.playerId ? 'You' : state.players.get(holder)?.username || '?') : null;
        const label = marker === 'monarch' ? 'the monarch' : 'the initiative';
        logEvent(name
            ? `<b>${escape(name)}</b> ${name === 'You' ? 'have' : 'has'} ${label}`
            : `${escape(by)} removed ${label}`);
    });

    state.socket.on('table-reset', ({ what, by, players, table }) => {
        applyTable(table);
        for (const player of players) upsertPlayer(keyOf(player.userId, state), player, { quiet: true });

        const label = { life: `life (${table.startingLife})`, commanders: 'commanders', all: 'everything' }[what];
        showToast(`${by} reset ${label}`, 'info');
        logEvent(`<b>${escape(by)}</b> reset ${label}`);
        // A reset of life starts a new game, with a newly shuffled turn order
        setTurn(table.turn, what === 'commanders' ? {} : { action: 'start', by });
    });

    state.socket.on('turn-changed', ({ turn, action, by }) => setTurn(turn, { action, by }));

    state.socket.on('rolled', ({ userId, username, kind, result }) => {
        showRoll({ userId, username, kind, result });
    });

    // Someone tapped a card on our camera: scan it from the original picture
    state.socket.on('scan-request', async (request, reply) => {
        reply(await handlers.answerScanRequest(request));
    });

    state.socket.on('chat-message', ({ userId, username, message }) => {
        receiveChatMessage({ userId, username, message });
    });
}

function escape(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ES6 Module Exports
export {
    initializeSocketIO,
    keyOf
};
