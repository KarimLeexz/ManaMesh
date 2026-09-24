/**
 * Recognition Handler Module
 * Tap-to-scan card recognition on any camera tile, the scanned cards panel, the card
 * viewer, card search and API communication
 */

import { effectiveFlip, escapeHtml } from './table-view.js';

const MAX_UPLOAD_SIDE = 2560;   // longest side of the frame sent to the server, in pixels
const OUTLINE_MS = 2500;        // how long a found card's outline stays on the video
const SUGGESTION_MS = 12000;    // how long the suggestion buttons stay before dismissing themselves
const MAX_SCANNED = 60;         // scanned cards kept in the panel

/**
 * Convert a position between the on-screen video and the raw video frame. The video may be
 * shown mirrored or upside down, but the frame we capture is always the raw one. A mirror
 * is its own inverse, so the same function converts both ways.
 * @param {number} fx - Horizontal position as a fraction (0-1)
 * @param {number} fy - Vertical position as a fraction (0-1)
 * @param {Object} flip - { h, v } as applied on screen
 * @returns {number[]} [fx, fy] in the other space
 */
function mirror(fx, fy, flip) {
    return [flip.h ? 1 - fx : fx, flip.v ? 1 - fy : fy];
}

/**
 * Where the picture really is inside a video element: the video is shown with
 * object-fit: contain, so there may be black bars left/right or top/bottom.
 * @param {HTMLVideoElement} video
 * @returns {Object} { left, top, width, height } in window coordinates
 */
function pictureRect(video) {
    const box = video.getBoundingClientRect();
    const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    return {
        left: box.left + (box.width - width) / 2,
        top: box.top + (box.height - height) / 2,
        width,
        height
    };
}

/**
 * Identify the card at a spot of a player's camera
 * @param {Object} state - Application state
 * @param {string} id - Player whose camera was tapped
 * @param {number} clientX - Tap position in window coordinates
 * @param {number} clientY
 * @param {string} API_URL - API URL
 * @param {Function} showToast - Toast notification function
 */
async function scanTile(state, id, clientX, clientY, API_URL, showToast) {
    const player = state.players.get(id);
    const video = player?.video;
    if (!player || state.isScanning || !video?.videoWidth) return;

    const picture = pictureRect(video);
    const sx = (clientX - picture.left) / picture.width;
    const sy = (clientY - picture.top) / picture.height;
    if (sx < 0 || sy < 0 || sx > 1 || sy > 1) return;   // tapped a black bar

    const [fx, fy] = mirror(sx, sy, effectiveFlip(player));

    state.isScanning = true;
    const tileBox = player.tile.getBoundingClientRect();
    const ping = document.createElement('div');
    ping.className = 'tile-ping';
    ping.style.left = `${clientX - tileBox.left}px`;
    ping.style.top = `${clientY - tileBox.top}px`;
    player.tile.appendChild(ping);

    try {
        // Capture the raw frame (a local camera gives its full capture resolution)
        const scale = Math.min(1, MAX_UPLOAD_SIDE / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));

        const formData = new FormData();
        formData.append('file', blob, 'frame.jpg');
        formData.append('x', fx.toFixed(4));
        formData.append('y', fy.toFixed(4));

        const response = await fetch(`${API_URL}/api/recognize`, { method: 'POST', body: formData });
        const result = await response.json();

        if (!response.ok) {
            showToast(result.detail || 'Scan failed', 'error');
        } else if (result.success) {
            hideSuggestions(player);
            displayCard(result.card);
            drawOutline(player, result.card);
            showToast(`Found: ${result.card.name}`, 'success');
        } else if (result.suggestions?.length) {
            drawOutline(player, { corners: result.corners, name: 'not sure' }, '#ffd000');
            showSuggestions(player, result.suggestions, showToast);
        } else {
            hideSuggestions(player);
            showToast(result.message || 'No card found there', 'warning');
        }
    } catch (err) {
        console.error('Error scanning card:', err);
        showToast('Failed to scan card', 'error');
    } finally {
        state.isScanning = false;
        ping.remove();
    }
}

