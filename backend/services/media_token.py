"""
Join tokens for the video server (LiveKit).

A LiveKit token is a plain HS256 JSON Web Token signed with the API secret, so it is made
here with the standard library instead of pulling in the LiveKit SDK and its dependencies.
Claims: https://docs.livekit.io/home/get-started/authentication/
"""
import base64
import hashlib
import hmac
import json
import time

TOKEN_TTL_SECONDS = 12 * 60 * 60   # a long evening; the client refreshes it while connected


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')


def media_token(api_key: str, api_secret: str, room: str, identity: str, name: str,
                can_publish: bool, ttl: int = TOKEN_TTL_SECONDS) -> str:
    """
    A token to join one table's video room. Players may send their camera; spectators
    only receive. Nobody sends audio or data through it (the table state goes via Socket.IO).
    """
    now = int(time.time())
    claims = {
        'iss': api_key,
        'sub': identity,
        'name': name,
        'nbf': now - 10,
        'exp': now + ttl,
        'video': {
            'room': room,
            'roomJoin': True,
            'canSubscribe': True,
            'canPublish': can_publish,
            'canPublishData': False,
            'canPublishSources': ['camera'] if can_publish else [],
        },
    }
    header = {'alg': 'HS256', 'typ': 'JWT'}
    signing_input = f"{_b64url(json.dumps(header, separators=(',', ':')).encode())}." \
                    f"{_b64url(json.dumps(claims, separators=(',', ':')).encode())}"
    signature = hmac.new(api_secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{_b64url(signature)}"
