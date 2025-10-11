"""Sockets package for WebRTC signaling."""
from .signaling import register_socket_handlers, clear_connected_users

__all__ = ['register_socket_handlers', 'clear_connected_users']
