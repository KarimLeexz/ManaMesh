"""
WebRTC Signaling and Table State
Socket.IO event handlers for WebRTC peer-to-peer connections, plus the shared game table:
every player's life total, commanders and camera orientation, dice rolls and resets.

The server holds the table state and is the single source of truth: clients send changes
(e.g. "life -1") and everyone, the sender included, gets the resulting state back. That way
two players tapping the same life counter at once can never disagree about the total.
"""
import socketio
from typing import Dict, Any, List


# Store connected users (sid -> player state)
connected_users: Dict[str, Dict[str, Any]] = {}

# Table-wide settings
DEFAULT_STARTING_LIFE = 40
table: Dict[str, Any] = {'starting_life': DEFAULT_STARTING_LIFE}

MAX_NAME_LENGTH = 24
MAX_COMMANDERS = 2          # a commander plus a partner / background
LIFE_LIMIT = 9999
ROLL_KINDS = {'d4': 4, 'd6': 6, 'd8': 8, 'd10': 10, 'd12': 12, 'd20': 20, 'coin': 2}
RESET_KINDS = {'life', 'commanders', 'all'}


def clean_name(value: Any) -> str:
    name = str(value or '').strip()[:MAX_NAME_LENGTH]
    return name or 'Player'


def clean_life(value: Any, default: int) -> int:
    try:
        return max(-LIFE_LIMIT, min(LIFE_LIMIT, int(value)))
    except (TypeError, ValueError):
        return default


def clean_commanders(value: Any) -> List[Dict[str, str]]:
    """Keep only the fields the clients show, as short strings."""
    if not isinstance(value, list):
        return []
    commanders = []
    for card in value[:MAX_COMMANDERS]:
        if not isinstance(card, dict) or not card.get('name'):
            continue
        commanders.append({
            key: str(card.get(key) or '')[:500]
            for key in ('name', 'scryfall_id', 'image_url', 'art_url')
        })
    return commanders


def public_state(sid: str) -> Dict[str, Any]:
    """What other clients get to know about a player."""
    user = connected_users[sid]
    return {
        'userId': sid,
        'username': user['username'],
        'hp': user['hp'],
        'commanders': user['commanders'],
        'flipH': user['flipH'],
        'flipV': user['flipV'],
    }


def register_socket_handlers(sio: socketio.AsyncServer):
    """
    Register all Socket.IO event handlers.

    Args:
        sio: Socket.IO server instance
    """

    @sio.event
    async def connect(sid, environ):
        """Handle new client connection."""
        print(f"✓ Client connected: {sid}")

    @sio.event
    async def disconnect(sid):
        """Handle client disconnection."""
        if sid in connected_users:
            username = connected_users[sid].get('username', 'Unknown')
            print(f"✗ Client disconnected: {username} ({sid})")

            # Notify others that this user left
            await sio.emit('user-left', {'userId': sid}, skip_sid=sid)

            del connected_users[sid]

        # An empty table starts the next game fresh
        if not connected_users:
            table['starting_life'] = DEFAULT_STARTING_LIFE

    @sio.event
    async def join(sid, data):
        """
        Handle user joining the room. A client that reconnects sends its last known
        life total and commanders along, so a dropped connection doesn't reset them.
        """
        data = data if isinstance(data, dict) else {}
        connected_users[sid] = {
            'sid': sid,
            'username': clean_name(data.get('username')),
            'hp': clean_life(data.get('hp'), table['starting_life']),
            'commanders': clean_commanders(data.get('commanders')),
            'flipH': bool(data.get('flipH')),
            'flipV': bool(data.get('flipV')),
        }
        username = connected_users[sid]['username']

        print(f"✓ User joined: {username} ({sid})")

        # Send list of existing users (and the joining player's own state) to the new user
        existing_users = [public_state(user_sid) for user_sid in connected_users if user_sid != sid]

        await sio.emit('existing-users', {
            'users': existing_users,
            'you': public_state(sid),
            'startingLife': table['starting_life'],
        }, to=sid)

        # Notify others about new user
        await sio.emit('user-joined', public_state(sid), skip_sid=sid)

    @sio.event
    async def signal(sid, data):
        """Forward WebRTC signaling messages between peers."""
        target_sid = data.get('to')
        signal_data = data.get('signal')

        if target_sid and target_sid in connected_users:
            await sio.emit('signal', {
                'from': sid,
                'signal': signal_data
            }, to=target_sid)

    @sio.on('camera-status-changed')
    async def handle_camera_status_changed(sid, data):
        """Handle camera enable/disable notifications."""
        enabled = data.get('enabled', False)
        username = connected_users.get(sid, {}).get('username', 'Unknown')

        print(f"📹 Camera {'enabled' if enabled else 'disabled'} for {username} ({sid})")

        # Broadcast to all other users
        await sio.emit('camera-status-changed', {
            'userId': sid,
            'enabled': enabled,
            'username': username
        }, skip_sid=sid)

    @sio.on('player-update')
    async def handle_player_update(sid, data):
        """
        Change a player's state. Anyone at the table may change anyone's life total
        (whoever deals the damage can count it); name, commanders and camera orientation
        only ever belong to the player themselves.
        """
        if sid not in connected_users or not isinstance(data, dict):
            return
        target = data.get('target') or sid
        if target not in connected_users:
            return
        user = connected_users[target]

        if 'hpDelta' in data:
            user['hp'] = clean_life(user['hp'] + clean_life(data['hpDelta'], 0), user['hp'])
        if target == sid:
            if 'username' in data:
                user['username'] = clean_name(data['username'])
            if 'commanders' in data:
                user['commanders'] = clean_commanders(data['commanders'])
            for key in ('flipH', 'flipV'):
                if key in data:
                    user[key] = bool(data[key])

        await sio.emit('player-updated', {**public_state(target), 'by': sid})

    @sio.on('reset-table')
    async def handle_reset_table(sid, data):
        """Start a new game: reset life totals, commanders, or both, for every player."""
        if sid not in connected_users or not isinstance(data, dict):
            return
        what = data.get('what')
        if what not in RESET_KINDS:
            return
        if 'startingLife' in data:
            table['starting_life'] = max(1, clean_life(data['startingLife'], table['starting_life']))

        for user in connected_users.values():
            if what in ('life', 'all'):
                user['hp'] = table['starting_life']
            if what in ('commanders', 'all'):
                user['commanders'] = []

        await sio.emit('table-reset', {
            'what': what,
            'by': connected_users[sid]['username'],
            'startingLife': table['starting_life'],
            'players': [public_state(user_sid) for user_sid in connected_users],
        })

    @sio.on('roll')
    async def handle_roll(sid, data):
        """Show a player's dice roll or coin flip to everyone else at the table."""
        if sid not in connected_users or not isinstance(data, dict):
            return
        kind = data.get('kind')
        if kind not in ROLL_KINDS:
            return
        try:
            result = int(data.get('result'))
        except (TypeError, ValueError):
            return
        if not 1 <= result <= ROLL_KINDS[kind]:
            return

        await sio.emit('rolled', {
            'userId': sid,
            'username': connected_users[sid]['username'],
            'kind': kind,
            'result': result,
        }, skip_sid=sid)


def clear_connected_users():
    """Clear all connected users (used during shutdown)."""
    connected_users.clear()
