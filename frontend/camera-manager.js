/**
 * Camera Manager Module
 * The join / settings dialog (name, camera, mirroring) with its live preview, and the
 * local camera stream: turning it on and off and switching to another camera mid-game.
 *
 * The preview is opened with the same high-quality settings as the real camera, so
 * joining simply keeps the preview stream running: no second camera start (some cameras,
 * especially on Windows, refuse to be opened twice).
 */

/**
 * Phones and tablets. Their cameras happily deliver 4K, but encoding it (once per other
 * player) is more than a phone's CPU keeps up with: the video stutters. They get settings
 * that keep the picture smooth (see also webrtc-manager.js).
 */
const IS_MOBILE = navigator.userAgentData?.mobile
    ?? (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));   // iPadOS

/**
 * Ask for the best picture the camera can give. "ideal" values are preferences: the
 * browser picks the closest mode the camera supports (a 1080p camera simply gives 1080p).
 * Card text is small, so resolution matters far more than frame rate here. Phones stop
 * at 1080p: that is all that gets sent anyway, and capturing 4K costs them smoothness.
 */
function videoConstraints(deviceId) {
    return {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: IS_MOBILE ? 1920 : 3840 },
        height: { ideal: IS_MOBILE ? 1080 : 2160 },
        frameRate: { ideal: 30 }
    };
}

/**
 * Tell the browser this video is about fine detail (card text), not motion, so it keeps
 * resolution instead of smoothness when it has to compromise. Not on phones: there the
 * compromise is constant, and a sharp picture at a few frames per second is worse.
 * @param {MediaStream} stream
 * @returns {string} Description of what the camera actually delivers, e.g. "1920x1080 @ 30fps"
 */
function describeAndTuneStream(stream) {
    const track = stream.getVideoTracks()[0];
    if (!track) return 'no video';
    if (!IS_MOBILE) track.contentHint = 'detail';
    const { width, height, frameRate } = track.getSettings();
    return `${width}x${height} @ ${Math.round(frameRate || 0)}fps`;
}

function stopStream(stream) {
    stream?.getTracks().forEach(track => track.stop());
}

function deviceOf(stream) {
    return stream?.getVideoTracks()[0]?.getSettings().deviceId || null;
}

// The stream shown in the dialog (may be the live camera itself when changing settings)
const preview = { stream: null, requestId: 0 };

// ============================== Setup dialog ==============================

/**
 * Open the join / settings dialog
 * @param {Object} state - Application state object
 * @param {Function} showToast - Toast notification function
 */
async function openSetup(state, showToast) {
    const modal = document.getElementById('setupModal');
    const joined = state.hasJoinedRoom;

    document.getElementById('setupTitle').textContent = joined ? 'Name & camera' : 'Join the table';
    document.getElementById('setupSubtitle').textContent = joined ? 'Changes apply right away' : "Name and camera, and you're in";
    document.getElementById('joinButton').textContent = joined ? 'Save' : 'Join table';
    document.getElementById('joinWithoutCameraButton').textContent = joined ? 'Turn camera off' : 'Join without camera';
    document.getElementById('joinWithoutCameraButton').classList.toggle('hidden', joined && !state.cameraEnabled);
    document.getElementById('setupCancelButton').classList.toggle('hidden', !joined);
    document.getElementById('watchButton').classList.toggle('hidden', joined);

    document.getElementById('usernameInput').value = state.username || '';
    document.getElementById('flipHInput').checked = state.flipH;
    document.getElementById('flipVInput').checked = state.flipV;
    document.getElementById('uploadSelect').value = state.uploadLevel;
    updatePreviewTransform();

    if (!modal.open) modal.showModal();
    if (!state.username) document.getElementById('usernameInput').focus();

    // While playing, the preview starts out as the camera that's already live
    if (joined && state.cameraEnabled && state.localStream) {
        showPreview(state.localStream);
        await fillCameraList(state, deviceOf(state.localStream));
    } else {
        await startPreview(state, state.selectedDeviceId, showToast);
    }
}

/**
 * Close the dialog. The preview camera keeps running only if it became the live camera.
 * @param {Object} state - Application state object
 */
