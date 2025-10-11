"""
Card Recognition Service
Handles image preprocessing, card detection, and recognition.
"""
import cv2
import numpy as np
from typing import Optional, Dict, Any
from fastapi import HTTPException

try:
    from backend.recognizer import get_orb_recognizer as get_recognizer
except ImportError:
    from recognizer import get_orb_recognizer as get_recognizer

try:
    from backend.config import (
        MIN_MATCHES, CLAHE_CLIP_LIMIT, CLAHE_TILE_GRID_SIZE,
        DENOISE_H, DENOISE_TEMPLATE_WINDOW_SIZE, DENOISE_SEARCH_WINDOW_SIZE,
        CARD_MIN_AREA_RATIO, CARD_MAX_AREA_RATIO,
        CARD_ASPECT_RATIO_MIN, CARD_ASPECT_RATIO_MAX, CARD_PADDING
    )
except ImportError:
    from config import (
        MIN_MATCHES, CLAHE_CLIP_LIMIT, CLAHE_TILE_GRID_SIZE,
        DENOISE_H, DENOISE_TEMPLATE_WINDOW_SIZE, DENOISE_SEARCH_WINDOW_SIZE,
        CARD_MIN_AREA_RATIO, CARD_MAX_AREA_RATIO,
        CARD_ASPECT_RATIO_MIN, CARD_ASPECT_RATIO_MAX, CARD_PADDING
    )


class CardRecognitionService:
    """Service for card recognition operations."""
    
    @staticmethod
    def preprocess_image(img: np.ndarray) -> np.ndarray:
        """
        Preprocess image to improve recognition quality.
        - Enhance contrast
        - Reduce noise
        - Normalize lighting
        
        Args:
            img: Input image in BGR format
            
        Returns:
            Preprocessed image
        """
        try:
            # Convert to LAB color space for better lighting adjustment
            lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            
            # Apply CLAHE (Contrast Limited Adaptive Histogram Equalization) to L channel
            clahe = cv2.createCLAHE(
                clipLimit=CLAHE_CLIP_LIMIT,
                tileGridSize=CLAHE_TILE_GRID_SIZE
            )
            l = clahe.apply(l)
            
            # Merge channels
            enhanced = cv2.merge([l, a, b])
            
            # Convert back to BGR
            result = cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)
            
            # Apply slight denoising
            result = cv2.fastNlMeansDenoisingColored(
                result, None,
                DENOISE_H, DENOISE_H,
                DENOISE_TEMPLATE_WINDOW_SIZE,
                DENOISE_SEARCH_WINDOW_SIZE
            )
            
            return result
            
        except Exception as e:
            print(f"⚠️  Preprocessing failed: {e}, using original image")
            return img
    
    @staticmethod
    def detect_card(img: np.ndarray) -> Optional[np.ndarray]:
        """
        Detect and extract a card from an image using edge detection.
        Returns the largest rectangular contour that looks like a card.
        
        Args:
            img: Input image in BGR format
            
        Returns:
            Extracted card image or None if no card detected
        """
        try:
            # Convert to grayscale
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            
            # Apply Gaussian blur to reduce noise
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)
            
            # Edge detection
            edges = cv2.Canny(blurred, 50, 150)
            
            # Find contours
            contours, _ = cv2.findContours(
                edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            
            if not contours:
                return None
            
            # Sort contours by area (largest first)
            contours = sorted(contours, key=cv2.contourArea, reverse=True)
            
            # Look for rectangular contours
            for contour in contours[:10]:  # Check top 10 largest contours
                # Approximate contour to polygon
                peri = cv2.arcLength(contour, True)
                approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
                
                # If it's roughly rectangular (4 corners)
                if len(approx) == 4:
                    area = cv2.contourArea(contour)
                    img_area = img.shape[0] * img.shape[1]
                    
                    # Card should be within configured size ratio
                    area_ratio = area / img_area
                    if CARD_MIN_AREA_RATIO < area_ratio < CARD_MAX_AREA_RATIO:
                        # Get bounding rectangle
                        x, y, w, h = cv2.boundingRect(approx)
                        
                        # Check aspect ratio (cards are roughly 2.5:3.5 = 0.714)
                        aspect_ratio = float(w) / h
                        if CARD_ASPECT_RATIO_MIN < aspect_ratio < CARD_ASPECT_RATIO_MAX:
                            # Extract the card region with padding
                            y1 = max(0, y - CARD_PADDING)
                            y2 = min(img.shape[0], y + h + CARD_PADDING)
                            x1 = max(0, x - CARD_PADDING)
                            x2 = min(img.shape[1], x + w + CARD_PADDING)
                            
                            return img[y1:y2, x1:x2]
            
            return None
            
        except Exception as e:
            print(f"Error in card detection: {e}")
            return None
    
    @staticmethod
    async def recognize_from_bytes(
        image_bytes: bytes,
        min_matches: int = MIN_MATCHES
    ) -> Dict[str, Any]:
        """
        Recognize a card from image bytes.
        
        Args:
            image_bytes: Image file contents
            min_matches: Minimum feature matches required
            
        Returns:
            Recognition result with success status and card info
            
        Raises:
            HTTPException: If image is invalid or recognition fails
        """
        try:
            # Decode image
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if img is None:
                raise HTTPException(status_code=400, detail="Invalid image file")
            
            print(f"📸 Received image: {img.shape[1]}x{img.shape[0]}px")
            
            # Preprocess image
            img = CardRecognitionService.preprocess_image(img)
            
            # Use ORB recognizer
            recognizer = get_recognizer()
            result = recognizer.recognize(img, min_matches=min_matches)
            
            if result is None:
                print(f"⚠️  No match found")
                return {
                    "success": False,
                    "message": "No card recognized. Try better lighting or a clearer image."
                }
            
            print(f"✓ Recognized: {result['name']} ({result['num_matches']} matches)")
            
            return {
                "success": True,
                "card": result
            }
            
        except FileNotFoundError as e:
            raise HTTPException(
                status_code=503,
                detail="Card database not available. Please build the database first."
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Error processing image: {str(e)}"
            )
