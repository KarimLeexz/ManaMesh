"""
Create a dummy card database for testing deployment without building the full database.
"""
import pickle
from pathlib import Path

# Create a minimal dummy database (flat structure matching real database)
dummy_database = {
    'dummy_hash_1': {
        'name': 'Black Lotus',
        'set': 'LEA',
        'collector_number': '232',
        'id': 'fake-id-1'
    },
    'dummy_hash_2': {
        'name': 'Lightning Bolt',
        'set': 'LEA',
        'collector_number': '161',
        'id': 'fake-id-2'
    },
    'dummy_hash_3': {
        'name': 'Sol Ring',
        'set': 'LEA',
        'collector_number': '268',
        'id': 'fake-id-3'
    }
}

# Save to file
output_path = Path('card_hashes.pkl')
with open(output_path, 'wb') as f:
    pickle.dump(dummy_database, f)

print(f"✅ Dummy database created: {output_path}")
print(f"   Total cards: {len(dummy_database)}")
print("   This is just for testing deployment - won't recognize real cards!")
