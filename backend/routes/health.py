"""
API Routes - Health and Statistics
"""
from fastapi import APIRouter, HTTPException

try:
    from backend.recognizer import get_orb_recognizer as get_recognizer
except ImportError:
    from recognizer import get_orb_recognizer as get_recognizer

router = APIRouter()


@router.get("/health")
async def health_check():
    """
    Health check endpoint.
    Returns application status and database information.
    """
    try:
        recognizer = get_recognizer()
        stats = recognizer.get_database_stats()
        return {
            "status": "healthy",
            "database_loaded": True,
            "stats": stats
        }
    except Exception as e:
        return {
            "status": "degraded",
            "database_loaded": False,
            "error": str(e)
        }


@router.get("/api/stats")
async def get_stats():
    """
    Get database statistics.
    Returns information about loaded cards and features.
    """
    try:
        recognizer = get_recognizer()
        return recognizer.get_database_stats()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
