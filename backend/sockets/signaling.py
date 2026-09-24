"""
WebRTC Signaling and Table State
Socket.IO event handlers for WebRTC peer-to-peer connections, plus the shared game tables:
every player's life total, counters, commander damage, commanders and camera orientation,
turns, dice rolls, resets and chat.

Tables ("rooms") are separate: each has its own link (/t/<code>), players, turn order and
settings. Nothing leaks from one table to another.

Every browser tab has a player id of its own that survives a reload. A player who drops out
keeps their seat (life, commanders, place in the turn order) for SEAT_GRACE_SECONDS, so a
reload or a flaky phone connection doesn't cost anything.

The server holds the table state and is the single source of truth: clients send changes
(e.g. "life -1") and everyone, the sender included, gets the resulting state back. That way
two players tapping the same life counter at once can never disagree about the total.
"""
import asyncio
import random
import re
import secrets
import time
import socketio
from typing import Dict, Any, List, Optional, Tuple


DEFAULT_STARTING_LIFE = 40
SEAT_GRACE_SECONDS = 15 * 60     # how long a dropped player's seat is kept

MAX_NAME_LENGTH = 24
MAX_CHAT_LENGTH = 500
MAX_COMMANDERS = 2          # a commander plus a partner / background
LIFE_LIMIT = 9999
COUNTER_LIMIT = 999
POISON_OUT = 10             # poison counters that knock a player out
COMMANDER_DAMAGE_OUT = 21   # damage from one commander that knocks a player out
COUNTERS = ('poison', 'energy', 'experience')
MARKERS = ('monarch', 'initiative')
ROLES = ('player', 'spectator')
ROLL_KINDS = {'d4': 4, 'd6': 6, 'd8': 8, 'd10': 10, 'd12': 12, 'd20': 20, 'coin': 2}
RESET_KINDS = {'life', 'commanders', 'all'}
TURN_ACTIONS = {'start', 'next', 'prev', 'set'}

ROOM_ID = re.compile(r'^[a-z0-9-]{3,40}$')
PLAYER_ID = re.compile(r'^[A-Za-z0-9_-]{8,64}$')


# ============================== Validation ==============================

def clean_name(value: Any) -> str:
    name = str(value or '').strip()[:MAX_NAME_LENGTH]
    return name or 'Player'


def clean_life(value: Any, default: int) -> int:
    try:
        return max(-LIFE_LIMIT, min(LIFE_LIMIT, int(value)))
    except (TypeError, ValueError):
        return default


def clean_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
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


# ============================== Tables ==============================

