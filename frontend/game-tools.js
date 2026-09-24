/**
 * Game Tools Module
 * Dice, coin flips, turns, the table reset, the table log and the side panel.
 * Rolls happen in the roller's browser and are shown to everyone with the same result.
 * Turns live on the server; anyone can pass (Space) or take back (Shift+Space) the turn.
 */

import { escapeHtml, setFocus, updateTurnMarkers } from './table-view.js';

// Die shapes (viewBox 0 0 100 100): outline and a few inner edges for a hint of depth
const DICE = {
    d4:  { sides: 4,  face: '<polygon class="face" points="50,6 95,88 5,88"/>',
                      edge: '<path class="edge" d="M50 6 50 64M5 88 50 64 95 88"/>' },
    d6:  { sides: 6,  face: '<rect class="face" x="10" y="10" width="80" height="80" rx="14"/>',
                      edge: '<rect class="edge" x="20" y="20" width="60" height="60" rx="8"/>' },
    d8:  { sides: 8,  face: '<polygon class="face" points="50,3 95,50 50,97 5,50"/>',
                      edge: '<path class="edge" d="M5 50 95 50"/>' },
    d10: { sides: 10, face: '<polygon class="face" points="50,3 95,44 50,97 5,44"/>',
                      edge: '<path class="edge" d="M5 44 50 62 95 44M50 62 50 97"/>' },
    d12: { sides: 12, face: '<polygon class="face" points="50,4 96,37 78,92 22,92 4,37"/>',
                      edge: '<polygon class="edge" points="50,22 76,41 66,74 34,74 24,41"/>' },
    d20: { sides: 20, face: '<polygon class="face" points="50,3 92,27 92,73 50,97 8,73 8,27"/>',
                      edge: '<path class="edge" d="M50 22 78 70 22 70Z M50 3 50 22M92 27 78 70M8 27 22 70M92 73 78 70M8 73 22 70M50 97 50 70"/>' }
};

// The coin is drawn like a die: a disc with a rim
const COIN = {
    face: '<circle class="face" cx="50" cy="50" r="46"/>',
    edge: '<circle class="edge" cx="50" cy="50" r="36"/>'
};
const COIN_SIDES = { 1: 'Heads', 2: 'Tails' };

const ROLL_SHOWN_MS = 4200;   // how long a result stays over the cameras
const MAX_ROLL_CARDS = 4;
const MAX_LOG = 100;
const PASS_COOLDOWN_MS = 400;   // a double tap of Space shouldn't skip a player
const ROLL_COOLDOWN_MS = 900;   // ignore a new roll until the previous one has landed

let state = null;
let deps = null;
let unreadLog = 0;
let lastRoll = 0;

/**
 * @param {Object} appState - Application state
 * @param {Object} appDeps - { showToast, upsertPlayer }
 */
function initGameTools(appState, appDeps) {
    state = appState;
    deps = appDeps;
    setupDice();
    setupCoin();
    setupTurns();
    setupReset();
    setupSidebar();
}

/** Uniform random number 1..sides (crypto, without modulo bias) */
function randomRoll(sides) {
    const limit = Math.floor(0x100000000 / sides) * sides;
    const buffer = new Uint32Array(1);
    do { crypto.getRandomValues(buffer); } while (buffer[0] >= limit);
    return (buffer[0] % sides) + 1;
}

function roll(kind) {
    if (state.role !== 'player') return;
    const now = Date.now();
    if (now - lastRoll < ROLL_COOLDOWN_MS) return;
    lastRoll = now;

    const sides = kind === 'coin' ? 2 : DICE[kind].sides;
    const result = randomRoll(sides);
    state.socket?.emit('roll', { kind, result });
    showRoll({ userId: 'local', username: state.username, kind, result });
}

// ============================== Dice ==============================

function dieSvg(kind) {
    return `<svg viewBox="0 0 100 100" aria-hidden="true">${DICE[kind].face}${DICE[kind].edge}</svg>`;
}

