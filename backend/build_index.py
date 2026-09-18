"""
Build the ManaMesh card index from Scryfall.

Downloads Scryfall's bulk card data, fetches one image per distinct card face /
artwork / frame variant, hashes its artwork and writes card_index.npz (about 5-10 MB).

    python backend/build_index.py                  # full build, ~60k images
    python backend/build_index.py --limit 500      # quick test run

The build is resumable: hashes are appended to <output>.checkpoint.jsonl as they
are computed, so an interrupted run continues where it stopped.
"""
import argparse
import gzip
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

import cv2
import numpy as np
import requests
from tqdm import tqdm

try:
    from backend import card_vision
    from backend.card_index import CardIndex
except ImportError:
    import card_vision
    from card_index import CardIndex

# Scryfall requires a descriptive User-Agent and an Accept header on all requests
HEADERS = {"User-Agent": "ManaMesh/1.0 (personal card scanner)", "Accept": "*/*"}
BULK_URL = "https://api.scryfall.com/bulk-data"

# Layouts that are not real playable/scannable cards, or are not portrait
SKIP_LAYOUTS = {"token", "double_faced_token", "emblem", "art_series", "planar", "scheme", "vanguard"}
SKIP_IMAGE_STATUS = {"missing", "placeholder"}


# --------------------------------------------------------------------------- data


def download_bulk(cache_dir: Path) -> Path:
    """Download Scryfall's 'default_cards' bulk file (every printing) unless today's is already cached."""
    print("📥 Fetching bulk data information from Scryfall...")
    response = requests.get(BULK_URL, headers=HEADERS, timeout=30)
    response.raise_for_status()
    entry = next(item for item in response.json()["data"] if item["type"] == "default_cards")

    uri = entry["jsonl_download_uri"]              # gzipped JSON lines; file name carries the date
    path = cache_dir / ("scryfall-" + uri.rsplit("/", 1)[-1])
    if path.exists():
        print(f"✓ Using cached {path.name}")
        return path

    print(f"📦 Downloading {entry['compressed_size'] / 1e6:.0f} MB bulk file ({entry['updated_at']})...")
    with requests.get(uri, headers=HEADERS, stream=True, timeout=60) as r:
        r.raise_for_status()
        with open(path, "wb") as f, tqdm(total=entry["compressed_size"], unit="B", unit_scale=True) as bar:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
                bar.update(len(chunk))
    return path


def read_cards(path: Path) -> List[Dict[str, Any]]:
    """Read a Scryfall bulk file: .jsonl.gz / .jsonl (one card per line) or a plain .json array."""
    if path.suffix == ".json":
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def iter_faces(cards: List[Dict[str, Any]]) -> Iterator[Dict[str, Any]]:
    """
    Yield one record per distinct card face image worth indexing.

    Reprints that share the same artwork and frame look identical to the hash, so
    they are collapsed into a single entry; a borderless / extended-art / different-
    frame printing of the same art is kept because its art window looks different.
    """
    seen = set()
    for card in cards:
        if card.get("layout") in SKIP_LAYOUTS or card.get("oversized"):
            continue
        if card.get("image_status") in SKIP_IMAGE_STATUS:
            continue

        if "image_uris" in card:                       # single-faced (incl. split / adventure)
            faces = [(0, card, card["image_uris"])]
        else:                                          # transform / modal double-faced etc.
            faces = [(i, f, f["image_uris"]) for i, f in enumerate(card.get("card_faces", [])) if "image_uris" in f]

        for face_idx, face, uris in faces:
            if "normal" not in uris:
                continue
            key = "|".join([
                face.get("name", card["name"]),
                face.get("illustration_id") or card["id"],
                str(card.get("frame")), str(card.get("border_color")), str(card.get("full_art")),
                ",".join(sorted(card.get("frame_effects", []))),
            ])
            if key in seen:
                continue
            seen.add(key)
            yield {
                "key": key,
                "id": card["id"],
                "face": face_idx,
                "name": face.get("name", card["name"]),
                "set": card.get("set", ""),
                "number": card.get("collector_number", ""),
                "url": uris["normal"],
            }


# ------------------------------------------------------------------- image / hash


