import time
import asyncio
import logging
import aiohttp
from typing import Optional, Any

from config import (
    API_1C_URL,
    API_1C_USER,
    API_1C_PASS,
    CACHE_TTL,
    PAGE_SIZE,
    API_1C_TIMEOUT
)
from db import sync_1c_products

logger = logging.getLogger(__name__)

# In-memory cache storage for 1C responses
_cache_data: Optional[Any] = None
_cache_time: float = 0.0
_cache_lock = asyncio.Lock()

NGROK_INSTRUCTION_GUIDE = """
========================================================================
[1C INTEGRATION GUIDE - NGROK / EXTERNAL TUNNEL SETUP]
Server 1C ning localhost:8080 manziliga ulana olmadi yoki 404 qaytdi.
Sababi: Backend bulutli serverda (Render, Vercel, VPS) ishlayotgan bo'lsa,
'localhost' bulut serverining o'zini bildiradi (1C o'rnatilgan kompyuterni emas).
Shuningdek, 1C da nashr qilingan (published) baza nomi va servis yo'li registrga sezgir (case-sensitive).

1C ni to'g'ri ulash bo'yicha qo'llanma:
1. 1C dasturi ishlayotgan kompyuterda terminal ochib Ngrok ni ishga tushiring:
   ngrok http 8080
2. Ngrok taqdim etgan HTTPS manzilni nusxalang (masalan: https://xxxx.ngrok-free.app).
3. .env fayliga yoki Render/Vercel Environment Variables ga to'liq va aniq yo'lni yozing:
   API_1C_URL=https://xxxx.ngrok-free.app/Bozorcham/hs/Bozorcham/GetTovarList
   API_1C_USER=mobiles
   API_1C_PASS=123
4. Eslatma: 1C Enterprise da HTTP Service nomi (/hs/Bozorcham/GetTovarList) katta-kichik harflar bilan to'liq bir xil bo'lishi shart!
5. Mini App Admin panelida '⚡️ 1C Sinxronlash' tugmasini bosing.
========================================================================
"""


def is_localhost_url(url: str) -> bool:
    """Checks if the given URL points to a local loopback address."""
    if not url:
        return False
    u = url.lower().strip()
    return "localhost" in u or "127.0.0.1" in u or "0.0.0.0" in u or "::1" in u


def get_1c_cache_status() -> dict:
    """Returns current cache status and remaining TTL in seconds."""
    global _cache_data, _cache_time
    now = time.time()
    age = now - _cache_time
    is_valid = (_cache_data is not None) and (age < CACHE_TTL)
    return {
        "has_cache": _cache_data is not None,
        "is_valid": is_valid,
        "cache_age_seconds": int(age) if _cache_data is not None else None,
        "remaining_ttl_seconds": max(0, int(CACHE_TTL - age)) if is_valid else 0,
        "cache_ttl": CACHE_TTL,
        "api_url_configured": bool(API_1C_URL),
        "is_localhost": is_localhost_url(API_1C_URL)
    }


def get_1c_config_status() -> dict:
    """Returns active 1C configuration status for the Admin Panel display."""
    return {
        "api_url": API_1C_URL or "",
        "api_user": API_1C_USER or "mobiles",
        "has_password": bool(API_1C_PASS),
        "is_localhost": is_localhost_url(API_1C_URL),
        "is_configured": bool(API_1C_URL and API_1C_URL.strip()),
        "cache": get_1c_cache_status()
    }


def clear_1c_cache():
    """Manually clears the 1C in-memory cache."""
    global _cache_data, _cache_time
    _cache_data = None
    _cache_time = 0.0


