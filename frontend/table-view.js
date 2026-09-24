/**
 * Table View Module
 * The game table: one tile per player (camera, name, life counter, commanders),
 * the two layouts (one big camera + small ones, or all the same size), the tile menu
 * and toasts.
 *
 * Every player has exactly one tile element for their whole stay. Switching layouts
 * only moves tiles around, so videos never restart or flicker.
 */

const ICONS = {
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
    cameraOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M23 7 16 12l7 5z"/><rect x="1" y="5" width="15" height="14" rx="2"/><path d="m2 2 20 20"/></svg>',
    mirror: '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M8 7 3 12l5 5z"/><path d="m16 7 5 5-5 5"/></svg>',
    flip: '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18"/><path d="M7 8l5-5 5 5z"/><path d="m7 16 5 5 5-5"/></svg>',
    focus: '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
    crownSmall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5z"/></svg>',
    turn: '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 4 10 8-10 8z"/><path d="M19 5v14"/></svg>',
    crown: '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5z"/></svg>',
    camera: '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7 16 12l7 5z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
    deck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><rect x="7" y="3" width="12" height="16" rx="2"/><path d="M5 7v12a2 2 0 0 0 2 2h9"/></svg>',
    counters: '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="M9 12h6M12 9v6"/></svg>',
    // Badges on the tile
    poison: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5c-.4 0-.7.2-.9.5C9.3 6 6 10.4 6 14a6 6 0 0 0 12 0c0-3.6-3.3-8-5.1-11-.2-.3-.5-.5-.9-.5z"/></svg>',
    sword: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/></svg>',
    energy: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
    experience: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.3L12 16.7l-6.2 4.5 2.4-7.3L2 9.4h7.6z"/></svg>',
    monarch: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5z"/></svg>',
    initiative: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M4 21V9l8-6 8 6v12z"/><path d="M9 21v-6h6v6"/></svg>',
    skull: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C7 2 3.5 5.6 3.5 10.2c0 2.6 1.2 4.6 3 5.8V19a1 1 0 0 0 1 1h1v-2h2v2h3v-2h2v2h1a1 1 0 0 0 1-1v-3c1.8-1.2 3-3.2 3-5.8C20.5 5.6 17 2 12 2zM8.5 13a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm7 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>'
};

// Badges shown on a tile for counters that aren't zero
const COUNTER_BADGES = [
    { name: 'poison', icon: 'poison', title: 'Poison' },
    { name: 'energy', icon: 'energy', title: 'Energy' },
    { name: 'experience', icon: 'experience', title: 'Experience' }
];

const GRID_GAP = 8;             // px between tiles, matches gap-2
const TILE_RATIO = 16 / 9;
const DELTA_MS = 1800;          // how long "-3" stays above a life counter after the last change
const HOLD_DELAY_MS = 450;      // holding +/- starts repeating after this long...
const HOLD_REPEAT_MS = 110;     // ...once every this often

let state = null;
let hooks = null;

/**
 * @param {Object} appState - Application state
 * @param {Object} appHooks - Actions the tiles trigger:
 *   changeLife(id, delta), scanTile(id, clientX, clientY), openCommanderPicker(tab), openDeck(id),
 *   deckChanged(id),
 *   showCommander(id, index), openSetup(), toggleCamera(), setOwnFlip(key, value), giveTurn(id),
 *   logEvent(html), openCounters(id), playerUpdated(id)
 */
function initTableView(appState, appHooks) {
    state = appState;
    hooks = appHooks;

    new ResizeObserver(() => renderLayout()).observe(document.getElementById('table'));

    document.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('#tileMenu') && !e.target.closest('.menu-btn')) closeTileMenu();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTileMenu(); });
    window.addEventListener('resize', closeTileMenu);
}

// ============================== Players ==============================

/**
 * Create or update a player and their tile
 * @param {string} id - 'local' for this browser, the socket id for everyone else
 * @param {Object} data - Any of: username, hp, commanders, flipH, flipV, isLocal
 * @param {Object} options - { quiet: true } updates the life total without the "+2" bubble
 * @returns {Object} The player
 */
