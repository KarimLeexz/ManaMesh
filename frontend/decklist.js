/**
 * Decklist Module
 * A player's decklist: entered in the commander dialog (an Archidekt link, or a pasted text
 * list), sorted into card types with Scryfall, and shown to the table in a small window
 * over the play area when someone taps a player's name.
 */

import { escapeHtml, serverId, showToast } from './table-view.js';

// How cards are grouped, in this order. An artifact creature is a creature, an artifact
// land a land (the first type in this list wins).
const TYPE_ORDER = ['Creature', 'Planeswalker', 'Battle', 'Land', 'Instant', 'Sorcery', 'Artifact', 'Enchantment'];
const GROUPS = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Other'];
const GROUP_LABELS = {
    Creature: 'Creatures', Planeswalker: 'Planeswalkers', Battle: 'Battles', Instant: 'Instants',
    Sorcery: 'Sorceries', Artifact: 'Artifacts', Enchantment: 'Enchantments', Land: 'Lands', Other: 'Other'
};
const SCRYFALL_BATCH = 75;   // cards per /cards/collection request

let state = null;
let draft = null;            // what the dialog's decklist tab holds: { source, name, types }
let loadedText = '';         // the text the tab was opened with (unchanged = nothing to save)

function mainType(typeLine) {
    const front = String(typeLine || '').split(' // ')[0];
    return TYPE_ORDER.find(type => front.includes(type)) || 'Other';
}

function cardImage(name) {
    return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;
}

// ============================== Reading lists ==============================

/**
 * Read a pasted decklist. Understands the usual export formats:
 *   "1 Sol Ring", "1x Sol Ring", "Sol Ring", "1 Sol Ring (CMM) 410 *F*",
 *   "1x Sol Ring (cmm) 410 [Ramp]" (Archidekt), section lines like "Commander", "Deck",
 *   "Sideboard" (skipped) and "// comments".
 * @returns {Object} { cards: [{ name, qty }], commanders: [names] }
 */
function parseDeckText(text) {
    const cards = new Map();
    const commanders = [];
    let section = 'main';

    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('//') || line.startsWith('#')) continue;

        const header = line.replace(/:$/, '').toLowerCase();
        if (/^(commanders?|commander zone)$/.test(header)) { section = 'commander'; continue; }
        if (/^(deck|main ?deck|mainboard|main)$/.test(header)) { section = 'main'; continue; }
        if (/^(sideboard|maybeboard|maybe|considering|companions?|tokens?)$/.test(header)) { section = 'skip'; continue; }
        if (section === 'skip') continue;

        const match = line.match(/^(\d+)\s*x?\s+(.+)$/i);
        let qty = match ? Number(match[1]) : 1;
        let name = match ? match[2] : line;
        let previous;
        do {   // peel off the extras from the end: [Category], ^tag^, *F*, (SET) 123
            previous = name;
            name = name
                .replace(/\s*\[[^\]]*\]\s*$/, '')
                .replace(/\s*\^[^^]*\^\s*$/, '')
                .replace(/\s*\*[A-Za-z]+\*\s*$/, '')
                .replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+[\w★\-]+)?\s*$/, '')
                .trim();
        } while (name !== previous);
        if (!name || qty < 1) continue;
        qty = Math.min(qty, 99);

        if (section === 'commander' && !commanders.includes(name)) commanders.push(name);
        const key = name.toLowerCase();
        if (cards.has(key)) cards.get(key).qty += qty;
        else cards.set(key, { name, qty });
    }
    return { cards: [...cards.values()], commanders };
}

/** A decklist as text (for the dialog): commanders first, then the rest */
function deckToText(deck, commanderNames = []) {
    if (!deck?.cards?.length) return '';
    const isCommander = (card) => commanderNames.some(name => name.toLowerCase() === card.name.toLowerCase());
    const commanders = deck.cards.filter(isCommander);
    const rest = deck.cards.filter(card => !isCommander(card));
    const lines = rest.map(card => `${card.qty} ${card.name}`);
    return commanders.length
        ? ['Commander', ...commanders.map(card => `${card.qty} ${card.name}`), '', 'Deck', ...lines].join('\n')
        : lines.join('\n');
}

