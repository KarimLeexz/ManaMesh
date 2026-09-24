"""
WebRTC Signaling and Table State
Socket.IO event handlers for WebRTC peer-to-peer connections, plus the shared game table:
every player's life total, commanders and camera orientation, dice rolls and resets.

The server holds the table state and is the single source of truth: clients send changes
(e.g. "life -1") and everyone, the sender included, gets the resulting state back. That way
two players tapping the same life counter at once can never disagree about the total.
"""
import random
import socketio
from typing import Dict, Any, List, Optional


# Store connected users (sid -> player state)
connected_users: Dict[str, Dict[str, Any]] = {}

# Table-wide settings
DEFAULT_STARTING_LIFE = 40
table: Dict[str, Any] = {'starting_life': DEFAULT_STARTING_LIFE}

# Whose turn it is. Empty order = nobody has started turns yet.
# 'number' counts turns since the start of the game (1 = the first player's first turn).
turn: Dict[str, Any] = {'order': [], 'current': None, 'number': 0}
TURN_ACTIONS = {'start', 'next', 'prev', 'set'}

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


def turn_state() -> Dict[str, Any]:
    return {'order': list(turn['order']), 'current': turn['current'], 'number': turn['number']}


def shuffle_turns():
    """New game: a random seating order, the first player in it starts."""
    order = list(connected_users)
    random.SystemRandom().shuffle(order)
    turn.update(order=order, current=order[0] if order else None, number=1 if order else 0)


def step_turn(steps: int):
    """Pass the turn on (1) or take it back (-1)."""
    order = turn['order']
    if not order:
        return
    index = order.index(turn['current']) if turn['current'] in order else -1
    turn['current'] = order[(index + steps) % len(order)]
    turn['number'] = max(1, turn['number'] + steps)


def remove_from_turns(sid: str) -> bool:
    """A player left: drop them from the order. Returns True if the turn state changed."""
    order = turn['order']
    if sid not in order:
        return False
    index = order.index(sid)
    order.remove(sid)
    if turn['current'] == sid:
        # The player after them carries on
        turn['current'] = order[index % len(order)] if order else None
    if not order:
        turn.update(current=None, number=0)
    return True


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

            if remove_from_turns(sid):
                await sio.emit('turn-changed', {'turn': turn_state(), 'action': 'left', 'by': username})

        # An empty table starts the next game fresh
        if not connected_users:
            table['starting_life'] = DEFAULT_STARTING_LIFE
            turn.update(order=[], current=None, number=0)

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

        # Turns already running: a newcomer plays last
        if turn['order']:
            turn['order'].append(sid)

        print(f"✓ User joined: {username} ({sid})")

        # Send list of existing users (and the joining player's own state) to the new user
        existing_users = [public_state(user_sid) for user_sid in connected_users if user_sid != sid]

        await sio.emit('existing-users', {
            'users': existing_users,
            'you': public_state(sid),
            'startingLife': table['starting_life'],
            'turn': turn_state(),
        }, to=sid)

        # Notify others about new user (and the turn order they now have a place in)
        await sio.emit('user-joined', {**public_state(sid), 'turn': turn_state()}, skip_sid=sid)

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

        # Resetting life means a new game: shuffle who goes first
        if what in ('life', 'all'):
            shuffle_turns()

        await sio.emit('table-reset', {
            'what': what,
            'by': connected_users[sid]['username'],
            'startingLife': table['starting_life'],
            'players': [public_state(user_sid) for user_sid in connected_users],
            'turn': turn_state(),
        })

    @sio.on('turn')
    async def handle_turn(sid, data):
        """
        Anyone may move the turn, for anyone: 'next' passes it on (and starts turns with a
        shuffled order if they haven't started), 'prev' takes a mistaken pass back,
        'set' gives it straight to a player, 'start' shuffles a new order.
        """
        if sid not in connected_users or not isinstance(data, dict):
            return
        action = data.get('action')
        if action not in TURN_ACTIONS:
            return

        if action == 'start' or (action == 'next' and not turn['order']):
            shuffle_turns()
            action = 'start'
        elif action == 'next':
            step_turn(1)
        elif action == 'prev':
            step_turn(-1)
        elif action == 'set':
            target: Optional[str] = data.get('target')
            if target not in turn['order']:
                return
            turn['current'] = target

        await sio.emit('turn-changed', {
            'turn': turn_state(),
            'action': action,
            'by': connected_users[sid]['username'],
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
    turn.update(order=[], current=None, number=0)
