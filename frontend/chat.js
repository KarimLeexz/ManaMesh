/**
 * Chat Module
 * A simple table-wide text chat, in its own sidebar tab. Messages are session-only
 * (like the table log): nothing is stored server-side, new joiners don't see history.
 */

import { escapeHtml } from './table-view.js';

const MAX_MESSAGE_LENGTH = 500;

let state = null;
let unreadChat = 0;

/**
 * @param {Object} appState - Application state (needs .socket, .username)
 */
function initChat(appState) {
    state = appState;

    document.getElementById('chatForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('chatInput');
        const message = input.value.trim().slice(0, MAX_MESSAGE_LENGTH);
        if (!message) return;
        input.value = '';
        addChatMessage('local', state.username, message);
        state.socket?.emit('chat-message', { message });
    });

    // The generic sidebar tab-switch (game-tools.js) shows the panel; this just
    // clears our own unread count once the player actually looks at it.
    document.querySelector('[data-tab="chat"]').addEventListener('click', () => {
        unreadChat = 0;
        document.getElementById('chatBadge').classList.add('hidden');
    });
}

/**
 * Show a message someone sent (our own is added directly by the form handler)
 * @param {Object} data - { userId, username, message }
 */
function receiveChatMessage({ userId, username, message }) {
    addChatMessage(userId, username, message);
}

function addChatMessage(userId, username, message) {
    const list = document.getElementById('chatMessages');
    document.getElementById('chatEmpty').classList.add('hidden');

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const item = document.createElement('div');
    item.className = 'rounded-box px-2 py-1.5 hover:bg-base-200';
    item.innerHTML = `
        <div class="text-xs text-base-content/40"><b class="text-base-content/70">${userId === 'local' ? 'You' : escapeHtml(username)}</b> · ${time}</div>
        <div class="break-words">${escapeHtml(message)}</div>`;
    list.appendChild(item);
    list.scrollTop = list.scrollHeight;

    const chatVisible = !document.querySelector('[data-panel="chat"]').hidden && !document.getElementById('sidebar').hidden;
    if (!chatVisible && userId !== 'local') {
        unreadChat++;
        const badge = document.getElementById('chatBadge');
        badge.textContent = unreadChat;
        badge.classList.remove('hidden');
    }
}

// ES6 Module Exports
export {
    initChat,
    receiveChatMessage
};