/**
 * Look the cards up on Scryfall: their exact names and types (and full card data for
 * commanders)
 * @returns {Object} { byName: Map(lowercase name -> Scryfall card), notFound: [names] }
 */
async function lookUpCards(names) {
    const byName = new Map();
    const notFound = [];
    for (let i = 0; i < names.length; i += SCRYFALL_BATCH) {
        const batch = names.slice(i, i + SCRYFALL_BATCH);
        const response = await fetch('https://api.scryfall.com/cards/collection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifiers: batch.map(name => ({ name })) })
        });
        if (!response.ok) throw new Error(`Scryfall answered ${response.status}`);
        const result = await response.json();
        for (const card of result.data || []) {
            byName.set(card.name.toLowerCase(), card);
            for (const face of card.card_faces || []) byName.set(face.name.toLowerCase(), card);
        }
        for (const missing of result.not_found || []) notFound.push(missing.name);
    }
    return { byName, notFound };
}

/**
 * Turn the dialog's decklist into what gets saved: every card with its type
 * @param {string} text - The list as in the dialog
 * @returns {Object} { deck (null if empty), commanders: [Scryfall cards], notFound: [names] }
 */
async function buildDeck(text) {
    const { cards, commanders } = parseDeckText(text);
    if (!cards.length) return { deck: null, commanders: [], notFound: [] };

    const known = draft?.types || new Map();
    const needed = cards.filter(card => !known.has(card.name.toLowerCase())).map(card => card.name);
    const commanderNames = commanders.map(name => name);
    let byName = new Map();
    let notFound = [];
    try {
        ({ byName, notFound } = await lookUpCards([...new Set([...needed, ...commanderNames])]));
    } catch (err) {
        console.warn('Could not sort the decklist by type:', err);
    }

    const typed = cards
        .filter(card => !notFound.includes(card.name))
        .map(card => {
            const scryfall = byName.get(card.name.toLowerCase());
            const type = known.get(card.name.toLowerCase()) || (scryfall ? mainType(scryfall.type_line || scryfall.card_faces?.[0]?.type_line) : 'Other');
            return { name: scryfall?.name || card.name, qty: card.qty, type };
        });
    return {
        deck: { name: draft?.name || '', source: draft?.source || '', cards: typed },
        commanders: commanderNames.map(name => byName.get(name.toLowerCase())).filter(Boolean),
        notFound
    };
}

// ============================== The dialog's decklist tab ==============================