function setupDice() {
    const dropdown = document.getElementById('diceDropdown');
    const buttons = document.getElementById('diceButtons');

    buttons.innerHTML = Object.keys(DICE).map(kind => `
        <button class="btn btn-ghost dice-pick" data-die="${kind}" title="Roll a ${kind}">
            ${dieSvg(kind)}
            <span class="font-bold">${kind}</span>
        </button>`).join('');

    buttons.addEventListener('click', (e) => {
        const kind = e.target.closest('[data-die]')?.dataset.die;
        if (!kind) return;
        dropdown.removeAttribute('open');
        roll(kind);
    });

    // Close when tapping anywhere else
    document.addEventListener('pointerdown', (e) => {
        if (dropdown.open && !dropdown.contains(e.target)) dropdown.removeAttribute('open');
    });
}

function setupCoin() {
    document.getElementById('coinButton').addEventListener('click', () => roll('coin'));
}

/**
 * Show a roll over the cameras: a die tumbling to its number, or a coin spinning to a side.
 * Both use the same look and the same kind of animation.
 * @param {Object} roll - { userId, username, kind, result }
 */
function showRoll({ userId, username, kind, result }) {
    const layer = document.getElementById('rollLayer');
    const who = userId === 'local' ? 'You' : escapeHtml(username);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isCoin = kind === 'coin';
    const shape = isCoin ? COIN : DICE[kind];
    const label = (value) => (isCoin ? COIN_SIDES[value] : String(value));
    const text = label(result);

    const card = document.createElement('div');
    card.className = 'roll-card';
    card.innerHTML = `
        <div class="die ${isCoin ? 'coin' : kind}">
            <svg viewBox="0 0 100 100" aria-hidden="true">${shape.face}${shape.edge}</svg>
            <span class="die-value">${reduceMotion ? text : '?'}</span>
        </div>
        <div class="roll-caption"><b>${who}</b> ${isCoin ? 'flipped a coin' : `rolled a ${kind}`}</div>`;

    layer.appendChild(card);
    while (layer.children.length > MAX_ROLL_CARDS) layer.firstElementChild.remove();

    const die = card.querySelector('.die');
    const value = card.querySelector('.die-value');
    const land = () => {
        value.textContent = text;
        if (!isCoin) {
            die.classList.toggle('is-max', result === DICE[kind].sides);
            die.classList.toggle('is-min', result === 1 && kind === 'd20');
        }
        if (!reduceMotion) value.animate([{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 250, easing: 'ease-out' });
    };

    if (reduceMotion) {
        land();
    } else {
        card.animate([{ opacity: 0, transform: 'translateY(16px) scale(0.92)' }, { opacity: 1, transform: 'none' }],
                     { duration: 200, easing: 'ease-out' });

        // A die tumbles in, a coin spins in the air; both settle with a small bounce
        const motion = isCoin
            ? [
                { transform: 'translateY(0) rotateY(0deg) scale(0.6)' },
                { transform: 'translateY(-26px) rotateY(900deg) scale(1.1)', offset: 0.5 },
                { transform: 'translateY(0) rotateY(1440deg) scale(1.04)', offset: 0.85 },
                { transform: 'translateY(0) rotateY(1440deg) scale(1)' }
            ]
            : [
                { transform: 'translateY(-30px) rotate(-420deg) scale(0.4)' },
                { transform: 'translateY(0) rotate(18deg) scale(1.1)', offset: 0.7 },
                { transform: 'rotate(-6deg) scale(0.97)', offset: 0.86 },
                { transform: 'rotate(0deg) scale(1)' }
            ];
        die.animate(motion, { duration: 950, easing: 'cubic-bezier(.2,.7,.3,1)' });

        // The face flickers while it moves
        const sides = isCoin ? 2 : DICE[kind].sides;
        const flicker = setInterval(() => { value.textContent = label(randomRoll(sides)); }, isCoin ? 90 : 60);
        setTimeout(() => { clearInterval(flicker); land(); }, 820);
    }

    setTimeout(() => {
        const fade = card.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.95)' }], { duration: 300, fill: 'forwards' });
        fade.onfinish = () => card.remove();
    }, ROLL_SHOWN_MS);

    const what = isCoin ? `flipped <b>${text}</b>` : `rolled <b>${text}</b> on a ${kind}`;
    logEvent(`<b>${who}</b> ${what}`);
}

