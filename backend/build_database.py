"""
Build the ManaMesh card hash database from Scryfall bulk data.
This creates a small (~12MB) database of perceptual hashes for fast card recognition.
"""
import imagehash
from PIL import Image
import requests
import pickle
import io
from tqdm import tqdm
import os
from pathlib import Path


def build_card_database(
    output_path: str = "card_hashes.pkl",
    hash_size: int = 16,
    include_all_printings: bool = True
):
    """
    Download Scryfall bulk data and build a perceptual hash database.
    
    Args:
        output_path: Path to save the database file
        hash_size: Size of the perceptual hash (larger = more precise)
        include_all_printings: Include all printings or just unique cards
    """
    print("🃏 ManaMesh Card Database Builder")
    print("=" * 50)
    
    # Step 1: Get bulk data URL
    print("\n📡 Fetching Scryfall bulk data metadata...")
    bulk_url = "https://api.scryfall.com/bulk-data/default-cards"
    
    try:
        response = requests.get(bulk_url, timeout=10)
        response.raise_for_status()
        bulk_data = response.json()
        download_url = bulk_data['download_uri']
        
        print(f"✓ Bulk data size: {bulk_data['size'] / (1024*1024):.1f} MB")
        print(f"✓ Last updated: {bulk_data['updated_at']}")
    except Exception as e:
        print(f"❌ Failed to fetch bulk data metadata: {e}")
        return
    
    # Step 2: Download card data
    print(f"\n⬇️  Downloading card data from Scryfall...")
    try:
        cards_response = requests.get(download_url, timeout=60)
        cards_response.raise_for_status()
        cards_data = cards_response.json()
        print(f"✓ Found {len(cards_data):,} total cards")
    except Exception as e:
        print(f"❌ Failed to download cards: {e}")
        return
    
    # Step 3: Process cards and build hash database
    print(f"\n🔨 Building hash database (hash_size={hash_size})...")
    hash_db = {}
    seen_names = set()
    errors = 0
    skipped = 0
    
    for card in tqdm(cards_data, desc="Processing cards"):
        # Skip cards without images
        if 'image_uris' not in card:
            skipped += 1
            continue
        
        # Skip reprints if not including all printings
        if not include_all_printings and card['name'] in seen_names:
            skipped += 1
            continue
        
        seen_names.add(card['name'])
        
        try:
            # Download card image (using small version to save bandwidth)
            img_url = card['image_uris']['small']
            img_response = requests.get(img_url, timeout=10)
            img_response.raise_for_status()
            img = Image.open(io.BytesIO(img_response.content))
            
            # Create perceptual hash
            card_hash = str(imagehash.phash(img, hash_size=hash_size))
            
            # Store metadata (not the image!)
            hash_db[card_hash] = {
                'name': card['name'],
                'scryfall_id': card['id'],
                'image_url': card['image_uris']['normal'],  # High-res URL
                'set': card['set'],
                'set_name': card.get('set_name', ''),
                'collector_number': card.get('collector_number', ''),
            }
            
            # Clean up memory
            del img
            
        except Exception as e:
            errors += 1
            if errors <= 5:  # Only show first few errors
                tqdm.write(f"⚠️  Error processing {card.get('name', 'Unknown')}: {e}")
    
    # Step 4: Save database
    print(f"\n💾 Saving database to {output_path}...")
    try:
        # Create directory if it doesn't exist
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_path, 'wb') as f:
            pickle.dump(hash_db, f, protocol=pickle.HIGHEST_PROTOCOL)
        
        file_size = os.path.getsize(output_path) / (1024 * 1024)
        
        print(f"\n✅ Database created successfully!")
        print(f"   Cards: {len(hash_db):,}")
        print(f"   Size: {file_size:.1f} MB")
        print(f"   Skipped: {skipped:,}")
        print(f"   Errors: {errors}")
        
    except Exception as e:
        print(f"❌ Failed to save database: {e}")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Build ManaMesh card hash database")
    parser.add_argument(
        "--output",
        "-o",
        default="card_hashes.pkl",
        help="Output path for database file (default: card_hashes.pkl)"
    )
    parser.add_argument(
        "--hash-size",
        type=int,
        default=16,
        help="Size of perceptual hash (default: 16)"
    )
    parser.add_argument(
        "--unique-only",
        action="store_true",
        help="Include only unique card names (default: all printings)"
    )
    
    args = parser.parse_args()
    
    build_card_database(
        output_path=args.output,
        hash_size=args.hash_size,
        include_all_printings=not args.unique_only
    )
