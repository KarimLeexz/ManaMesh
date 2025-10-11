"""
WebRTC Signaling Handlers
Socket.IO event handlers for WebRTC peer-to-peer connections.
"""
import socketio
from typing import Dict, Any


# Store connected users
connected_users: Dict[str, Dict[str, Any]] = {}


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
    
    @sio.event
    async def join(sid, data):
        """Handle user joining the room."""
        username = data.get('username', 'Anonymous')
        connected_users[sid] = {
            'username': username,
            'sid': sid
        }
        
        print(f"✓ User joined: {username} ({sid})")
        
        # Send list of existing users to the new user
        existing_users = [
            {'userId': user_sid, 'username': user_data['username']}
            for user_sid, user_data in connected_users.items()
            if user_sid != sid
        ]
        
        await sio.emit('existing-users', {'users': existing_users}, to=sid)
        
        # Notify others about new user
        await sio.emit('user-joined', {
            'userId': sid,
            'username': username
        }, skip_sid=sid)
    
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


def clear_connected_users():
    """Clear all connected users (used during shutdown)."""
    connected_users.clear()