// ============================== Turns ==============================

let lastPass = 0;

function setupTurns() {
    document.getElementById('turnNext').addEventListener('click', (e) => {
        e.currentTarget.blur();   // so a later Space doesn't press the button as well
        moveTurn('next');
    });
    document.getElementById('turnPrev').addEventListener('click', (e) => {
        e.currentTarget.blur();
        moveTurn('prev');
    });

    // Space passes the turn (Shift+Space takes it back), for whoever's turn it is
    document.addEventListener('keydown', (e) => {
        if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.target.closest?.('input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable]')) return;
        if (document.querySelector('dialog[open]')) return;
        e.preventDefault();
        if (e.repeat) return;
        document.activeElement?.blur?.();
        moveTurn(e.shiftKey ? 'prev' : 'next');
    });

    renderTurnControls();
}

/**
 * @param {string} action - 'next' (starts turns if needed), 'prev' or 'start'
 */
function moveTurn(action) {
    if (!state.socket?.connected || state.role !== 'player') return;
    if (action === 'prev' && !state.turn?.order.length) return;
    const now = Date.now();
    if (now - lastPass < PASS_COOLDOWN_MS) return;
    lastPass = now;
    state.socket.emit('turn', { action });
}

/** Give the turn straight to a player (tile menu) */
function giveTurn(id) {
    if (!state.socket?.connected) return;
    state.socket.emit('turn', { action: 'set', target: id === 'local' ? state.playerId : id });
}

function turnKey(pid) {
    return pid && pid === state.playerId ? 'local' : pid;
}

function nameOf(pid) {
    const player = state.players.get(turnKey(pid));
    return player ? (player.isLocal ? 'You' : player.username) : '?';
}

/**
 * The server says whose turn it is now
 * @param {Object} turn - { order: [player ids], current, number }
 * @param {Object} info - { action, by } of the change; nothing for a quiet sync
 */
function setTurn(turn, info = {}) {
    const before = state.turnId;
    state.turn = turn;
    state.turnId = turnKey(turn.current);
    updateTurnMarkers();
    renderTurnControls();

    if (!state.turnId) return;
    const changed = state.turnId !== before;

    // The focus view follows the turn (also when switching to it later)
    if (changed) setFocus(state.turnId);
    if (!info.action || (info.action === 'left' && !changed)) return;

    const who = `<b>${escapeHtml(nameOf(turn.current))}</b>`;
    const by = info.by === state.username ? 'You' : escapeHtml(info.by || '');
    switch (info.action) {
        case 'start': {
            const order = turn.order.map(nameOf).join(' → ');
            logEvent(`New turn order: ${escapeHtml(order)}`);
            deps.showToast(`Turn order: ${order}`, 'info');
            logEvent(`Turn 1 · ${who}`);
            break;
        }
        case 'next': logEvent(`Turn ${turn.number} · ${who}`); break;
        case 'prev': logEvent(by === nameOf(turn.current) ? `${who} took the turn back` : `${by} gave the turn back to ${who}`); break;
        case 'set': logEvent(by === nameOf(turn.current) ? `${who} took the turn` : `${by} gave the turn to ${who}`); break;
        case 'left': logEvent(`Turn ${turn.number} · ${who}`); break;
    }
}