function upsertPlayer(id, data = {}, options = {}) {
    let player = state.players.get(id);
    const isNew = !player;
    if (isNew) {
        player = {
            id,
            isLocal: id === 'local',
            username: 'Player',
            hp: state.startingLife,
            commanders: [],
            flipH: false,          // the player's own setting, seen by everyone
            flipV: false,
            connected: true,
            counters: { poison: 0, energy: 0, experience: 0 },
            cmdDamage: {},         // attacker's player id -> [damage from commander 1, from 2]
            conceded: false,
            out: false,
            deckSize: 0,           // cards in their decklist (the list itself: decklist.js)
            viewFlipH: false,      // an extra flip only this browser applies
            viewFlipV: false,
            stream: null,
            track: null            // another player's camera, from the video server
        };
        state.players.set(id, player);
    }

    const wasOut = player.out;
    const before = { counters: { ...player.counters }, cmdDamage: player.cmdDamage };
    const hadDeck = player.deckSize;
    for (const key of ['username', 'hp', 'commanders', 'flipH', 'flipV', 'connected', 'counters', 'cmdDamage', 'conceded', 'out', 'deckSize']) {
        if (data[key] !== undefined) player[key] = data[key];
    }

    if (isNew) {
        createTile(player);
        renderLayout();
        hooks.tileCreated?.(id);   // their camera may already be there
    } else if (player.out !== wasOut && !options.quiet) {
        hooks.logEvent(player.out
            ? `${ICONS.skull.replace('<svg', '<svg class="inline h-4 w-4 align-[-3px]"')} <b>${escapeHtml(player.username)}</b> is out`
            : `<b>${escapeHtml(player.username)}</b> is back in the game`);
    }
    if (!isNew && !options.quiet) noteCounterChanges(player, before);
    if (player.deckSize !== hadDeck) hooks.deckChanged?.(id);
    updateTile(player, options);
    hooks.playerUpdated?.(id);
    return player;
}

/**
 * Show a player's camera, or the "no camera" placeholder
 * @param {string} id - Player id
 * @param {MediaStream|Object|null} source - Our own camera stream, another player's camera
 *   track from the video server (it attaches itself to the tile's video, which also tells it
 *   how big the tile is, so it can fetch the right quality), or null
 */
function setPlayerStream(id, source) {
    const player = state.players.get(id);
    if (!player) return;
    if (player.track && player.track !== source) player.track.detach(player.video);
    player.track = null;

    const video = player.video;
    if (source?.attach) {
        player.track = source;
        source.attach(video);
        player.stream = video.srcObject;
    } else {
        // Same stream object with a new camera track in it: reattach so the video picks it up
        if (video.srcObject === source) video.srcObject = null;
        video.srcObject = source;
        player.stream = source;
    }
    const showing = !!player.stream;
    // (inline styles: the tile CSS would win over Tailwind's .hidden)
    video.style.display = showing ? '' : 'none';
    player.placeholder.style.display = showing ? 'none' : '';
    if (showing) video.play().catch(() => {});
    updateTile(player, { quiet: true });

    if (!showing) clearOverlay(player);
    if (state.layout === 'focus' && !state.players.has(state.focusId)) renderLayout();
}

function removePlayer(id) {
    const player = state.players.get(id);
    if (!player) return;
    player.track?.detach(player.video);
    player.tile.remove();
    state.players.delete(id);
    if (state.focusId === id) state.focusId = null;
    renderLayout();
}

/**
 * The flip actually applied on this screen: the player's own choice, and on top of
 * it whatever this viewer flipped locally
 */
function effectiveFlip(player) {
    return {
        h: !!player?.flipH !== !!player?.viewFlipH,
        v: !!player?.flipV !== !!player?.viewFlipV
    };
}

// ============================== Tiles ==============================

