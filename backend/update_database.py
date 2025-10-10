"""
Update the MTG card hash database with new cards from Scryfall.
Only downloads and processes cards that aren't already in the database.
"""
import imagehash
from PIL import Image
import requests
import pickle
import io
from tqdm import tqdm
import os
from pathlib import Path
from datetime import datetime


def update_card_database(
    database_path: str = "card_hashes.pkl",
    hash_size: int = 16,
    backup: bool = True
):
    """
    Update existing database with new cards from Scryfall.
    
    Args:
        database_path: Path to the existing database file
        hash_size: Size of perceptual hash (must match existing database)
        backup: Whether to create a backup of the old database
    """
    print("🔄 ManaMesh Card Database Updater")
    print("=" * 50)
    
    # Step 1: Load existing database
    if not Path(database_path).exists():
        print(f"❌ Database not found at {database_path}")
        print("   Please run build_database.py first to create initial database.")
        return
    
    print(f"\n📂 Loading existing database from {database_path}...")
    with open(database_path, 'rb') as f:
        existing_db = pickle.load(f)
    
    print(f"✓ Loaded {len(existing_db):,} existing cards")
    
    # Create backup if requested
    if backup:
        backup_path = database_path.replace('.pkl', f'_backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}.pkl')
        print(f"\n💾 Creating backup at {backup_path}...")
        with open(backup_path, 'wb') as f:
            pickle.dump(existing_db, f, protocol=pickle.HIGHEST_PROTOCOL)
        print(f"✓ Backup created")
    
    # Step 2: Get bulk data from Scryfall
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
    
    # Step 3: Download card data
    print(f"\n⬇️  Downloading card data from Scryfall...")
    try:
        cards_response = requests.get(download_url, timeout=60)
        cards_response.raise_for_status()
        cards_data = cards_response.json()
        print(f"✓ Found {len(cards_data):,} total cards from Scryfall")
    except Exception as e:
        print(f"❌ Failed to download cards: {e}")
        return
    
    # Step 4: Find new cards
    print(f"\n🔍 Identifying new cards...")
    
    # Build set of existing card IDs for quick lookup
    existing_ids = set(card['scryfall_id'] for card in existing_db.values())
    print(f"✓ Existing cards indexed by ID")
    
    new_cards = [card for card in cards_data if card['id'] not in existing_ids and 'image_uris' in card]
    
    if not new_cards:
        print("\n✨ No new cards found! Your database is up to date.")
        return
    
    print(f"✓ Found {len(new_cards):,} new cards to add")
    
    # Step 5: Process new cards
    print(f"\n🔨 Processing new cards (hash_size={hash_size})...")
    added = 0
    errors = 0
    
    for card in tqdm(new_cards, desc="Adding cards"):
        try:
            # Download card image (using small version to save bandwidth)
            img_url = card['image_uris']['small']
            img_response = requests.get(img_url, timeout=10)
            img_response.raise_for_status()
            img = Image.open(io.BytesIO(img_response.content))
            
            # Create perceptual hash
            card_hash = str(imagehash.phash(img, hash_size=hash_size))
            
            # Check if hash already exists (different card with same artwork)
            if card_hash in existing_db:
                tqdm.write(f"⚠️  Hash collision: {card['name']} has same hash as {existing_db[card_hash]['name']}")
                continue
            
            # Add to database
            existing_db[card_hash] = {
                'name': card['name'],
                'scryfall_id': card['id'],
                'image_url': card['image_uris']['normal'],
                'set': card['set'],
                'set_name': card.get('set_name', ''),
                'collector_number': card.get('collector_number', ''),
            }
            
            added += 1
            
            # Clean up memory
            del img
            
        except Exception as e:
            errors += 1
            if errors <= 5:  # Only show first few errors
                tqdm.write(f"⚠️  Error processing {card.get('name', 'Unknown')}: {e}")
    
    # Step 6: Save updated database
    print(f"\n💾 Saving updated database to {database_path}...")
    try:
        with open(database_path, 'wb') as f:
            pickle.dump(existing_db, f, protocol=pickle.HIGHEST_PROTOCOL)
        
        file_size = os.path.getsize(database_path) / (1024 * 1024)
        
        print(f"\n✅ Database updated successfully!")
        print(f"   Total cards: {len(existing_db):,} (+{added:,})")
        print(f"   Size: {file_size:.1f} MB")
        print(f"   Errors: {errors}")
        
        if backup:
            print(f"\n💡 Old database backed up to: {backup_path}")
        
    except Exception as e:
        print(f"❌ Failed to save database: {e}")
        if backup:
            print(f"💡 Your backup is safe at: {backup_path}")


def check_for_updates(database_path: str = "card_hashes.pkl"):
    """
    Check if there are new cards available without downloading them.
    
    Args:
        database_path: Path to the existing database file
    """
    print("🔍 Checking for updates...")
    
    if not Path(database_path).exists():
        print(f"❌ Database not found at {database_path}")
        return
    
    # Load existing database
    with open(database_path, 'rb') as f:
        existing_db = pickle.load(f)
    
    existing_count = len(existing_db)
    existing_ids = set(card['scryfall_id'] for card in existing_db.values())
    
    # Get latest card count from Scryfall
    try:
        bulk_url = "https://api.scryfall.com/bulk-data/default-cards"
        response = requests.get(bulk_url, timeout=10)
        response.raise_for_status()
        bulk_data = response.json()
        
        # Download just to count (could cache this, but it's fast)
        cards_response = requests.get(bulk_data['download_uri'], timeout=60)
        cards_data = cards_response.json()
        
        total_cards = sum(1 for card in cards_data if 'image_uris' in card)
        new_cards = sum(1 for card in cards_data if card['id'] not in existing_ids and 'image_uris' in card)
        
        print(f"\n📊 Update Status:")
        print(f"   Your database: {existing_count:,} cards")
        print(f"   Scryfall total: {total_cards:,} cards")
        print(f"   New cards available: {new_cards:,}")
        print(f"   Last updated: {bulk_data['updated_at']}")
        
        if new_cards > 0:
            print(f"\n💡 Run 'python backend/update_database.py' to add {new_cards:,} new cards")
        else:
            print(f"\n✨ Your database is up to date!")
        
    except Exception as e:
        print(f"❌ Failed to check for updates: {e}")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Update ManaMesh card hash database")
    parser.add_argument(
        "--database",
        "-d",
        default="card_hashes.pkl",
        help="Path to existing database file (default: card_hashes.pkl)"
    )
    parser.add_argument(
        "--hash-size",
        type=int,
        default=16,
        help="Size of perceptual hash (must match existing database, default: 16)"
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Don't create backup of old database"
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Only check for updates without downloading"
    )
    
    args = parser.parse_args()
    
    if args.check_only:
        check_for_updates(args.database)
    else:
        update_card_database(
            database_path=args.database,
            hash_size=args.hash_size,
            backup=not args.no_backup
        )
