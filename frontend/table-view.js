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
    camera: '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7 16 12l7 5z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>'
};

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
 *   changeLife(id, delta), scanTile(id, clientX, clientY), openCommanderPicker(),
 *   showCommander(id, index), openSetup(), toggleCamera(), setOwnFlip(key, value), giveTurn(id)
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
            viewFlipH: false,      // an extra flip only this browser applies
            viewFlipV: false,
            stream: null,
            streamPeer: null,
            peer: null
        };
        state.players.set(id, player);
    }

    for (const key of ['username', 'hp', 'commanders', 'flipH', 'flipV']) {
        if (data[key] !== undefined) player[key] = data[key];
    }

    if (isNew) {
        createTile(player);
        renderLayout();
    }
    updateTile(player, options);
    return player;
}

/**
 * Show a player's camera, or the "no camera" placeholder when stream is null
 * @param {string} id - Player id
 * @param {MediaStream|null} stream
 * @param {Object} peer - The peer connection the stream came from, if remote
 */
function setPlayerStream(id, stream, peer = null) {
    const player = state.players.get(id);
    if (!player) return;
    player.stream = stream;
    player.streamPeer = peer;

    // Same stream object with a new camera track in it: reattach so the video picks it up
    if (player.video.srcObject === stream) player.video.srcObject = null;
    player.video.srcObject = stream;
    // (inline styles: the tile CSS would win over Tailwind's .hidden)
    player.video.style.display = stream ? '' : 'none';
    player.placeholder.style.display = stream ? 'none' : '';
    if (stream) player.video.play().catch(() => {});
    updateTile(player, { quiet: true });

    if (!stream) clearOverlay(player);
    if (state.layout === 'focus' && !state.players.has(state.focusId)) renderLayout();
}

function removePlayer(id) {
    const player = state.players.get(id);
    if (!player) return;
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
        <div class="tile-top">
            <div class="tile-name"></div>
            <div class="tile-tools">
                <button class="tile-icon-btn focus-btn" title="Show big">${ICONS.expand}</button>
                <button class="tile-icon-btn menu-btn" title="Options">${ICONS.dots}</button>
            </div>
        </div>
        <div class="turn-badge"><span class="turn-dot"></span><span class="turn-text"></span></div>
        <div class="tile-bottom">
            <div class="commanders"></div>
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

    tile.querySelector('.tile-name').textContent = player.isLocal ? `${player.username} (you)` : player.username;

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
        player.delta = 0;
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
}

// ============================== Layout ==============================

/**
 * 'focus': one big camera with everybody else small underneath.
 * 'grid': every camera the same size, as big as fits.
 */
function setLayout(layout) {
    state.layout = layout;
    try { localStorage.setItem('layout', layout); } catch { /* private mode */ }
    document.querySelectorAll('input[name="layout"]').forEach(input => { input.checked = input.value === layout; });
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
    const players = [...state.players.values()];

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

        for (const player of players) {
            const isMain = player.id === state.focusId;
            place(player, isMain ? stage : strip);
            player.tile.classList.toggle('is-main', isMain);
            player.tile.classList.toggle('is-thumb', !isMain);
            player.tile.style.width = '';
            player.tile.style.height = '';
        }
    } else {
        strip.style.display = 'none';
        for (const player of players) {
            place(player, stage);
            player.tile.classList.remove('is-main', 'is-thumb');
        }
        fitGrid(stage, players.length);
    }
}

/** Move a tile into a container (only if needed: moving a video can pause it) */
function place(player, container) {
    if (player.tile.parentElement === container) return;
    container.appendChild(player.tile);
    if (player.stream) player.video.play().catch(() => {});
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
    if (state.turn?.order.length && state.turnId !== id) {
        items.push(`<li><a data-action="turn">${ICONS.turn} ${player.isLocal ? 'Make it my turn' : `Give ${escapeHtml(player.username)} the turn`}</a></li>`);
    }
    if (player.isLocal) {
        items.push(`<div class="divider my-0"></div>`);
        items.push(`<li><a data-action="commander">${ICONS.crown} ${player.commanders.length ? 'Change commander' : 'Choose commander'}</a></li>`);
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
            case 'setup': hooks.openSetup(); break;
            case 'camera': hooks.toggleCamera(); break;
            case 'turn': hooks.giveTurn(id); break;
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
    setLayout,
    setFocus,
    renderLayout,
    showToast,
    escapeHtml
};
