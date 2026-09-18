"""
ManaMesh - MTG card recognition.

Pipeline (about 5-20 ms per scan):
  1. find the card outline(s) in the image and warp each flat        (card_vision)
  2. hash the artwork window, trying both orientations and a few
     small shifts to tolerate an imperfect outline                   (card_vision)
  3. nearest neighbours by Hamming distance over the whole index     (card_index)
  4. accept only if the best distance is under the threshold, so an
     unclear scan returns "not recognized" instead of a wrong card
"""
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np

try:
    from backend.card_index import CardIndex
    from backend import card_vision
except ImportError:
    from card_index import CardIndex
    import card_vision

# Window shifts (fraction of card size) tried per outline: centre, then left/right/up/down
_SHIFTS = ((0.0, 0.0), (0.02, 0.0), (-0.02, 0.0), (0.0, 0.02), (0.0, -0.02))
_ROTATIONS = (None, cv2.ROTATE_180)  # a card can be held upside down

# Treating the whole image as the card hashes any background too, so it must match
# more tightly than a properly outlined card.
_FALLBACK_STRICTNESS = 12

_MAX_ALTERNATIVES = 3


class CardRecognizer:
    def __init__(self, index_path: str, max_distance: int):
        """max_distance: largest Hamming distance (of 256 bits) still accepted as a match."""
        self.index_path = index_path
        self.max_distance = max_distance
        self.index: Optional[CardIndex] = None

        if Path(index_path).exists():
            self.index = CardIndex.load(index_path)
            print(f"✓ Loaded card index: {len(self.index):,} entries, {self.index.unique_names:,} unique names "
                  f"(max distance {max_distance})")
        else:
            print(f"⚠️  Card index not found at {index_path}")
            print("   Run './build-db.ps1' (or 'python backend/build_index.py') to build it.")

    def recognize(self, img: np.ndarray) -> Optional[Dict[str, Any]]:
        """
        Identify the card in a BGR image.

        Returns the matched card's info plus 'distance', 'confidence' (0-1) and
        'alternatives', or None if nothing matched closely enough.
        """
        if self.index is None:
            raise FileNotFoundError(self.index_path)

        max_distance = self.max_distance
        outlines = card_vision.find_cards(img, limit=3)
        candidates = [(card, max_distance) for card in outlines]
        candidates.append((card_vision.whole_image_as_card(img), max_distance - _FALLBACK_STRICTNESS))

        # One row per (candidate, rotation, shift); all matched in a single matrix product
        hashes: List[np.ndarray] = []
        row_limits: List[int] = []
        for card, limit in candidates:
            for rotation in _ROTATIONS:
                oriented = card if rotation is None else cv2.rotate(card, rotation)
                for dx, dy in _SHIFTS:
                    hashes.append(card_vision.art_hash(oriented, dx, dy))
                    row_limits.append(limit)

        dist = self.index.distances(np.stack(hashes))          # (rows, entries)
        nearest = dist.argmin(axis=1)
        nearest_dist = dist[np.arange(len(nearest)), nearest]

        # Best row among those inside their own threshold
        ok = nearest_dist <= np.array(row_limits)
        if not ok.any():
            closest = int(nearest_dist.argmin())
            print(f"⚠️  Closest was '{self.index.names[nearest[closest]]}' at distance "
                  f"{int(nearest_dist[closest])} (limit {max_distance})")
            return None
        row = int(np.where(ok, nearest_dist, np.inf).argmin())
        best, best_dist = int(nearest[row]), float(nearest_dist[row])

        result = self.index.entry(best)
        result["distance"] = int(best_dist)
        result["confidence"] = round(max(0.0, 1.0 - best_dist / max_distance), 3)
        result["alternatives"] = self._alternatives(dist[row], result["name"], max_distance)
        return result

    def _alternatives(self, row_dist: np.ndarray, best_name: str, max_distance: int) -> List[Dict[str, Any]]:
        """Next-closest distinct card names for the same scan, if any are plausible."""
        assert self.index is not None
        alternatives: List[Dict[str, Any]] = []
        seen = {best_name}
        for i in np.argsort(row_dist)[:50]:
            if row_dist[i] > max_distance:
                break
            name = str(self.index.names[i])
            if name in seen:
                continue
            seen.add(name)
            alternatives.append({**self.index.entry(int(i)), "distance": int(row_dist[i])})
            if len(alternatives) == _MAX_ALTERNATIVES:
                break
        return alternatives

    def get_database_stats(self) -> Dict[str, Any]:
        if self.index is None:
            raise FileNotFoundError(self.index_path)
        return {
            "total_cards": len(self.index),
            "unique_names": self.index.unique_names,
            "max_distance": self.max_distance,
        }


# Singleton instance
_recognizer_instance: Optional[CardRecognizer] = None


def get_recognizer(index_path: Optional[str] = None) -> CardRecognizer:
    """Get or create the global recognizer instance."""
    global _recognizer_instance
    if _recognizer_instance is None:
        try:
            from backend.config import CARD_INDEX_PATH, MAX_HASH_DISTANCE
        except ImportError:
            from config import CARD_INDEX_PATH, MAX_HASH_DISTANCE
        _recognizer_instance = CardRecognizer(index_path or CARD_INDEX_PATH, MAX_HASH_DISTANCE)
    return _recognizer_instance
