from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import logging

import asyncio
from concurrent.futures import ThreadPoolExecutor
import requests
import fastavro
from cachetools import TTLCache

STEAM_API_KEY = "978A741591AE46FFB9EDF4EBBF26A34A"
DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1497510052511223828/zGsmrRIbSbUbZZosQpbK1NNF_bqMIefuvhdqXeLJC_JP1RLRIWFpEDip_syhK4KjdBJ1"

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
CACHE_PATH = DATA_DIR / "steam_cache.json"
AVRO_CACHE_PATH = DATA_DIR / "steam_cache.avro"

DEFAULT_TOP_N = 10000

# Apache Avro Schema definition
from dateutil import parser as date_parser
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


# Apache Avro Schema definition
AVRO_SCHEMA = {
    "type": "record",
    "name": "GameRecords",
    "fields": [
        {"name": "generated_at", "type": "string"},
        {"name": "count", "type": "int"},
        {
            "name": "games",
            "type": {
                "type": "array",
                "items": {
                    "type": "record",
                    "name": "Game",
                    "fields": [
                        {"name": "appid", "type": "int"},
                        {"name": "name", "type": "string"},
                        {"name": "genre", "type": "string"},
                        {"name": "header_image", "type": "string"},
                        {"name": "price_currency", "type": "string"},
                        {"name": "original_price", "type": ["null", "float"]},
                        {"name": "final_price", "type": ["null", "float"]},
                        {"name": "discount_percent", "type": "int"},
                        {"name": "is_on_sale", "type": "boolean"},
                        {"name": "current_players", "type": ["null", "int"]},
                        {"name": "owners", "type": "string"},
                        {"name": "revenue_est", "type": ["null", "float"]},
                        {"name": "rating", "type": ["null", "int"]},
                        {"name": "positive_reviews", "type": ["null", "int"]},
                        {"name": "negative_reviews", "type": ["null", "int"]},
                        {"name": "news", "type": {"type": "array", "items": "string"}},
                    ]
                }
            }
        }
    ]
}


@dataclass(frozen=True)
class GameRecord:
    appid: int
    name: str
    genre: str
    header_image: str
    price_currency: str
    original_price: Optional[float]
    final_price: Optional[float]
    discount_percent: int
    is_on_sale: bool
    current_players: Optional[int]
    owners: str = "Unknown"
    revenue_est: Optional[float] = None
    rating: Optional[int] = None
    positive_reviews: Optional[int] = None
    negative_reviews: Optional[int] = None
    news: List[str] = None


_session: Optional[requests.Session] = None
_http_cache: TTLCache = TTLCache(maxsize=2048, ttl=60)

logger = logging.getLogger("steam_dashboard")


def _get_session() -> requests.Session:
    global _session
    if _session is not None:
        return _session

    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7",
    })
    retry = Retry(
        total=5,
        backoff_factor=0.6,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=20, pool_maxsize=20)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    _session = s
    return s


def _get_json(url: str, params: Optional[Dict[str, Any]] = None, timeout_s: int = 20) -> Any:
    key = (url, tuple(sorted((params or {}).items())))
    if key in _http_cache:
        return _http_cache[key]

    s = _get_session()
    resp = s.get(url, params=params, timeout=timeout_s)
    resp.raise_for_status()
    data = resp.json()
    _http_cache[key] = data
    return data


