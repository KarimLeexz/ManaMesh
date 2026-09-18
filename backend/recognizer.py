"""
ManaMesh - MTG card recognition.

Pipeline (about 5-20 ms per crop):
  1. find the card outline(s) in the image and flatten each          (card_vision)
  2. hash the artwork window, trying both orientations and a few
     small shifts to tolerate an imperfect outline                   (card_vision)
  3. nearest neighbours by Hamming distance over the whole index     (card_index)
  4. accept only if the best distance is under the threshold, so an
     unclear scan returns "not recognized" instead of a wrong card

recognize_at() is the click-to-scan entry point: it looks for a card exactly where the
user clicked, by trying crops of several sizes around the click and only accepting a
card whose outline contains the click.
"""
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

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

# Click-to-scan: crop heights tried around a click, as fractions of the image height. A
# card that fills its crop is recognized very reliably; the sizes cover cards from small
# (a full table in view) to large (one card up close).
_CLICK_CROP_SIZES = (0.2, 0.27, 0.35, 0.45, 0.58, 0.75, 0.95)
_SUGGEST_MAX_DISTANCE = 90  # weaker matches than the click limits below are still offered as suggestions, up to here
_CLICK_MAX_DISTANCE = 76   # a click is held to a slightly stricter limit than the general threshold...
_CLICK_SURE_DISTANCE = 40  # ...and beyond this distance the match must also stand apart from look-alikes
_CLICK_MIN_MARGIN = 14
_CLICK_ASPECT = (0.62, 0.82)   # a card outline's short/long side must be near a card's 0.716
_MIN_EDGE_SUPPORT = 0.82   # ...and run along real edges: measured on real scans, true outlines score 0.87-1.00, junk boxes 0.37-0.79
_UNSUPPORTED_MAX_DISTANCE = 64  # an outline without edge support only counts for matches at least this close
_EDGE_BAND = 0.03         # how close to the outline (fraction of the card's short side) an edge must be
_EDGE_SAMPLES = 30         # points checked per side
_EDGE_MIN_STRENGTH = 0.25  # relative edge strength that counts as an edge (see _edge_strength)
_CROP_PIXELS = 720         # every crop is analysed at this height, in pixels
_CLICK_OFFSETS = (0.0,)    # crop centre shifts around the click, as fractions of the crop size (per axis)
_CROP_ASPECT = 0.8         # crop width / height: a bit roomier than a card (0.716)
_CLICK_MARGIN = 0.08       # a click within this fraction of the card's short side outside its outline still counts


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

    def recognize(self, img: np.ndarray, point: Optional[Tuple[float, float]] = None,
                  max_distance: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """
        Identify the card in a BGR image (the best one), or with `point` (x, y in pixels)
        only a card whose outline contains that point.

        Returns the matched card's info plus 'distance', 'margin', 'confidence' (0-1),
        'corners' (the outline as 4 x [x, y] fractions of the image size) and 'alternatives',
        or None if nothing matched within `max_distance` (default: the configured threshold).
        """
        if self.index is None:
            raise FileNotFoundError(self.index_path)

        max_distance = max_distance or self.max_distance
        outlines = card_vision.find_outlines(img, limit=6 if point else 3)
        outline_limits = [max_distance] * len(outlines)
        if point is not None:
            # A click only considers card-shaped outlines around it. One that does not follow real
            # edges (a box over bare desk) may only win with a very close match: on a dark mat a
            # real card can have weak edges, but a close match is trustworthy anyway.
            edges = _edge_strength(img)
            outlines = [q for q in outlines if _contains(q, point) and _card_shaped(q)]
            outline_limits = [max_distance if _edge_support(q, edges) >= _MIN_EDGE_SUPPORT
                              else min(max_distance, _UNSUPPORTED_MAX_DISTANCE) for q in outlines]
        candidates = [(quad, card_vision.flatten(img, quad), limit) for quad, limit in zip(outlines, outline_limits)]
        # The whole-image fallback stays tied to the configured threshold, even when a looser
        # limit is used to collect suggestions: it hashes background too and is the likeliest
        # source of look-alike matches
        candidates.append((card_vision.whole_image_quad(img), card_vision.whole_image_as_card(img),
                           min(max_distance, self.max_distance) - _FALLBACK_STRICTNESS))

        # One row per (candidate, rotation, shift); all matched in a single matrix product
        hashes: List[np.ndarray] = []
        row_limits: List[int] = []
        row_candidate: List[int] = []
        for n, (_, card, limit) in enumerate(candidates):
            for rotation in _ROTATIONS:
                oriented = card if rotation is None else cv2.rotate(card, rotation)
                for dx, dy in _SHIFTS:
                    hashes.append(card_vision.art_hash(oriented, dx, dy))
                    row_limits.append(limit)
                    row_candidate.append(n)

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

        h, w = img.shape[:2]
        quad = candidates[row_candidate[row]][0]
        result = self.index.entry(best)
        result["distance"] = int(best_dist)
        # How much closer the match is than the closest card with a different name: a real
        # match stands far apart, a look-alike on a plain image has many near-equal rivals
        result["margin"] = int(dist[row][self.index.names != self.index.names[best]].min() - best_dist)
        result["confidence"] = round(max(0.0, 1.0 - best_dist / self.max_distance), 3)
        result["corners"] = [[round(float(x) / w, 4), round(float(y) / h, 4)] for x, y in quad]
        result["alternatives"] = self._alternatives(dist[row], result["name"], max_distance)
        return result

    def recognize_at(self, img: np.ndarray, x: float, y: float) -> Optional[Dict[str, Any]]:
        """
        Click-to-scan: identify the card at pixel (x, y), or None if there is no card there.

        Crops of several sizes are taken around the click; each is searched for a card whose
        outline contains the click, and the closest match overall wins.

        The result carries 'certain': True for a clear match, False for a plausible but
        unsure one (the caller should offer it, with 'alternatives', as a suggestion to
        confirm rather than accept it outright).
        """
        h, w = img.shape[:2]
        best: Optional[Dict[str, Any]] = None
        for fraction in _CLICK_CROP_SIZES:
            crop_h = min(fraction * h, h)
            crop_w = min(crop_h * _CROP_ASPECT, w)
            for off_x in _CLICK_OFFSETS:              # the card is rarely centred exactly on the click
                for off_y in _CLICK_OFFSETS:
                    cx, cy = x + off_x * crop_w, y + off_y * crop_h
                    x0 = int(max(0, min(cx - crop_w / 2, w - crop_w)))
                    y0 = int(max(0, min(cy - crop_h / 2, h - crop_h)))
                    crop = img[y0:int(y0 + crop_h), x0:int(x0 + crop_w)]
                    if crop.size == 0:
                        continue
                    ch, cw = crop.shape[:2]
                    # Analyse every crop at the same pixel size, so the outline finder behaves alike
                    # whether the camera gives 720p, 1080p or 4K
                    zoom = _CROP_PIXELS / ch
                    if abs(zoom - 1) > 0.05:
                        crop = cv2.resize(crop, None, fx=zoom, fy=zoom,
                                          interpolation=cv2.INTER_CUBIC if zoom > 1 else cv2.INTER_AREA)
                    result = self.recognize(crop, point=((x - x0) * zoom, (y - y0) * zoom),
                                            max_distance=_SUGGEST_MAX_DISTANCE)
                    if result is not None and (best is None or result["distance"] < best["distance"]):
                        # express the outline relative to the whole image, not the crop
                        result["corners"] = [[round((px * cw + x0) / w, 4), round((py * ch + y0) / h, 4)] for px, py in result["corners"]]
                        best = result

        if best is None:
            return None

        # A clear match is close and stands well apart from look-alikes. Anything weaker is only
        # a suggestion: a person can see at a glance whether "Abrade?" is right, and a wrong
        # suggestion costs nothing, whereas a wrong automatic answer would.
        best["certain"] = not (best["distance"] > _CLICK_MAX_DISTANCE
                               or (best["distance"] > _CLICK_SURE_DISTANCE and best["margin"] < _CLICK_MIN_MARGIN))
        if not best["certain"]:
            print(f"⚠️  Unsure: '{best['name']}' (distance {best['distance']}, margin {best['margin']}) offered as a suggestion")
        return best

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


def _edge_strength(img: np.ndarray) -> np.ndarray:
    """
    Edge strength of the image relative to its strongest edges (1.0 = as strong as the
    strongest 1%). Relative, because a crop that was enlarged smooths every edge and would
    otherwise look weaker than the same crop at native size.
    """
    gray = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (3, 3), 0)
    magnitude = np.hypot(cv2.Sobel(gray, cv2.CV_32F, 1, 0), cv2.Sobel(gray, cv2.CV_32F, 0, 1))
    return magnitude / max(float(np.percentile(magnitude, 99)), 1.0)


