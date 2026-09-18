"""
API Routes - Card Recognition
"""
from typing import Optional

from fastapi import APIRouter, File, Form, UploadFile

try:
    from backend.services.card_recognition import CardRecognitionService
except ImportError:
    from services.card_recognition import CardRecognitionService

router = APIRouter()


@router.post("/api/recognize")
async def recognize_card(
    file: UploadFile = File(...),
    x: Optional[float] = Form(None, ge=0, le=1),
    y: Optional[float] = Form(None, ge=0, le=1),
):
    """
    Recognize a card from an uploaded image.

    Args:
        file: Image file (JPEG, PNG, etc.)
        x, y: Where the user clicked, as fractions (0-1) of the image width and height.
              With them, only the card at that spot is identified.

    Returns:
        Card information including name, image URL, confidence and the card's outline
        ('corners', as fractions of the image size)
    """
    contents = await file.read()
    return await CardRecognitionService.recognize_from_bytes(contents, x, y)
