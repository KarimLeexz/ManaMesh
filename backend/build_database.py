"""
Build ORB feature database for card recognition.
Downloads ALL card images from Scryfall and extracts ORB features.
"""
import requests
import cv2
import numpy as np
import pickle
from pathlib import Path
from tqdm import tqdm
import time
from datetime import datetime


def download_bulk_data():
    """Download Scryfall bulk data file."""
    print("📥 Fetching bulk data information from Scryfall...")
    
    # Get list of bulk data files
    response = requests.get("https://api.scryfall.com/bulk-data")
    response.raise_for_status()
    bulk_data = response.json()
    
    # Find the "Default Cards" bulk data
    default_cards = None
    for item in bulk_data['data']:
        if item['type'] == 'default_cards':
            default_cards = item
            break
    
    if not default_cards:
        raise Exception("Could not find default cards bulk data")
    
    download_uri = default_cards['download_uri']
    size_mb = default_cards['size'] / (1024 * 1024)
    
    print(f"📦 Downloading bulk data ({size_mb:.1f} MB)...")
    print(f"   URI: {download_uri}")
    
    # Download the JSON file
    response = requests.get(download_uri, stream=True)
    response.raise_for_status()
    
    cards_data = response.json()
    print(f"✓ Downloaded {len(cards_data):,} cards")
    
    return cards_data


def download_card_image(url: str, timeout: int = 10) -> np.ndarray:
    """
    Download a card image and convert to OpenCV format.
    
    Args:
        url: Image URL
        timeout: Request timeout in seconds
    
    Returns:
        Image as numpy array (BGR format)
    """
    response = requests.get(url, timeout=timeout)
    response.raise_for_status()
    
    # Convert to numpy array
    image_array = np.asarray(bytearray(response.content), dtype=np.uint8)
    img = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    
    return img


def extract_orb_features(img: np.ndarray, max_features: int = 500) -> tuple:
    """
    Extract ORB features from an image.
    
    Args:
        img: Image as numpy array (BGR format)
        max_features: Maximum number of features to detect
    
    Returns:
        Tuple of (keypoints, descriptors)
    """
    # Convert to grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Create ORB detector
    orb = cv2.ORB_create(nfeatures=max_features)
    
    # Detect and compute
    keypoints, descriptors = orb.detectAndCompute(gray, None)
    
    return keypoints, descriptors


def build_database(output_path: str = "card_features.pkl", max_features: int = 500):
    """
    Build ORB feature database from Scryfall bulk data.
    
    Args:
        output_path: Path to save the database
        max_features: Maximum number of ORB features per card
    """
    print("🎴 ManaMesh - ORB Feature Database Builder")
    print("=" * 60)
    print(f"📊 Max features per card: {max_features}")
    print(f"💾 Output: {output_path}")
    print()
    
    # Check for existing checkpoint
    checkpoint_path = f"{output_path}.checkpoint"
    card_features = {}
    
    if Path(checkpoint_path).exists():
        print(f"📦 Found checkpoint file: {checkpoint_path}")
        print("   Loading existing progress...")
        with open(checkpoint_path, 'rb') as f:
            card_features = pickle.load(f)
        print(f"✓ Loaded {len(card_features):,} cards from checkpoint")
        print()
    
    # Download bulk data
    cards_data = download_bulk_data()
    
    # Filter cards that have images
    print("\n🔍 Filtering cards with images...")
    valid_cards = []
    for card in cards_data:
        # Skip tokens, art cards, etc.
        if card.get('layout') in ['token', 'emblem', 'art_series']:
            continue
        
        # Check if card has image
        if 'image_uris' in card and 'normal' in card['image_uris']:
            valid_cards.append(card)
    
    print(f"✓ Found {len(valid_cards):,} cards with images")
    
    # Build feature database
    print("\n⚙️  Extracting ORB features from card images...")
    print("   (This will take several hours)")
    print()
    
    successful = len(card_features)
    skipped = 0
    errors = 0
    
    start_time = time.time()
    
    for card in tqdm(valid_cards, desc="Processing cards", unit="card"):
        try:
            card_name = card['name']
            card_id = card['id']
            
            # Skip if already processed in checkpoint
            if card_id in card_features:
                continue
            
            image_url = card['image_uris']['normal']
            
            # Download image
            img = download_card_image(image_url)
            
            # Extract ORB features
            keypoints, descriptors = extract_orb_features(img, max_features)
            
            # Skip if not enough features
            if descriptors is None or len(keypoints) < 10:
                tqdm.write(f"⚠️  Skipping {card_name}: Not enough features ({len(keypoints) if keypoints else 0})")
                skipped += 1
                continue
            
            # Store features and card info
            card_features[card_id] = {
                'descriptors': descriptors,
                'num_features': len(keypoints),
                'info': {
                    'name': card_name,
                    'scryfall_id': card_id,
                    'image_url': image_url,
                    'set': card.get('set', ''),
                    'collector_number': card.get('collector_number', '')
                }
            }
            
            successful += 1
            
            # Save checkpoint every 1000 cards
            if successful % 1000 == 0:
                checkpoint_path = f"{output_path}.checkpoint"
                with open(checkpoint_path, 'wb') as f:
                    pickle.dump(card_features, f)
                tqdm.write(f"💾 Checkpoint saved: {successful:,} cards")
            
            # Rate limiting - be nice to Scryfall
            time.sleep(0.075)  # ~13 requests per second
            
        except requests.exceptions.Timeout:
            tqdm.write(f"⏱️  Timeout: {card['name']}")
            errors += 1
        except requests.exceptions.ConnectionError as e:
            tqdm.write(f"🔌 Connection error: {card['name']} - {str(e)}")
            errors += 1
        except Exception as e:
            tqdm.write(f"❌ Error processing {card['name']}: {str(e)}")
            errors += 1
    
    elapsed = time.time() - start_time
    hours = int(elapsed // 3600)
    minutes = int((elapsed % 3600) // 60)
    
    print("\n" + "=" * 60)
    print("📊 Summary:")
    print(f"   Total cards processed: {len(valid_cards):,}")
    print(f"   Successfully added: {successful:,}")
    print(f"   Skipped (low features): {skipped:,}")
    print(f"   Errors: {errors:,}")
    print(f"   Time taken: {hours}h {minutes}m")
    print()
    
    # Save final database
    print(f"💾 Saving database to {output_path}...")
    with open(output_path, 'wb') as f:
        pickle.dump(card_features, f)
    
    # Get file size
    size_mb = Path(output_path).stat().st_size / (1024 * 1024)
    print(f"✓ Database saved: {size_mb:.1f} MB")
    
    # Calculate average features per card
    avg_features = sum(data['num_features'] for data in card_features.values()) / len(card_features)
    print(f"📈 Average features per card: {avg_features:.1f}")
    
    print("\n✅ Database build complete!")
    print(f"   You can now use this database with the ORB recognizer.")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Build ORB feature database for card recognition")
    parser.add_argument(
        "--output",
        "-o",
        default="card_features.pkl",
        help="Output database file path (default: card_features.pkl)"
    )
    parser.add_argument(
        "--max-features",
        "-f",
        type=int,
        default=500,
        help="Maximum number of ORB features per card (default: 500)"
    )
    
    args = parser.parse_args()
    
    try:
        build_database(args.output, args.max_features)
    except KeyboardInterrupt:
        print("\n\n⚠️  Build interrupted by user")
        print("   Progress has been saved in checkpoint file")
    except Exception as e:
        print(f"\n❌ Build failed: {e}")
        raise
