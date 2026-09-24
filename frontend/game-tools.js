/**
 * Game Tools Module
 * Dice, coin flips, the table reset, the table log and the side panel.
 * Rolls happen in the roller's browser and are shown to everyone with the same result.
 */

import { escapeHtml } from './table-view.js';

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

const COIN_FACES = {
    1: { label: 'Heads', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5z"/></svg>' },
    2: { label: 'Tails', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 14.5 9 21 9.5 16 14l1.5 6.5L12 17l-5.5 3.5L8 14 3 9.5 9.5 9z"/></svg>' }
};

const ROLL_SHOWN_MS = 4200;   // how long a result stays over the cameras
const MAX_ROLL_CARDS = 4;
const MAX_LOG = 100;

let state = null;
let deps = null;
let unreadLog = 0;

/**
 * @param {Object} appState - Application state
 * @param {Object} appDeps - { showToast, upsertPlayer }
 */
function initGameTools(appState, appDeps) {
    state = appState;
    deps = appDeps;
    setupDice();
    setupCoin();
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
 * Show a roll over the cameras: a die tumbling to its number, or a coin flipping
 * @param {Object} roll - { userId, username, kind, result }
 */
function showRoll({ userId, username, kind, result }) {
    const layer = document.getElementById('rollLayer');
    const mine = userId === 'local';
    const who = mine ? 'You' : escapeHtml(username);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const card = document.createElement('div');
    card.className = 'roll-card';

    let text;
    if (kind === 'coin') {
        text = COIN_FACES[result].label;
        card.innerHTML = `
            <div class="coin">
                <div class="coin-inner">
                    <div class="coin-face front"><div>${COIN_FACES[1].icon}${COIN_FACES[1].label}</div></div>
                    <div class="coin-face back"><div>${COIN_FACES[2].icon}${COIN_FACES[2].label}</div></div>
                </div>
            </div>
            <div class="roll-result-text">&nbsp;</div>
            <div class="roll-caption"><b>${who}</b> flipped a coin</div>`;
    } else {
        text = String(result);
        card.innerHTML = `
            <div class="die ${kind}">
                ${dieSvg(kind)}
                <span class="die-value">?</span>
            </div>
            <div class="roll-caption"><b>${who}</b> rolled a ${kind}</div>`;
    }

    layer.appendChild(card);
    while (layer.children.length > MAX_ROLL_CARDS) layer.firstElementChild.remove();

    const land = () => {
        if (kind === 'coin') {
            card.querySelector('.roll-result-text').textContent = text;
        } else {
            const die = card.querySelector('.die');
            const value = card.querySelector('.die-value');
            value.textContent = text;
            die.classList.toggle('is-max', result === DICE[kind].sides);
            die.classList.toggle('is-min', result === 1 && kind === 'd20');
            if (!reduceMotion) value.animate([{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 250, easing: 'ease-out' });
        }
    };

    if (reduceMotion) {
        if (kind === 'coin') card.querySelector('.coin-inner').style.transform = result === 2 ? 'rotateY(180deg)' : '';
        land();
    } else {
        card.animate([{ opacity: 0, transform: 'translateY(16px) scale(0.92)' }, { opacity: 1, transform: 'none' }],
                     { duration: 200, easing: 'ease-out' });

        if (kind === 'coin') {
            // Five full turns, plus half a turn to land on tails
            const end = 360 * 5 + (result === 2 ? 180 : 0);
            card.querySelector('.coin-inner').animate(
                [{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${end}deg)` }],
                { duration: 1300, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' });
            card.querySelector('.coin').animate(
                [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-28px) scale(1.15)', offset: 0.4 }, { transform: 'translateY(0) scale(1)' }],
                { duration: 1300, easing: 'ease-in-out' });
            setTimeout(land, 1300);
        } else {
            const die = card.querySelector('.die');
            const value = card.querySelector('.die-value');
            die.animate([
                { transform: 'translateY(-30px) rotate(-420deg) scale(0.4)' },
                { transform: 'translateY(0) rotate(18deg) scale(1.1)', offset: 0.7 },
                { transform: 'rotate(-6deg) scale(0.97)', offset: 0.86 },
                { transform: 'rotate(0deg) scale(1)' }
            ], { duration: 950, easing: 'cubic-bezier(.2,.7,.3,1)' });

            // Numbers flicker while it tumbles
            const sides = DICE[kind].sides;
            const flicker = setInterval(() => { value.textContent = randomRoll(sides); }, 60);
            setTimeout(() => { clearInterval(flicker); land(); }, 820);
        }
    }

    setTimeout(() => {
        const fade = card.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.95)' }], { duration: 300, fill: 'forwards' });
        fade.onfinish = () => card.remove();
    }, ROLL_SHOWN_MS);

    const what = kind === 'coin' ? `flipped <b>${text}</b>` : `rolled <b>${text}</b> on a ${kind}`;
    logEvent(`<b>${who}</b> ${what}`);
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
    logEvent
};