function renderTurnControls() {
    const started = !!state.turn?.order.length;
    const next = document.getElementById('turnNext');
    document.getElementById('turnNextLabel').textContent = started ? 'Pass turn' : 'Start turns';
    document.getElementById('turnPrev').disabled = !started;

    if (started) {
        const order = state.turn.order;
        const upNext = order[(order.indexOf(state.turn.current) + 1) % order.length];
        next.title = `Pass the turn to ${nameOf(upNext)} (Space)`;
    } else {
        next.title = 'Shuffle a random turn order and start (Space)';
    }
}

// ============================== Reset ==============================

function setupReset() {
    const modal = document.getElementById('resetModal');

    document.getElementById('resetButton').addEventListener('click', () => {
        const life = String(state.startingLife);
        document.querySelectorAll('input[name="startingLife"]').forEach(input => { input.checked = input.value === life; });
        modal.showModal();
    });

    modal.querySelectorAll('[data-reset]').forEach(button => {
        button.addEventListener('click', () => {
            const what = button.dataset.reset;
            const startingLife = Number(document.querySelector('input[name="startingLife"]:checked')?.value) || state.startingLife;
            modal.close();

            if (state.socket?.connected) {
                state.socket.emit('reset-table', { what, ...(what !== 'commanders' ? { startingLife } : {}) });
                return;
            }
            // Not connected: reset what we have locally
            if (what !== 'commanders') state.startingLife = startingLife;
            for (const player of state.players.values()) {
                deps.upsertPlayer(player.id, {
                    ...(what !== 'commanders' ? { hp: state.startingLife } : {}),
                    ...(what !== 'life' ? { commanders: [] } : {})
                }, { quiet: true });
            }
        });
    });
}

// ============================== Log & side panel ==============================

/**
 * Add a line to the table log
 * @param {string} html - Already escaped HTML
 */
function logEvent(html) {
    const list = document.getElementById('tableLog');
    document.getElementById('logEmpty').classList.add('hidden');

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const item = document.createElement('li');
    item.className = 'flex gap-2 rounded-box px-2 py-1.5 hover:bg-base-200';
    item.innerHTML = `<span class="text-xs text-base-content/40 tabular-nums pt-0.5">${time}</span><span>${html}</span>`;
    list.prepend(item);
    while (list.children.length > MAX_LOG) list.lastElementChild.remove();

    const logVisible = !document.querySelector('[data-panel="log"]').hidden && !document.getElementById('sidebar').hidden;
    if (!logVisible) {
        unreadLog++;
        const badge = document.getElementById('logBadge');
        badge.textContent = unreadLog;
        badge.classList.remove('hidden');
    }
}

function setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    const tabs = sidebar.querySelectorAll('[data-tab]');

    tabs.forEach(tab => tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.toggle('tab-active', t === tab));
        sidebar.querySelectorAll('[data-panel]').forEach(panel => {
            panel.hidden = panel.dataset.panel !== tab.dataset.tab;
        });
        if (tab.dataset.tab === 'log') {
            unreadLog = 0;
            document.getElementById('logBadge').classList.add('hidden');
        }
    }));

    // Open by default on big screens, where it doesn't cover the cameras
    let open;
    try { open = localStorage.getItem('sidebar'); } catch { open = null; }
    setSidebar(open === null ? window.innerWidth >= 1024 : open === 'open');

    document.getElementById('sidebarButton').addEventListener('click', () => {
        const nowOpen = sidebar.hidden;
        setSidebar(nowOpen);
        try { localStorage.setItem('sidebar', nowOpen ? 'open' : 'closed'); } catch { /* private mode */ }
    });
}

function setSidebar(open) {
    document.getElementById('sidebar').hidden = !open;
    document.getElementById('sidebarButton').classList.toggle('btn-active', open);
}

// ES6 Module Exports
export {
    initGameTools,
    showRoll,
    logEvent,
    setTurn,
    giveTurn
};