/**
 * Offer the best guesses for an unsure scan as buttons over the video: one tap confirms
 * a guess, and a wrong guess costs nothing (dismiss it or tap the card again).
 * @param {Object} player - Player whose camera was scanned
 * @param {Object[]} suggestions - Up to 3 cards: { name, scryfall_id, image_url, ... }
 * @param {Function} showToast - Toast notification function
 */
function showSuggestions(player, suggestions, showToast) {
    hideSuggestions(player);

    const panel = document.createElement('div');
    panel.className = 'suggestions absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex flex-wrap items-center ' +
                      'justify-center gap-2 rounded-box bg-base-100/95 p-2 shadow-xl max-w-[90%]';

    const label = document.createElement('span');
    label.className = 'text-xs opacity-80 px-1';
    label.textContent = 'Not sure. Is it:';
    panel.appendChild(label);

    for (const card of suggestions) {
        const button = document.createElement('button');
        button.className = 'btn btn-sm btn-warning';
        button.textContent = card.name;
        button.onclick = (e) => {
            e.stopPropagation();
            displayCard(card);
            showToast(`Added: ${card.name}`, 'success');
            hideSuggestions(player);
        };
        panel.appendChild(button);
    }

    const close = document.createElement('button');
    close.className = 'btn btn-sm btn-ghost btn-circle';
    close.textContent = '✕';
    close.onclick = (e) => { e.stopPropagation(); hideSuggestions(player); };
    panel.appendChild(close);

    player.tile.appendChild(panel);
    player.suggestionTimer = setTimeout(() => hideSuggestions(player), SUGGESTION_MS);
}

function hideSuggestions(player) {
    clearTimeout(player.suggestionTimer);
    player.tile.querySelector('.suggestions')?.remove();
}

/**
 * Outline the found card on the video for a moment, with its name
 * @param {Object} player - Player whose camera was scanned
 * @param {Object} card - Recognized card, with 'corners' as fractions of the raw frame
 * @param {string} color - Outline colour (green for a sure match, amber for a guess)
 */
function drawOutline(player, card, color = '#00ff88') {
    if (!card.corners) return;

    const canvas = player.tile.querySelector('.tile-canvas');
    const box = canvas.getBoundingClientRect();
    const picture = pictureRect(player.video);
    const flip = effectiveFlip(player);
    canvas.width = box.width;
    canvas.height = box.height;

    const points = card.corners.map(([cx, cy]) => {
        const [sx, sy] = mirror(cx, cy, flip);
        return [picture.left - box.left + sx * picture.width, picture.top - box.top + sy * picture.height];
    });

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();

    // Name tag above the card's top edge
    const left = Math.min(...points.map(p => p[0]));
    const top = Math.min(...points.map(p => p[1]));
    ctx.font = 'bold 14px sans-serif';
    const label = card.name;
    const width = ctx.measureText(label).width + 12;
    const labelY = Math.max(top - 26, 0);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(left, labelY, width, 22);
    ctx.fillStyle = color;
    ctx.fillText(label, left + 6, labelY + 16);

    clearTimeout(player.outlineTimer);
    player.outlineTimer = setTimeout(() => ctx.clearRect(0, 0, canvas.width, canvas.height), OUTLINE_MS);
}

// ============================== Scanned cards panel ==============================

/**
 * Put a card at the top of the scanned cards panel (moving it there if it's already in it)
 * @param {Object} card - Card data: { name, scryfall_id, image_url }
 */
function displayCard(card) {
    const resultDiv = document.getElementById('result');
    resultDiv.querySelector('.empty-hint')?.remove();
    resultDiv.querySelector(`[data-scryfall-id="${CSS.escape(card.scryfall_id)}"]`)?.remove();

    const item = document.createElement('div');
    item.className = 'card-result';
    item.dataset.scryfallId = card.scryfall_id;
    item.title = card.name;
    item.innerHTML = `<img src="${escapeHtml(card.image_url)}" alt="${escapeHtml(card.name)}" loading="lazy" draggable="false" />`;
    item.addEventListener('click', () => {
        hidePreview();
        openCardModal(card);
    });
    setupCardHoverPreview(item, card.scryfall_id);

    resultDiv.prepend(item);
    while (resultDiv.children.length > MAX_SCANNED) resultDiv.lastElementChild.remove();
    resultDiv.scrollTop = 0;
}

