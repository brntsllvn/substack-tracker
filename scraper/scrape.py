#!/usr/bin/env python3
"""Scrape Substack finance leaderboard top 100 (rising + paid) and save daily JSON."""
import json
import sys
from datetime import date
from pathlib import Path

import requests

BASE = "https://substack.com"
FINANCE_ID = 153  # from /api/v1/homepage/initial-category-data?category=finance
LIST_TYPES = {
    "rising": "trending",  # Substack calls it "trending" internally
    "paid": "paid",
}
DATA_DIR = Path(__file__).parent.parent / "data"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json",
}


def fetch_page(list_type_api: str, page: int) -> tuple[list, bool]:
    url = f"{BASE}/api/v1/category/leaderboard/{FINANCE_ID}/{list_type_api}"
    r = requests.get(url, headers=HEADERS, params={"page": page}, timeout=30)
    r.raise_for_status()
    data = r.json()
    return data["items"], data.get("more", False)


def fetch_top_100(list_key: str) -> list[dict]:
    api_type = LIST_TYPES[list_key]
    items = []
    page = 0
    while len(items) < 100:
        page_items, more = fetch_page(api_type, page)
        items.extend(page_items)
        if not more:
            break
        page += 1

    out = []
    for i, item in enumerate(items[:100], 1):
        pub = item.get("publication") or {}
        user = item.get("user") or {}
        lb = (user.get("status") or {}).get("leaderboard") or {}
        out.append(
            {
                "rank": lb.get("rank", i),
                "name": pub.get("name", ""),
                "subdomain": pub.get("subdomain", ""),
                "url": pub.get("base_url", ""),
                "logo_url": pub.get("logo_url", ""),
                "author": user.get("name", ""),
                "author_handle": user.get("handle", ""),
                "pub_id": pub.get("id"),
            }
        )
    return out


def main():
    today = date.today().isoformat()
    DATA_DIR.mkdir(exist_ok=True)

    out_file = DATA_DIR / f"{today}.json"
    if out_file.exists():
        print(f"Already have data for {today}, skipping.")
        return

    data = {"date": today, "rising": [], "paid": []}
    errors = []

    for list_key in ("rising", "paid"):
        try:
            entries = fetch_top_100(list_key)
            data[list_key] = entries
            print(f"  {list_key}: {len(entries)} entries")
        except Exception as exc:
            errors.append(f"{list_key}: {exc}")
            print(f"ERROR {list_key}: {exc}", file=sys.stderr)

    with open(out_file, "w") as f:
        json.dump(data, f, indent=2)

    index_file = DATA_DIR / "index.json"
    idx = {"dates": []}
    if index_file.exists():
        idx = json.loads(index_file.read_text())
    if today not in idx["dates"]:
        idx["dates"].append(today)
        idx["dates"].sort()
    with open(index_file, "w") as f:
        json.dump(idx, f, indent=2)

    if errors:
        print(f"\nFailed: {errors}", file=sys.stderr)
        sys.exit(1)

    print(f"Saved {out_file}")


if __name__ == "__main__":
    main()
