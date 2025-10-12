/**
 * Recognition Handler Module
 * Handles card recognition, scanning, and API communication
 */

/**
 * Setup click handler on main video for card scanning
 * @param {Object} state - Application state
 * @param {Function} scanRegion - Function to scan selected region
 * @param {Function} showToast - Toast notification function
 */
function setupClickHandler(state, scanRegion, showToast) {
    const container = document.getElementById('mainFeedContainer');
    const mainVideo = document.getElementById('mainVideo');
    
    let isDragging = false;
    let startX, startY;
    let selectionBox = null;
    
    // Remove old listener
    container.onmousedown = null;
    container.onmousemove = null;
    container.onmouseup = null;
    
    // Mouse down - start selection
    container.onmousedown = (e) => {
        if (state.isScanning) return;
        
        // Don't scan if clicking on the menu button or dropdown
        if (e.target.closest('#mainCameraMenu') || e.target.closest('.dropdown-content')) {
            return;
        }
        
        const rect = mainVideo.getBoundingClientRect();
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;
        
        isDragging = true;
        
        // Create selection box
        if (!selectionBox) {
            selectionBox = document.createElement('div');
            selectionBox.style.position = 'absolute';
            selectionBox.style.border = '3px solid #00ff00';
            selectionBox.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
            selectionBox.style.pointerEvents = 'none';
            selectionBox.style.zIndex = '100';
            container.appendChild(selectionBox);
        }
        
        selectionBox.style.left = `${startX}px`;
        selectionBox.style.top = `${startY}px`;
        selectionBox.style.width = '0px';
        selectionBox.style.height = '0px';
        selectionBox.style.display = 'block';
    };
    
    // Mouse move - update selection
    container.onmousemove = (e) => {
        if (!isDragging || !selectionBox) return;
        
        const rect = mainVideo.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);
        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        
        selectionBox.style.left = `${left}px`;
        selectionBox.style.top = `${top}px`;
        selectionBox.style.width = `${width}px`;
        selectionBox.style.height = `${height}px`;
    };
    
    // Mouse up - scan selected area
    container.onmouseup = async (e) => {
        if (!isDragging) return;
        isDragging = false;
        
        const rect = mainVideo.getBoundingClientRect();
        const endX = e.clientX - rect.left;
        const endY = e.clientY - rect.top;
        
        const width = Math.abs(endX - startX);
        const height = Math.abs(endY - startY);
        
        // Hide selection box
        if (selectionBox) {
            selectionBox.style.display = 'none';
        }
        
        // If selection too small, treat as click
        if (width < 50 || height < 50) {
            showToast('Drag a box around the card to scan', 'info');
            return;
        }
        
        // Scan the selected region
        const left = Math.min(startX, endX);
        const top = Math.min(startY, endY);
        await scanRegion(left, top, width, height);
    };
}

/**
 * Scan card in selected region
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} width - Selection width
 * @param {number} height - Selection height
 * @param {string} API_URL - API URL
 * @param {Object} state - Application state
 * @param {Function} displayCard - Function to display recognized card
 * @param {Function} showToast - Toast notification function
 */
async function scanRegion(x, y, width, height, API_URL, state, displayCard, showToast) {
    if (!state.currentMainCamera || state.isScanning) return;
    
    state.isScanning = true;
    document.getElementById('scanningIndicator').style.display = 'flex';
    
    try {
        const mainVideo = document.getElementById('mainVideo');
        const canvas = document.createElement('canvas');
        canvas.width = mainVideo.videoWidth;
        canvas.height = mainVideo.videoHeight;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(mainVideo, 0, 0);
        
        // Calculate the region in video coordinates
        const scaleX = canvas.width / mainVideo.clientWidth;
        const scaleY = canvas.height / mainVideo.clientHeight;
        
        const regionX = Math.floor(x * scaleX);
        const regionY = Math.floor(y * scaleY);
        const regionWidth = Math.floor(width * scaleX);
        const regionHeight = Math.floor(height * scaleY);
        
        // Extract the selected region
        const regionCanvas = document.createElement('canvas');
        regionCanvas.width = regionWidth;
        regionCanvas.height = regionHeight;
        const regionCtx = regionCanvas.getContext('2d');
        
        regionCtx.drawImage(
            canvas,
            regionX, regionY, regionWidth, regionHeight,
            0, 0, regionWidth, regionHeight
        );
        
        // Convert to blob (high quality)
        const blob = await new Promise(resolve => regionCanvas.toBlob(resolve, 'image/jpeg', 0.98));
        
        console.log('📸 Scanning region:', {
            x: regionX, y: regionY,
            width: regionWidth, height: regionHeight,
            size: (blob.size / 1024).toFixed(2) + ' KB'
        });
        
        // Send to API
        const formData = new FormData();
        formData.append('file', blob, 'card.jpg');
        
        const response = await fetch(`${API_URL}/api/recognize`, {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            displayCard(result.card);
            showToast(`Found: ${result.card.name}`, 'success');
        } else {
            showToast(result.message || 'Card not recognized', 'warning');
        }
        
    } catch (err) {
        console.error('Error scanning card:', err);
        showToast('Failed to scan card', 'error');
    } finally {
        state.isScanning = false;
        document.getElementById('scanningIndicator').style.display = 'none';
    }
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
            statusEl.textContent = '✓ Ready';
            statsEl.textContent = `${health.stats.total_cards.toLocaleString()} cards`;
        } else {
            statusEl.textContent = '⚠ No DB';
            statsEl.textContent = '';
        }
    } catch (err) {
        console.error('Health check failed:', err);
        document.getElementById('dbStatus').textContent = '✗ Offline';
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
    scanRegion,
    displayCard,
    checkHealth,
    setupCardSearch
};
