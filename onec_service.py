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
    PAGE_SIZE
)
from db import sync_1c_products

logger = logging.getLogger(__name__)

# In-memory cache storage for 1C responses
_cache_data: Optional[Any] = None
_cache_time: float = 0.0
_cache_lock = asyncio.Lock()


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
        "cache_ttl": CACHE_TTL
    }


def clear_1c_cache():
    """Manually clears the 1C in-memory cache."""
    global _cache_data, _cache_time
    _cache_data = None
    _cache_time = 0.0


async def fetch_1c_products(force_refresh: bool = False, timeout_seconds: int = 10) -> dict:
    """
    Asynchronously fetches product catalog from 1C HTTP Service.
    Uses HTTP Basic Authentication and in-memory TTL caching.
    Returns graceful error dictionary instead of crashing if 1C is offline.
    """
    global _cache_data, _cache_time

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
        warning_msg = "API_1C_URL konfiguratsiyada ko'rsatilmagan (.env faylini tekshiring)"
        logger.warning(warning_msg)
        return {
            "success": False,
            "error": warning_msg,
            "data": None
        }

    # 3. Setup HTTP Basic Authentication
    auth = None
    if API_1C_USER and API_1C_PASS:
        auth = aiohttp.BasicAuth(login=API_1C_USER, password=API_1C_PASS)

    headers = {
        "Accept": "application/json, application/xml, text/plain, */*",
        "User-Agent": "Bozorcha-App/1.0"
    }

    timeout = aiohttp.ClientTimeout(total=timeout_seconds)

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
            logger.info(f"Connecting to 1C HTTP Service at: {API_1C_URL}")
            async with aiohttp.ClientSession(timeout=timeout) as session:
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

                        # Log raw response for debugging as requested
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
            error_msg = f"1C serveriga ulanib bo'lmadi ({API_1C_URL}): Server o'chiq yoki tarmoqda xatolik ({str(e)})"
            logger.warning(error_msg)
            return {
                "success": False,
                "error": error_msg,
                "data": None
            }
        except asyncio.TimeoutError:
            error_msg = f"1C serveriga ulanish vaqti tugadi (Timeout {timeout_seconds}s)"
            logger.warning(error_msg)
            return {
                "success": False,
                "error": error_msg,
                "data": None
            }
        except Exception as e:
            error_msg = f"1C HTTP xizmati bilan aloqada kutilmagan xatolik: {str(e)}"
            logger.error(error_msg, exc_info=True)
            return {
                "success": False,
                "error": error_msg,
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
            "detail": fetch_res.get("error"),
            "status_code": fetch_res.get("status_code", 502)
        }

    raw_data = fetch_res.get("data")
    sync_result = sync_1c_products(raw_data)
    sync_result["cached"] = fetch_res.get("cached", False)
    if "cache_age" in fetch_res:
        sync_result["cache_age"] = fetch_res["cache_age"]

    return sync_result