class Room:
    """One game table."""

    def __init__(self, room_id: str):
        self.id = room_id
        self.players: Dict[str, Dict[str, Any]] = {}   # player id -> player (players and spectators)
        self.starting_life = DEFAULT_STARTING_LIFE
        # Whose turn it is. Empty order = nobody has started turns yet.
        # 'number' counts turns since the start of the game (1 = the first player's first turn).
        self.turn: Dict[str, Any] = {'order': [], 'current': None, 'number': 0}
        self.markers: Dict[str, Optional[str]] = {marker: None for marker in MARKERS}

    # ------------------------------ players ------------------------------

    def new_player(self, pid: str, role: str, data: Dict[str, Any]) -> Dict[str, Any]:
        player = {
            'pid': pid,
            'sid': None,
            'role': role,
            'username': clean_name(data.get('username')),
            'flipH': bool(data.get('flipH')),
            'flipV': bool(data.get('flipV')),
            'left_at': None,
        }
        self.reset_game_state(player)
        # After a server restart, a client brings its last life total and commanders along
        player['hp'] = clean_life(data.get('hp'), self.starting_life)
        player['commanders'] = clean_commanders(data.get('commanders'))
        self.players[pid] = player
        return player

    def reset_game_state(self, player: Dict[str, Any]):
        """Everything that belongs to one game (not the commanders: they stay for the rematch)."""
        player['hp'] = self.starting_life
        player['counters'] = {name: 0 for name in COUNTERS}
        player['cmd_damage'] = {}      # attacker's player id -> [damage from commander 1, from 2]
        player['conceded'] = False
        player.setdefault('commanders', [])

    def seated(self) -> List[Dict[str, Any]]:
        return [p for p in self.players.values() if p['role'] == 'player']

    def find_seat_by_name(self, username: str) -> Optional[Dict[str, Any]]:
        """
        A dropped player whose tab lost its id (e.g. the phone closed it) and who comes back
        under the same name gets their seat back.
        """
        name = clean_name(username).casefold()
        for player in self.players.values():
            if player['sid'] is None and player['role'] == 'player' and player['username'].casefold() == name:
                return player
        return None

    @staticmethod
    def is_out(player: Dict[str, Any]) -> bool:
        return (
            player['conceded']
            or player['hp'] <= 0
            or player['counters']['poison'] >= POISON_OUT
            or any(damage >= COMMANDER_DAMAGE_OUT for hits in player['cmd_damage'].values() for damage in hits)
        )

    def public(self, player: Dict[str, Any]) -> Dict[str, Any]:
        """What the clients get to know about a player."""
        return {
            'userId': player['pid'],
            'role': player['role'],
            'connected': player['sid'] is not None,
            'username': player['username'],
            'hp': player['hp'],
            'commanders': player['commanders'],
            'flipH': player['flipH'],
            'flipV': player['flipV'],
            'counters': dict(player['counters']),
            'cmdDamage': {source: list(hits) for source, hits in player['cmd_damage'].items()},
            'conceded': player['conceded'],
            'out': self.is_out(player),
        }

    def table_state(self) -> Dict[str, Any]:
        return {
            'startingLife': self.starting_life,
            'turn': {'order': list(self.turn['order']), 'current': self.turn['current'], 'number': self.turn['number']},
            'markers': dict(self.markers),
        }

    # ------------------------------ turns ------------------------------

    def shuffle_turns(self):
        """New game: a random seating order of everyone at the table; the first one starts."""
        order = [p['pid'] for p in self.seated() if p['sid']]
        random.SystemRandom().shuffle(order)
        self.turn.update(order=order, current=order[0] if order else None, number=1 if order else 0)

    def can_take_turn(self, pid: str) -> bool:
        player = self.players.get(pid)
        return bool(player and player['sid'] and not self.is_out(player))

    def step_turn(self, steps: int):
        """
        Pass the turn on (1) or take it back (-1), skipping players who are out of the game
        or dropped out. If nobody else can play, it moves on one seat anyway.
        """
        order = self.turn['order']
        if not order:
            return
        index = order.index(self.turn['current']) if self.turn['current'] in order else -1
        candidate = order[(index + steps) % len(order)]
        for distance in range(1, len(order) + 1):   # all the way round: maybe it's ours again
            option = order[(index + steps * distance) % len(order)]
            if self.can_take_turn(option):
                candidate = option
                break
        self.turn['current'] = candidate
        self.turn['number'] = max(1, self.turn['number'] + steps)

    def remove_from_turns(self, pid: str) -> bool:
        """Drop a player from the order. Returns True if the turn state changed."""
        order = self.turn['order']
        if pid not in order:
            return False
        index = order.index(pid)
        order.remove(pid)
        if self.turn['current'] == pid:
            # The player after them carries on
            self.turn['current'] = order[index % len(order)] if order else None
        if not order:
            self.turn.update(current=None, number=0)
        return True


rooms: Dict[str, Room] = {}
sessions: Dict[str, Tuple[str, str]] = {}    # socket id -> (room id, player id)


def lookup(sid: str) -> Tuple[Optional[Room], Optional[Dict[str, Any]]]:
    """The table and player behind a connection (both None if it hasn't joined a table)."""
    room_id, pid = sessions.get(sid, (None, None))
    room = rooms.get(room_id) if room_id else None
    player = room.players.get(pid) if room and pid else None
    if not player or player['sid'] != sid:
        return None, None
    return room, player