function createTile(player) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.id = player.id;
    tile.classList.toggle('is-local', player.isLocal);
    tile.innerHTML = `
        <div class="tile-media">
            <div class="tile-placeholder">${ICONS.cameraOff}<span>No camera</span></div>
            <canvas class="tile-canvas"></canvas>
        </div>
        <div class="tile-status"></div>
        <div class="tile-top">
            <div class="tile-title">
                <button class="tile-name" title="Show the decklist"></button>
                <div class="tile-markers"></div>
            </div>
            <div class="tile-tools">
                <button class="tile-icon-btn focus-btn" title="Show big">${ICONS.expand}</button>
                <button class="tile-icon-btn menu-btn" title="Options">${ICONS.dots}</button>
            </div>
        </div>
        <div class="turn-badge"><span class="turn-dot"></span><span class="turn-text"></span></div>
        <div class="tile-bottom">
            <div class="commanders"></div>
            <div class="tile-counters">
                <div class="counter-badges"></div>
                <button class="tile-icon-btn counters-btn" title="Counters &amp; commander damage">${ICONS.counters}</button>
            </div>
            <div class="life">
                <button class="life-btn" data-life="-1" aria-label="Lose 1 life">−</button>
                <span class="life-value"></span>
                <button class="life-btn" data-life="1" aria-label="Gain 1 life">+</button>
                <span class="life-delta"></span>
            </div>
        </div>
    `;

    const video = document.createElement('video');
    video.className = 'tile-video';
    video.style.display = 'none';
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;    // video only, and never echo ourselves
    tile.querySelector('.tile-media').prepend(video);

    player.tile = tile;
    player.video = video;
    player.placeholder = tile.querySelector('.tile-placeholder');
    player.shownHp = null;
    player.delta = 0;
    player.shownCommanders = null;

    // Tap on the tile: a small tile becomes the big one; on a big one, scan the card there
    tile.addEventListener('click', (e) => {
        if (e.target.closest('.tile-top > *, .tile-bottom > *, .suggestions')) return;
        if (tile.classList.contains('is-thumb')) {
            setFocus(player.id);
        } else if (player.stream) {
            hooks.scanTile(player.id, e.clientX, e.clientY);
        }
    });

    tile.querySelector('.focus-btn').addEventListener('click', () => {
        setFocus(player.id);
        setLayout('focus');
    });
    tile.querySelector('.menu-btn').addEventListener('click', (e) => {
        const menu = document.getElementById('tileMenu');
        if (!menu.classList.contains('hidden') && menu.dataset.for === player.id) closeTileMenu();
        else openTileMenu(player.id, e.currentTarget);
    });

    tile.querySelector('.commanders').addEventListener('click', (e) => {
        const chip = e.target.closest('.commander-chip');
        if (chip) hooks.showCommander(player.id, Number(chip.dataset.index));
        else if (e.target.closest('.commander-add')) hooks.openCommanderPicker();
    });

    tile.querySelectorAll('.life-btn').forEach(btn => setupLifeButton(btn, player.id));
    tile.querySelector('.tile-counters').addEventListener('click', () => hooks.openCounters(player.id));
    tile.querySelector('.tile-name').addEventListener('click', () => hooks.openDeck(player.id));
    tile.querySelector('.tile-markers').addEventListener('click', () => hooks.openCounters(player.id));
}

/**
 * +/- buttons: tap for 1, hold to keep counting
 */
function setupLifeButton(btn, id) {
    const delta = Number(btn.dataset.life);
    let timer = null;
    const stop = () => { clearTimeout(timer); timer = null; };

    btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        hooks.changeLife(id, delta);
        const repeat = () => { hooks.changeLife(id, delta); timer = setTimeout(repeat, HOLD_REPEAT_MS); };
        timer = setTimeout(repeat, HOLD_DELAY_MS);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => btn.addEventListener(ev, stop));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    // Keyboard (Enter / Space) produces a click without a pointer
    btn.addEventListener('click', (e) => { if (e.detail === 0) hooks.changeLife(id, delta); });
}

/**
 * Bring a tile up to date with its player's state
 */
