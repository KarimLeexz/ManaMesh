/**
 * UI Controller Module
 * Handles all UI updates, camera grid management, toasts, and visual effects
 */

/**
 * Add camera to the camera grid
 * @param {string} userId - User ID
 * @param {MediaStream} stream - Media stream (null for placeholder)
 * @param {string} username - Display name
 * @param {boolean} isLocal - Whether this is the local user
 * @param {Object} state - Application state
 * @param {Function} showOnMainFeed - Function to show camera on main feed
 */
function addCamera(userId, stream, username, isLocal, state, showOnMainFeed) {
    // Check if stream is null (no camera) - show placeholder instead
    const hasStream = stream !== null;
    
    // Create video element or placeholder
    let mediaElement;
    if (hasStream) {
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsinline = true;
        video.srcObject = stream;
        video.style.transform = 'scaleX(-1)';
        video.muted = isLocal; // Mute local to avoid feedback
        video.className = 'w-full h-full object-cover';
        mediaElement = video;
    } else {
        // Create placeholder for no camera
        const placeholder = document.createElement('div');
        placeholder.className = 'w-full h-full flex items-center justify-center bg-base-300';
        placeholder.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2"/>
            </svg>
        `;
        mediaElement = placeholder;
    }
    
    // Store in state with flip info
    state.cameras.set(userId, { 
        stream, 
        element: mediaElement, 
        username,
        flipH: false,
        flipV: false,
        hasStream
    });
    
    // Create thumbnail container
    const container = document.createElement('div');
    container.id = `camera-${userId}`;
    container.className = 'relative rounded-lg flex-shrink-0 w-48 h-36 group';
    
    // Video wrapper (clickable) - this has overflow-hidden
    const videoWrapper = document.createElement('div');
    videoWrapper.className = 'w-full h-full cursor-pointer hover:ring-2 hover:ring-primary transition-all rounded-lg overflow-hidden';
    if (hasStream) {
        videoWrapper.onclick = () => showOnMainFeed(userId);
    }
    videoWrapper.appendChild(mediaElement);
    container.appendChild(videoWrapper);
    
    // Add name badge
    const badge = document.createElement('div');
    badge.className = 'absolute bottom-1 left-1 badge badge-sm badge-neutral pointer-events-none';
    badge.textContent = username;
    container.appendChild(badge);
    
    // Three-dot menu button - ALWAYS visible on hover, with high z-index
    const menuBtn = document.createElement('div');
    menuBtn.className = 'dropdown dropdown-end absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity z-50';
    menuBtn.innerHTML = `
        <label tabindex="0" class="btn btn-xs btn-circle btn-neutral">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
        </label>
        <ul tabindex="0" class="dropdown-content z-[1000] menu p-2 shadow bg-base-200 rounded-box w-52 text-sm">
            ${hasStream ? `
            <li><a onclick="event.stopPropagation(); toggleFlipHorizontal('${userId}')">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                Flip Horizontally
            </a></li>
            <li><a onclick="event.stopPropagation(); toggleFlipVertical('${userId}')">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
                Flip Vertically
            </a></li>
            ` : ''}
            ${isLocal ? `
                <div class="divider my-1"></div>
                <li><a onclick="event.stopPropagation(); reopenCameraSetup()">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Configure Inputs
                </a></li>
                <li>
                    <label class="label cursor-pointer justify-start gap-2 px-4 hover:bg-base-300 rounded-lg">
                        <input type="checkbox" class="checkbox checkbox-sm" ${state.cameraEnabled ? 'checked' : ''} onchange="toggleCameraEnabled(this)" />
                        <span class="label-text">Camera Enabled</span>
                    </label>
                </li>
            ` : ''}
        </ul>
    `;
    container.appendChild(menuBtn);
    
    // Add to list
    document.getElementById('cameraList').appendChild(container);
    
    // Hide "no cameras" message when any camera is added
    const noCamerasMsg = document.getElementById('noCamerasMessage');
    if (noCamerasMsg) {
        noCamerasMsg.style.display = 'none';
    }
}

/**
 * Remove camera from the grid
 * @param {string} userId - User ID
 * @param {Object} state - Application state
 */
function removeCamera(userId, state) {
    const container = document.getElementById(`camera-${userId}`);
    if (container) {
        container.remove();
    }
    state.cameras.delete(userId);
    
    // If this was on main feed, clear it
    if (state.currentMainCamera === userId) {
        const mainVideo = document.getElementById('mainVideo');
        mainVideo.srcObject = null;
        document.getElementById('mainPlayerName').textContent = 'Select a camera';
        state.currentMainCamera = null;
        
        // Hide main camera menu
        const mainCameraMenu = document.getElementById('mainCameraMenu');
        if (mainCameraMenu) {
            mainCameraMenu.style.display = 'none';
        }
    }
    
    // Show "no cameras" message if no cameras left
    if (state.cameras.size === 0) {
        const noCamerasMsg = document.getElementById('noCamerasMessage');
        if (noCamerasMsg) noCamerasMsg.style.display = 'block';
    }
}

/**
 * Show camera on main feed
 * @param {string} userId - User ID
 * @param {Object} state - Application state
 * @param {Function} setupClickHandler - Function to set up scanning click handler
 */
function showOnMainFeed(userId, state, setupClickHandler) {
    const camera = state.cameras.get(userId);
    if (!camera) return;
    
    const mainVideo = document.getElementById('mainVideo');
    
    // Only set video if there's a stream
    if (camera.stream && camera.hasStream) {
        mainVideo.srcObject = camera.stream;
        mainVideo.style.display = 'block';
        
        // Apply flip settings
        const scaleX = camera.flipH ? -1 : 1;
        const scaleY = camera.flipV ? -1 : 1;
        mainVideo.style.transform = `scale(${scaleX}, ${scaleY})`;
    } else {
        // No stream - hide video
        mainVideo.style.display = 'none';
    }
    
    document.getElementById('mainPlayerName').textContent = camera.username;
    state.currentMainCamera = userId;
    
    // Update main camera menu
    updateMainCameraMenu(userId, state);
    
    // Setup click handler for scanning (only if has stream)
    if (camera.hasStream) {
        setupClickHandler();
    }
}

/**
 * Update the main camera menu with appropriate controls
 * @param {string} userId - User ID
 * @param {Object} state - Application state
 */
function updateMainCameraMenu(userId, state) {
    const camera = state.cameras.get(userId);
    if (!camera) return;
    
    const isLocal = (userId === 'local' || userId === state.socket?.id);
    const hasStream = camera.hasStream;
    const menuContainer = document.getElementById('mainCameraMenu');
    const menuContent = document.getElementById('mainCameraMenuContent');
    
    // Show the menu
    menuContainer.style.display = 'block';
    
    // Build menu content
    menuContent.innerHTML = `
        ${hasStream ? `
        <li><a onclick="event.stopPropagation(); toggleFlipHorizontal('${userId}')">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Flip Horizontally
        </a></li>
        <li><a onclick="event.stopPropagation(); toggleFlipVertical('${userId}')">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
            Flip Vertically
        </a></li>
        ` : ''}
        ${isLocal ? `
            ${hasStream ? '<div class="divider my-1"></div>' : ''}
            <li><a onclick="event.stopPropagation(); reopenCameraSetup()">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Configure Inputs
            </a></li>
            <li>
                <label class="label cursor-pointer justify-start gap-2 px-4 hover:bg-base-300 rounded-lg">
                    <input type="checkbox" class="checkbox checkbox-sm" ${state.cameraEnabled ? 'checked' : ''} onchange="toggleCameraEnabled(this)" />
                    <span class="label-text">Camera Enabled</span>
                </label>
            </li>
        ` : ''}
    `;
}

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type of toast (info, success, warning, error)
 */
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `alert alert-${type} shadow-lg fixed bottom-4 right-4 w-auto max-w-sm z-50`;
    toast.style.animation = 'slideIn 0.3s ease-out';
    toast.innerHTML = `<div><span>${message}</span></div>`;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease-out reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Toggle horizontal flip for a camera
 * @param {string} userId - User ID
 * @param {Object} state - Application state
 * @param {Function} showToast - Toast notification function
 */
function toggleFlipHorizontal(userId, state, showToast) {
    const camera = state.cameras.get(userId);
    if (!camera) return;
    
    camera.flipH = !camera.flipH;
    updateCameraTransform(userId, state);
    showToast(`Horizontal flip ${camera.flipH ? 'enabled' : 'disabled'}`, 'info');
}

/**
 * Toggle vertical flip for a camera
 * @param {string} userId - User ID
 * @param {Object} state - Application state
 * @param {Function} showToast - Toast notification function
 */
function toggleFlipVertical(userId, state, showToast) {
    const camera = state.cameras.get(userId);
    if (!camera) return;
    
    camera.flipV = !camera.flipV;
    updateCameraTransform(userId, state);
    showToast(`Vertical flip ${camera.flipV ? 'enabled' : 'disabled'}`, 'info');
}

/**
 * Update camera transform based on flip settings
 * @param {string} userId - User ID
 * @param {Object} state - Application state
 */
function updateCameraTransform(userId, state) {
    const camera = state.cameras.get(userId);
    if (!camera || !camera.element) return;
    
    const scaleX = camera.flipH ? -1 : 1;
    const scaleY = camera.flipV ? -1 : 1;
    camera.element.style.transform = `scale(${scaleX}, ${scaleY})`;
    
    // Also update main video if this camera is currently shown
    if (state.currentMainCamera === userId) {
        const mainVideo = document.getElementById('mainVideo');
        if (mainVideo) {
            mainVideo.style.transform = `scale(${scaleX}, ${scaleY})`;
        }
    }
}

// ES6 Module Exports
export {
    addCamera,
    removeCamera,
    showOnMainFeed,
    showToast,
    toggleFlipHorizontal,
    toggleFlipVertical,
    updateCameraTransform
};
