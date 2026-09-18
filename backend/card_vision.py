"""
ManaMesh - Shared computer-vision primitives for card recognition.

Used by both the index builder and the live recognizer so a card is always
described the same way on both sides:
  find_cards()          -> locate card outlines and warp each flat to CARD_W x CARD_H
  whole_image_as_card() -> fallback when the image is already a tight card crop
  art_hash()            -> 256-bit perceptual hash of the artwork window
"""
from typing import List

import cv2
import numpy as np

# Canonical card geometry (Scryfall "normal" images are 488x680)
CARD_W, CARD_H = 488, 680

# Artwork window of a standard MTG frame, as fractions of the card
_ART_X0, _ART_X1 = 0.075, 0.925
_ART_Y0, _ART_Y1 = 0.115, 0.550

HASH_DCT_SIZE = 16  # 16x16 low-frequency DCT block -> 256 bits
HASH_BITS = HASH_DCT_SIZE * HASH_DCT_SIZE
HASH_BYTES = HASH_BITS // 8

# Card outline detection limits
_MIN_AREA_RATIO = 0.10   # card must cover at least 10% of the image
_MAX_AREA_RATIO = 0.98
_ASPECT_MIN, _ASPECT_MAX = 0.55, 0.90  # short/long side (MTG cards: 0.716, widened for perspective tilt)

_DUPLICATE_TOLERANCE = 0.03  # quads whose corners all lie within 3% of the image diagonal are the same card


def _order_corners(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as top-left, top-right, bottom-right, bottom-left."""
    p = pts.reshape(4, 2).astype(np.float32)
    s = p.sum(axis=1)
    d = np.diff(p, axis=1).ravel()
    return np.array([p[np.argmin(s)], p[np.argmin(d)], p[np.argmax(s)], p[np.argmax(d)]], np.float32)


def _card_quads(img: np.ndarray) -> List[np.ndarray]:
    """Find the corners of card-like shapes in the image, best candidate first."""
    h, w = img.shape[:2]
    gray = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (5, 5), 0)

    # Three complementary foreground masks: edges, and Otsu in both polarities
    edges = cv2.dilate(cv2.Canny(gray, 30, 100), np.ones((3, 3), np.uint8), iterations=2)
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    masks = (edges, otsu, 255 - otsu)

    found = []  # (score, quad)
    for mask in masks:
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
            area = cv2.contourArea(contour)
            if not (_MIN_AREA_RATIO * h * w < area < _MAX_AREA_RATIO * h * w):
                continue

            quad = _hull_to_quad(cv2.convexHull(contour))

            # Aspect from the fitted quad's edge lengths: minAreaRect is thrown
            # off by perspective tilt, this is not.
            tl, tr, br, bl = quad
            side_w = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
            side_h = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
            if min(side_w, side_h) < 1 or not (_ASPECT_MIN < min(side_w, side_h) / max(side_w, side_h) < _ASPECT_MAX):
                continue

            # Prefer large shapes that fill their quad (i.e. are really rectangular)
            score = area * min(1.0, area / max(cv2.contourArea(quad), 1.0))
            found.append((score, quad))

    # Best first, dropping near-duplicates (the same card found via different masks)
    quads: List[np.ndarray] = []
    diagonal = float(np.hypot(h, w))
    for _, quad in sorted(found, key=lambda f: f[0], reverse=True):
        if all(np.abs(quad - q).max() > _DUPLICATE_TOLERANCE * diagonal for q in quads):
            quads.append(quad)
    return quads


def _hull_to_quad(hull: np.ndarray) -> np.ndarray:
    """Fit a 4-corner polygon to a convex hull, loosening the tolerance until it has 4 corners."""
    perimeter = cv2.arcLength(hull, True)
    for eps in (0.02, 0.03, 0.04, 0.05, 0.07, 0.09):
        approx = cv2.approxPolyDP(hull, eps * perimeter, True)
        if len(approx) == 4:
            return _order_corners(approx)
        if len(approx) < 4:
            break
    return _order_corners(cv2.boxPoints(cv2.minAreaRect(hull)))


def whole_image_as_card(img: np.ndarray) -> np.ndarray:
    """
    Treat the entire image as the card (for a user-drawn box that is already
    tight around it). Only trustworthy if the resulting match is very close,
    since any background in the box gets hashed too.
    """
    h, w = img.shape[:2]
    if h < w:
        img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    return cv2.resize(img, (CARD_W, CARD_H), interpolation=cv2.INTER_AREA)


def find_outlines(img: np.ndarray, limit: int = 3) -> List[np.ndarray]:
    """
    Corners (top-left, top-right, bottom-right, bottom-left, long side vertical) of the
    card-like shapes in the image, most likely first (empty if none found).
    """
    outlines = []
    for quad in _card_quads(img)[:limit]:
        width = np.linalg.norm(quad[1] - quad[0])
        height = np.linalg.norm(quad[3] - quad[0])
        outlines.append(np.roll(quad, -1, axis=0) if height < width else quad)  # landscape -> long edge vertical
    return outlines


def flatten(img: np.ndarray, quad: np.ndarray) -> np.ndarray:
    """Warp the region inside a quad to an upright CARD_W x CARD_H crop."""
    dst = np.float32([[0, 0], [CARD_W - 1, 0], [CARD_W - 1, CARD_H - 1], [0, CARD_H - 1]])
    return cv2.warpPerspective(img, cv2.getPerspectiveTransform(np.float32(quad), dst), (CARD_W, CARD_H))


def whole_image_quad(img: np.ndarray) -> np.ndarray:
    """The image frame as a quad (for a crop that is already tight around one card)."""
    h, w = img.shape[:2]
    return np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]])


def art_hash(card: np.ndarray, dx: float = 0.0, dy: float = 0.0) -> np.ndarray:
    """
    256-bit perceptual (DCT) hash of the artwork window, packed into HASH_BYTES uint8.

    dx / dy shift the window by a fraction of the card size. The recognizer uses
    small shifts to tolerate an outline that is a few pixels off; the index is
    always built with (0, 0).
    """
    if card.shape[:2] != (CARD_H, CARD_W):
        card = cv2.resize(card, (CARD_W, CARD_H), interpolation=cv2.INTER_AREA)

    x0 = int(round((_ART_X0 + dx) * CARD_W))
    x1 = int(round((_ART_X1 + dx) * CARD_W))
    y0 = int(round((_ART_Y0 + dy) * CARD_H))
    y1 = int(round((_ART_Y1 + dy) * CARD_H))
    art = card[max(y0, 0):min(y1, CARD_H), max(x0, 0):min(x1, CARD_W)]

    gray = cv2.cvtColor(art, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, (64, 64), interpolation=cv2.INTER_AREA).astype(np.float32)
    gray = cv2.GaussianBlur(gray, (0, 0), 1.0)

    coeffs = cv2.dct(gray)[:HASH_DCT_SIZE, :HASH_DCT_SIZE].ravel()
    return np.packbits(coeffs > np.median(coeffs[1:]))  # median excludes the DC term