function updateTile(player, { quiet = false } = {}) {
    const tile = player.tile;
    if (!tile) return;

    const name = player.isLocal ? `${player.username} (you)` : player.username;
    tile.querySelector('.tile-name').innerHTML = `<span class="truncate">${escapeHtml(name)}</span>${player.deckSize ? ICONS.deck : ''}`;

    // Orientation
    const flip = effectiveFlip(player);
    player.video.style.transform = `scale(${flip.h ? -1 : 1}, ${flip.v ? -1 : 1})`;

    // Life
    const life = tile.querySelector('.life');
    const value = tile.querySelector('.life-value');
    if (player.shownHp !== null && player.hp !== player.shownHp && !quiet) {
        showLifeDelta(player, player.hp - player.shownHp);
        value.classList.remove('life-bump');
        void value.offsetWidth;   // restart the animation
        value.classList.add('life-bump');
    }
    player.shownHp = player.hp;
    value.textContent = player.hp;
    life.classList.toggle('is-low', player.hp > 0 && player.hp <= 10);
    life.classList.toggle('is-dead', player.hp <= 0);

    // Commanders
    const box = tile.querySelector('.commanders');
    const newCommanders = player.commanders.map(c => c.name).join(' & ');
    if (player.shownCommanders !== null && newCommanders && newCommanders !== player.shownCommanders && !quiet) {
        hooks.logEvent(`<b>${escapeHtml(player.username)}</b> plays <b>${escapeHtml(newCommanders)}</b>`);
    }
    player.shownCommanders = newCommanders;
    if (player.commanders.length) {
        // Small tiles show the art (name as tooltip), big tiles just the name
        box.innerHTML = player.commanders.map((card, i) => `
            <button class="commander-chip tooltip tooltip-right" data-index="${i}" data-tip="${escapeHtml(card.name)}" aria-label="${escapeHtml(card.name)}">
                <img src="${escapeHtml(card.art_url || card.image_url)}" alt="" draggable="false" />
                <span class="commander-name">${ICONS.crownSmall}${escapeHtml(card.name)}</span>
            </button>`).join('');
    } else if (player.isLocal) {
        box.innerHTML = `<button class="commander-add">${ICONS.crown} Commander</button>`;
    } else {
        box.innerHTML = '';
    }
    const hasTurn = state.turnId === player.id;
    tile.classList.toggle('has-turn', hasTurn);
    tile.querySelector('.turn-text').textContent = player.isLocal ? 'Your turn' : `${player.username}'s turn`;

    const art = player.commanders[0]?.art_url;
    player.placeholder.style.backgroundImage = art ? `url("${art}")` : '';
    player.placeholder.querySelector('span').textContent = player.isLocal ? 'Your camera is off' : 'No camera';

    // Counters that aren't zero, the highest commander damage from any one commander
    const badges = COUNTER_BADGES
        .filter(({ name }) => player.counters[name] > 0)
        .map(({ name, icon, title }) => {
            const danger = name === 'poison' && player.counters.poison >= 10;
            return `<span class="counter-badge ${name} ${danger ? 'danger' : ''}" title="${title}">${ICONS[icon]}${player.counters[name]}</span>`;
        });
    const maxCommanderDamage = Math.max(0, ...Object.values(player.cmdDamage).flat());
    if (maxCommanderDamage > 0) {
        badges.unshift(`<span class="counter-badge commander ${maxCommanderDamage >= 21 ? 'danger' : ''}" title="Most commander damage from one commander">${ICONS.sword}${maxCommanderDamage}</span>`);
    }
    tile.querySelector('.counter-badges').innerHTML = badges.join('');

    // Monarch / initiative
    const markers = [];
    if (state.markers?.monarch === serverId(player.id)) markers.push(`<span class="marker-badge monarch" title="The monarch">${ICONS.monarch}</span>`);
    if (state.markers?.initiative === serverId(player.id)) markers.push(`<span class="marker-badge initiative" title="Has the initiative">${ICONS.initiative}</span>`);
    tile.querySelector('.tile-markers').innerHTML = markers.join('');

    // Out of the game / dropped out
    tile.classList.toggle('is-out', !!player.out);
    tile.classList.toggle('is-offline', !player.connected);
    tile.querySelector('.tile-status').innerHTML = !player.connected
        ? `<span class="loading loading-dots loading-sm"></span> Reconnecting…`
        : player.out ? `${ICONS.skull} Out` : '';
}

