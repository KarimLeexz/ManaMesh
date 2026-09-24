/**
 * Lobby
 * The start page: every public table (who is playing, how many watch, how long it has been
 * open), creating a table, and joining a private one by its invite link. Name and camera
 * are only asked for at the table itself.
 */

const REFRESH_MS = 5000;

const ICONS = {
    players: '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
    eye: '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    clock: '<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
};

let tables = [];

function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `alert alert-${type} alert-soft shadow-lg py-2 text-sm`;
    toast.textContent = message;
    document.getElementById('toasts').appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

/** "just opened", "12 min", "1 h 5 min" */
function openFor(createdAt) {
    const minutes = Math.floor((Date.now() / 1000 - createdAt) / 60);
    if (minutes < 1) return 'just opened';
    if (minutes < 60) return `open ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    return `open ${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

// ============================== Table list ==============================

async function loadTables() {
    try {
        const response = await fetch('/api/tables');
        tables = (await response.json()).tables || [];
        render();
    } catch (err) {
        console.error('Could not load the tables:', err);
        document.getElementById('tableList').innerHTML = `
            <div class="col-span-full alert alert-warning alert-soft">The server can't be reached right now. Retrying…</div>`;
    }
}

function render() {
    const list = document.getElementById('tableList');
    if (!tables.length) {
        list.innerHTML = `
            <div class="col-span-full card bg-base-100 border border-dashed border-base-300">
                <div class="card-body items-center text-center py-14">
                    <img src="logo_image.png" alt="" class="h-14 w-14 object-contain opacity-60" />
                    <h2 class="card-title">No open tables right now</h2>
                    <p class="text-base-content/60">Create one and send the link to your friends.</p>
                    <button class="btn btn-primary mt-2" data-create>Create table</button>
                </div>
            </div>`;
        return;
    }

    list.innerHTML = tables.map(table => {
        const players = table.players.length
            ? table.players.map(name => `<span class="badge badge-soft">${escapeHtml(name)}</span>`).join('')
            : '<span class="text-sm text-base-content/50">Nobody playing yet</span>';
        return `
            <div class="card bg-base-100 shadow-sm hover:shadow-md transition-shadow">
                <div class="card-body gap-3">
                    <div class="flex items-start justify-between gap-2">
                        <h2 class="card-title text-lg leading-tight break-words min-w-0">${escapeHtml(table.name)}</h2>
                        <span class="badge badge-ghost gap-1 shrink-0 text-xs" data-created="${table.createdAt}">${ICONS.clock}${openFor(table.createdAt)}</span>
                    </div>
                    <div class="flex flex-wrap gap-1.5 min-h-6">${players}</div>
                    <div class="flex items-center gap-4 text-sm text-base-content/60">
                        <span class="flex items-center gap-1.5" title="Players">${ICONS.players}${table.players.length} ${table.players.length === 1 ? 'player' : 'players'}</span>
                        ${table.spectators ? `<span class="flex items-center gap-1.5" title="Watching">${ICONS.eye}${table.spectators} watching</span>` : ''}
                    </div>
                    <div class="card-actions justify-end">
                        <a class="btn btn-primary btn-sm" href="/t/${encodeURIComponent(table.id)}">Join</a>
                    </div>
                </div>
            </div>`;
    }).join('');
}

/** Keep "open 12 min" current between refreshes */
function tickTimes() {
    document.querySelectorAll('[data-created]').forEach(badge => {
        badge.innerHTML = `${ICONS.clock}${openFor(Number(badge.dataset.created))}`;
    });
}

// ============================== Creating & joining ==============================

function setupCreate() {
    const modal = document.getElementById('createModal');
    const open = () => {
        document.getElementById('tableNameInput').value = '';
        modal.showModal();
        document.getElementById('tableNameInput').focus();
    };
    document.getElementById('createButton').addEventListener('click', open);
    document.getElementById('tableList').addEventListener('click', (e) => {
        if (e.target.closest('[data-create]')) open();
    });
    document.getElementById('createCancel').addEventListener('click', () => modal.close());

    document.getElementById('createForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const submit = document.getElementById('createSubmit');
        submit.disabled = true;
        try {
            const response = await fetch('/api/tables', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: document.getElementById('tableNameInput').value.trim(),
                    private: document.querySelector('input[name="visibility"]:checked').value === 'private'
                })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail || 'Could not create the table');
            location.href = `/t/${encodeURIComponent(result.id)}`;
        } catch (err) {
            showToast(err.message, 'error');
            submit.disabled = false;
        }
    });
}

/** Private tables: a pasted invite link, or just its code */
function setupJoinLink() {
    document.getElementById('joinLinkForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const text = document.getElementById('joinLinkInput').value.trim();
        const code = (text.match(/\/t\/([a-z0-9-]+)/i)?.[1] || text).toLowerCase();
        if (!/^[a-z0-9-]{3,40}$/.test(code)) {
            showToast('That is not a table link or code', 'warning');
            return;
        }
        location.href = `/t/${code}`;
    });
}

function initializeTheme() {
    let theme = 'dim';
    try { theme = localStorage.getItem('theme') || 'dim'; } catch { /* private mode */ }
    document.documentElement.setAttribute('data-theme', theme);
    const controller = document.querySelector('.theme-controller');
    controller.checked = theme === 'fantasy';
    controller.addEventListener('change', (e) => {
        const next = e.target.checked ? 'fantasy' : 'dim';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('theme', next); } catch { /* private mode */ }
    });
}

// A table that had closed sends people back here with ?closed=1
if (new URLSearchParams(location.search).has('closed')) {
    history.replaceState(null, '', '/');
    showToast('That table has closed.', 'warning');
}

initializeTheme();
setupCreate();
setupJoinLink();
loadTables();
setInterval(loadTables, REFRESH_MS);
setInterval(tickTimes, 30000);
