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
    const confidencePercent = (card.confidence * 100).toFixed(1);
    const confidenceClass = card.confidence > 0.9 ? 'badge-success' : 
                           card.confidence > 0.7 ? 'badge-warning' : 'badge-error';
    
    const cardHTML = `
        <div class="card-result">
            <div class="card bg-base-200 shadow-sm image-full">
                <figure><img src="${card.image_url}" alt="${card.name}" /></figure>
                <div class="card-body p-2">
                    <h3 class="card-title text-xs">${card.name}</h3>
                    <div class="flex gap-1 text-xs">
                        <span class="badge badge-xs badge-outline">${card.set.toUpperCase()}</span>
                        <span class="badge badge-xs ${confidenceClass}">${confidencePercent}%</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    const resultDiv = document.getElementById('result');
    
    // Replace empty state or add to top
    if (resultDiv.children[0]?.classList.contains('text-center')) {
        resultDiv.innerHTML = cardHTML;
    } else {
        resultDiv.insertAdjacentHTML('afterbegin', cardHTML);
    }
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
            statusEl.classList.add('text-success');
            statsEl.textContent = `${health.stats.total_cards.toLocaleString()} cards`;
        } else {
            statusEl.textContent = '⚠ No DB';
            statusEl.classList.add('text-warning');
            statsEl.textContent = 'Build database';
        }
    } catch (err) {
        console.error('Health check failed:', err);
        document.getElementById('dbStatus').textContent = '✗ Offline';
        document.getElementById('dbStats').textContent = 'Cannot connect';
    }
}

// ES6 Module Exports
export {
    setupClickHandler,
    scanRegion,
    displayCard,
    checkHealth
};
