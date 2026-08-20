import os
import re
import json
import base64
import time
import asyncio
import logging
import aiohttp
from typing import Optional, Any

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from db import (
    sync_1c_products,
    get_uncategorized_products,
    get_system_setting,
    set_system_setting,
    get_1c_system_settings,
    update_1c_system_settings
)

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
3. Admin panelida yoki .env faylida to'liq va aniq yo'lni yozing:
   API_1C_URL=https://xxxx.ngrok-free.app/Bozorcham/hs/Bozorcham/GetTovarList
   API_1C_USER=mobiles
   API_1C_PASS=123
4. Eslatma: 1C Enterprise da HTTP Service nomi (/hs/Bozorcham/GetTovarList) katta-kichik harflar bilan to'liq bir xil bo'lishi shart!
5. Mini App Admin panelida '⚡️ 1C Sinxronlash' tugmasini bosing.
========================================================================
"""


DEFAULT_1C_URL = "https://wreath-paddling-precook.ngrok-free.dev/Bozorcham/hs/Bozorcham/GetTovarList"


def resolve_dynamic_ngrok_url_sync() -> Optional[str]:
    """
    Queries local Ngrok API (http://127.0.0.1:4040/api/tunnels) to fetch the active public tunnel URL automatically.
    Updates API_1C_URL dynamically so the backend always points to the live Ngrok endpoint.
    """
    import urllib.request
    try:
        req = urllib.request.Request("http://127.0.0.1:4040/api/tunnels", headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            if resp.status == 200:
                body = resp.read().decode("utf-8")
                data = json.loads(body)
                tunnels = data.get("tunnels", [])
                base_url = None
                for t in tunnels:
                    pub = t.get("public_url", "")
                    if pub.startswith("https://"):
                        base_url = pub
                        break
                    elif pub.startswith("http://") and not base_url:
                        base_url = pub
                if base_url:
                    full_1c_url = f"{base_url.rstrip('/')}/Bozorcham/hs/Bozorcham/GetTovarList"
                    update_1c_config(api_url=full_1c_url)
                    logger.info(f"🚀 Auto-resolved active Ngrok tunnel URL: {full_1c_url}")
                    print(f"🚀 Auto-resolved active Ngrok tunnel URL: {full_1c_url}")
                    return full_1c_url
    except Exception:
        pass
    return None


async def start_ngrok_url_watcher(max_attempts: int = 10, interval: float = 2.0):
    """Background task to poll Ngrok local API on startup until tunnel is active."""
    for attempt in range(1, max_attempts + 1):
        url = resolve_dynamic_ngrok_url_sync()
        if url:
            break
        await asyncio.sleep(interval)


def is_localhost_url(url: str) -> bool:
    """Checks if the given URL points to a local loopback address."""
    if not url:
        return False
    u = url.lower().strip()
    return "localhost" in u or "127.0.0.1" in u or "0.0.0.0" in u or "::1" in u


def clean_1c_url(raw_url: Optional[str]) -> str:
    """Strips whitespace, markdown brackets/parentheses, quotes, and duplicates."""
    if not raw_url:
        return ""
    s = str(raw_url).strip().strip("'\"").strip()

    # 1. If Markdown format [text](url), extract URL from parentheses
    md_match = re.search(r'\((https?://[^\s\)]+)\)', s)
    if md_match:
        s = md_match.group(1).strip()
    elif s.startswith("[") and s.endswith("]"):
        s = s[1:-1].strip()

    # 2. Extract valid http/https URL if embedded or duplicated
    url_match = re.search(r'(https?://[^\s\[\]\(\)\<\>\"\']+)', s)
    if url_match:
        s = url_match.group(1).strip()

    # 3. If duplicated url (e.g. https://...https://...), keep first valid instance
    if s.count("http://") + s.count("https://") > 1:
        dup_match = re.search(r'(https?://.+?)(?=https?://|$)', s)
        if dup_match:
            s = dup_match.group(1).strip()

    # Remove any trailing brackets/punctuation
    s = re.sub(r'[\]\)>.,;\"\'\s]+$', '', s)
    return s


def get_active_1c_url() -> str:
    """Returns currently active 1C URL from dynamic system settings, defaulting to active target URL."""
    val = get_system_setting("api_1c_url", DEFAULT_1C_URL)
    cleaned = clean_1c_url(val)
    if not cleaned or "abcd-123" in cleaned or "xxxx" in cleaned:
        return DEFAULT_1C_URL
    return cleaned


def get_active_1c_user() -> str:
    return str(get_system_setting("api_1c_user", "mobiles")).strip()


def get_active_1c_pass() -> str:
    return str(get_system_setting("api_1c_pass", "123")).strip()


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
    """Updates dynamic 1C settings in DB and memory without requiring server restart."""
    cleaned_url = clean_1c_url(api_url) if api_url is not None else None
    update_1c_system_settings(api_url=cleaned_url, api_user=api_user, api_pass=api_pass)
    clear_1c_cache()

    active_url = get_active_1c_url()
    active_user = get_active_1c_user()
    active_pass = get_active_1c_pass()

    # Persist to .env file for continuity across restarts
    persist_1c_settings_to_env(active_url, active_user, active_pass)

    return get_1c_config_status()


def get_1c_cache_status() -> dict:
    """Returns current cache status and remaining TTL in seconds."""
    global _cache_data, _cache_time
    now = time.time()
    age = now - _cache_time
    ttl = int(get_system_setting("cache_ttl", 300))
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
    """Returns active 1C configuration status for the Admin Panel display & editor."""
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


def _extract_items_list(raw_data: Any) -> list:
    """Helper to extract list of product items from various 1C JSON/dict structures."""
    if isinstance(raw_data, list):
        return raw_data
    elif isinstance(raw_data, dict):
        for key in ["data", "products", "items", "goods", "Товары", "товары", "Номенклатура", "номенклатура", "Catalog", "catalog", "rows"]:
            if key in raw_data and isinstance(raw_data[key], list):
                return raw_data[key]
        # Check if dict itself represents a single product
        if "id" in raw_data or "sku" in raw_data or "SKU" in raw_data or "Код" in raw_data or "Name" in raw_data:
            return [raw_data]
    return []


async def fetch_1c_products(force_refresh: bool = False, timeout_seconds: Optional[int] = None) -> dict:
    """
    Asynchronously fetches product catalog from 1C HTTP Service.
    Loops through pages (limit/offset or page=1,2,3...) until 0 items are returned.
    Sets HTTP Client Timeout to 180 seconds to prevent socket timeouts on large payloads.
    """
    global _cache_data, _cache_time

    active_url = get_active_1c_url()
    active_user = get_active_1c_user()
    active_pass = get_active_1c_pass()
    ttl = int(get_system_setting("cache_ttl", 300))
    eff_timeout = float(timeout_seconds or get_system_setting("api_1c_timeout", 180.0) or 180.0)

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
        warning_msg = "1C server manzili ko'rsatilmagan. Admin panelida yoki .env faylida API_1C_URL ni sozlang."
        logger.warning(warning_msg)
        return {
            "success": False,
            "error": warning_msg,
            "data": None
        }

    # 3. Setup HTTP Basic Authentication
    auth = None
    if active_user and active_pass:
        auth = aiohttp.BasicAuth(login=active_user, password=active_pass)

    # 4. Mandatory Headers (Ngrok bypass & JSON accept)
    headers = {
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
        "Bypass-Tunnel-Reminder": "true",
        "X-Requested-With": "XMLHttpRequest"
    }

    # Set HTTP Client Timeout to 180 seconds or eff_timeout
    timeout = aiohttp.ClientTimeout(total=eff_timeout, sock_read=eff_timeout, connect=30.0)
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
            print(f"=== 1C FETCH DEBUG ===")
            print(f"Target URL: {active_url}")
            print(f"Timeout setting: {eff_timeout}s")
            logger.info(f"[1C REQUEST] Calling 1C URL: {active_url} (timeout: {eff_timeout}s)")

            accumulated_items = []
            page = 1
            max_pages = 200  # Safeguard cap for pagination loop

            async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
                while page <= max_pages:
                    # Construct page URL
                    if page == 1:
                        target_url = active_url
                    else:
                        sep = "&" if "?" in active_url else "?"
                        target_url = f"{active_url}{sep}page={page}"

                    print(f"[1C PAGINATION] Requesting Page {page}: {target_url}")
                    async with session.get(target_url, auth=auth, headers=headers) as response:
                        status = response.status
                        print(f"Page {page} Status Code: {status}")

                        if status == 200:
                            raw_text = await response.text()
                            if "<!DOCTYPE" in raw_text or "<html" in raw_text.lower():
                                warning_msg = "Ngrok HTML ogohlantirish sahifasini qaytardi. ngrok-skip-browser-warning sarlavhasi talab qilinadi."
                                logger.warning(warning_msg)
                                return {
                                    "success": False,
                                    "error": warning_msg,
                                    "status_code": 200,
                                    "data": None
                                }

                            try:
                                raw_data = json.loads(raw_text)
                            except (json.JSONDecodeError, Exception):
                                raw_data = raw_text

                            page_items = _extract_items_list(raw_data)
                            print(f"Page {page} returned {len(page_items)} items")

                            if not page_items:
                                # 0 items returned -> catalog end reached
                                print(f"[1C PAGINATION] Page {page} returned 0 items. Loop finished.")
                                break

                            accumulated_items.extend(page_items)

                            # If page 1 returned non-paginated data (e.g. text/xml/dict or single list without paging support)
                            # or fewer than 5 items, check if loop should continue
                            if page == 1 and isinstance(raw_data, str) and not raw_data.strip().startswith("["):
                                break

                            page += 1
                        elif status in (401, 403):
                            err_text = await response.text()
                            warning_msg = "1C login yoki paroli noto'g'ri (401/403 Basic Auth)"
                            logger.warning(f"1C Auth Error ({status}) at {target_url}: {warning_msg}")
                            if page == 1:
                                return {
                                    "success": False,
                                    "error": warning_msg,
                                    "detail": err_text[:300],
                                    "status_code": status,
                                    "data": None
                                }
                            break
                        elif status == 404:
                            if page > 1:
                                # Next page 404 means pagination reached the end
                                print(f"[1C PAGINATION] Page {page} returned 404. End of catalog.")
                                break
                            err_text = await response.text()
                            warning_msg = "1C HTTP xizmati topilmadi (404 Not Found)."
                            return {
                                "success": False,
                                "error": warning_msg,
                                "url": target_url,
                                "detail": err_text[:300],
                                "status_code": 404,
                                "data": None
                            }
                        else:
                            if page > 1:
                                break
                            err_text = await response.text()
                            warning_msg = f"1C serveridan xato javob qaytdi (HTTP {status}): {err_text[:200]}"
                            return {
                                "success": False,
                                "error": warning_msg,
                                "status_code": status,
                                "detail": err_text[:300],
                                "data": None
                            }

            # Update in-memory cache with accumulated catalog items
            final_data = accumulated_items if accumulated_items else raw_data
            _cache_data = final_data
            _cache_time = time.time()

            print(f"[1C FETCH COMPLETE] Total accumulated items fetched: {len(accumulated_items)}")

            return {
                "success": True,
                "cached": False,
                "data": final_data,
                "status_code": 200
            }

        except aiohttp.ClientConnectorError as e:
            print(f"=== 1C FETCH EXCEPTION ===")
            print(f"Connection Error: {str(e)}")
            error_msg = f"1C serveriga ({active_url}) ulanib bo'lmadi: {str(e)}"
            logger.warning(error_msg)
            return {
                "success": False,
                "error": error_msg,
                "detail": str(e),
                "data": None
            }
        except asyncio.TimeoutError as e:
            print(f"=== 1C FETCH EXCEPTION ===")
            print(f"Timeout Error after {eff_timeout}s")
            error_msg = f"1C serveridan javob kelishi vaqti tugadi ({eff_timeout}s)."
            logger.warning(error_msg)
            return {
                "success": False,
                "error": error_msg,
                "detail": "TimeoutError",
                "data": None
            }
        except Exception as e:
            print(f"=== 1C FETCH EXCEPTION ===")
            print(f"Unexpected Exception: {type(e).__name__}: {str(e)}")
            error_msg = f"1C bilan aloqada xatolik ({type(e).__name__}): {str(e)}"
            logger.error(error_msg, exc_info=True)
            return {
                "success": False,
                "error": error_msg,
                "detail": str(e),
                "data": None
            }


async def sync_products_from_1c(force_refresh: bool = True) -> dict:
    """
    Fetches latest products from 1C and upserts into local database.
    Uncategorized items receive category_id = None.
    Returns fresh list of uncategorized products instantly.
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

    # Instantly include fresh uncategorized products list
    sync_result["uncategorized_products"] = get_uncategorized_products()

    return sync_result

