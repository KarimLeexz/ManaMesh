"""
ManaMesh - Advanced MTG Card Recognition using ORB feature matching.
Much more robust than perceptual hashing for real-world conditions.
"""
import cv2
import numpy as np
import pickle
from typing import Optional, Dict, Any, List, Tuple
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import requests
from io import BytesIO
from PIL import Image


class ORBCardRecognizer:
    """
    Recognizes MTG cards using ORB (Oriented FAST and Rotated BRIEF) feature matching.
    More robust to lighting, angle, and perspective changes than perceptual hashing.
    """
    
    def __init__(self, database_path: str = "card_features.pkl", max_features: int = 500):
        """
        Initialize the ORB-based card recognizer.
        
        Args:
            database_path: Path to the feature database
            max_features: Maximum number of ORB features to detect per card
        """
        self.max_features = max_features
        self.orb = cv2.ORB_create(nfeatures=max_features)
        self.bf_matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
        
        # Try to load existing database
        if Path(database_path).exists():
            self.card_features = self._load_database(database_path)
            print(f"✓ Loaded ORB features for {len(self.card_features):,} cards")
        else:
            print(f"⚠️  Database not found at {database_path}")
            print(f"   Run './build-db.ps1' to build the database.")
            self.card_features = {}
    
    def _load_database(self, database_path: str) -> Dict[str, Dict[str, Any]]:
        """Load the card feature database."""
        with open(database_path, 'rb') as f:
            return pickle.load(f)
    
    def recognize(
        self,
        image_array: np.ndarray,
        threshold: int = 30,
        min_matches: int = 10
    ) -> Optional[Dict[str, Any]]:
        """
        Recognize a card using ORB feature matching.
        
        Args:
            image_array: Image as numpy array (BGR format from OpenCV)
            threshold: Match distance ratio threshold (0.0-1.0, lower = stricter)
            min_matches: Minimum number of good matches required
        
        Returns:
            Dictionary with card info and confidence, or None if no match
        """
        # Convert to grayscale for feature detection
        if len(image_array.shape) == 3:
            gray = cv2.cvtColor(image_array, cv2.COLOR_BGR2GRAY)
        else:
            gray = image_array
        
        # Detect ORB features in query image
        keypoints_query, descriptors_query = self.orb.detectAndCompute(gray, None)
        
        if descriptors_query is None or len(keypoints_query) < min_matches:
            print(f"⚠️  Not enough features detected ({len(keypoints_query) if keypoints_query else 0})")
            return None
        
        print(f"🔍 Detected {len(keypoints_query)} features in query image")
        
        # Match against all cards in database
        best_match = None
        best_score = 0
        best_num_matches = 0
        
        for card_id, card_data in self.card_features.items():
            descriptors_db = card_data['descriptors']
            
            # Match features using BFMatcher with KNN
            matches = self.bf_matcher.knnMatch(descriptors_query, descriptors_db, k=2)
            
            # Apply Lowe's ratio test
            good_matches = []
            for match_pair in matches:
                if len(match_pair) == 2:
                    m, n = match_pair
                    if m.distance < 0.75 * n.distance:  # Lowe's ratio
                        good_matches.append(m)
            
            num_good = len(good_matches)
            
            if num_good >= min_matches:
                # Calculate match score
                avg_distance = sum(m.distance for m in good_matches) / num_good
                score = num_good / avg_distance  # Higher is better
                
                if score > best_score:
                    best_score = score
                    best_match = card_data['info']
                    best_num_matches = num_good
        
        if best_match is None:
            print(f"⚠️  No matches found (min_matches={min_matches})")
            return None
        
        # Calculate confidence based on number of matches
        confidence = min(best_num_matches / 50.0, 1.0)  # Normalize to 0-1
        
        print(f"✓ Matched: {best_match['name']} ({best_num_matches} features, confidence={confidence:.2f})")
        
        return {
            **best_match,
            'confidence': float(confidence),
            'num_matches': int(best_num_matches),
            'match_score': float(best_score)
        }
    
    def get_database_stats(self) -> Dict[str, Any]:
        """Get statistics about the loaded database."""
        return {
            'total_cards': len(self.card_features),
            'max_features': self.max_features,
            'unique_names': len(set(card['info']['name'] for card in self.card_features.values())),
        }


# Singleton instance
_orb_recognizer_instance: Optional[ORBCardRecognizer] = None


def get_orb_recognizer(database_path: str = "card_features.pkl") -> ORBCardRecognizer:
    """Get or create the global ORB recognizer instance."""
    global _orb_recognizer_instance
    if _orb_recognizer_instance is None:
        _orb_recognizer_instance = ORBCardRecognizer(database_path)
    return _orb_recognizer_instance
