/**
 * Recognition Handler Module
 * Click-to-scan card recognition, card search and API communication
 */

const MAX_UPLOAD_SIDE = 2560;   // longest side of the frame sent to the server, in pixels
const OUTLINE_MS = 2500;        // how long a found card's outline stays on the video

let outlineTimer = null;

/**
 * Convert a position between the on-screen video and the raw video frame. The video may be
 * shown mirrored (flipH) or upside down (flipV), but the frame we capture is always the raw
 * one. A mirror is its own inverse, so the same function converts both ways.
 * @param {number} fx - Horizontal position as a fraction (0-1)
 * @param {number} fy - Vertical position as a fraction (0-1)
 * @param {Object} camera - Camera entry with flipH / flipV
 * @returns {number[]} [fx, fy] in the other space
 */
function mirror(fx, fy, camera) {
    return [camera?.flipH ? 1 - fx : fx, camera?.flipV ? 1 - fy : fy];
}

/**
 * Click on a card in the main video to identify it
 * @param {Object} state - Application state
 * @param {Function} scanAt - Scans the card at a position: (fx, fy, click)
 */
function setupClickHandler(state, scanAt) {
    const container = document.getElementById('mainFeedContainer');
    const mainVideo = document.getElementById('mainVideo');

    // Remove the old drag-a-box handlers
    container.onmousedown = null;
    container.onmousemove = null;
    container.onmouseup = null;

    container.onclick = (e) => {
        if (state.isScanning) return;

        // Don't scan if clicking on the menu button or dropdown
        if (e.target.closest('#mainCameraMenu') || e.target.closest('.dropdown-content')) {
            return;
        }

        const rect = mainVideo.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        if (screenX < 0 || screenY < 0 || screenX > rect.width || screenY > rect.height) return;

        const camera = state.cameras.get(state.currentMainCamera);
        const [fx, fy] = mirror(screenX / rect.width, screenY / rect.height, camera);
        scanAt(fx, fy, { screenX, screenY });
    };
}

/**
 * Identify the card at a position in the main video
 * @param {number} fx - Horizontal position in the raw frame, as a fraction (0-1)
 * @param {number} fy - Vertical position in the raw frame, as a fraction (0-1)
 * @param {Object} click - Where the click landed on screen: { screenX, screenY }
 * @param {string} API_URL - API URL
 * @param {Object} state - Application state
 * @param {Function} displayCard - Function to display recognized card
 * @param {Function} showToast - Toast notification function
 */
async function scanAt(fx, fy, click, API_URL, state, displayCard, showToast) {
    const mainVideo = document.getElementById('mainVideo');
    if (!state.currentMainCamera || state.isScanning || !mainVideo.videoWidth) return;

    state.isScanning = true;
    document.getElementById('scanningIndicator').style.display = 'flex';
    const ping = document.getElementById('clickIndicator');
    ping.style.left = `${click.screenX - 24}px`;
    ping.style.top = `${click.screenY - 24}px`;
    ping.classList.remove('hidden');

    try {
        // Capture the raw frame (a local camera gives its full capture resolution)
        const scale = Math.min(1, MAX_UPLOAD_SIDE / Math.max(mainVideo.videoWidth, mainVideo.videoHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(mainVideo.videoWidth * scale);
        canvas.height = Math.round(mainVideo.videoHeight * scale);
        canvas.getContext('2d').drawImage(mainVideo, 0, 0, canvas.width, canvas.height);
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
            displayCard(result.card);
            drawOutline(result.card, state);
            showToast(`Found: ${result.card.name}`, 'success');
        } else {
            showToast(result.message || 'No card found there', 'warning');
        }
    } catch (err) {
        console.error('Error scanning card:', err);
        showToast('Failed to scan card', 'error');
    } finally {
        state.isScanning = false;
        ping.classList.add('hidden');
        document.getElementById('scanningIndicator').style.display = 'none';
    }
}

/**
 * Outline the found card on the video for a moment, with its name
 * @param {Object} card - Recognized card, with 'corners' as fractions of the raw frame
 * @param {Object} state - Application state
 */
function drawOutline(card, state) {
    if (!card.corners) return;

    const mainVideo = document.getElementById('mainVideo');
    const canvas = document.getElementById('clickCanvas');
    const camera = state.cameras.get(state.currentMainCamera);
    canvas.width = mainVideo.clientWidth;
    canvas.height = mainVideo.clientHeight;

    const points = card.corners.map(([cx, cy]) => {
        const [sx, sy] = mirror(cx, cy, camera);
        return [sx * canvas.width, sy * canvas.height];
    });

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 255, 136, 0.12)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#00ff88';
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
    ctx.fillStyle = '#00ff88';
    ctx.fillText(label, left + 6, labelY + 16);

    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(() => ctx.clearRect(0, 0, canvas.width, canvas.height), OUTLINE_MS);
}

/**
 * Display recognized card
 * @param {Object} card - Card data
 */
function displayCard(card) {
    const cardHTML = `
        <div class="card-result" data-scryfall-id="${card.scryfall_id}">
            <img src="${card.image_url}" alt="${card.name}" class="w-full rounded-lg shadow-lg" />
        </div>
    `;
    
    const resultDiv = document.getElementById('result');
    
    // Replace empty state or add to top
    if (resultDiv.children[0]?.classList.contains('text-center')) {
        resultDiv.innerHTML = cardHTML;
    } else {
        resultDiv.insertAdjacentHTML('afterbegin', cardHTML);
    }

    // Setup hover preview for the newly added card
    setupCardHoverPreview(card.scryfall_id);
}