function setupDeckEditor() {
    const status = document.getElementById('deckStatus');

    document.getElementById('deckImport').addEventListener('click', async () => {
        const url = document.getElementById('deckLink').value.trim();
        if (!url) return;
        const button = document.getElementById('deckImport');
        button.disabled = true;
        status.textContent = 'Importing…';
        try {
            const response = await fetch('/api/decklist/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const deck = await response.json();
            if (!response.ok) throw new Error(deck.detail || 'Import failed');
            draft = {
                source: deck.source,
                name: deck.name,
                types: new Map(deck.cards.filter(c => c.type).map(c => [c.name.toLowerCase(), c.type]))
            };
            document.getElementById('deckText').value = deckToText(deck, deck.commanders);
            const count = deck.cards.reduce((sum, card) => sum + card.qty, 0);
            status.textContent = `Imported “${deck.name || 'deck'}”: ${count} cards`;
        } catch (err) {
            status.textContent = err.message;
        } finally {
            button.disabled = false;
        }
    });

    document.getElementById('deckText').addEventListener('input', () => {
        const count = parseDeckText(document.getElementById('deckText').value).cards.reduce((sum, card) => sum + card.qty, 0);
        status.textContent = count ? `${count} cards` : '';
    });

    document.getElementById('deckClear').addEventListener('click', () => {
        document.getElementById('deckText').value = '';
        document.getElementById('deckLink').value = '';
        draft = null;
        status.textContent = 'The decklist is removed when you tap Done';
    });
}

/**
 * Fill the decklist tab with our current list
 * @param {Object|null} deck - Our saved deck
 * @param {string[]} commanderNames
 */
function loadDeckEditor(deck, commanderNames) {
    draft = deck ? { source: deck.source, name: deck.name, types: new Map(deck.cards.map(c => [c.name.toLowerCase(), c.type])) } : null;
    loadedText = deckToText(deck, commanderNames);
    document.getElementById('deckText').value = loadedText;
    document.getElementById('deckLink').value = deck?.source || '';
    const count = deck ? deck.cards.reduce((sum, card) => sum + card.qty, 0) : 0;
    document.getElementById('deckStatus').textContent = count ? `${count} cards` : '';
}

/** The tab's text, or undefined when it wasn't touched */
function editedDeckText() {
    const text = document.getElementById('deckText').value;
    return text.trim() === loadedText.trim() ? undefined : text;
}

// ============================== Showing a deck ==============================

let panelFor = null;
const deckCache = new Map();   // player id -> { size, deck }

/** A player's deck from the server (cached until its size changes) */
async function fetchDeck(player) {
    const cached = deckCache.get(player.id);
    if (cached && cached.size === player.deckSize) return cached.deck;
    const deck = await state.socket?.emitWithAck('get-deck', { target: serverId(player.id) });
    deckCache.set(player.id, { size: player.deckSize, deck });
    return deck;
}

/**
 * Open (or close) the deck window for a player, next to their name
 * @param {string} id - Player id
 * @param {Object} hooks - { openCommanderPicker } for "Add decklist" on our own tile
 */
async function toggleDeckPanel(id, hooks) {
    if (panelFor === id) return closeDeckPanel();
    const player = state.players.get(id);
    if (!player) return;
    panelFor = id;

    const panel = document.getElementById('deckPanel');
    panel.innerHTML = `<div class="p-6 flex justify-center"><span class="loading loading-dots"></span></div>`;
    panel.hidden = false;
    placePanel(player);

    let deck = null;
    if (player.deckSize) {
        try {
            deck = await fetchDeck(player);
        } catch (err) {
            console.warn('Could not load the deck:', err);
        }
    }
    if (panelFor !== id) return;
    renderDeck(panel, player, deck, hooks);
    placePanel(player);
}

function closeDeckPanel() {
    panelFor = null;
    const panel = document.getElementById('deckPanel');
    if (panel) {
        panel.hidden = true;
        panel.innerHTML = '';
    }
}

/** Over the play area, starting at the player's name, kept inside the table */
function placePanel(player) {
    const panel = document.getElementById('deckPanel');
    const table = document.getElementById('table').getBoundingClientRect();
    const name = player.tile.querySelector('.tile-name').getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const left = Math.min(Math.max(0, name.left - table.left), Math.max(0, table.width - box.width));
    const top = Math.min(Math.max(0, name.bottom - table.top + 6), Math.max(0, table.height - box.height));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
}

function renderDeck(panel, player, deck, hooks) {
    const owner = player.isLocal ? 'Your deck' : `${escapeHtml(player.username)}'s deck`;
    const close = `<button class="btn btn-sm btn-circle btn-ghost" data-deck-close aria-label="Close">✕</button>`;

    if (!deck?.cards?.length) {
        panel.innerHTML = `
            <div class="flex items-center justify-between gap-2 p-3 pb-0">
                <h3 class="font-bold">${owner}</h3>${close}
            </div>
            <div class="p-4 pt-2 text-sm text-base-content/60">
                ${player.isLocal
                    ? `No decklist yet. <button class="btn btn-sm btn-primary mt-3 w-full" data-deck-add>Add a decklist</button>`
                    : `${escapeHtml(player.username)} hasn't added a decklist.`}
            </div>`;
        panel.querySelector('[data-deck-add]')?.addEventListener('click', () => {
            closeDeckPanel();
            hooks.openCommanderPicker('deck');
        });
        panel.querySelector('[data-deck-close]').addEventListener('click', closeDeckPanel);
        return;
    }

    const commanderNames = player.commanders.map(card => card.name.toLowerCase());
    const total = deck.cards.reduce((sum, card) => sum + card.qty, 0);
    const groups = GROUPS.map(type => {
        const cards = deck.cards
            .filter(card => (card.type || 'Other') === type && !commanderNames.includes(card.name.toLowerCase()))
            .sort((a, b) => a.name.localeCompare(b.name));
        return { type, cards, count: cards.reduce((sum, card) => sum + card.qty, 0) };
    }).filter(group => group.cards.length);

    const line = (name, qty) => `
        <li><button class="deck-card" data-card="${escapeHtml(name)}">
            <span class="deck-qty">${qty}</span><span class="truncate">${escapeHtml(name)}</span>
        </button></li>`;
    const commanderBlock = player.commanders.length ? `
        <section class="deck-group">
            <h4>Commander</h4>
            <ul>${player.commanders.map(card => line(card.name, 1)).join('')}</ul>
        </section>` : '';
    const firstCard = player.commanders[0]?.name || groups[0]?.cards[0]?.name;

    panel.innerHTML = `
        <div class="flex items-center justify-between gap-2 px-3 pt-3">
            <div class="min-w-0">
                <h3 class="font-bold leading-tight truncate">${owner}${deck.name ? ` · <span class="font-normal">${escapeHtml(deck.name)}</span>` : ''}</h3>
                <p class="text-xs text-base-content/50">${total} cards${deck.source ? ` · <a class="link" href="${escapeHtml(deck.source)}" target="_blank" rel="noopener">Archidekt</a>` : ''}</p>
            </div>
            ${close}
        </div>
        <div class="deck-body">
            <div class="deck-list">
                ${commanderBlock}
                ${groups.map(group => `
                    <section class="deck-group">
                        <h4>${GROUP_LABELS[group.type]} <span>${group.count}</span></h4>
                        <ul>${group.cards.map(card => line(card.name, card.qty)).join('')}</ul>
                    </section>`).join('')}
            </div>
            <div class="deck-preview">
                ${firstCard ? `<img src="${cardImage(firstCard)}" alt="" draggable="false" />` : ''}
            </div>
        </div>`;

    panel.querySelector('[data-deck-close]').addEventListener('click', closeDeckPanel);
    const preview = panel.querySelector('.deck-preview img');
    const show = (button) => {
        panel.querySelectorAll('.deck-card.active').forEach(b => b.classList.remove('active'));
        button.classList.add('active');
        if (preview) preview.src = cardImage(button.dataset.card);
    };
    panel.querySelectorAll('.deck-card').forEach(button => {
        button.addEventListener('mouseenter', () => show(button));
        button.addEventListener('click', () => show(button));
    });
}

/**
 * @param {Object} appState - Application state
 */
function initDecklists(appState) {
    state = appState;
    setupDeckEditor();

    document.addEventListener('pointerdown', (e) => {
        if (panelFor && !e.target.closest('#deckPanel') && !e.target.closest('.tile-title')) closeDeckPanel();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDeckPanel(); });
}

/** A saved deck changed: forget the cached copy (and refresh the window if it's open) */
function deckChanged(id) {
    const player = state.players.get(id);
    const cached = deckCache.get(id);
    if (!cached || !player || cached.size === player.deckSize) return;
    deckCache.delete(id);
}

/** Save the dialog's decklist; resolves commanders from the list if none were picked */
async function saveDeck(text, pickedCommanders, updateMe, toCommander) {
    const { deck, commanders, notFound } = await buildDeck(text);
    const changes = { deck };
    if (!pickedCommanders.length && commanders.length) changes.commanders = commanders.slice(0, 2).map(toCommander);
    updateMe(changes);
    deckCache.delete('local');

    if (!deck) {
        showToast('Decklist removed', 'info');
        return;
    }
    const count = deck.cards.reduce((sum, card) => sum + card.qty, 0);
    showToast(notFound.length
        ? `Decklist saved (${count} cards). Not found: ${notFound.slice(0, 3).join(', ')}${notFound.length > 3 ? '…' : ''}`
        : `Decklist saved (${count} cards)`, notFound.length ? 'warning' : 'success');
}

// ES6 Module Exports
export {
    initDecklists,
    parseDeckText,
    loadDeckEditor,
    editedDeckText,
    saveDeck,
    fetchDeck,
    toggleDeckPanel,
    closeDeckPanel,
    deckChanged
};