def _edge_support(quad: np.ndarray, edges: np.ndarray) -> float:
    """
    Fraction of points along the outline that lie on a real edge in the image. A real card's
    outline follows its border; a box drawn around bare desk does not, however card-shaped it is.
    """
    short = min(np.linalg.norm(quad[1] - quad[0]), np.linalg.norm(quad[3] - quad[0]))
    reach = max(2, int(_EDGE_BAND * short))
    hits = total = 0
    for i in range(4):
        start, end = quad[i], quad[(i + 1) % 4]
        for t in np.linspace(0.08, 0.92, _EDGE_SAMPLES):
            x, y = (start + t * (end - start)).astype(int)
            window = edges[max(y - reach, 0):y + reach + 1, max(x - reach, 0):x + reach + 1]
            total += 1
            hits += bool(window.size and window.max() > _EDGE_MIN_STRENGTH)
    return hits / total


def _card_shaped(quad: np.ndarray) -> bool:
    """Does the outline have a card's proportions (short/long side near 0.716)?"""
    width, height = np.linalg.norm(quad[1] - quad[0]), np.linalg.norm(quad[3] - quad[0])
    if min(width, height) < 1:
        return False
    return _CLICK_ASPECT[0] < min(width, height) / max(width, height) < _CLICK_ASPECT[1]


def _contains(quad: np.ndarray, point: Tuple[float, float]) -> bool:
    """Is the point on the quad, or within a small margin of its edge (a click can land on a card's border)?"""
    short = min(np.linalg.norm(quad[1] - quad[0]), np.linalg.norm(quad[3] - quad[0]))
    return cv2.pointPolygonTest(np.float32(quad), (float(point[0]), float(point[1])), True) >= -_CLICK_MARGIN * short


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