def register_socket_handlers(sio: socketio.AsyncServer):
    """
    Register all Socket.IO event handlers.

    Args:
        sio: Socket.IO server instance
    """

    async def to_table(room: Room, event: str, data: Any, skip_sid: Optional[str] = None):
        await sio.emit(event, data, room=room.id, skip_sid=skip_sid)

    async def expire_seat(room_id: str, pid: str, left_at: float):
        """Give up a dropped player's seat once they've been gone too long."""
        await asyncio.sleep(SEAT_GRACE_SECONDS)
        room = rooms.get(room_id)
        player = room.players.get(pid) if room else None
        if not player or player['sid'] is not None or player['left_at'] != left_at:
            return   # came back in the meantime (or already gone)

        del room.players[pid]
        for marker, holder in room.markers.items():
            if holder == pid:
                room.markers[marker] = None
        turn_changed = room.remove_from_turns(pid)

        if not room.players:
            rooms.pop(room_id, None)
            return
        await to_table(room, 'user-left', {'userId': pid})
        if turn_changed:
            await to_table(room, 'turn-changed', {'turn': room.table_state()['turn'], 'action': 'left', 'by': player['username']})

    async def leave_table(sid: str):
        """
        A connection is done with its table. Spectators simply leave; players keep their seat
        for a while, shown to the others as "reconnecting".
        """
        room, player = lookup(sid)
        sessions.pop(sid, None)
        if not room:
            return
        await sio.leave_room(sid, room.id)
        print(f"✗ Left: {player['username']} ({room.id})")

        if player['role'] == 'spectator':
            del room.players[player['pid']]
            if not room.players:
                rooms.pop(room.id, None)
                return
            await to_table(room, 'user-left', {'userId': player['pid']})
            return

        player['sid'] = None
        player['left_at'] = time.monotonic()
        await to_table(room, 'player-updated', room.public(player))
        asyncio.create_task(expire_seat(room.id, player['pid'], player['left_at']))

    @sio.event
    async def connect(sid, environ):
        """Handle new client connection."""
        print(f"✓ Client connected: {sid}")

    @sio.event
    async def disconnect(sid):
        await leave_table(sid)

    @sio.event
    async def join(sid, data):
        """
        Sit down at a table (or come back to your seat). data: room, playerId, role
        ('player' / 'spectator'), username, flipH, flipV, and after a server restart the
        last known hp and commanders.
        """
        data = data if isinstance(data, dict) else {}
        room_id = str(data.get('room') or '').lower()
        if not ROOM_ID.match(room_id):
            await sio.emit('join-error', {'message': 'That table link is not valid.'}, to=sid)
            return
        pid = str(data.get('playerId') or '')
        if not PLAYER_ID.match(pid):
            pid = secrets.token_urlsafe(12)
        role = data.get('role') if data.get('role') in ROLES else 'player'

        # Joining again on the same connection (e.g. another table): leave the old one first
        if sid in sessions:
            await leave_table(sid)

        room = rooms.setdefault(room_id, Room(room_id))
        player = room.players.get(pid)
        if player is None and role == 'player':
            player = room.find_seat_by_name(data.get('username'))
        rejoined = player is not None

        if player is None:
            player = room.new_player(pid, role, data)
            # Turns already running: a newcomer plays last
            if role == 'player' and room.turn['order']:
                room.turn['order'].append(pid)
        else:
            # Back in the same seat: the game state stays, name and camera may have changed
            if player['sid'] and player['sid'] != sid:
                sessions.pop(player['sid'], None)   # the same player in a stale connection
            player['username'] = clean_name(data.get('username'))
            player['flipH'] = bool(data.get('flipH'))
            player['flipV'] = bool(data.get('flipV'))

        player['sid'] = sid
        player['left_at'] = None
        sessions[sid] = (room.id, player['pid'])
        await sio.enter_room(sid, room.id)
        print(f"✓ {'Back' if rejoined else 'Joined'}: {player['username']} as {player['role']} ({room.id})")

        # The joining player gets everybody else and their own state...
        await sio.emit('existing-users', {
            'users': [room.public(p) for p in room.players.values() if p is not player],
            'you': room.public(player),
            'table': room.table_state(),
        }, to=sid)

        # ...everybody else gets the new (or returning) player
        await to_table(room, 'user-joined', {
            'user': room.public(player),
            'table': room.table_state(),
            'rejoined': rejoined,
        }, skip_sid=sid)

    @sio.event
    async def signal(sid, data):
        """Forward WebRTC signaling messages between peers at the same table."""
        room, player = lookup(sid)
        if not room or not isinstance(data, dict):
            return
        target = room.players.get(str(data.get('to') or ''))
        if target and target['sid']:
            await sio.emit('signal', {
                'from': player['pid'],
                'signal': data.get('signal')
            }, to=target['sid'])

    @sio.on('camera-status-changed')
    async def handle_camera_status_changed(sid, data):
        """Handle camera enable/disable notifications."""
        room, player = lookup(sid)
        if not room or not isinstance(data, dict):
            return
        await to_table(room, 'camera-status-changed', {
            'userId': player['pid'],
            'enabled': bool(data.get('enabled')),
            'username': player['username'],
        }, skip_sid=sid)

    @sio.on('player-update')
    async def handle_player_update(sid, data):
        """
        Change a player's state. Anyone at the table may change anyone's life total, counters
        and commander damage (whoever deals the damage can count it) or mark them out;
        name, commanders and camera orientation only ever belong to the player themselves.
        Spectators only change their own name.
        """
        room, actor = lookup(sid)
        if not room or not isinstance(data, dict):
            return
        target = room.players.get(str(data.get('target') or actor['pid']))
        if not target:
            return

        if actor['role'] == 'player' and target['role'] == 'player':
            if 'hpDelta' in data:
                target['hp'] = clean_life(target['hp'] + clean_life(data['hpDelta'], 0), target['hp'])

            counter = data.get('counter')
            if isinstance(counter, dict) and counter.get('name') in COUNTERS:
                name = counter['name']
                value = target['counters'][name] + clean_int(counter.get('delta'))
                target['counters'][name] = max(0, min(COUNTER_LIMIT, value))

            damage = data.get('cmdDamage')
            if isinstance(damage, dict):
                source = str(damage.get('source') or '')
                index = clean_int(damage.get('index'), -1)
                if source in room.players and room.players[source]['role'] == 'player' and index in (0, 1):
                    hits = target['cmd_damage'].setdefault(source, [0, 0])
                    before = hits[index]
                    hits[index] = max(0, min(COUNTER_LIMIT, before + clean_int(damage.get('delta'))))
                    # Commander damage is damage: it comes off the life total too
                    target['hp'] = clean_life(target['hp'] - (hits[index] - before), target['hp'])
                    if not any(hits):
                        del target['cmd_damage'][source]

            if 'conceded' in data:
                target['conceded'] = bool(data['conceded'])

        if target is actor:
            if 'username' in data:
                target['username'] = clean_name(data['username'])
            if target['role'] == 'player':
                if 'commanders' in data:
                    target['commanders'] = clean_commanders(data['commanders'])
                for key in ('flipH', 'flipV'):
                    if key in data:
                        target[key] = bool(data[key])

        await to_table(room, 'player-updated', {**room.public(target), 'by': actor['username']})

    @sio.on('take-seat')
    async def handle_take_seat(sid, data=None):
        """A spectator joins the game as a player."""
        room, player = lookup(sid)
        if not room or player['role'] != 'spectator':
            return
        player['role'] = 'player'
        room.reset_game_state(player)
        if room.turn['order']:
            room.turn['order'].append(player['pid'])
        await to_table(room, 'player-updated', {**room.public(player), 'by': player['username']})
        await to_table(room, 'turn-changed', {'turn': room.table_state()['turn'], 'action': 'seat', 'by': player['username']})

    @sio.on('set-marker')
    async def handle_set_marker(sid, data):
        """Give the monarch or the initiative to a player (or to nobody: target None)."""
        room, actor = lookup(sid)
        if not room or actor['role'] != 'player' or not isinstance(data, dict):
            return
        marker = data.get('marker')
        if marker not in MARKERS:
            return
        target = data.get('target')
        if target is not None and (target not in room.players or room.players[target]['role'] != 'player'):
            return
        room.markers[marker] = target
        await to_table(room, 'markers-changed', {'markers': dict(room.markers), 'marker': marker, 'by': actor['username']})

    @sio.on('reset-table')
    async def handle_reset_table(sid, data):
        """
        Reset life, commanders or both for every player. Resetting life starts a new game:
        counters, commander damage, markers and "out" go too, and the turn order is shuffled.
        """
        room, actor = lookup(sid)
        if not room or actor['role'] != 'player' or not isinstance(data, dict):
            return
        what = data.get('what')
        if what not in RESET_KINDS:
            return
        if 'startingLife' in data:
            room.starting_life = max(1, clean_life(data['startingLife'], room.starting_life))

        for player in room.seated():
            if what in ('life', 'all'):
                room.reset_game_state(player)
            if what in ('commanders', 'all'):
                player['commanders'] = []

        if what in ('life', 'all'):
            room.markers = {marker: None for marker in MARKERS}
            room.shuffle_turns()

        await to_table(room, 'table-reset', {
            'what': what,
            'by': actor['username'],
            'players': [room.public(p) for p in room.seated()],
            'table': room.table_state(),
        })

    @sio.on('turn')
    async def handle_turn(sid, data):
        """
        Anyone may move the turn, for anyone: 'next' passes it on (and starts turns with a
        shuffled order if they haven't started), 'prev' takes a mistaken pass back,
        'set' gives it straight to a player, 'start' shuffles a new order.
        """
        room, actor = lookup(sid)
        if not room or actor['role'] != 'player' or not isinstance(data, dict):
            return
        action = data.get('action')
        if action not in TURN_ACTIONS:
            return

        if action == 'start' or (action == 'next' and not room.turn['order']):
            room.shuffle_turns()
            action = 'start'
        elif action == 'next':
            room.step_turn(1)
        elif action == 'prev':
            room.step_turn(-1)
        elif action == 'set':
            target = data.get('target')
            if target not in room.turn['order']:
                return
            room.turn['current'] = target

        await to_table(room, 'turn-changed', {
            'turn': room.table_state()['turn'],
            'action': action,
            'by': actor['username'],
        })

    @sio.on('roll')
    async def handle_roll(sid, data):
        """Show a player's dice roll or coin flip to everyone else at the table."""
        room, player = lookup(sid)
        if not room or player['role'] != 'player' or not isinstance(data, dict):
            return
        kind = data.get('kind')
        if kind not in ROLL_KINDS:
            return
        result = clean_int(data.get('result'))
        if not 1 <= result <= ROLL_KINDS[kind]:
            return

        await to_table(room, 'rolled', {
            'userId': player['pid'],
            'username': player['username'],
            'kind': kind,
            'result': result,
        }, skip_sid=sid)

    @sio.on('chat-message')
    async def handle_chat_message(sid, data):
        """Send a chat message to everyone else at the table. Not stored server-side."""
        room, player = lookup(sid)
        if not room or not isinstance(data, dict):
            return
        message = str(data.get('message') or '').strip()[:MAX_CHAT_LENGTH]
        if not message:
            return

        await to_table(room, 'chat-message', {
            'userId': player['pid'],
            'username': player['username'],
            'message': message,
        }, skip_sid=sid)


def clear_connected_users():
    """Forget all tables (used during shutdown)."""
    rooms.clear()
    sessions.clear()
