"""
ManaMesh - Card hash index.

Holds one 256-bit art hash per (card face, artwork/frame variant) plus the
metadata needed to show the card. Stored as a single compressed .npz (about 10 MB
for the whole of Scryfall); no pickle involved.

Hamming distance between many query hashes and the whole index is computed as a
single matrix product on +/-1 bit vectors:  distance = (BITS - q . s) / 2
"""
from pathlib import Path
from typing import Dict, Any

import numpy as np

try:
    from backend.card_vision import HASH_BITS, HASH_BYTES
except ImportError:
    from card_vision import HASH_BITS, HASH_BYTES

INDEX_VERSION = 1


def to_signs(packed: np.ndarray) -> np.ndarray:
    """Unpack (N, HASH_BYTES) uint8 hashes into (N, HASH_BITS) float32 vectors of +1 / -1."""
    bits = np.unpackbits(np.atleast_2d(packed), axis=1)
    return bits.astype(np.float32) * 2.0 - 1.0


class CardIndex:
    def __init__(
        self,
        hashes: np.ndarray,
        scryfall_ids: np.ndarray,
        names: np.ndarray,
        sets: np.ndarray,
        numbers: np.ndarray,
        faces: np.ndarray,
    ):
        if hashes.ndim != 2 or hashes.shape[1] != HASH_BYTES:
            raise ValueError(f"Index hashes must be (N, {HASH_BYTES}) uint8, got {hashes.shape}")
        self.hashes = hashes
        self.scryfall_ids = scryfall_ids
        self.names = names
        self.sets = sets
        self.numbers = numbers
        self.faces = faces
        self._signs = to_signs(hashes)

    def __len__(self) -> int:
        return len(self.hashes)

    @property
    def unique_names(self) -> int:
        return len(np.unique(self.names))

    def distances(self, query_hashes: np.ndarray) -> np.ndarray:
        """Hamming distances from Q packed query hashes to every entry -> (Q, N) float32."""
        return (HASH_BITS - to_signs(query_hashes) @ self._signs.T) / 2.0

    def image_url(self, i: int) -> str:
        """Scryfall CDN URL of the card face (deterministic from the card id)."""
        sid = str(self.scryfall_ids[i])
        side = "back" if self.faces[i] else "front"
        return f"https://cards.scryfall.io/normal/{side}/{sid[0]}/{sid[1]}/{sid}.jpg"

    def entry(self, i: int) -> Dict[str, Any]:
        return {
            "name": str(self.names[i]),
            "scryfall_id": str(self.scryfall_ids[i]),
            "set": str(self.sets[i]),
            "collector_number": str(self.numbers[i]),
            "image_url": self.image_url(i),
        }

    def save(self, path: str) -> None:
        np.savez_compressed(
            path,
            version=np.int32(INDEX_VERSION),
            hashes=self.hashes,
            scryfall_ids=self.scryfall_ids,
            names=self.names,
            sets=self.sets,
            numbers=self.numbers,
            faces=self.faces,
        )

    @classmethod
    def load(cls, path: str) -> "CardIndex":
        if not Path(path).exists():
            raise FileNotFoundError(path)
        with np.load(path, allow_pickle=False) as data:
            if int(data["version"]) != INDEX_VERSION:
                raise ValueError(f"Unsupported index version {int(data['version'])} in {path}; rebuild it")
            return cls(
                hashes=data["hashes"],
                scryfall_ids=data["scryfall_ids"],
                names=data["names"],
                sets=data["sets"],
                numbers=data["numbers"],
                faces=data["faces"],
            )