function closeSetup(state) {
    const modal = document.getElementById('setupModal');
    if (modal.open) modal.close();
    releasePreview(state);
}

/**
 * Hand the preview stream over to the caller (it becomes the live camera)
 * @returns {MediaStream|null}
 */
function takePreviewStream() {
    const stream = preview.stream;
    preview.stream = null;
    return stream?.getVideoTracks().some(t => t.readyState === 'live') ? stream : null;
}

function releasePreview(state) {
    if (preview.stream && preview.stream !== state.localStream) stopStream(preview.stream);
    preview.stream = null;
    document.getElementById('setupVideo').srcObject = null;
}

function showPreview(stream) {
    const video = document.getElementById('setupVideo');
    preview.stream = stream;
    video.srcObject = stream;
    video.play().catch(() => {});
    setNoCamera(null);
}

function setNoCamera(message) {
    const box = document.getElementById('setupNoCamera');
    box.classList.toggle('hidden', !message);
    box.classList.toggle('flex', !!message);
    if (message) document.getElementById('setupNoCameraText').textContent = message;
}

/**
 * Show a camera in the preview
 * @param {Object} state - Application state object
 * @param {string|null} deviceId - null for the browser's default camera
 * @param {Function} showToast - Toast notification function
 */
async function startPreview(state, deviceId, showToast) {
    const requestId = ++preview.requestId;
    const select = document.getElementById('cameraSelect');

    // Stop the previous preview first (unless it is the live camera)
    releasePreview(state);

    // The live camera can be shown as it is, no need to open it a second time
    if (state.localStream && deviceId && deviceOf(state.localStream) === deviceId) {
        showPreview(state.localStream);
        return;
    }

    try {
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(deviceId) });
        } catch (err) {
            // A remembered camera that is gone now: fall back to the default one
            if (!deviceId || err.name === 'NotAllowedError') throw err;
            stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(null) });
        }

        // The dialog was closed or another camera chosen while this one was starting
        if (requestId !== preview.requestId || !document.getElementById('setupModal').open) {
            stopStream(stream);
            return;
        }

        console.log(`Preview camera: ${describeAndTuneStream(stream)}`);
        showPreview(stream);
        state.selectedDeviceId = deviceOf(stream) || deviceId;

        // Camera names are only available once permission was granted, so list them now
        await fillCameraList(state, state.selectedDeviceId);
    } catch (err) {
        console.error('Error accessing camera:', err);
        if (requestId !== preview.requestId) return;

        const message = {
            NotAllowedError: 'Camera access was blocked. Allow it in the browser to join with a camera.',
            NotFoundError: 'No camera found',
            NotReadableError: 'The camera is in use by another program'
        }[err.name] || `Camera error: ${err.message}`;
        setNoCamera(message);
        select.innerHTML = `<option disabled selected>${err.name === 'NotAllowedError' ? 'Permission denied' : 'No camera available'}</option>`;
        showToast(message, 'warning');
    }
}

/**
 * Fill the camera dropdown
 * @param {Object} state - Application state object
 * @param {string|null} currentId - Camera to show as selected
 */