/** The id the server knows a player by ('local' is us) */
function serverId(id) {
    return id === 'local' ? state.playerId : id;
}

/** The table's id for a server player id ('local' for us) */
function localKey(pid) {
    return pid && pid === state.playerId ? 'local' : pid;
}

function showLifeDelta(player, change) {
    const bubble = player.tile.querySelector('.life-delta');
    player.delta += change;
    clearTimeout(player.deltaTimer);

    if (player.delta === 0) {
        bubble.classList.remove('show');
        return;
    }
    bubble.textContent = player.delta > 0 ? `+${player.delta}` : `${player.delta}`;
    bubble.classList.toggle('up', player.delta > 0);
    bubble.classList.toggle('down', player.delta < 0);
    bubble.classList.add('show');
    player.deltaTimer = setTimeout(() => {
        bubble.classList.remove('show');
        const net = player.delta;
        player.delta = 0;
        hooks.logEvent(`<b>${escapeHtml(player.username)}</b> ${net > 0 ? 'gained' : 'lost'} <b>${Math.abs(net)}</b> life (→ ${player.hp})`);
    }, DELTA_MS);
}

/**
 * Log counter and commander damage changes, summed up once the tapping stops
 * ("Lena: poison +2 (→ 3)") instead of a line per tap
 */
function noteCounterChanges(player, before) {
    const pending = player.pendingCounters ??= {};
    for (const [name, value] of Object.entries(player.counters)) {
        const change = value - (before.counters[name] || 0);
        if (change) pending[name] = (pending[name] || 0) + change;
    }
    const sources = new Set([...Object.keys(before.cmdDamage || {}), ...Object.keys(player.cmdDamage)]);
    for (const source of sources) {
        const total = (hits) => (hits || []).reduce((sum, n) => sum + n, 0);
        const change = total(player.cmdDamage[source]) - total(before.cmdDamage?.[source]);
        if (change) pending[`cmd:${source}`] = (pending[`cmd:${source}`] || 0) + change;
    }
    if (!Object.keys(pending).length) return;

    clearTimeout(player.counterTimer);
    player.counterTimer = setTimeout(() => {
        const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
        const parts = Object.entries(pending).filter(([, n]) => n).map(([key, n]) => {
            if (!key.startsWith('cmd:')) return `${key} ${signed(n)} (→ ${player.counters[key]})`;
            const source = state.players.get(localKey(key.slice(4)));
            const from = source ? (source.isLocal ? 'your' : `${escapeHtml(source.username)}'s`) : 'a';
            return `commander damage ${signed(n)} from ${from} commander`;
        });
        player.pendingCounters = {};
        if (parts.length) hooks.logEvent(`<b>${escapeHtml(player.username)}</b>: ${parts.join(', ')}`);
    }, DELTA_MS);
}

function clearOverlay(player) {
    const canvas = player.tile.querySelector('.tile-canvas');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    player.tile.querySelector('.suggestions')?.remove();
}

/** Mark whose turn it is (state.turnId) on every tile */
function updateTurnMarkers() {
    for (const player of state.players.values()) updateTile(player, { quiet: true });
    renderLayout();   // the turn order is also the seating order
}

/**
 * Players in seating order: the turn order once there is one (anyone not in it yet at
 * the end), otherwise the order they joined in. It doesn't rotate with the turn, so
 * every camera keeps its place.
 */
function seatingOrder() {
    const players = [...state.players.values()];
    const order = state.turn?.order || [];
    if (!order.length) return players;
    const seat = new Map(order.map((pid, i) => [localKey(pid), i]));
    return players.sort((a, b) => (seat.get(a.id) ?? order.length) - (seat.get(b.id) ?? order.length));
}

// ============================== Layout ==============================

/**
 * 'focus': one big camera with everybody else small underneath.
 * 'grid': every camera the same size, as big as fits.
 */
function setLayout(layout) {
    state.layout = layout;
    try { localStorage.setItem('layout', layout); } catch { /* private mode */ }
    document.querySelectorAll('button[data-layout]').forEach(button => {
        const on = button.dataset.layout === layout;
        button.classList.toggle('btn-active', on);
        button.setAttribute('aria-pressed', String(on));
    });
    renderLayout();
}

