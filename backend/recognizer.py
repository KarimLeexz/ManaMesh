"""
ManaMesh - MTG Card Recognition Engine using perceptual hashing.
"""
import imagehash
from PIL import Image
import pickle
import numpy as np
from typing import Optional, Dict, Any
from pathlib import Path


class CardRecognizer:
    """
    Recognizes MTG cards using perceptual hashing.
    """
    
    def __init__(self, database_path: str = "card_hashes.pkl", hash_size: int = 16):
        """
        Initialize the card recognizer.
        
        Args:
            database_path: Path to the card hash database
            hash_size: Size of perceptual hash (must match database)
        """
        self.hash_size = hash_size
        self.card_hashes = self._load_database(database_path)
        print(f"✓ Loaded {len(self.card_hashes):,} cards from database")
    
    def _load_database(self, database_path: str) -> Dict[str, Dict[str, Any]]:
        """Load the card hash database."""
        if not Path(database_path).exists():
            raise FileNotFoundError(
                f"Card database not found at {database_path}. "
                "Please run build_database.py first."
            )
        
        with open(database_path, 'rb') as f:
            return pickle.load(f)
    
    def recognize(
        self,
        image_array: np.ndarray,
        threshold: int = 15
    ) -> Optional[Dict[str, Any]]:
        """
        Recognize a card from an image.
        
        Args:
            image_array: Image as numpy array (BGR format from OpenCV)
            threshold: Maximum hash distance to consider a match (lower = stricter)
        
        Returns:
            Dictionary with card info and confidence, or None if no match
        """
        # Convert numpy array to PIL Image
        # OpenCV uses BGR, PIL uses RGB
        if len(image_array.shape) == 3 and image_array.shape[2] == 3:
            # Convert BGR to RGB
            image_rgb = image_array[:, :, ::-1]
        else:
            image_rgb = image_array
        
        img = Image.fromarray(image_rgb)
        
        # Create perceptual hash
        query_hash = imagehash.phash(img, hash_size=self.hash_size)
        
        # Find best match
        best_match: Optional[Dict[str, Any]] = None
        best_distance = float('inf')
        
        for stored_hash_str, card_data in self.card_hashes.items():
            stored_hash = imagehash.hex_to_hash(stored_hash_str)
            distance = query_hash - stored_hash
            
            if distance < best_distance:
                best_distance = distance
                best_match = card_data
        
        # Check if match is good enough
        if best_match is None or best_distance > threshold:
            return None
        
        # Calculate confidence (0-1 scale)
        confidence = 1 - (best_distance / 64)
        
        return {
            **best_match,
            'confidence': confidence,
            'distance': best_distance
        }
    
    def recognize_batch(
        self,
        images: list[np.ndarray],
        threshold: int = 15
    ) -> list[Optional[Dict[str, Any]]]:
        """
        Recognize multiple cards at once.
        
        Args:
            images: List of image arrays
            threshold: Maximum hash distance to consider a match
        
        Returns:
            List of card info dictionaries (or None for no match)
        """
        return [self.recognize(img, threshold) for img in images]
    
    def get_database_stats(self) -> Dict[str, Any]:
        """Get statistics about the loaded database."""
        return {
            'total_cards': len(self.card_hashes),
            'hash_size': self.hash_size,
            'unique_names': len(set(card['name'] for card in self.card_hashes.values())),
        }


# Singleton instance for the API
_recognizer_instance: Optional[CardRecognizer] = None


def get_recognizer(database_path: str = "card_hashes.pkl") -> CardRecognizer:
    """Get or create the global recognizer instance."""
    global _recognizer_instance
    if _recognizer_instance is None:
        _recognizer_instance = CardRecognizer(database_path)
    return _recognizer_instance