// Cache for card data from Scryfall API
const cardDataCache = {};

async function fetchCardData(scryfallId) {
    if (!cardDataCache[scryfallId]) {
        const response = await fetch(`https://api.scryfall.com/cards/${scryfallId}`);
        if (!response.ok) throw new Error(`Scryfall answered ${response.status}`);
        cardDataCache[scryfallId] = await response.json();
    }
    return cardDataCache[scryfallId];
}

/** Large images of a card: both faces of a double-faced card, else the one */
function largeImages(cardData) {
    if (cardData.card_faces?.length > 1 && cardData.card_faces[0].image_uris) {
        return cardData.card_faces.map(face => face.image_uris.large || face.image_uris.normal);
    }
    return [cardData.image_uris?.large || cardData.image_uris?.normal].filter(Boolean);
}

/**
 * Enlarged preview next to the panel while the mouse is over a scanned card
 * (touch screens use the card viewer instead)
 */
function setupCardHoverPreview(element, scryfallId) {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const previewContainer = document.getElementById('cardHoverPreview');

    element.addEventListener('mouseenter', async () => {
        let cardData;
        try {
            cardData = await fetchCardData(scryfallId);
        } catch (err) {
            console.error('Failed to fetch card data:', err);
            return;
        }
        if (!element.matches(':hover')) return;

        const images = largeImages(cardData);
        previewContainer.innerHTML = images.map(src => `<img src="${escapeHtml(src)}" alt="" />`).join('');
        previewContainer.classList.add('active');

        // To the left of the panel, kept inside the window
        const rect = element.getBoundingClientRect();
        const previewWidth = images.length * 320 + (images.length - 1) * 16;
        previewContainer.style.left = `${Math.max(8, rect.left - previewWidth - 16)}px`;
        previewContainer.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - 460))}px`;
    });

    element.addEventListener('mouseleave', hidePreview);
}

function hidePreview() {
    const previewContainer = document.getElementById('cardHoverPreview');
    previewContainer.classList.remove('active');
    previewContainer.innerHTML = '';
}

/**
 * Show a card big, both faces if it has two
 * @param {Object} card - { name, scryfall_id, image_url }
 * @param {Object[]} actions - Extra buttons: [{ label, className, onClick }]
 */
async function openCardModal(card, actions = []) {
    const modal = document.getElementById('cardModal');
    const images = document.getElementById('cardModalImages');
    const buttons = document.getElementById('cardModalActions');

    images.innerHTML = `<img src="${escapeHtml(card.image_url)}" alt="${escapeHtml(card.name)}" />`;
    buttons.innerHTML = '';
    for (const action of actions) {
        const button = document.createElement('button');
        button.className = `btn ${action.className || ''}`;
        button.textContent = action.label;
        button.onclick = () => { modal.close(); action.onClick(); };
        buttons.appendChild(button);
    }
    const close = document.createElement('button');
    close.className = 'btn';
    close.textContent = 'Close';
    close.onclick = () => modal.close();
    buttons.appendChild(close);

    modal.showModal();

    // Upgrade to the large image(s) once Scryfall has answered
    try {
        const cardData = await fetchCardData(card.scryfall_id);
        if (modal.open) {
            images.innerHTML = largeImages(cardData).map(src => `<img src="${escapeHtml(src)}" alt="" />`).join('');
        }
    } catch (err) {
        console.warn('Could not load the large card image:', err);
    }
}

// ============================== Scanner status ==============================

/**
 * Check API health and display database status
 * @param {string} API_URL - API URL
 */
async function checkHealth(API_URL) {
    const dot = document.getElementById('scannerStatusDot');
    const text = document.getElementById('scannerStatusText');
    const tip = document.getElementById('scannerStatusTip');
    const show = (status, label, tooltip) => {
        dot.className = `status status-${status}`;
        text.textContent = label;
        tip.dataset.tip = tooltip;
    };

    try {
        const response = await fetch(`${API_URL}/health`);
        const health = await response.json();

        if (health.database_loaded) {
            const cards = health.stats.total_cards.toLocaleString();
            show('success', 'Scanner', `Card scanner ready · ${cards} cards`);
        } else {
            show('warning', 'No card index', 'Card index missing: run backend/build_index.py');
        }
    } catch (err) {
        console.error('Health check failed:', err);
        show('error', 'Offline', 'The server cannot be reached');
    }
}

// ============================== Card search ==============================

let searchTimeout = null;
let selectedIndex = -1;
let searchResultsData = [];

/**
 * Setup card search with autocomplete
 */
function setupCardSearch() {
    const searchInput = document.getElementById('cardSearch');
    const searchResults = document.getElementById('searchResults');

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();

        // Clear timeout
        if (searchTimeout) clearTimeout(searchTimeout);

        if (query.length < 2) {
            searchResults.classList.add('hidden');
            searchResultsData = [];
            selectedIndex = -1;
            return;
        }

        // Debounce search (200ms)
        searchTimeout = setTimeout(() => searchCards(query), 200);
    });

    // Keyboard navigation
    searchInput.addEventListener('keydown', (e) => {
        const items = searchResults.querySelectorAll('.search-result-item');

        if (e.key === 'Escape') {
            e.preventDefault();
            searchResults.classList.add('hidden');
            selectedIndex = -1;
            searchInput.blur();
            return;
        }
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(items.length - 1, selectedIndex + 1);
            updateSelection(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(-1, selectedIndex - 1);
            updateSelection(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const pick = searchResultsData[Math.max(0, selectedIndex)];
            if (pick) selectCard(pick);
        }
    });

    // Click outside to close
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
            searchResults.classList.add('hidden');
        }
    });
}

/**
 * Search for cards using Scryfall autocomplete
 */
async function searchCards(query) {
    const searchResults = document.getElementById('searchResults');

    try {
        // Use Scryfall autocomplete API for unique card names
        const response = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(query)}`);
        const data = await response.json();

        searchResultsData = data.data || [];
        selectedIndex = -1;

        if (searchResultsData.length === 0) {
            searchResults.innerHTML = '<li class="menu-disabled"><span>No cards found</span></li>';
            searchResults.classList.remove('hidden');
            return;
        }

        searchResults.innerHTML = searchResultsData.map((cardName, index) =>
            `<li><a class="search-result-item" data-index="${index}">${escapeHtml(cardName)}</a></li>`
        ).join('');
        searchResults.classList.remove('hidden');

        searchResults.querySelectorAll('.search-result-item').forEach((item, index) => {
            item.addEventListener('click', () => selectCard(searchResultsData[index]));
        });
    } catch (err) {
        console.error('Search failed:', err);
        searchResults.innerHTML = '<li class="menu-disabled"><span class="text-error">Search failed</span></li>';
        searchResults.classList.remove('hidden');
    }
}

/**
 * Update selected item in dropdown
 */
function updateSelection(items) {
    items.forEach((item, index) => {
        item.classList.toggle('menu-active', index === selectedIndex);
        if (index === selectedIndex) item.scrollIntoView({ block: 'nearest' });
    });
}

/**
 * Select a card and display it
 */
async function selectCard(cardName) {
    const searchInput = document.getElementById('cardSearch');
    const searchResults = document.getElementById('searchResults');

    // Close dropdown
    searchResults.classList.add('hidden');
    searchInput.value = '';

    try {
        // Fetch card by exact name (returns latest/most common printing)
        const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`);
        const cardData = await response.json();
        cardDataCache[cardData.id] = cardData;

        // Display card using same function as recognition
        displayCard({
            name: cardData.name,
            image_url: cardData.image_uris?.normal || cardData.card_faces?.[0]?.image_uris?.normal,
            scryfall_id: cardData.id,
            set: cardData.set
        });
    } catch (err) {
        console.error('Failed to fetch card:', err);
    }
}

// ES6 Module Exports
export {
    scanTile,
    displayCard,
    openCardModal,
    checkHealth,
    setupCardSearch
};
