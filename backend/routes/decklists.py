"""
API Routes - Decklists
Importing a decklist from an Archidekt link. The browser can't ask Archidekt itself (it
doesn't allow other sites to), so the server fetches the public deck and hands back the
cards. Pasted text lists are read in the browser.
"""
import re
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

ARCHIDEKT_LINK = re.compile(r'archidekt\.com/(?:api/)?decks/(\d+)', re.IGNORECASE)
TYPE_ORDER = ('Creature', 'Planeswalker', 'Battle', 'Land', 'Instant', 'Sorcery', 'Artifact', 'Enchantment')
MAX_ENTRIES = 300


class DeckLink(BaseModel):
    url: str


def main_type(types: List[str]) -> Optional[str]:
    """The group a card is listed under: an artifact creature is a creature, an artifact land a land."""
    for card_type in TYPE_ORDER:
        if card_type in types:
            return card_type
    return None


def parse_archidekt(deck: Dict[str, Any]) -> Dict[str, Any]:
    """
    Archidekt's deck JSON -> {name, commanders: [names], cards: [{name, qty, type}]}.
    Cards only in categories that aren't part of the deck (Maybeboard, Sideboard...) are left out.
    """
    excluded = {
        category.get('name') for category in deck.get('categories') or []
        if isinstance(category, dict) and category.get('includedInDeck') is False
    }
    cards: Dict[str, Dict[str, Any]] = {}
    commanders: List[str] = []
    for entry in deck.get('cards') or []:
        if not isinstance(entry, dict):
            continue
        categories = [c for c in entry.get('categories') or [] if isinstance(c, str)]
        if categories and all(category in excluded for category in categories):
            continue
        card = entry.get('card') or {}
        oracle = card.get('oracleCard') or {}
        name = str(oracle.get('name') or card.get('name') or '').strip()
        if not name:
            continue
        if 'Commander' in categories and name not in commanders:
            commanders.append(name)
        quantity = entry.get('quantity') or 1
        if name in cards:
            cards[name]['qty'] += quantity
        else:
            cards[name] = {'name': name, 'qty': quantity, 'type': main_type(oracle.get('types') or [])}
    return {
        'name': str(deck.get('name') or '').strip(),
        'commanders': commanders,
        'cards': list(cards.values())[:MAX_ENTRIES],
    }


@router.post("/api/decklist/import")
async def import_decklist(link: DeckLink):
    """Fetch a public Archidekt deck: {name, source, commanders, cards: [{name, qty, type}]}."""
    match = ARCHIDEKT_LINK.search(link.url)
    if not match:
        raise HTTPException(status_code=400, detail='Only Archidekt links can be imported. Paste the list as text instead.')
    deck_id = match.group(1)

    try:
        async with httpx.AsyncClient(timeout=10, headers={'User-Agent': 'ManaMesh (decklist import)'}) as client:
            response = await client.get(f'https://archidekt.com/api/decks/{deck_id}/')
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail='Archidekt cannot be reached right now. Paste the list as text instead.')
    if response.status_code in (403, 404):
        raise HTTPException(status_code=404, detail='Deck not found. Is it public?')
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f'Archidekt answered {response.status_code}. Paste the list as text instead.')

    try:
        deck = parse_archidekt(response.json())
    except ValueError:
        raise HTTPException(status_code=502, detail='Archidekt sent something unexpected. Paste the list as text instead.')
    if not deck['cards']:
        raise HTTPException(status_code=404, detail='That deck has no cards.')
    return {**deck, 'source': f'https://archidekt.com/decks/{deck_id}'}