def fetch_top_appids(top_n: int = DEFAULT_TOP_N) -> List[int]:
    seen = set()
    out: List[int] = []
    
    # SteamSpy 'all' gives about 1000 games. For more, we need to iterate pages.
    # Page 0 to N. Each page has 1000 games.
    pages_to_fetch = (top_n // 1000) + 1
    if pages_to_fetch > 20: pages_to_fetch = 20 # Cap at 20k games to avoid long wait
    
    print(f"[*] Fetching {pages_to_fetch} pages of games from SteamSpy...")
    
    for page in range(pages_to_fetch):
        try:
            data = _get_json("https://steamspy.com/api.php", params={"request": "all", "page": str(page)})
            if not data or not isinstance(data, dict):
                break
                
            for k, v in data.items():
                try:
                    appid = int(v.get("appid") or k)
                    if appid not in seen:
                        seen.add(appid)
                        out.append(appid)
                except Exception:
                    continue
            
            if len(out) >= top_n:
                break
            
            # Small sleep to be nice to API
            time.sleep(0.5)
        except Exception as e:
            print(f"[!] Error fetching page {page}: {e}")
            break

    return out[:top_n]


def fetch_steam_store_detail(appid: int) -> Optional[Dict[str, Any]]:
    try:
        data = _get_json(
            "https://store.steampowered.com/api/appdetails",
            params={"appids": str(appid), "cc": "th", "l": "th"},
            timeout_s=10
        )
        payload = data.get(str(appid))
        if not payload or not payload.get("success"):
            return None
        return payload.get("data")
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 403:
            logger.warning(f"Access forbidden (403) for appid {appid}. Might be rate limited or blocked.")
        elif e.response.status_code == 429:
            logger.warning(f"Rate limited (429) for appid {appid}. Sleeping...")
            time.sleep(2)
        return None
    except Exception as e:
        logger.error(f"Error fetching store detail for {appid}: {e}")
        return None


def fetch_steamspy_detail(appid: int) -> Optional[Dict[str, Any]]:
    data = _get_json("https://steamspy.com/api.php", params={"request": "appdetails", "appid": str(appid)})
    if not isinstance(data, dict) or data.get("appid") is None:
        return None
    return data


def fetch_current_players(appid: int) -> Optional[int]:
    data = _get_json(
        "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/",
        params={"key": STEAM_API_KEY, "appid": str(appid)},
    )
    try:
        return int(data["response"]["player_count"])
    except Exception:
        return None


def _extract_genre(store: Optional[Dict[str, Any]], spy: Optional[Dict[str, Any]]) -> str:
    if store:
        genres = store.get("genres")
        if isinstance(genres, list) and genres:
            d = genres[0]
            if isinstance(d, dict) and d.get("description"):
                return str(d["description"])
    if spy:
        g = spy.get("genre")
        if g:
            return str(g)
    return "Unknown"


def _extract_prices(store: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not store:
        return {
            "currency": "THB",
            "original": None,
            "final": None,
            "discount_percent": 0,
            "is_on_sale": False,
        }

    price_overview = store.get("price_overview")
    if not isinstance(price_overview, dict):
        return {
            "currency": "THB",
            "original": None,
            "final": None,
            "discount_percent": 0,
            "is_on_sale": False,
        }

    currency = str(price_overview.get("currency") or "THB")

    def _money(x: Any) -> Optional[float]:
        try:
            return float(x) / 100.0
        except Exception:
            return None

    initial = _money(price_overview.get("initial"))
    final = _money(price_overview.get("final"))
    discount_percent = int(price_overview.get("discount_percent") or 0)
    is_on_sale = discount_percent > 0

    return {
        "currency": currency,
        "original": initial,
        "final": final,
        "discount_percent": discount_percent,
        "is_on_sale": is_on_sale,
    }


def fetch_game_news(appid: int, count: int = 3) -> List[str]:
    try:
        data = _get_json(
            "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/",
            params={"appid": str(appid), "count": count, "maxlength": 300}
        )
        items = data.get("appnews", {}).get("newsitems", [])
        return [item.get("title", "") for item in items if item.get("title")]
    except Exception:
        return []

def send_notification(message: str):
    if not DISCORD_WEBHOOK_URL or "webhooks" not in DISCORD_WEBHOOK_URL:
        print(f"[LOG ONLY] Notification: {message}")
        return
    try:
        # Beautiful Discord Embed for deals
        if "🔥 Big Deals Found!" in message:
            # Simple content for now, can be expanded to rich embeds
            payload = {"content": f"📢 **Steam Update**\n{message}"}
        else:
            payload = {"content": f"ℹ️ **System Log**: {message}"}
            
        requests.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
    except Exception as e:
        print(f"Failed to send notification: {e}")

def normalize_game(appid: int) -> Optional[GameRecord]:
    try:
        store = fetch_steam_store_detail(appid)
    except Exception:
        store = None
        
    try:
        spy = fetch_steamspy_detail(appid)
    except Exception:
        spy = None

    # Even if both fail, we can still create a record with the appid if we have nothing else
    # but usually we want at least a name.
    if not store and not spy:
        # Minimal fallback for the name/image to at least show something
        # For 10k games, we want to see the list even if details aren't all there
        return GameRecord(
            appid=appid,
            name=f"Game {appid}",
            genre="Unknown",
            header_image=f"https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{appid}/header.jpg",
            price_currency="THB",
            original_price=None,
            final_price=None,
            discount_percent=0,
            is_on_sale=False,
            current_players=0,
            news=[]
        )

    name = ""
    if store and store.get("name"):
        name = str(store["name"])
    elif spy and spy.get("name"):
        name = str(spy["name"])
    else:
        name = str(appid)

    header_image = f"https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{appid}/header.jpg"
    if store and store.get("header_image"):
        header_image = str(store["header_image"])

    genre = _extract_genre(store, spy)
    prices = _extract_prices(store)
    
    # Fallback for prices using SteamSpy if Store API failed
    if prices["final"] is None and spy and spy.get("price"):
        try:
            # SteamSpy price is usually in cents (USD)
            spy_price = float(spy["price"]) / 100.0
            # Convert to approximate THB (e.g., x35) for demo if currency is THB
            prices["final"] = spy_price * 35.0 if prices["currency"] == "THB" else spy_price
            prices["original"] = float(spy.get("initialprice", 0)) / 100.0 * 35.0
            prices["discount_percent"] = int(spy.get("discount", 0))
            prices["is_on_sale"] = prices["discount_percent"] > 0
        except Exception:
            pass

    current_players = fetch_current_players(appid)
    news = fetch_game_news(appid)

    owners = "Unknown"
    revenue_est = None
    rating = None
    positive_reviews = None
    negative_reviews = None
    if spy:
        owners = str(spy.get("owners") or "Unknown")
        positive_reviews = spy.get("positive")
        negative_reviews = spy.get("negative")
        if positive_reviews is not None and negative_reviews is not None:
            total = positive_reviews + negative_reviews
            if total > 0:
                rating = round((positive_reviews / total) * 100)

        # Simple revenue estimate: (midpoint of owners) * (final price)
        # Note: This is a VERY rough estimate often used in the industry for demo purposes
        try:
            raw_owners = owners.replace(",", "").replace(" ", "")
            if ".." in raw_owners:
                low, high = raw_owners.split("..")
                avg_owners = (float(low) + float(high)) / 2
                if prices["final"] is not None:
                    revenue_est = avg_owners * prices["final"]
        except Exception:
            pass

    return GameRecord(
        appid=appid,
        name=name,
        genre=genre,
        header_image=header_image,
        price_currency=prices["currency"],
        original_price=prices["original"],
        final_price=prices["final"],
        discount_percent=prices["discount_percent"],
        is_on_sale=prices["is_on_sale"],
        current_players=current_players,
        owners=owners,
        revenue_est=revenue_est,
        rating=rating,
        positive_reviews=positive_reviews,
        negative_reviews=negative_reviews,
        news=news
    )


async def fetch_game_data_async(appid: int) -> Optional[GameRecord]:
    loop = asyncio.get_event_loop()
    with ThreadPoolExecutor() as pool:
        try:
            return await loop.run_in_executor(pool, normalize_game, appid)
        except Exception:
            return None

async def fetch_games_async(top_n: int = DEFAULT_TOP_N) -> List[GameRecord]:
    appids = fetch_top_appids(top_n=top_n)
    total = len(appids)
    print(f"[*] Total appids to fetch (async): {total}")
    
    if total == 0:
        print("[!] No appids found to fetch.")
        return []

    tasks = [fetch_game_data_async(appid) for appid in appids]
    results = await asyncio.gather(*tasks)
    
    games = [g for g in results if g is not None]
    if total > 0 and len(games) == 0:
        print(f"[!] Warning: Fetched {total} appids but all normalized results were None.")
        # Print first few results to see if there are errors
        for i, res in enumerate(results[:5]):
            print(f"    - Result {i}: {res}")

    print(f"\n[+] Data fetching complete. Fetched {len(games)} games.")
    games.sort(key=lambda x: (x.current_players or 0), reverse=True)
    return games

def fetch_games(top_n: int = DEFAULT_TOP_N) -> List[GameRecord]:
    # Synchronous wrapper for backward compatibility or direct CLI usage
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import nest_asyncio

        nest_asyncio.apply()
        return asyncio.get_event_loop().run_until_complete(fetch_games_async(top_n))

    return asyncio.run(fetch_games_async(top_n))


def write_cache(games: List[GameRecord]) -> Dict[str, Any]:
    # Data Quality Check
    if not games or len(games) == 0:
        error_msg = "[!] Data Quality Check Failed: 0 games fetched. Aborting save."
        send_notification(error_msg)
        print(error_msg)
        return {"error": "zero_games"}

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    # Partitioning: Create folders by date (data/YYYY/MM/DD)
    now = datetime.now(timezone.utc)
    partition_dir = DATA_DIR / now.strftime("%Y") / now.strftime("%m") / now.strftime("%d")
    partition_dir.mkdir(parents=True, exist_ok=True)
    
    timestamp = now.strftime("%Y%m%d_%H%M%S")
    avro_history_path = partition_dir / f"steam_history_{timestamp}.avro"

    payload = {
        "generated_at": now.isoformat(),
        "count": len(games),
        "games": [
            {
                "appid": g.appid,
                "name": g.name,
                "genre": g.genre,
                "header_image": g.header_image,
                "price_currency": g.price_currency,
                "original_price": g.original_price,
                "final_price": g.final_price,
                "discount_percent": g.discount_percent,
                "is_on_sale": g.is_on_sale,
                "current_players": g.current_players,
                "owners": g.owners,
                "revenue_est": g.revenue_est,
                "rating": g.rating,
                "positive_reviews": g.positive_reviews,
                "negative_reviews": g.negative_reviews,
                "news": g.news or [],
            }
            for g in games
        ],
    }

    # Save to Apache Avro cache (main file for Dashboard)
    with open(AVRO_CACHE_PATH, 'wb') as f:
        fastavro.writer(f, AVRO_SCHEMA, [payload])
    
    # Save to history file (partitioned)
    with open(avro_history_path, 'wb') as f:
        fastavro.writer(f, AVRO_SCHEMA, [payload])
    
    # Notification for Big Deals
    sale_games = [g.name for g in games if g.discount_percent >= 50]
    if sale_games:
        send_notification(f" Big Deals Found! {len(sale_games)} games are on 50%+ sale: {', '.join(sale_games[:3])}...")
    
    return payload


def get_data_dir_size_gb() -> float:
    total_size = 0
    for f in DATA_DIR.glob('**/*'):
        if f.is_file():
            total_size += f.stat().st_size
    return total_size / (1024 * 1024 * 1024)

def fetch_and_write(top_n: int = DEFAULT_TOP_N) -> Dict[str, Any]:
    start_time = time.time()
    print(f"[*] Starting data fetch (Limit: {top_n} games)...")
    
    games = fetch_games(top_n=top_n)
    
    # Data Quality Check is already inside write_cache, but let's handle the response
    payload = write_cache(games)
    
    if "error" in payload:
        return payload

    duration = time.time() - start_time
    current_size_gb = get_data_dir_size_gb()
    
    # Enhanced Notification Message
    success_msg = (
        f"✅ **Data Fetch Completed**\n"
        f"📊 **Games Fetched**: {len(games)} games\n"
        f"⏱️ **Duration**: {duration:.1f} seconds\n"
        f"💾 **Storage Usage**: {current_size_gb:.4f} GB / 5.0000 GB\n"
        f"📅 **Timestamp**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    )
    send_notification(success_msg)
    
    print(f"[+] Fetch complete! Total games in this batch: {len(games)}")
    print(f"[+] Total data storage used: {current_size_gb:.4f} GB / 5.0000 GB")
    
    return payload


def read_cache() -> Optional[Dict[str, Any]]:
    if not AVRO_CACHE_PATH.exists():
        logger.info("read_cache missing path=%s", str(AVRO_CACHE_PATH))
        return None
    try:
        start = time.perf_counter()
        with open(AVRO_CACHE_PATH, 'rb') as f:
            reader = fastavro.reader(f)
            records = list(reader)
            cache = records[0] if records else None
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        count = 0
        if isinstance(cache, dict):
            try:
                count = int(cache.get("count") or 0)
            except Exception:
                count = 0
        logger.info("read_cache ok duration_ms=%.1f count=%d", elapsed_ms, count)
        return cache
    except Exception:
        logger.exception("read_cache_failed")
        return None


def cache_age_seconds(cache: Dict[str, Any]) -> Optional[float]:
    ts = cache.get("generated_at")
    if not ts:
        return None
    try:
        dt = date_parser.isoparse(str(ts))
    except Exception:
        return None
    if not dt.tzinfo:
        dt = dt.replace(tzinfo=timezone.utc)
    return max(0.0, (datetime.now(timezone.utc) - dt).total_seconds())


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description='Steam Data Fetcher')
    parser.add_argument('--count', type=int, default=DEFAULT_TOP_N, help='Number of games to fetch')
    args = parser.parse_args()
    
    fetch_and_write(top_n=args.count)