async function fillCameraList(state, currentId) {
    const select = document.getElementById('cameraSelect');
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');

    select.innerHTML = '';
    if (devices.length === 0) {
        select.innerHTML = '<option disabled selected>No cameras found</option>';
        return;
    }
    devices.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Camera ${index + 1}`;
        select.appendChild(option);
    });
    if (currentId && devices.some(d => d.deviceId === currentId)) select.value = currentId;
}

/**
 * Wire up the dialog's camera dropdown and mirror controls
 * @param {Object} state - Application state object
 * @param {Function} showToast - Toast notification function
 */
function setupCameraDialog(state, showToast) {
    document.getElementById('cameraSelect').addEventListener('change', (e) => {
        startPreview(state, e.target.value, showToast);
    });

    for (const key of ['flipH', 'flipV']) {
        const input = document.getElementById(`${key}Input`);
        input.addEventListener('change', updatePreviewTransform);
        document.querySelector(`[data-flip-button="${key}"]`).addEventListener('click', () => {
            input.checked = !input.checked;
            updatePreviewTransform();
        });
    }
}

/** Show the preview exactly as the others will see it */
function updatePreviewTransform() {
    const flipH = document.getElementById('flipHInput').checked;
    const flipV = document.getElementById('flipVInput').checked;
    document.getElementById('setupVideo').style.transform = `scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`;
    document.querySelector('[data-flip-button="flipH"]').classList.toggle('btn-primary', flipH);
    document.querySelector('[data-flip-button="flipV"]').classList.toggle('btn-primary', flipV);
}

// ============================== Live camera ==============================

/**
 * Make a stream the live camera: shown on our tile and sent to every other player.
 * If a camera is live already, its track is swapped in place in every connection (no
 * reconnect); otherwise the connections are rebuilt so they carry video.
 * @param {Object} state - Application state object
 * @param {MediaStream} stream
 * @param {Object} handlers - { setPlayerStream, createPeerConnection, showToast }
 */
async function useStream(state, stream, { setPlayerStream, createPeerConnection, showToast }) {
    if (stream === state.localStream) return;
    const quality = describeAndTuneStream(stream);
    const oldStream = state.localStream;
    state.selectedDeviceId = deviceOf(stream) || state.selectedDeviceId;

    if (state.cameraEnabled && oldStream) {
        const oldTrack = oldStream.getVideoTracks()[0];
        const newTrack = stream.getVideoTracks()[0];
        for (const peer of state.peers.values()) {
            try {
                if (!peer.destroyed) peer.replaceTrack(oldTrack, newTrack, oldStream);
            } catch (err) {
                console.warn('Could not swap camera in a connection:', err);
            }
        }
        // Keep the stream object the connections know about, just with the new track in it
        oldStream.removeTrack(oldTrack);
        oldStream.addTrack(newTrack);
        oldTrack.stop();
        stream.getTracks().filter(t => t !== newTrack).forEach(t => t.stop());
        setPlayerStream('local', oldStream);
        console.log(`✓ Switched camera (${quality})`);
        showToast(`Camera switched (${quality})`, 'success');
        return;
    }

    state.localStream = stream;
    state.cameraEnabled = true;
    setPlayerStream('local', stream);
    console.log(`✓ Local camera enabled (${quality})`);

    if (state.socket?.connected) {
        // Peers throw away their connection to us and wait for our new one, which carries video
        state.socket.emit('camera-status-changed', { enabled: true });
        for (const [userId, oldPeer] of [...state.peers.entries()]) {
            oldPeer.destroy();
            state.peers.delete(userId);
            createPeerConnection(userId, true);
        }
    }
}

/**
 * Turn the local camera on again (with the last chosen camera)
 * @param {Object} state - Application state object
 * @param {Object} handlers - { setPlayerStream, createPeerConnection, showToast }
 */
async function enableCamera(state, handlers) {
    if (state.cameraEnabled && state.localStream) return;
    try {
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(state.selectedDeviceId) });
        } catch (err) {
            if (!state.selectedDeviceId || err.name === 'NotAllowedError') throw err;
            stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(null) });
        }
        await useStream(state, stream, handlers);
        handlers.showToast('Camera on', 'success');
    } catch (err) {
        console.error('Error enabling camera:', err);
        state.cameraEnabled = false;
        handlers.showToast('Could not turn the camera on', 'error');
    }
}

/**
 * Turn the local camera off
 * @param {Object} state - Application state object
 * @param {Object} handlers - { setPlayerStream, showToast }
 */
function disableCamera(state, { setPlayerStream, showToast }) {
    if (!state.localStream || !state.cameraEnabled) return;

    stopStream(state.localStream);
    state.localStream = null;
    state.cameraEnabled = false;
    setPlayerStream('local', null);

    // Peers show our placeholder; the old connections simply carry no video any more
    state.socket?.emit('camera-status-changed', { enabled: false });
    showToast('Camera off', 'info');
}

// ES6 Module Exports
export {
    IS_MOBILE,
    openSetup,
    closeSetup,
    takePreviewStream,
    setupCameraDialog,
    useStream,
    enableCamera,
    disableCamera
};
