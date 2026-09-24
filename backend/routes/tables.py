"""
API Routes - Tables
The lobby's view of the game tables: the list of public tables and creating a new one.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

try:
    from backend.sockets import signaling
except ImportError:
    from sockets import signaling

router = APIRouter()


class NewTable(BaseModel):
    name: str = ''
    private: bool = False


@router.get("/api/tables")
async def list_tables():
    """Public tables, newest first: name, who is playing, how many watch, when it opened."""
    return {'tables': signaling.public_tables()}


@router.post("/api/tables")
async def create_table(table: NewTable):
    """
    Open a new table. Private tables aren't listed; they only work with their link.
    A table nobody joins closes again after a few minutes.
    """
    room: Optional[signaling.Room] = signaling.create_table(table.name, table.private)
    if room is None:
        raise HTTPException(status_code=503, detail='Too many open tables right now, try again later.')
    return {'id': room.id, 'name': room.name, 'private': room.private}


@router.get("/api/tables/{table_id}")
async def get_table(table_id: str):
    """One table by its link (private ones too: having the link is the invitation)."""
    room = signaling.rooms.get(table_id.lower())
    if room is None:
        raise HTTPException(status_code=404, detail='This table has closed.')
    return {'id': room.id, 'name': room.name, 'private': room.private, **room.lobby_entry()}
