"""
Card Recognition Service
Decodes uploaded images and runs them through the card recognizer.
"""
import asyncio
from typing import Any, Dict

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
    async def recognize_from_bytes(image_bytes: bytes) -> Dict[str, Any]:
        """
        Recognize a card from image bytes (runs in a thread pool).

        Args:
            image_bytes: Image file contents

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
            result = await asyncio.get_running_loop().run_in_executor(None, recognizer.recognize, img)

            if result is None:
                print(f"⚠️  No match ({img.shape[1]}x{img.shape[0]}px image)")
                return {
                    "success": False,
                    "message": "No card recognized. Try better lighting or a clearer image."
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
