/**
 * Counters Module
 * One player's counters in a dialog: commander damage taken (from each opponent's
 * commander), poison, energy, experience, the monarch and the initiative, and "out of the
 * game". Anyone at the table can change them for anyone, like the life total.
 *
 * A player is out automatically at 0 life, 10 poison or 21 damage from one commander;
 * the toggle is for conceding (or for other ways of losing).
 */

import { escapeHtml, seatingOrder, serverId, ICONS } from './table-view.js';

const COUNTERS = [
    { name: 'poison', label: 'Poison', icon: 'poison', hint: '10 = out' },
    { name: 'energy', label: 'Energy', icon: 'energy' },
    { name: 'experience', label: 'Experience', icon: 'experience' }
];
const MARKERS = [
    { name: 'monarch', label: 'The monarch', icon: 'monarch' },
    { name: 'initiative', label: 'The initiative', icon: 'initiative' }
];

let state = null;
let actions = null;
let openFor = null;   // player id the dialog shows

/**
 * @param {Object} appState - Application state
 * @param {Object} appActions - changeCounter(id, name, delta), changeCommanderDamage(id, sourceId, index, delta),
 *                              setMarker(marker, id|null), setConceded(id, conceded)
 */
function initCounters(appState, appActions) {
    state = appState;
    actions = appActions;
    const modal = document.getElementById('countersModal');
    modal.addEventListener('close', () => { openFor = null; });

    document.getElementById('countersBody').addEventListener('click', (e) => {
        const button = e.target.closest('button[data-kind]');
        if (!button || !openFor) return;
        const { kind, name, source, index, delta } = button.dataset;
        const player = state.players.get(openFor);
        if (!player) return;

        if (kind === 'counter') actions.changeCounter(openFor, name, Number(delta));
        if (kind === 'commander') actions.changeCommanderDamage(openFor, source, Number(index), Number(delta));
        if (kind === 'marker') {
            const holds = state.markers?.[name] === serverId(openFor);
            actions.setMarker(name, holds ? null : openFor);
        }
        if (kind === 'out') actions.setConceded(openFor, !player.conceded);
    });
}

/** Show a player's counters */
function openCounters(id) {
    if (!state.players.has(id)) return;
    openFor = id;
    render();
    const modal = document.getElementById('countersModal');
    if (!modal.open) modal.showModal();
}

/** Keep the dialog up to date while it's open */
function refreshCounters(id) {
    if (openFor && (id === undefined || id === openFor)) render();
}

function stepper(value, data, { danger = false, disabled = false } = {}) {
    const attrs = Object.entries(data).map(([key, val]) => `data-${key}="${escapeHtml(val)}"`).join(' ');
    const off = disabled ? 'disabled' : '';
    return `
        <div class="join">
            <button class="btn btn-sm join-item btn-square" ${attrs} data-delta="-1" ${off} aria-label="Minus one">−</button>
            <span class="btn btn-sm join-item w-12 pointer-events-none tabular-nums ${danger ? 'btn-error' : ''}">${value}</span>
            <button class="btn btn-sm join-item btn-square" ${attrs} data-delta="1" ${off} aria-label="Plus one">+</button>
        </div>`;
}

function row(label, control, sub = '') {
    return `
        <div class="flex items-center justify-between gap-3 py-1.5">
            <div class="min-w-0">
                <div class="text-sm font-medium truncate">${label}</div>
                ${sub ? `<div class="text-xs text-base-content/50 truncate">${sub}</div>` : ''}
            </div>
            ${control}
        </div>`;
}

function icon(name) {
    return ICONS[name].replace('<svg', '<svg class="inline h-4 w-4 mr-1 align-[-3px]"');
}

function render() {
    const player = state.players.get(openFor);
    if (!player) {
        document.getElementById('countersModal').close();
        return;
    }
    const readOnly = state.role !== 'player';
    const pid = serverId(player.id);

    document.getElementById('countersTitle').textContent = player.isLocal ? 'Your counters' : `${player.username}'s counters`;

    // Commander damage taken, from every opponent's commander(s)
    const opponents = seatingOrder().filter(p => p.id !== player.id);
    const damageRows = opponents.flatMap(opponent => {
        const hits = player.cmdDamage[serverId(opponent.id)] || [0, 0];
        const commanders = opponent.commanders.length ? opponent.commanders : [{ name: 'Commander' }];
        return commanders.map((card, index) => row(
            escapeHtml(card.name),
            stepper(hits[index] || 0, { kind: 'commander', source: serverId(opponent.id), index }, { danger: (hits[index] || 0) >= 21, disabled: readOnly }),
            opponent.isLocal ? 'Your commander' : escapeHtml(opponent.username)
        ));
    });

    const counterRows = COUNTERS.map(({ name, label, icon: iconName, hint }) => row(
        `${icon(iconName)}${label}`,
        stepper(player.counters[name] || 0, { kind: 'counter', name }, { danger: name === 'poison' && player.counters.poison >= 10, disabled: readOnly }),
        hint || ''
    ));

    const markerButtons = MARKERS.map(({ name, label, icon: iconName }) => {
        const holds = state.markers?.[name] === pid;
        const holder = state.markers?.[name] && !holds
            ? [...state.players.values()].find(p => serverId(p.id) === state.markers[name])?.username
            : null;
        return `
            <button class="btn btn-sm ${holds ? 'btn-primary' : 'btn-outline'} flex-1" data-kind="marker" data-name="${name}" ${readOnly ? 'disabled' : ''}
                    title="${holder ? `Now: ${escapeHtml(holder)}` : ''}">
                ${icon(iconName)}${label}${holder ? ` <span class="opacity-60 font-normal">(${escapeHtml(holder)})</span>` : ''}
            </button>`;
    }).join('');

    document.getElementById('countersBody').innerHTML = `
        <section>
            <h4 class="text-xs font-semibold uppercase tracking-wide text-base-content/50 mb-1">Commander damage taken</h4>
            ${damageRows.length ? damageRows.join('') : '<p class="text-sm text-base-content/50 py-1">Nobody else at the table yet</p>'}
            <p class="text-xs text-base-content/50">Also comes off the life total. 21 from one commander = out.</p>
        </section>
        <div class="divider my-1"></div>
        <section>${counterRows.join('')}</section>
        <div class="divider my-1"></div>
        <section class="flex flex-wrap gap-2">${markerButtons}</section>
        <div class="divider my-1"></div>
        <section class="flex items-center justify-between gap-3">
            <p class="text-xs text-base-content/50">${player.out && !player.conceded
                ? 'Out because of life, poison or commander damage.'
                : 'Players who are out are skipped when passing the turn.'}</p>
            <button class="btn btn-sm ${player.conceded ? 'btn-success' : 'btn-error btn-outline'} shrink-0" data-kind="out" ${readOnly ? 'disabled' : ''}>
                ${player.conceded ? 'Back in the game' : `${icon('skull')}Out of the game`}
            </button>
        </section>`;
}

// ES6 Module Exports
export {
    initCounters,
    openCounters,
    refreshCounters
};
