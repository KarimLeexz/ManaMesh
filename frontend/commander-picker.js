/**
 * Commander Picker Module
 * Search Scryfall for a commander (or two, for partners / backgrounds) and pick it.
 * The dialog's second tab holds the decklist (decklist.js).
 */

import { escapeHtml } from './table-view.js';

const MAX_RESULTS = 24;

let selected = [];
let results = [];
let searchTimer = null;
let searchId = 0;
let onSave = null;

/**
 * @param {Function} save - Called with the chosen commanders and the decklist tab's text
 *   (undefined if it wasn't touched) when the player taps Done
 * @param {Function} editedDeckText - Reads the decklist tab
 */
function setupCommanderPicker(save, editedDeckText) {
    onSave = save;
    const modal = document.getElementById('commanderModal');
    const input = document.getElementById('commanderSearch');

    input.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => search(input.value.trim()), 250);
    });

    document.getElementById('commanderResults').addEventListener('click', (e) => {
        const option = e.target.closest('[data-index]');
        if (option) pick(results[Number(option.dataset.index)]);
    });

    document.getElementById('commanderSelected').addEventListener('click', (e) => {
        const remove = e.target.closest('[data-remove]');
        if (!remove) return;
        selected.splice(Number(remove.dataset.remove), 1);
        render();
    });

    document.getElementById('commanderPartner').addEventListener('change', (e) => {
        if (!e.target.checked && selected.length > 1) selected = selected.slice(0, 1);
        render();
    });

    modal.addEventListener('close', () => {
        if (modal.returnValue === 'save') onSave(selected.slice(), editedDeckText());
    });

    modal.querySelectorAll('[data-cmd-tab]').forEach(tab => {
        tab.addEventListener('click', () => showTab(tab.dataset.cmdTab));
    });
}

/** 'commander' or 'deck' */
function showTab(name) {
    const modal = document.getElementById('commanderModal');
    modal.querySelectorAll('[data-cmd-tab]').forEach(tab => tab.classList.toggle('tab-active', tab.dataset.cmdTab === name));
    modal.querySelectorAll('[data-cmd-panel]').forEach(panel => { panel.hidden = panel.dataset.cmdPanel !== name; });
    document.getElementById('commanderPartnerLabel').style.visibility = name === 'commander' ? '' : 'hidden';
    if (name === 'commander') document.getElementById('commanderSearch').focus();
}

/**
 * @param {Object[]} current - The commanders the player has now
 * @param {string} tab - 'commander' or 'deck'
 */
function openCommanderPicker(current, tab = 'commander') {
    const modal = document.getElementById('commanderModal');
    selected = current.slice();
    results = [];
    document.getElementById('commanderPartner').checked = selected.length > 1;
    document.getElementById('commanderSearch').value = '';
    document.getElementById('commanderResults').innerHTML = hint('Type a name to search');
    render();

    modal.returnValue = '';
    modal.showModal();
    showTab(tab);
}

function hint(text) {
    return `<p class="col-span-full py-10 text-center text-sm text-base-content/50">${text}</p>`;
}

/** Scryfall card -> what the table needs to show a commander */
function toCommander(card) {
    const images = card.image_uris || card.card_faces?.[0]?.image_uris || {};
    return {
        name: card.name,
        scryfall_id: card.id,
        image_url: images.normal || images.large || '',
        art_url: images.art_crop || images.small || ''
    };
}

async function search(query) {
    const box = document.getElementById('commanderResults');
    const loading = document.getElementById('commanderLoading');
    const id = ++searchId;

    if (query.length < 2) {
        results = [];
        box.innerHTML = hint('Type a name to search');
        return;
    }

    loading.classList.remove('hidden');
    try {
        const q = encodeURIComponent(`${query} is:commander`);
        const response = await fetch(`https://api.scryfall.com/cards/search?q=${q}&order=edhrec&unique=cards`);
        if (id !== searchId) return;   // a newer search is under way

        if (response.status === 404) {
            results = [];
            box.innerHTML = hint('No commander found');
            return;
        }
        const data = await response.json();
        results = (data.data || []).slice(0, MAX_RESULTS).map(toCommander).filter(c => c.image_url);
        renderResults();
    } catch (err) {
        console.error('Commander search failed:', err);
        if (id === searchId) box.innerHTML = hint('Search failed. Is the internet connection up?');
    } finally {
        if (id === searchId) loading.classList.add('hidden');
    }
}

/** Tap a result: it becomes the commander, or the second one in partner mode */
function pick(card) {
    if (!card) return;
    const index = selected.findIndex(c => c.scryfall_id === card.scryfall_id);
    const partner = document.getElementById('commanderPartner').checked;

    if (index >= 0) selected.splice(index, 1);
    else if (!partner) selected = [card];
    else selected = [...selected, card].slice(-2);
    render();
}

function render() {
    document.getElementById('commanderSelected').innerHTML = selected.length
        ? selected.map((card, i) => `
            <div class="badge badge-lg badge-primary gap-2 h-auto py-1 pl-1 pr-2">
                <img src="${escapeHtml(card.art_url)}" alt="" class="h-8 w-8 rounded-full object-cover" />
                <span class="font-semibold">${escapeHtml(card.name)}</span>
                <button class="btn btn-xs btn-circle btn-ghost" data-remove="${i}" aria-label="Remove">✕</button>
            </div>`).join('')
        : '<span class="text-sm text-base-content/50">No commander chosen</span>';
    renderResults();
}

function renderResults() {
    if (!results.length) return;
    const chosen = new Set(selected.map(c => c.scryfall_id));
    document.getElementById('commanderResults').innerHTML = results.map((card, i) => `
        <button class="commander-option ${chosen.has(card.scryfall_id) ? 'selected' : ''}" data-index="${i}" title="${escapeHtml(card.name)}">
            <img src="${escapeHtml(card.image_url)}" alt="${escapeHtml(card.name)}" loading="lazy" draggable="false" />
        </button>`).join('');
}

// ES6 Module Exports
export {
    toCommander,
    setupCommanderPicker,
    openCommanderPicker
};
