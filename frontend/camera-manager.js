/**
 * Camera Manager Module
 * Handles camera setup, enumeration, stream management, and enable/disable functionality
 */

/**
 * Initialize camera setup modal with device enumeration and preview
 * @param {Object} state - Application state object
 * @param {Function} showToast - Toast notification function
 */
async function initializeCameraSetup(state, showToast) {
    const setupVideo = document.getElementById('setupVideo');
    const cameraSelect = document.getElementById('cameraSelect');
    
    try {
        // First, request camera permissions with a basic stream
        console.log('Requesting camera permission...');
        const tempStream = await navigator.mediaDevices.getUserMedia({ 
            video: true,
            audio: false 
        });
        
        console.log('Camera permission granted!');
        
        // Show preview immediately
        setupVideo.srcObject = tempStream;
        
        // Now enumerate devices (labels will be available after permission)
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        
        console.log(`Found ${videoDevices.length} cameras:`, videoDevices);
        
        // Populate camera dropdown
        cameraSelect.innerHTML = '';
        
        if (videoDevices.length === 0) {
            cameraSelect.innerHTML = '<option>No cameras found</option>';
            showToast('No cameras detected', 'warning');
            return;
        }
        
        videoDevices.forEach((device, index) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Camera ${index + 1}`;
            cameraSelect.appendChild(option);
        });
        
        // Set first camera as default
        state.selectedDeviceId = videoDevices[0].deviceId;
        cameraSelect.value = state.selectedDeviceId;
        
        // Listen for camera changes
        cameraSelect.addEventListener('change', async (e) => {
            const newDeviceId = e.target.value;
            console.log(`Switching to camera: ${newDeviceId}`);
            
            state.selectedDeviceId = newDeviceId;
            
            // Stop old stream
            const oldStream = setupVideo.srcObject;
            if (oldStream) {
                oldStream.getTracks().forEach(track => {
                    track.stop();
                    console.log('Stopped track:', track.label);
                });
            }
            
            // Start new stream with selected camera
            try {
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: { 
                        deviceId: { exact: newDeviceId },
                        width: { ideal: 1920 },
                        height: { ideal: 1080 }
                    }
                });
                setupVideo.srcObject = newStream;
                console.log('Switched to new camera successfully');
            } catch (err) {
                console.error('Error switching camera:', err);
                showToast('Failed to switch camera', 'error');
            }
        });
        
        showToast('Camera ready! Select your camera and click Join Room.', 'success');
        
    } catch (err) {
        console.error('Error accessing camera:', err);
        
        // More specific error messages
        if (err.name === 'NotAllowedError') {
            showToast('Camera access denied. Please allow camera permissions in your browser.', 'error');
            cameraSelect.innerHTML = '<option>Permission denied</option>';
        } else if (err.name === 'NotFoundError') {
            showToast('No camera found. Please connect a camera.', 'error');
            cameraSelect.innerHTML = '<option>No camera found</option>';
        } else {
            showToast(`Camera error: ${err.message}`, 'error');
            cameraSelect.innerHTML = '<option>Error loading cameras</option>';
        }
    }
}

/**
 * Enable local camera and create media stream
 * @param {Object} state - Application state object
 * @param {Function} removeCamera - Function to remove camera from UI
 * @param {Function} addCamera - Function to add camera to UI
 * @param {Function} showOnMainFeed - Function to show camera on main feed
 * @param {Function} createPeerConnection - Function to create WebRTC peer connection
 * @param {Function} showToast - Toast notification function
 */
async function enableCamera(state, { removeCamera, addCamera, showOnMainFeed, createPeerConnection, showToast }) {
    // Prevent multiple enables or re-enabling while already enabled
    if (state.cameraEnabled && state.localStream) {
        console.log('Camera already enabled, skipping...');
        return;
    }
    
    try {
        const constraints = {
            video: {
                deviceId: state.selectedDeviceId ? { exact: state.selectedDeviceId } : undefined,
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        };
        
        state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        state.cameraEnabled = true;
        
        console.log('✓ Local camera enabled', state.localStream);
        
        // Remove placeholder and add real camera
        removeCamera('local');
        addCamera('local', state.localStream, state.username + ' (You)', true);
        
        // Show on main feed
        showOnMainFeed('local');
        
        // If we have existing connected peers, we need to recreate connections to add stream
        const connectedPeers = Array.from(state.peers.entries()).filter(([_, peer]) => peer.connected);
        if (connectedPeers.length > 0) {
            console.log('Recreating peer connections to add camera stream');
            for (const [userId, oldPeer] of connectedPeers) {
                const camera = state.cameras.get(userId);
                if (camera) {
                    // Destroy old peer
                    oldPeer.destroy();
                    state.peers.delete(userId);
                    
                    // Create new peer with stream as initiator
                    createPeerConnection(userId, camera.username, true);
                }
            }
            
            // Notify peers that camera is enabled
            state.socket.emit('camera-status-changed', {
                enabled: true,
                username: state.username
            });
        }
        
        showToast('Camera enabled', 'success');
    } catch (err) {
        console.error('Error enabling camera:', err);
        state.cameraEnabled = false;
        showToast('Failed to enable camera', 'error');
    }
}

/**
 * Disable local camera and clean up stream
 * @param {Object} state - Application state object
 * @param {Function} removeCamera - Function to remove camera from UI
 * @param {Function} addCamera - Function to add camera to UI
 * @param {Function} showOnMainFeed - Function to show camera on main feed
 * @param {Function} showToast - Toast notification function
 */
function disableCamera(state, { removeCamera, addCamera, showOnMainFeed, showToast }) {
    console.log('[DISABLE] disableCamera() called, state.cameraEnabled:', state.cameraEnabled);
    if (state.localStream && state.cameraEnabled) {
        console.log('[DISABLE] Stopping camera tracks...');
        state.localStream.getTracks().forEach(track => track.stop());
        state.localStream = null;
        state.cameraEnabled = false;
        
        // Remove camera with stream and add placeholder
        removeCamera('local');
        addCamera('local', null, state.username + ' (You)', true);
        
        // Update main feed if showing local camera
        if (state.currentMainCamera === 'local') {
            showOnMainFeed('local');
        }
        
        // Notify all peers that camera is disabled
        console.log('[DISABLE] Emitting camera-status-changed event');
        state.socket.emit('camera-status-changed', {
            enabled: false,
            username: state.username
        });
        
        showToast('Camera disabled', 'info');
    } else {
        console.log('[DISABLE] Camera not enabled or no stream, skipping');
    }
}

/**
 * Stop the setup video stream
 */
function stopSetupStream() {
    const setupVideo = document.getElementById('setupVideo');
    if (setupVideo.srcObject) {
        setupVideo.srcObject.getTracks().forEach(track => track.stop());
        setupVideo.srcObject = null;
    }
}

// ES6 Module Exports
export {
    initializeCameraSetup,
    enableCamera,
    disableCamera,
    stopSetupStream
};