function setFocus(id) {
    if (!state.players.has(id)) return;
    state.focusId = id;
    renderLayout();
}

/**
 * Who gets the big spot when nobody was picked: the first other player with a camera,
 * otherwise ourselves
 */
function defaultFocus() {
    const players = [...state.players.values()];
    return (players.find(p => !p.isLocal && p.stream) || players.find(p => p.isLocal) || players[0])?.id ?? null;
}

function renderLayout() {
    if (!state) return;
    const table = document.getElementById('table');
    const stage = document.getElementById('stage');
    const strip = document.getElementById('strip');
    const players = seatingOrder();

    table.dataset.layout = state.layout;
    const empty = document.getElementById('emptyTable');
    empty.classList.toggle('hidden', players.length > 0);
    empty.classList.toggle('flex', players.length === 0);

    if (state.layout === 'focus') {
        if (!state.players.has(state.focusId)) state.focusId = defaultFocus();

        stage.style.display = 'block';
        stage.style.gridTemplateColumns = '';
        stage.style.gridAutoRows = '';

        const others = players.filter(p => p.id !== state.focusId);
        strip.style.display = others.length ? 'flex' : 'none';
        strip.style.height = `${Math.round(Math.min(170, Math.max(80, table.clientHeight * 0.2)))}px`;

        arrange(stage, players.filter(p => p.id === state.focusId));
        arrange(strip, others);
        for (const player of players) {
            const isMain = player.id === state.focusId;
            player.tile.classList.toggle('is-main', isMain);
            player.tile.classList.toggle('is-thumb', !isMain);
            player.tile.style.width = '';
            player.tile.style.height = '';
        }
    } else {
        strip.style.display = 'none';
        arrange(stage, players);
        for (const player of players) player.tile.classList.remove('is-main', 'is-thumb');
        fitGrid(stage, players.length);
    }
}

/**
 * Put these players' tiles into a container, in this order. Tiles already in the right
 * spot aren't touched (moving a video can pause it, so moved ones are restarted).
 */
function arrange(container, players) {
    players.forEach((player, i) => {
        if (container.children[i] === player.tile) return;
        container.insertBefore(player.tile, container.children[i] || null);
        if (player.stream) player.video.play().catch(() => {});
    });
}

/**
 * Size a grid so n tiles of 16:9 are as big as possible without scrolling
 */
function fitGrid(stage, n) {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    let best = { cols: 1, tileWidth: 0 };

    for (let cols = 1; cols <= Math.max(1, n); cols++) {
        const rows = Math.ceil(n / cols);
        const tileWidth = Math.min(
            (width - GRID_GAP * (cols - 1)) / cols,
            ((height - GRID_GAP * (rows - 1)) / rows) * TILE_RATIO
        );
        if (tileWidth > best.tileWidth) best = { cols, tileWidth };
    }

    const tileWidth = Math.max(0, Math.floor(best.tileWidth));
    stage.style.display = 'grid';
    stage.style.gap = `${GRID_GAP}px`;
    stage.style.justifyContent = 'center';
    stage.style.alignContent = 'center';
    stage.style.gridTemplateColumns = `repeat(${best.cols}, ${tileWidth}px)`;
    stage.style.gridAutoRows = `${Math.floor(tileWidth / TILE_RATIO)}px`;
}

// ============================== Tile menu ==============================

