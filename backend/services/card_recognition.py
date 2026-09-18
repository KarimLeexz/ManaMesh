"""
Card Recognition Service
Decodes uploaded images and runs them through the card recognizer.
"""
import asyncio
import json
import time
from pathlib import Path
from typing import Any, Dict, Optional

import cv2
import numpy as np
from fastapi import HTTPException

try:
    from backend.config import SAVE_SCANS_DIR
    from backend.recognizer import get_recognizer
except ImportError:
    from config import SAVE_SCANS_DIR
    from recognizer import get_recognizer


def _save_scan(image_bytes: bytes, x: Optional[float], y: Optional[float], result: Optional[Dict[str, Any]]) -> None:
    """Keep the scanned image with its click position and outcome (only when SAVE_SCANS_DIR is set)."""
    if not SAVE_SCANS_DIR:
        return
    folder = Path(SAVE_SCANS_DIR)
    folder.mkdir(parents=True, exist_ok=True)
    stem = time.strftime("%Y%m%d_%H%M%S") + f"_{int(time.time() * 1000) % 1000:03d}"
    (folder / f"{stem}.jpg").write_bytes(image_bytes)
    outcome = None if result is None else {k: result[k] for k in ("name", "distance", "margin", "corners")}
    if outcome is not None:
        outcome["certain"] = result.get("certain", True)
    (folder / f"{stem}.json").write_text(json.dumps({"x": x, "y": y, "result": outcome}, indent=1), encoding="utf-8")


class CardRecognitionService:
    """Service for card recognition operations."""

    @staticmethod
    async def recognize_from_bytes(
        image_bytes: bytes, x: Optional[float] = None, y: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Recognize a card from image bytes (runs in a thread pool).

        Args:
            image_bytes: Image file contents
            x, y: Where the user clicked, as fractions (0-1) of the image width and height.
                  Given, only the card at that spot is identified; omitted, the best card in the image.

        Returns:
            Recognition result with success status and card info

        Raises:
            HTTPException: If image is invalid or recognition fails
        """
        try:
            img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                raise HTTPException(status_code=400, detail="Invalid image file")

            recognizer = get_recognizer()
            loop = asyncio.get_running_loop()
            if x is not None and y is not None:
                h, w = img.shape[:2]
                result = await loop.run_in_executor(None, recognizer.recognize_at, img, x * w, y * h)
            else:
                result = await loop.run_in_executor(None, recognizer.recognize, img)

            _save_scan(image_bytes, x, y, result)

            if result is None:
                print(f"⚠️  No match ({img.shape[1]}x{img.shape[0]}px image)")
                return {
                    "success": False,
                    "message": "No card found there. Click on the card itself, with the whole card in view."
                }

            if not result.get("certain", True):
                # Plausible but unsure: offer the best guesses for the user to confirm
                fields = ("name", "scryfall_id", "set", "collector_number", "image_url", "distance")
                suggestions = ([{k: result[k] for k in fields}] + result["alternatives"])[:3]
                return {
                    "success": False,
                    "message": "Not sure - is it one of these?",
                    "suggestions": suggestions,
                    "corners": result["corners"]
                }

            print(f"✓ Recognized: {result['name']} (distance {result['distance']}/{recognizer.max_distance})")
            return {
                "success": True,
                "card": result
            }

        except FileNotFoundError:
            raise HTTPException(
                status_code=503,
                detail="Card index not available. Please build it first (python backend/build_index.py)."
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Error processing image: {str(e)}"
            )
