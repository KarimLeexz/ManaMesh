"""
Download multiple printings of specific cards for testing recognition.
Creates a small test database with different artworks.
"""
import requests
import cv2
import numpy as np
import pickle
from pathlib import Path
from tqdm import tqdm
import time


def search_card(card_name: str):
    """Search for all printings of a card on Scryfall."""
    print(f"🔍 Searching for '{card_name}'...")
    
    # Use Scryfall search API - search by exact name to get ALL printings
    # Remove game:paper filter to get digital + paper, then we'll filter by images
    url = f"https://api.scryfall.com/cards/search?q=!\"{card_name}\"+unique%3Aprints"
    response = requests.get(url)
    
    if response.status_code == 404:
        print(f"   ❌ Card not found: {card_name}")
        return []
    
    response.raise_for_status()
    data = response.json()
    
    cards = []
    # Get all printings from paginated results
    while True:
        cards.extend(data['data'])
        
        if not data.get('has_more', False):
            break
        
        # Get next page
        next_page = data.get('next_page')
        if not next_page:
            break
        
        time.sleep(0.1)  # Rate limiting
        response = requests.get(next_page)
        response.raise_for_status()
        data = response.json()
    
    # Filter to cards with images (skip tokens, etc.)
    valid_cards = []
    for card in cards:
        if 'image_uris' in card and 'normal' in card['image_uris']:
            valid_cards.append(card)
    
    print(f"   ✓ Found {len(valid_cards)} printings with images")
    return valid_cards


def download_card_image(url: str, timeout: int = 10) -> np.ndarray:
    """Download a card image and convert to OpenCV format."""
    response = requests.get(url, timeout=timeout)
    response.raise_for_status()
    
    # Convert to numpy array
    image_array = np.asarray(bytearray(response.content), dtype=np.uint8)
    img = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    
    return img


def extract_orb_features(img: np.ndarray, max_features: int = 500) -> tuple:
    """Extract ORB features from an image."""
    # Convert to grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Create ORB detector
    orb = cv2.ORB_create(nfeatures=max_features)
    
    # Detect and compute
    keypoints, descriptors = orb.detectAndCompute(gray, None)
    
    return keypoints, descriptors


def build_test_database(card_names: list, output_path: str = "card_features_test.pkl"):
    """
    Build a small test database with specific cards.
    
    Args:
        card_names: List of card names to download
        output_path: Path to save the database
    """
    print("🎴 ManaMesh - Test Card Database Builder")
    print("=" * 60)
    print(f"📋 Cards to download: {', '.join(card_names)}")
    print(f"💾 Output: {output_path}")
    print()
    
    all_cards = []
    
    # Search for each card
    for card_name in card_names:
        cards = search_card(card_name)
        all_cards.extend(cards)
        time.sleep(0.1)  # Rate limiting between searches
    
    print(f"\n✓ Total cards to process: {len(all_cards)}")
    
    # Build feature database
    print("\n⚙️  Extracting ORB features...")
    
    card_features = {}
    successful = 0
    errors = 0
    
    for card in tqdm(all_cards, desc="Processing cards", unit="card"):
        try:
            card_name = card['name']
            card_id = card['id']
            card_set = card.get('set', 'unknown').upper()
            collector_num = card.get('collector_number', '')
            image_url = card['image_uris']['normal']
            
            # Download image
            img = download_card_image(image_url)
            
            # Extract ORB features
            keypoints, descriptors = extract_orb_features(img, max_features=500)
            
            # Skip if not enough features
            if descriptors is None or len(keypoints) < 10:
                tqdm.write(f"⚠️  Skipping {card_name} [{card_set}]: Not enough features")
                continue
            
            # Store features and card info
            card_features[card_id] = {
                'descriptors': descriptors,
                'num_features': len(keypoints),
                'info': {
                    'name': card_name,
                    'scryfall_id': card_id,
                    'image_url': image_url,
                    'set': card_set,
                    'collector_number': collector_num
                }
            }
            
            tqdm.write(f"✓ {card_name} [{card_set} #{collector_num}] - {len(keypoints)} features")
            successful += 1
            
            # Rate limiting
            time.sleep(0.075)
            
        except Exception as e:
            tqdm.write(f"❌ Error: {card['name']}: {str(e)}")
            errors += 1
    
    print("\n" + "=" * 60)
    print("📊 Summary:")
    print(f"   Successfully added: {successful}")
    print(f"   Errors: {errors}")
    print()
    
    # Save database
    print(f"💾 Saving test database to {output_path}...")
    with open(output_path, 'wb') as f:
        pickle.dump(card_features, f)
    
    size_kb = Path(output_path).stat().st_size / 1024
    print(f"✓ Database saved: {size_kb:.1f} KB")
    
    # Show summary by card
    print("\n📋 Cards in database:")
    card_counts = {}
    for data in card_features.values():
        name = data['info']['name']
        card_counts[name] = card_counts.get(name, 0) + 1
    
    for name, count in sorted(card_counts.items()):
        print(f"   • {name}: {count} printing(s)")
    
    print("\n✅ Test database complete!")
    print(f"   Copy to 'card_features.pkl' to use with the API")


if __name__ == "__main__":
    # Cards to test
    test_cards = [
        "Blasphemous Act",
        "Dark Ritual",
        "Bojuka Bog",
        "Big Score"
    ]
    
    try:
        build_test_database(test_cards, output_path="card_features_test.pkl")
        
        print("\n🚀 Next steps:")
        print("   1. Copy card_features_test.pkl to card_features.pkl")
        print("   2. Restart the server")
        print("   3. Try scanning one of the test cards!")
        print("\n   PowerShell command:")
        print("   Copy-Item card_features_test.pkl card_features.pkl")
        
    except KeyboardInterrupt:
        print("\n\n⚠️  Build interrupted by user")
    except Exception as e:
        print(f"\n❌ Build failed: {e}")
        raise