function openTileMenu(id, anchor) {
    const player = state.players.get(id);
    if (!player) return;
    const menu = document.getElementById('tileMenu');
    const flip = effectiveFlip(player);
    const check = (on) => `<input type="checkbox" class="toggle toggle-sm toggle-primary ml-auto pointer-events-none" ${on ? 'checked' : ''} tabindex="-1" />`;

    const items = [];
    if (player.isLocal) {
        items.push(`<li class="menu-title">Your camera (everyone sees this)</li>`);
        items.push(`<li><a data-action="own-flipH">${ICONS.mirror} Mirror ↔ ${check(player.flipH)}</a></li>`);
        items.push(`<li><a data-action="own-flipV">${ICONS.flip} Upside down ↕ ${check(player.flipV)}</a></li>`);
    } else {
        items.push(`<li class="menu-title">Only on your screen</li>`);
        items.push(`<li><a data-action="view-flipH">${ICONS.mirror} Mirror ↔ ${check(flip.h)}</a></li>`);
        items.push(`<li><a data-action="view-flipV">${ICONS.flip} Upside down ↕ ${check(flip.v)}</a></li>`);
    }
    if (!(state.layout === 'focus' && state.focusId === id)) {
        items.push(`<li><a data-action="focus">${ICONS.focus} Show big</a></li>`);
    }
    if (state.role === 'player' && state.turn?.order.length && state.turnId !== id) {
        items.push(`<li><a data-action="turn">${ICONS.turn} ${player.isLocal ? 'Make it my turn' : `Give ${escapeHtml(player.username)} the turn`}</a></li>`);
    }
    items.push(`<li><a data-action="counters">${ICONS.counters} Counters &amp; commander damage…</a></li>`);
    if (player.isLocal) {
        items.push(`<div class="divider my-0"></div>`);
        items.push(`<li><a data-action="commander">${ICONS.crown} ${player.commanders.length ? 'Change commander' : 'Choose commander'}</a></li>`);
        items.push(`<li><a data-action="decklist">${ICONS.deck.replace('<svg', '<svg class="h-4 w-4"')} ${player.deckSize ? 'Change decklist' : 'Add decklist'}…</a></li>`);
        items.push(`<li><a data-action="setup">${ICONS.camera} Name &amp; camera…</a></li>`);
        items.push(`<li><a data-action="camera">${ICONS.camera} Camera on ${check(state.cameraEnabled)}</a></li>`);
    }

    menu.innerHTML = items.join('');
    menu.dataset.for = id;
    menu.classList.remove('hidden');

    // Next to the button, kept inside the window
    const rect = anchor.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    let top = rect.bottom + 6;
    if (top + box.height > window.innerHeight - 8) top = Math.max(8, rect.top - box.height - 6);
    const left = Math.min(Math.max(8, rect.right - box.width), window.innerWidth - box.width - 8);
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    menu.onclick = (e) => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (!action) return;
        closeTileMenu();
        switch (action) {
            case 'own-flipH': hooks.setOwnFlip('flipH', !player.flipH); break;
            case 'own-flipV': hooks.setOwnFlip('flipV', !player.flipV); break;
            case 'view-flipH': player.viewFlipH = !player.viewFlipH; updateTile(player, { quiet: true }); clearOverlay(player); break;
            case 'view-flipV': player.viewFlipV = !player.viewFlipV; updateTile(player, { quiet: true }); clearOverlay(player); break;
            case 'focus': setFocus(id); setLayout('focus'); break;
            case 'commander': hooks.openCommanderPicker(); break;
            case 'decklist': hooks.openCommanderPicker('deck'); break;
            case 'setup': hooks.openSetup(); break;
            case 'camera': hooks.toggleCamera(); break;
            case 'turn': hooks.giveTurn(id); break;
            case 'counters': hooks.openCounters(id); break;
        }
    };
}

function closeTileMenu() {
    document.getElementById('tileMenu')?.classList.add('hidden');
}

// ============================== Toasts ==============================

const MAX_TOASTS = 3;

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type of toast (info, success, warning, error)
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toasts');
    const toast = document.createElement('div');
    toast.className = `alert alert-${type} alert-soft shadow-lg py-2 text-sm`;
    toast.style.animation = 'slideIn 0.3s ease-out';
    toast.textContent = message;
    container.appendChild(toast);

    while (container.children.length > MAX_TOASTS) container.firstElementChild.remove();

    setTimeout(() => {
        toast.style.transition = 'opacity 0.3s';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ES6 Module Exports
export {
    initTableView,
    upsertPlayer,
    setPlayerStream,
    removePlayer,
    effectiveFlip,
    updateTile,
    updateTurnMarkers,
    seatingOrder,
    serverId,
    localKey,
    ICONS,
    setLayout,
    setFocus,
    renderLayout,
    showToast,
    escapeHtml
};
