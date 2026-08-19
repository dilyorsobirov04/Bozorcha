import os
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

# Mutable runtime configuration (initialized from config.py / environment variables)
_runtime_config = {
    "api_1c_url": API_1C_URL,
    "api_1c_user": API_1C_USER,
    "api_1c_pass": API_1C_PASS,
    "cache_ttl": CACHE_TTL,
    "timeout": API_1C_TIMEOUT
}

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
3. Admin panelida yoki .env faylida to'liq va aniq yo'lni yozing:
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


def get_active_1c_url() -> str:
    """Returns currently active 1C URL from runtime config."""
    return _runtime_config.get("api_1c_url", "").strip()


def get_active_1c_user() -> str:
    return _runtime_config.get("api_1c_user", "mobiles").strip()


def get_active_1c_pass() -> str:
    return _runtime_config.get("api_1c_pass", "123").strip()


def persist_1c_settings_to_env(api_url: str, api_user: str = "", api_pass: str = ""):
    """Persists 1C settings into .env file if available."""
    try:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
        if not os.path.exists(env_path):
            return

        with open(env_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        new_lines = []
        found_url = False
        found_user = False
        found_pass = False

        for line in lines:
            if line.strip().startswith("API_1C_URL="):
                new_lines.append(f"API_1C_URL={api_url}\n")
                found_url = True
            elif line.strip().startswith("API_1C_USER=") and api_user:
                new_lines.append(f"API_1C_USER={api_user}\n")
                found_user = True
            elif line.strip().startswith("API_1C_PASS=") and api_pass:
                new_lines.append(f"API_1C_PASS={api_pass}\n")
                found_pass = True
            else:
                new_lines.append(line)

        if not found_url:
            new_lines.append(f"API_1C_URL={api_url}\n")
        if not found_user and api_user:
            new_lines.append(f"API_1C_USER={api_user}\n")
        if not found_pass and api_pass:
            new_lines.append(f"API_1C_PASS={api_pass}\n")

        with open(env_path, "w", encoding="utf-8") as f:
            f.writelines(new_lines)
    except Exception as e:
        logger.warning(f"Could not persist 1C settings to .env: {e}")


def update_1c_config(api_url: Optional[str] = None, api_user: Optional[str] = None, api_pass: Optional[str] = None) -> dict:
    """Updates runtime 1C settings dynamically without requiring backend restart."""
    global _runtime_config
    if api_url is not None:
        _runtime_config["api_1c_url"] = str(api_url).strip()
        clear_1c_cache()
    if api_user is not None:
        _runtime_config["api_1c_user"] = str(api_user).strip()
    if api_pass is not None:
        _runtime_config["api_1c_pass"] = str(api_pass).strip()

    # Persist to .env
    persist_1c_settings_to_env(
        _runtime_config["api_1c_url"],
        _runtime_config["api_1c_user"],
        _runtime_config["api_1c_pass"]
    )

    return get_1c_config_status()


def get_1c_cache_status() -> dict:
    """Returns current cache status and remaining TTL in seconds."""
    global _cache_data, _cache_time
    now = time.time()
    age = now - _cache_time
    ttl = _runtime_config.get("cache_ttl", CACHE_TTL)
    is_valid = (_cache_data is not None) and (age < ttl)
    active_url = get_active_1c_url()
    return {
        "has_cache": _cache_data is not None,
        "is_valid": is_valid,
        "cache_age_seconds": int(age) if _cache_data is not None else None,
        "remaining_ttl_seconds": max(0, int(ttl - age)) if is_valid else 0,
        "cache_ttl": ttl,
        "api_url_configured": bool(active_url),
        "is_localhost": is_localhost_url(active_url)
    }


def get_1c_config_status() -> dict:
    """Returns active 1C configuration status for Admin Panel display and editing."""
    active_url = get_active_1c_url()
    active_user = get_active_1c_user()
    active_pass = get_active_1c_pass()
    return {
        "api_url": active_url,
        "api_user": active_user,
        "has_password": bool(active_pass),
        "is_localhost": is_localhost_url(active_url),
        "is_configured": bool(active_url),
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
    ngrok warning bypass headers, User-Agent Mozilla/5.0, Accept application/json,
    and in-memory TTL caching.
    """
    global _cache_data, _cache_time

    active_url = get_active_1c_url()
    active_user = get_active_1c_user()
    active_pass = get_active_1c_pass()
    ttl = _runtime_config.get("cache_ttl", CACHE_TTL)
    eff_timeout = timeout_seconds or _runtime_config.get("timeout", API_1C_TIMEOUT) or 20

    # 1. Check in-memory cache if not forcing refresh
    now = time.time()
    if not force_refresh and _cache_data is not None:
        if (now - _cache_time) < ttl:
            logger.info(f"Returning cached 1C response (age: {int(now - _cache_time)}s / TTL: {ttl}s)")
            return {
                "success": True,
                "cached": True,
                "data": _cache_data,
                "cache_age": int(now - _cache_time)
            }

    # 2. Check 1C URL configuration
    if not active_url:
        warning_msg = "1C serverining tashqi IP/Ngrok manzili ko'rsatilmagan. Admin panelida yoki .env faylida API_1C_URL ni sozlang (masalan: https://xxxx.ngrok-free.app/Bozorcham/hs/Bozorcham/GetTovarList)."
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
    if active_user and active_pass:
        auth = aiohttp.BasicAuth(login=active_user, password=active_pass)

    # 4. Required headers
    headers = {
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json",
        "Bypass-Tunnel-Reminder": "true",
        "X-Requested-With": "XMLHttpRequest"
    }

    timeout = aiohttp.ClientTimeout(total=eff_timeout)
    connector = aiohttp.TCPConnector(ssl=False)

    async with _cache_lock:
        # Double-check cache after acquiring lock
        now = time.time()
        if not force_refresh and _cache_data is not None:
            if (now - _cache_time) < ttl:
                return {
                    "success": True,
                    "cached": True,
                    "data": _cache_data,
                    "cache_age": int(now - _cache_time)
                }

        try:
            # Diagnostics log
            print(f"Requesting 1C URL: {active_url}")
            logger.info(f"Requesting 1C URL: {active_url}")

            async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
                async with session.get(active_url, auth=auth, headers=headers) as response:
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
                        warning_msg = "1C logini yoki paroli xato (401 Basic Auth). API_1C_USER va API_1C_PASS ni tekshiring."
                        print(f"1C Auth Error at: {active_url}")
                        logger.warning(f"1C Auth Error ({status}) at {active_url}: {warning_msg}")
                        return {
                            "success": False,
                            "error": warning_msg,
                            "detail": err_text[:200],
                            "status_code": status,
                            "data": None
                        }
                    elif status == 404:
                        err_text = await response.text()
                        warning_msg = "1C HTTP xizmati topilmadi (404). Kiritilgan URL va 1C Nashr qilingan xizmat nomini (Case-Sensitive) tekshiring."
                        print(f"1C 404 Not Found at URL: {active_url}")
                        logger.warning(f"1C 404 Not Found at URL: {active_url}")
                        print(NGROK_INSTRUCTION_GUIDE)
                        return {
                            "success": False,
                            "error": warning_msg,
                            "url": active_url,
                            "detail": err_text[:200],
                            "status_code": 404,
                            "instruction": NGROK_INSTRUCTION_GUIDE,
                            "data": None
                        }
                    else:
                        err_text = await response.text()
                        warning_msg = f"1C serveridan xato javob qaytdi (HTTP {status}): {err_text[:200]}"
                        logger.warning(f"1C Error ({status}) at {active_url}: {warning_msg}")
                        return {
                            "success": False,
                            "error": warning_msg,
                            "status_code": status,
                            "data": None
                        }

        except aiohttp.ClientConnectorError as e:
            if is_localhost_url(active_url):
                error_msg = "1C serverining tashqi IP/Ngrok manzili noto'g'ri ko'rsatilgan. Cloud server (Render/Vercel) localhost ga ulana olmaydi. Admin panelida Ngrok tunnel manzilini yozing (masalan: https://xyz.ngrok-free.app/Bozorcham/hs/Bozorcham/GetTovarList)."
                print(NGROK_INSTRUCTION_GUIDE)
            else:
                error_msg = f"1C serveriga ({active_url}) ulanib bo'lmadi. Ngrok tunnel yoniqligini va 1C dasturi ishlayotganini tekshiring."

            logger.warning(f"1C Connection Error at {active_url}: {error_msg} | Detail: {str(e)}")
            return {
                "success": False,
                "error": error_msg,
                "detail": str(e),
                "instruction": NGROK_INSTRUCTION_GUIDE,
                "data": None
            }
        except asyncio.TimeoutError:
            if is_localhost_url(active_url):
                error_msg = "1C serverining tashqi IP/Ngrok manzili noto'g'ri ko'rsatilgan. Cloud server (Render/Vercel) localhost ga ulana olmaydi. Admin panelida Ngrok tunnel manzilini yozing (masalan: https://xyz.ngrok-free.app/Bozorcham/hs/Bozorcham/GetTovarList)."
                print(NGROK_INSTRUCTION_GUIDE)
            else:
                error_msg = f"1C serveridan javob kelishi vaqti tugadi ({eff_timeout}s). 1C kompyuteri yoki Ngrok tunnel tezligini tekshiring."

            logger.warning(f"1C Timeout at {active_url}: {error_msg}")
            return {
                "success": False,
                "error": error_msg,
                "instruction": NGROK_INSTRUCTION_GUIDE,
                "data": None
            }
        except Exception as e:
            error_msg = f"1C HTTP xizmati bilan aloqada kutilmagan xatolik: {str(e)}"
            logger.error(f"1C Unexpected error at {active_url}: {error_msg}", exc_info=True)
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