// Cache for card data from Scryfall API
const cardDataCache = {};

/**
 * Setup hover preview for a card
 * @param {string} scryfallId - Scryfall card ID
 */
async function setupCardHoverPreview(scryfallId) {
    const cardElement = document.querySelector(`[data-scryfall-id="${scryfallId}"]`);
    if (!cardElement) return;

    const previewContainer = document.getElementById('cardHoverPreview');
    let cardData = null;

    cardElement.addEventListener('mouseenter', async (e) => {
        // Fetch card data if not cached
        if (!cardDataCache[scryfallId]) {
            try {
                const response = await fetch(`https://api.scryfall.com/cards/${scryfallId}`);
                cardData = await response.json();
                cardDataCache[scryfallId] = cardData;
            } catch (err) {
                console.error('Failed to fetch card data:', err);
                return;
            }
        } else {
            cardData = cardDataCache[scryfallId];
        }

        // Build preview HTML
        let previewHTML = '';
        
        // Check if double-faced card
        if (cardData.card_faces && cardData.card_faces.length > 1) {
            // Show both faces
            previewHTML = `
                <img src="${cardData.card_faces[0].image_uris.large}" alt="${cardData.card_faces[0].name}" />
                <img src="${cardData.card_faces[1].image_uris.large}" alt="${cardData.card_faces[1].name}" />
            `;
        } else {
            // Single-faced card - just show larger version
            const imageUrl = cardData.image_uris?.large || cardData.image_uris?.normal;
            previewHTML = `<img src="${imageUrl}" alt="${cardData.name}" />`;
        }

        previewContainer.innerHTML = previewHTML;
        previewContainer.classList.add('active');

        // Position preview to the left of the card
        const rect = cardElement.getBoundingClientRect();
        const previewWidth = cardData.card_faces?.length > 1 ? 740 : 370; // 360px per card + gap
        previewContainer.style.left = `${rect.left - previewWidth - 20}px`;
        previewContainer.style.top = `${rect.top}px`;
    });

    cardElement.addEventListener('mouseleave', () => {
        previewContainer.classList.remove('active');
        previewContainer.innerHTML = '';
    });
}

/**
 * Check API health and display database status
 * @param {string} API_URL - API URL
 */
async function checkHealth(API_URL) {
    try {
        const response = await fetch(`${API_URL}/health`);
        const health = await response.json();
        
        const statusEl = document.getElementById('dbStatus');
        const statsEl = document.getElementById('dbStats');
        
        if (health.database_loaded) {
            statusEl.textContent = 'âœ“ Ready';
            statsEl.textContent = `${health.stats.total_cards.toLocaleString()} cards`;
        } else {
            statusEl.textContent = 'âš  No DB';
            statsEl.textContent = '';
        }
    } catch (err) {
        console.error('Health check failed:', err);
        document.getElementById('dbStatus').textContent = 'âœ— Offline';
        document.getElementById('dbStats').textContent = '';
    }
}

// Card search functionality
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
        
        if (items.length === 0) return;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (selectedIndex < items.length - 1) {
                selectedIndex++;
                updateSelection(items);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (selectedIndex > 0) {
                selectedIndex--;
                updateSelection(items);
            } else {
                selectedIndex = -1;
                updateSelection(items);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0 && searchResultsData[selectedIndex]) {
                selectCard(searchResultsData[selectedIndex]);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            searchResults.classList.add('hidden');
            selectedIndex = -1;
            searchInput.blur();
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
            searchResults.innerHTML = '<div class="p-3 text-sm text-center opacity-50">No cards found</div>';
            searchResults.classList.remove('hidden');
            return;
        }
        
        // Display results
        const html = searchResultsData.map((cardName, index) => `
            <div class="search-result-item text-sm" data-index="${index}">
                ${cardName}
            </div>
        `).join('');
        
        searchResults.innerHTML = html;
        searchResults.classList.remove('hidden');
        
        // Add click handlers and hover
        searchResults.querySelectorAll('.search-result-item').forEach((item, index) => {
            item.addEventListener('click', () => {
                selectCard(searchResultsData[index]);
            });
            
            item.addEventListener('mouseenter', () => {
                selectedIndex = index;
                updateSelection(searchResults.querySelectorAll('.search-result-item'));
            });
        });
        
    } catch (err) {
        console.error('Search failed:', err);
        searchResults.innerHTML = '<div class="p-3 text-sm text-center text-error">Search failed</div>';
        searchResults.classList.remove('hidden');
    }
}

/**
 * Update selected item in dropdown
 */
function updateSelection(items) {
    items.forEach((item, index) => {
        item.classList.remove('selected');
        if (index === selectedIndex) {
            item.classList.add('selected');
            // Smooth scroll into view
            item.scrollIntoView({ 
                block: 'nearest', 
                behavior: 'smooth' 
            });
        }
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
        
        // Display card using same function as recognition
        displayCard({
            name: cardData.name,
            image_url: cardData.image_uris?.normal || cardData.card_faces?.[0]?.image_uris?.normal,
            scryfall_id: cardData.id,
            set: cardData.set,
            confidence: 1.0 // Manual search = 100% confidence
        });
        
    } catch (err) {
        console.error('Failed to fetch card:', err);
    }
}

// ES6 Module Exports
export {
    setupClickHandler,
    scanAt,
    displayCard,
    checkHealth,
    setupCardSearch
};
