"""
API Routes - Card Recognition
"""
from fastapi import APIRouter, UploadFile, File

try:
    from backend.services.card_recognition import CardRecognitionService
except ImportError:
    from services.card_recognition import CardRecognitionService

router = APIRouter()


@router.post("/api/recognize")
async def recognize_card(file: UploadFile = File(...)):
    """
    Recognize a card from an uploaded image.
    
    Args:
        file: Image file (JPEG, PNG, etc.)
    
    Returns:
        Card information including name, image URL, and confidence
    """
    contents = await file.read()
    return await CardRecognitionService.recognize_from_bytes(contents)
