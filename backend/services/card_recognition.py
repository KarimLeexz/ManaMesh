"""
Card Recognition Service
Decodes uploaded images and runs them through the card recognizer.
"""
import asyncio
from typing import Any, Dict, Optional

import cv2
import numpy as np
from fastapi import HTTPException

try:
    from backend.recognizer import get_recognizer
except ImportError:
    from recognizer import get_recognizer


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

            if result is None:
                print(f"⚠️  No match ({img.shape[1]}x{img.shape[0]}px image)")
                return {
                    "success": False,
                    "message": "No card found there. Click on the card itself, with the whole card in view."
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