def fetch_hash(record: Dict[str, Any], session: requests.Session) -> Optional[str]:
    """Download one card image and return its art hash as hex (None on failure)."""
    for attempt in range(4):
        try:
            r = session.get(record["url"], headers=HEADERS, timeout=20)
            if r.status_code == 429:
                time.sleep(float(r.headers.get("Retry-After", 5)))
                continue
            r.raise_for_status()
            img = cv2.imdecode(np.frombuffer(r.content, np.uint8), cv2.IMREAD_COLOR)
            if img is None or min(img.shape[:2]) < 100:
                return None
            return card_vision.art_hash(img).tobytes().hex()
        except requests.RequestException:
            time.sleep(1.5 * (attempt + 1))
    return None


def load_checkpoint(path: Path) -> Dict[str, str]:
    done: Dict[str, str] = {}
    if path.exists():
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    row = json.loads(line)
                    done[row["k"]] = row["h"]
                except (json.JSONDecodeError, KeyError):
                    pass  # a partially written last line from an interrupted run
    return done


# ----------------------------------------------------------------------- build


def build_index(output: str, bulk_file: Optional[str], workers: int, limit: Optional[int]) -> None:
    output_path = Path(output)
    checkpoint_path = Path(str(output) + ".checkpoint.jsonl")

    print("🎴 ManaMesh - Card Index Builder")
    print("=" * 60)

    bulk_path = Path(bulk_file) if bulk_file else download_bulk(Path("."))
    print("📖 Reading bulk data...")
    cards = read_cards(bulk_path)

    records = list(iter_faces(cards))
    del cards
    print(f"✓ {len(records):,} distinct card faces in Scryfall")
    if limit:
        records = records[:limit]
        print(f"  (limited to the first {limit:,})")

    done = load_checkpoint(checkpoint_path)
    todo = [r for r in records if r["key"] not in done]
    if done:
        print(f"↻ Resuming: {len(done):,} already hashed, {len(todo):,} to go")

    failed = 0
    if todo:
        print(f"⚙️  Downloading and hashing images with {workers} workers...")
        thread_state = threading.local()

        def work(record: Dict[str, Any]) -> Optional[str]:
            if not hasattr(thread_state, "session"):
                thread_state.session = requests.Session()   # one connection pool per worker thread
            return fetch_hash(record, thread_state.session)

        pool = ThreadPoolExecutor(max_workers=workers)
        try:
            with open(checkpoint_path, "a", encoding="utf-8") as ckpt:
                futures = {pool.submit(work, r): r for r in todo}
                for fut in tqdm(as_completed(futures), total=len(futures), unit="card"):
                    record, digest = futures[fut], fut.result()
                    if digest is None:
                        failed += 1
                        continue
                    done[record["key"]] = digest
                    ckpt.write(json.dumps({"k": record["key"], "h": digest}) + "\n")
                    ckpt.flush()
        finally:
            pool.shutdown(wait=False, cancel_futures=True)   # don't wait for queued work on Ctrl+C

    kept = [r for r in records if r["key"] in done]
    if not kept:
        raise SystemExit("❌ Nothing was indexed; check your connection and try again.")
    print(f"\n✓ Hashed {len(kept):,} faces ({failed:,} failed; rerun to retry them)")

    index = CardIndex(
        hashes=np.stack([np.frombuffer(bytes.fromhex(done[r["key"]]), np.uint8) for r in kept]),
        scryfall_ids=np.array([r["id"] for r in kept]),
        names=np.array([r["name"] for r in kept]),
        sets=np.array([r["set"] for r in kept]),
        numbers=np.array([r["number"] for r in kept]),
        faces=np.array([r["face"] for r in kept], dtype=np.uint8),
    )
    index.save(str(output_path))

    print(f"\n✅ Saved {output_path} ({output_path.stat().st_size / 1e6:.1f} MB, "
          f"{len(index):,} entries, {index.unique_names:,} unique names)")
    if failed == 0:
        checkpoint_path.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build the ManaMesh card hash index from Scryfall")
    parser.add_argument("--output", "-o", default="card_index.npz", help="Output index path (default: card_index.npz)")
    parser.add_argument("--bulk-file", help="Use this local Scryfall default_cards file (.jsonl.gz / .jsonl / .json) instead of downloading it")
    parser.add_argument("--workers", "-w", type=int, default=8, help="Parallel image downloads (default: 8)")
    parser.add_argument("--limit", type=int, help="Only index the first N faces (for testing)")
    args = parser.parse_args()

    try:
        build_index(args.output, args.bulk_file, args.workers, args.limit)
    except KeyboardInterrupt:
        print("\n⚠️  Interrupted - progress is saved; run the same command again to resume.")
