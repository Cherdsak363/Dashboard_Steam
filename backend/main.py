from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional, List

import warnings

warnings.filterwarnings(
    "ignore",
    category=DeprecationWarning,
    module=r"authlib\..*",
)

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from authlib.integrations.starlette_client import OAuth

import sys
import os
import requests
import json
import urllib.parse
import logging
import time
from datetime import datetime

# Add the project root to sys.path to allow running this script directly
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.steam_fetcher import cache_age_seconds, fetch_and_write, read_cache, STEAM_API_KEY, fetch_steam_store_detail, fetch_current_players, fetch_steamspy_detail

FRONTEND_BUILD_DIR = Path(__file__).resolve().parents[1] / "frontend" / "build"

app = FastAPI(title="Steam Dashboard Demo")

# Add CORS Middleware
_cors_origins_env = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
if _cors_origins_env:
    _cors_origins = [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
else:
    _cors_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("steam_dashboard")

# Add Session Middleware for Auth
app.add_middleware(SessionMiddleware, secret_key="a-very-secret-key-for-steam-dashboard")


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        logger.exception("request_failed method=%s path=%s duration_ms=%.1f", request.method, request.url.path, elapsed_ms)
        raise
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    logger.info(
        "request_done method=%s path=%s status=%s duration_ms=%.1f",
        request.method,
        request.url.path,
        getattr(response, "status_code", "?"),
        elapsed_ms,
    )
    return response

app.mount("/static", StaticFiles(directory=str(FRONTEND_BUILD_DIR / "static")), name="static")

STEAM_OPENID_URL = "https://steamcommunity.com/openid/login"

@app.get("/api/auth/login")
def login(request: Request):
    # Steam OpenID 2.0 Login
    params = {
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "checkid_setup",
        "openid.return_to": str(request.url_for("auth_callback")),
        "openid.realm": f"{request.url.scheme}://{request.url.netloc}",
        "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
        "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    }
    query_string = urllib.parse.urlencode(params)
    return RedirectResponse(f"{STEAM_OPENID_URL}?{query_string}")

@app.get("/api/auth/callback")
def auth_callback(request: Request):
    # Verify OpenID response
    params = dict(request.query_params)
    
    # Simple validation: change mode to check_authentication
    validation_params = params.copy()
    validation_params["openid.mode"] = "check_authentication"
    
    response = requests.post(STEAM_OPENID_URL, data=validation_params, timeout=8)
    
    if "is_valid:true" in response.text:
        # Extract Steam ID from claimed_id (it's the last part of the URL)
        claimed_id = params.get("openid.claimed_id", "")
        steam_id = claimed_id.split("/")[-1]
        
        # Store Steam ID in session
        request.session["steam_id"] = steam_id
        
        # Fetch basic profile info
        profile_url = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
        profile_resp = requests.get(profile_url, params={"key": STEAM_API_KEY, "steamids": steam_id}, timeout=8)
        profile_data = profile_resp.json()
        
        if profile_data.get("response", {}).get("players"):
            request.session["user"] = profile_data["response"]["players"][0]
            
        return RedirectResponse(url="/")
    else:
        raise HTTPException(status_code=400, detail="Authentication failed")

@app.get("/api/auth/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/")

@app.get("/api/user/profile")
def get_user_profile(request: Request):
    user = request.session.get("user")
    if not user:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    return user

@app.get("/api/user/games/recent")
def get_recent_games(request: Request):
    steam_id = request.session.get("steam_id")
    if not steam_id:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    
    url = "https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/"
    resp = requests.get(url, params={"key": STEAM_API_KEY, "steamid": steam_id, "format": "json"}, timeout=8)
    return resp.json().get("response", {})

@app.get("/api/user/games/stats")
def get_user_game_stats(request: Request):
    steam_id = request.session.get("steam_id")
    if not steam_id:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    
    # Get owned games for stats
    url = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/"
    resp = requests.get(url, params={
        "key": STEAM_API_KEY, 
        "steamid": steam_id, 
        "include_appinfo": True, 
        "format": "json"
    }, timeout=12)
    data = resp.json().get("response", {})
    games = data.get("games", [])
    
    total_playtime = sum(g.get("playtime_forever", 0) for g in games)
    games_played = len([g for g in games if g.get("playtime_forever", 0) > 0])
    
    # Sort by playtime
    top_played = sorted(games, key=lambda x: x.get("playtime_forever", 0), reverse=True)[:5]
    
    # Fetch some achievements for each top game to show icons
    latest_achievements = {}
    for game in top_played[:3]:
        appid = game.get("appid")
        try:
            # Get schema for icons
            ach_url = "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/"
            ach_resp = requests.get(ach_url, params={"key": STEAM_API_KEY, "appid": appid}, timeout=5)
            
            # Get user status
            user_ach_map = {}
            if steam_id:
                user_ach_url = "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/"
                user_ach_resp = requests.get(user_ach_url, params={"key": STEAM_API_KEY, "steamid": steam_id, "appid": appid}, timeout=5)
                if user_ach_resp.status_code == 200:
                    user_ach_map = {a["apiname"]: a.get("achieved") == 1 for a in user_ach_resp.json().get("playerstats", {}).get("achievements", [])}

            if ach_resp.status_code == 200:
                raw_ach = ach_resp.json().get("game", {}).get("availableGameStats", {}).get("achievements", [])
                combined = []
                for ra in raw_ach[:8]: # Just get 8 for the grid
                    combined.append({
                        "icon": ra.get("icon"),
                        "unlocked": user_ach_map.get(ra.get("name"), False)
                    })
                latest_achievements[appid] = combined
        except Exception:
            continue

    return {
        "total_playtime_hours": round(total_playtime / 60, 1),
        "games_count": data.get("game_count", 0),
        "games_played": games_played,
        "top_played": top_played,
        "latest_achievements": latest_achievements
    }

@app.get("/api/games/sentiment/{appid}")
def get_game_sentiment(appid: int):
    # Fetch recent reviews to analyze sentiment
    url = f"https://store.steampowered.com/appreviews/{appid}?json=1&day_range=30&language=all"
    try:
        resp = requests.get(url, timeout=8)
        data = resp.json()
        query_summary = data.get("query_summary", {})
        
        total_reviews = query_summary.get("total_reviews", 0)
        positive_reviews = query_summary.get("total_positive", 0)
        
        sentiment_score = 0
        if total_reviews > 0:
            sentiment_score = round((positive_reviews / total_reviews) * 100)
            
        # Determine label
        label = "Mixed"
        color = "yellow"
        if sentiment_score >= 80:
            label = "Very Positive"
            color = "green"
        elif sentiment_score >= 70:
            label = "Mostly Positive"
            color = "green"
        elif sentiment_score < 40:
            label = "Negative"
            color = "red"
            
        return {
            "appid": appid,
            "sentiment_score": sentiment_score,
            "total_reviews": total_reviews,
            "label": label,
            "color": color
        }
    except Exception:
        return {"error": "Failed to fetch sentiment"}

@app.get("/api/games/deals")
def get_top_deals():
    cache = read_cache()
    if not cache:
        return {"deals": []}
    
    games = cache.get("games", [])
    # Filter games with discount > 0%
    deals = [g for g in games if g.get("discount_percent", 0) > 0]
    
    # Sort by discount percent
    deals = sorted(deals, key=lambda x: x.get("discount_percent", 0), reverse=True)
    
    # If no deals found (common when Steam API is rate limited), 
    # show some popular games as 'featured' to avoid empty screen
    if not deals and games:
        import random
        featured = random.sample(games, min(len(games), 12))
        return {"deals": featured, "is_featured": True}
    
    return {"deals": deals}

@app.get("/api/games/search")
def search_games(q: str = ""):
    cache = read_cache()
    if not cache:
        return {"games": []}
    
    games = cache.get("games", [])
    if not q:
        return {"games": games[:20]}
    
    # Simple case-insensitive search
    query = q.lower()
    results = [
        g for g in games 
        if query in g.get("name", "").lower() or query in g.get("genre", "").lower()
    ]
    
    return {"games": results}

@app.get("/api/steam/stats")
def get_steam_stats():
    # Fetch actual global steam stats if possible, or provide more realistic peaks
    try:
        # Steam provides current player count for "app 0" which is global
        url = "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/"
        resp = requests.get(url, params={"appid": 0}, timeout=8)
        data = resp.json()
        
        online_users = data.get("response", {}).get("player_count", 28500000)
        
        # We don't have a direct peak API, so we'll use the current + a buffer for demo
        # or just return the static peak if it's higher
        peak_24h = max(34649583, online_users + 2000000)
        
        return {
            "online_users": online_users,
            "peak_24h": peak_24h,
            "total_accounts": 1320000000
        }
    except Exception as e:
        print(f"Error fetching global stats: {e}")
        return {
            "online_users": 28500000,
            "peak_24h": 34649583,
            "total_accounts": 1320000000
        }

@app.get("/api/games/details/{appid}")
def get_detailed_game_info(appid: int, request: Request):
    try:
        # 1. Try to fetch fresh data from Steam Store
        store_data = fetch_steam_store_detail(appid)
        
        # 2. Try to fetch spy data (useful for fallback or additional info)
        spy = fetch_steamspy_detail(appid)
        
        # 3. If Steam API fails, fallback to our local cache
        cache_game = None
        if not store_data:
            cache = read_cache()
            if cache and "games" in cache:
                cache_game = next((g for g in cache["games"] if g["appid"] == appid), None)
            
            if not cache_game:
                return JSONResponse(status_code=404, content={"error": "ไม่พบข้อมูลเกมนี้ในระบบ"})
            
            # Use cache data as base
            store_data = {
                "name": cache_game.get("name"),
                "short_description": "ข้อมูลจากแคช (Steam API ไม่ตอบสนอง)",
                "header_image": cache_game.get("header_image"),
                "developers": [spy.get("developer")] if spy and spy.get("developer") else ["Unknown"],
                "publishers": [spy.get("publisher")] if spy and spy.get("publisher") else ["Unknown"],
                "release_date": {"date": "Unknown"}
            }

        # Get achievements with a shorter timeout and error handling
        achievements = []
        try:
            # 1. Get Schema (all possible achievements with icons)
            ach_url = "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/"
            ach_resp = requests.get(ach_url, params={"key": STEAM_API_KEY, "appid": appid}, timeout=5)
            
            # 2. Get User Status (which ones are unlocked)
            steam_id = request.session.get("steam_id")
            user_ach_map = {}
            if steam_id:
                try:
                    user_ach_url = "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/"
                    user_ach_resp = requests.get(user_ach_url, params={"key": STEAM_API_KEY, "steamid": steam_id, "appid": appid}, timeout=5)
                    if user_ach_resp.status_code == 200:
                        user_data = user_ach_resp.json()
                        user_ach_map = {a["apiname"]: a.get("achieved") == 1 for a in user_data.get("playerstats", {}).get("achievements", [])}
                except Exception as e:
                    print(f"User achievement status fetch error: {e}")

            if ach_resp.status_code == 200:
                ach_data = ach_resp.json()
                raw_achievements = ach_data.get("game", {}).get("availableGameStats", {}).get("achievements", [])
                
                # Combine schema with user status
                for ra in raw_achievements:
                    api_name = ra.get("name")
                    achievements.append({
                        "name": api_name,
                        "displayName": ra.get("displayName"),
                        "icon": ra.get("icon"),
                        "icongray": ra.get("icongray"),
                        "unlocked": user_ach_map.get(api_name, False)
                    })
        except Exception as e:
            print(f"Achievement fetch error: {e}")
        
        # Player count
        current_players = fetch_current_players(appid) or 0
        if cache_game and current_players == 0:
            current_players = cache_game.get("current_players") or 0
            
        history = [
            int(current_players * 0.8), 
            int(current_players * 0.9), 
            int(current_players * 1.1), 
            int(current_players * 0.95), 
            current_players
        ]
        
        # Format price for display
        price_display = None
        if store_data.get("price_overview"):
            price_display = store_data.get("price_overview")
        elif cache_game:
            final_price = cache_game.get("final_price")
            if final_price is not None and final_price > 0:
                price_display = {"final_formatted": f"฿{final_price:,.2f}"}
            elif cache_game.get("is_on_sale") is False and (final_price == 0 or final_price is None):
                price_display = None # Will show "เล่นฟรี" in frontend
        
        return {
            "appid": appid,
            "name": store_data.get("name"),
            "description": store_data.get("short_description") or store_data.get("description") or "ไม่มีรายละเอียด",
            "header_image": store_data.get("header_image"),
            "dlc_count": len(store_data.get("dlc", [])),
            "achievement_count": len(achievements),
            "achievements": achievements,
            "current_players": current_players,
            "player_history": history,
            "price": price_display,
            "developers": store_data.get("developers", []),
            "publishers": store_data.get("publishers", []),
            "release_date": store_data.get("release_date", {}).get("date", "ไม่ระบุ")
        }
    except Exception as e:
        print(f"Detail fetch error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/steam/status")
def get_steam_status():
    # In a real scenario, we would probe Steam's CM servers or use a service like SteamStat.us
    # For this demo, we'll check connectivity to main Steam domains.
    services = [
        {"name": "Steam Store", "url": "https://store.steampowered.com"},
        {"name": "Steam Community", "url": "https://steamcommunity.com"},
        {"name": "Steam Web API", "url": "https://api.steampowered.com"},
    ]
    
    status_results = []
    for service in services:
        try:
            resp = requests.get(service["url"], timeout=3)
            status = "online" if resp.status_code < 400 else "delayed"
        except Exception:
            status = "offline"
        
        status_results.append({
            "service": service["name"],
            "status": status
        })
    
    return {"services": status_results}

@app.get("/api/health")
def health() -> Dict[str, Any]:
    cache = read_cache()
    age = cache_age_seconds(cache) if cache else None
    return {"ok": True, "has_cache": cache is not None, "cache_age_seconds": age}


@app.post("/api/refresh")
def refresh(top_n: int = 50) -> Dict[str, Any]:
    try:
        payload = fetch_and_write(top_n=top_n)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return payload


@app.get("/api/games")
async def games() -> JSONResponse:
    start = time.perf_counter()
    try:
        # Fast load: Read only basic info for main dashboard
        cache = read_cache()
        if not cache or "games" not in cache:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            logger.info("api_games cache=missing duration_ms=%.1f", elapsed_ms)
            return JSONResponse(
                status_code=200,
                content={"generated_at": None, "count": 0, "games": [], "message": "Cache not found"},
            )
        
        # Optimize: Only send required fields for the list view to reduce payload size
        minimal_games = []
        for g in cache.get("games", []):
            final_price = g.get("final_price")
            price_currency = g.get("price_currency", "THB")
            
            # Formatted price for cards
            price_formatted = "0.00"
            if final_price is not None and final_price > 0:
                price_formatted = f"฿{final_price:,.2f}"
            elif g.get("discount_percent", 0) == 0:
                price_formatted = "Free"
            
            minimal_games.append({
                "appid": g.get("appid"),
                "name": g.get("name", "Unknown Game"),
                "genre": g.get("genre", "Unknown"),
                "header_image": g.get("header_image", ""),
                "current_players": g.get("current_players", 0),
                "discount_percent": g.get("discount_percent", 0),
                "rating": g.get("rating", 0),
                "final_price": final_price,
                "price_formatted": price_formatted,
                "price_currency": price_currency
            })
            
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        logger.info("api_games cache=hit count=%d duration_ms=%.1f", len(minimal_games), elapsed_ms)
        return JSONResponse(content={
            "generated_at": cache.get("generated_at"),
            "count": len(minimal_games),
            "games": minimal_games
        })
    except Exception as e:
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        logger.exception("api_games_failed duration_ms=%.1f", elapsed_ms)
        return JSONResponse(
            status_code=200,
            content={"generated_at": None, "count": 0, "games": [], "error": str(e)},
        )

@app.get("/api/steam/yearly-stats")
def get_yearly_stats():
    cache = read_cache()
    current_year = datetime.now().year
    target_years = range(current_year - 4, current_year + 1)
    
    yearly_data = {}
    for year in target_years:
        # ใส่ข้อมูลพื้นฐานไว้ก่อน (Baseline) เพื่อให้กราฟไม่ว่าง
        # ในระบบจริงข้อมูลนี้จะถูกบวกเพิ่มจาก Cache
        yearly_data[str(year)] = {"revenue": 0.0, "sales": 0, "count": 0}

    if cache and "games" in cache:
        games = cache.get("games", [])
        for g in games:
            rel_date = str(g.get("release_date", "Unknown"))
            try:
                year_str = None
                # พยายามหาปีจากข้อความวันที่ (เช่น "2023", "23")
                for y in target_years:
                    if str(y) in rel_date:
                        year_str = str(y)
                        break
                
                if year_str:
                    # คำนวณรายได้โดยประมาณ: (ราคา * ยอดเจ้าของเฉลี่ย)
                    owners_raw = str(g.get("owners", "0")).replace(",", "").replace(" ", "")
                    avg_owners = 0
                    if ".." in owners_raw:
                        low, high = owners_raw.split("..")
                        avg_owners = (float(low) + float(high)) / 2
                    else:
                        avg_owners = float(owners_raw or 0)
                    
                    price = float(g.get("final_price") or 0)
                    # ถ้าเป็นเกมฟรี ให้ตีเป็นรายได้จาก Microtransactions เล็กน้อยเพื่อใช้ในกราฟ
                    if price == 0: price = 0.5 
                    
                    est_revenue = avg_owners * price
                    
                    yearly_data[year_str]["revenue"] += est_revenue
                    yearly_data[year_str]["sales"] += int(avg_owners)
                    yearly_data[year_str]["count"] += 1
            except Exception:
                continue

    # ถ้าหลังคำนวณแล้วยังเป็น 0 (เช่น Cache ยังไม่มีข้อมูล)
    # ให้ใส่ข้อมูลสถิติตลาด Steam โดยประมาณเพื่อให้กราฟแสดงผลสวยงาม
    if sum(v["revenue"] for v in yearly_data.values()) == 0:
        mock_multiplier = [0.7, 0.85, 1.2, 1.5, 1.3] # เทรนด์รายได้
        for i, year in enumerate(target_years):
            y_str = str(year)
            yearly_data[y_str]["revenue"] = 4500000000 * mock_multiplier[i]
            yearly_data[y_str]["sales"] = int(12000000 * mock_multiplier[i])
            yearly_data[y_str]["game_count"] = int(800 * mock_multiplier[i])
            
    # Format for frontend
    result = []
    for year in sorted(yearly_data.keys()):
        result.append({
            "year": year,
            "revenue": round(yearly_data[year]["revenue"], 2),
            "sales": yearly_data[year]["sales"],
            "game_count": yearly_data[year]["count"]
        })
        
    return {"stats": result}

@app.get("/api/games/reviews/{appid}")
def get_game_reviews(appid: int):
    try:
        # Fetch recent reviews (json=1 for machine readable)
        url = f"https://store.steampowered.com/appreviews/{appid}?json=1&language=all&num_per_page=10"
        resp = requests.get(url, timeout=8)
        data = resp.json()

        author_ids: List[str] = []
        for r in data.get("reviews", []):
            sid = r.get("author", {}).get("steamid")
            if sid and sid not in author_ids:
                author_ids.append(sid)

        author_profiles: Dict[str, Dict[str, Any]] = {}
        if author_ids:
            try:
                summaries_url = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
                sum_resp = requests.get(
                    summaries_url,
                    params={"key": STEAM_API_KEY, "steamids": ",".join(author_ids[:100])},
                    timeout=8,
                )
                if sum_resp.status_code == 200:
                    players = sum_resp.json().get("response", {}).get("players", [])
                    for p in players:
                        sid = p.get("steamid")
                        if not sid:
                            continue
                        author_profiles[sid] = {
                            "personaname": p.get("personaname"),
                            "avatar": p.get("avatar"),
                            "avatarfull": p.get("avatarfull"),
                            "profileurl": p.get("profileurl"),
                        }
            except Exception:
                author_profiles = {}
        
        reviews = []
        for r in data.get("reviews", []):
            author_steamid = r.get("author", {}).get("steamid")
            author_profile = author_profiles.get(author_steamid or "", {})
            reviews.append({
                "recommendation_id": r.get("recommendationid"),
                "author": author_steamid,
                "author_name": author_profile.get("personaname"),
                "author_avatar": author_profile.get("avatarfull") or author_profile.get("avatar"),
                "author_profileurl": author_profile.get("profileurl"),
                "review_text": r.get("review"),
                "voted_up": r.get("voted_up"), # True for Positive/Like, False for Negative/Dislike
                "votes_up": r.get("votes_up"),
                "playtime_forever": r.get("author", {}).get("playtime_forever")
            })
            
        return {
            "reviews": reviews, 
            "summary": data.get("query_summary"),
            "review_score_desc": data.get("query_summary", {}).get("review_score_desc"),
            "total_positive": data.get("query_summary", {}).get("total_positive"),
            "total_reviews": data.get("query_summary", {}).get("total_reviews")
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/user/friends/stats/{steam_id}")
def get_friend_game_stats(steam_id: str):
    try:
        # Get owned games for stats
        url = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/"
        resp = requests.get(url, params={
            "key": STEAM_API_KEY, 
            "steamid": steam_id, 
            "include_appinfo": True, 
            "format": "json"
        }, timeout=12)
        data = resp.json().get("response", {})
        games = data.get("games", [])
        
        if not games:
            return JSONResponse(status_code=404, content={"error": "ไม่พบข้อมูลเกม (โปรไฟล์อาจเป็นส่วนตัว)"})

        total_playtime = sum(g.get("playtime_forever", 0) for g in games)
        games_played = len([g for g in games if g.get("playtime_forever", 0) > 0])
        
        # Sort by playtime
        top_played = sorted(games, key=lambda x: x.get("playtime_forever", 0), reverse=True)[:5]
        
        return {
            "total_playtime_hours": round(total_playtime / 60, 1),
            "games_count": data.get("game_count", 0),
            "games_played": games_played,
            "top_played": top_played
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/user/friends")
def get_user_friends(request: Request):
    steam_id = request.session.get("steam_id")
    if not steam_id:
        return JSONResponse(status_code=401, content={"error": "Not authenticated"})
    
    try:
        # 1. Get friend list (IDs)
        friends_list_url = "https://api.steampowered.com/ISteamUser/GetFriendList/v1/"
        resp = requests.get(friends_list_url, params={"key": STEAM_API_KEY, "steamid": steam_id, "relationship": "friend"}, timeout=8)
        friends_data = resp.json()
        
        friend_ids = [f["steamid"] for f in friends_data.get("friendslist", {}).get("friends", [])]
        if not friend_ids:
            return {"friends": []}
            
        # 2. Get summaries for those IDs (max 100 at a time)
        summaries_url = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
        sum_resp = requests.get(summaries_url, params={"key": STEAM_API_KEY, "steamids": ",".join(friend_ids[:100])}, timeout=8)
        sum_data = sum_resp.json()
        
        return {"friends": sum_data.get("response", {}).get("players", [])}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/user/search/{query}")
def search_user(query: str):
    try:
        # 1. Try to see if it's a SteamID64 (17 digits)
        steam_id = None
        if query.isdigit() and len(query) == 17:
            steam_id = query
        else:
            # 2. Try to resolve vanity URL
            resolve_url = "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/"
            resp = requests.get(resolve_url, params={"key": STEAM_API_KEY, "vanityurl": query}, timeout=8)
            data = resp.json()
            if data.get("response", {}).get("success") == 1:
                steam_id = data["response"]["steamid"]
        
        if not steam_id:
            return JSONResponse(status_code=404, content={"error": "ไม่พบผู้ใช้ Steam นี้ (ลองใช้ SteamID64 หรือชื่อใน URL โปรไฟล์)"})

        # 3. Fetch profile summary
        profile_url = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
        profile_resp = requests.get(profile_url, params={"key": STEAM_API_KEY, "steamids": steam_id}, timeout=8)
        profile_data = profile_resp.json()
        
        players = profile_data.get("response", {}).get("players", [])
        if not players:
            return JSONResponse(status_code=404, content={"error": "ไม่พบข้อมูลโปรไฟล์"})
            
        return players[0]
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

# Serve files from the build root (manifest.json, favicon.ico, etc.)
@app.get("/{file_path:path}")
async def serve_build_root(file_path: str):
    file = FRONTEND_BUILD_DIR / file_path
    if file.exists() and file.is_file():
        return FileResponse(str(file))
    # If not a file, return index.html for React routing
    return FileResponse(str(FRONTEND_BUILD_DIR / "index.html"))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)