async def fetch_1c_products(force_refresh: bool = False, timeout_seconds: Optional[int] = None) -> dict:
    """
    Asynchronously fetches product catalog from 1C HTTP Service.
    Uses HTTP Basic Authentication, SSL bypass for local/ngrok tunnels,
    ngrok warning bypass headers, and in-memory TTL caching.
    Returns graceful error dictionary with helpful instructions instead of crashing.
    """
    global _cache_data, _cache_time

    eff_timeout = timeout_seconds or API_1C_TIMEOUT or 20

    # 1. Check in-memory cache if not forcing refresh
    now = time.time()
    if not force_refresh and _cache_data is not None:
        if (now - _cache_time) < CACHE_TTL:
            logger.info(f"Returning cached 1C response (age: {int(now - _cache_time)}s / TTL: {CACHE_TTL}s)")
            return {
                "success": True,
                "cached": True,
                "data": _cache_data,
                "cache_age": int(now - _cache_time)
            }

    # 2. Check 1C URL configuration
    if not API_1C_URL or not API_1C_URL.strip():
        warning_msg = "1C serverining tashqi IP/Ngrok manzili ko'rsatilmagan. .env faylida API_1C_URL ni sozlang (masalan: https://xxxx.ngrok-free.app/Bozorcham/hs/Bozorcham/GetTovarList)."
        print(NGROK_INSTRUCTION_GUIDE)
        logger.warning(warning_msg)
        return {
            "success": False,
            "error": warning_msg,
            "instruction": NGROK_INSTRUCTION_GUIDE,
            "data": None
        }

    # 3. Setup HTTP Basic Authentication
    auth = None
    if API_1C_USER and API_1C_PASS:
        auth = aiohttp.BasicAuth(login=API_1C_USER, password=API_1C_PASS)

    # 4. Headers with ngrok / tunnel warning bypass and standard User-Agent
    headers = {
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "BozorchaBot/1.0",
        "Accept": "application/json, application/xml, text/plain, */*",
        "Bypass-Tunnel-Reminder": "true",
        "X-Requested-With": "XMLHttpRequest"
    }

    timeout = aiohttp.ClientTimeout(total=eff_timeout)
    # Allow self-signed certificates or HTTPS tunnels without strict SSL rejection
    connector = aiohttp.TCPConnector(ssl=False)

    async with _cache_lock:
        # Double-check cache after acquiring lock
        now = time.time()
        if not force_refresh and _cache_data is not None:
            if (now - _cache_time) < CACHE_TTL:
                return {
                    "success": True,
                    "cached": True,
                    "data": _cache_data,
                    "cache_age": int(now - _cache_time)
                }

        try:
            # Diagnostics log
            print(f"Requesting 1C URL: {API_1C_URL}")
            logger.info(f"Requesting 1C URL: {API_1C_URL}")

            async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
                async with session.get(API_1C_URL, auth=auth, headers=headers) as response:
                    status = response.status

                    if status == 200:
                        content_type = response.headers.get("Content-Type", "").lower()
                        raw_data = None

                        if "application/json" in content_type:
                            try:
                                raw_data = await response.json()
                            except Exception:
                                raw_text = await response.text()
                                raw_data = raw_text
                        else:
                            raw_text = await response.text()
                            raw_data = raw_text

                        # Log raw response for debugging
                        print("1C RAW RESPONSE:", raw_data)
                        logger.info(f"1C RAW RESPONSE: {raw_data}")

                        # Update in-memory cache
                        _cache_data = raw_data
                        _cache_time = time.time()

                        return {
                            "success": True,
                            "cached": False,
                            "data": raw_data,
                            "status_code": status
                        }
                    elif status in (401, 403):
                        err_text = await response.text()
                        warning_msg = f"1C logini yoki paroli xato (401 Basic Auth). API_1C_USER va API_1C_PASS ni tekshiring."
                        logger.warning(f"1C Auth Error ({status}): {warning_msg}")
                        return {
                            "success": False,
                            "error": warning_msg,
                            "detail": err_text[:200],
                            "status_code": status,
                            "data": None
                        }
                    elif status == 404:
                        err_text = await response.text()
                        warning_msg = f"1C HTTP xizmati manzili xato (404). 1C-da nashr qilingan (published) xizmat nomi va URL yo'lini tekshiring: {API_1C_URL}"
                        print(NGROK_INSTRUCTION_GUIDE)
                        logger.warning(f"1C 404 Not Found: {warning_msg}")
                        return {
                            "success": False,
                            "error": warning_msg,
                            "detail": err_text[:200],
                            "status_code": 404,
                            "instruction": NGROK_INSTRUCTION_GUIDE,
                            "data": None
                        }
                    else:
                        err_text = await response.text()
                        warning_msg = f"1C serveridan xato javob qaytdi (HTTP {status}): {err_text[:200]}"
                        logger.warning(warning_msg)
                        return {
                            "success": False,
                            "error": warning_msg,
                            "status_code": status,
                            "data": None
                        }

        except aiohttp.ClientConnectorError as e:
            if is_localhost_url(API_1C_URL):
                error_msg = "1C serverining tashqi IP/Ngrok manzili noto'g'ri ko'rsatilgan. Cloud server (Render/Vercel) localhost ga ulana olmaydi. .env fayliga Ngrok tunnel manzilini yozing (masalan: API_1C_URL=https://xyz.ngrok-free.app/Bozorcham/hs/Bozorcham/GetTovarList)."
                print(NGROK_INSTRUCTION_GUIDE)
            else:
                error_msg = f"1C serveriga ({API_1C_URL}) ulanib bo'lmadi. Ngrok tunnel yoniqligini va 1C dasturi ishlayotganini tekshiring."

            logger.warning(f"1C Connection Error: {error_msg} | Detail: {str(e)}")
            return {
                "success": False,
                "error": error_msg,
                "detail": str(e),
                "instruction": NGROK_INSTRUCTION_GUIDE,
                "data": None
            }
        except asyncio.TimeoutError:
            if is_localhost_url(API_1C_URL):
                error_msg = "1C serverining tashqi IP/Ngrok manzili noto'g'ri ko'rsatilgan. Cloud server (Render/Vercel) localhost ga ulana olmaydi. .env fayliga Ngrok tunnel manzilini yozing (masalan: API_1C_URL=https://xyz.ngrok-free.app/Bozorcham/hs/Bozorcham/GetTovarList)."
                print(NGROK_INSTRUCTION_GUIDE)
            else:
                error_msg = f"1C serveridan javob kelishi vaqti tugadi ({eff_timeout}s). 1C kompyuteri yoki Ngrok tunnel tezligini tekshiring."

            logger.warning(error_msg)
            return {
                "success": False,
                "error": error_msg,
                "instruction": NGROK_INSTRUCTION_GUIDE,
                "data": None
            }
        except Exception as e:
            error_msg = f"1C HTTP xizmati bilan aloqada kutilmagan xatolik: {str(e)}"
            logger.error(error_msg, exc_info=True)
            return {
                "success": False,
                "error": error_msg,
                "instruction": NGROK_INSTRUCTION_GUIDE,
                "data": None
            }


async def sync_products_from_1c(force_refresh: bool = True) -> dict:
    """
    Fetches latest products from 1C and upserts into local database.
    Uncategorized items receive category_id = None.
    """
    fetch_res = await fetch_1c_products(force_refresh=force_refresh)

    if not fetch_res.get("success"):
        return {
            "success": False,
            "message": fetch_res.get("error", "1C dan ma'lumot olib bo'lmadi"),
            "detail": fetch_res.get("detail") or fetch_res.get("error"),
            "instruction": fetch_res.get("instruction"),
            "status_code": fetch_res.get("status_code", 502)
        }

    raw_data = fetch_res.get("data")
    sync_result = sync_1c_products(raw_data)
    sync_result["cached"] = fetch_res.get("cached", False)
    if "cache_age" in fetch_res:
        sync_result["cache_age"] = fetch_res["cache_age"]

    return sync_result
