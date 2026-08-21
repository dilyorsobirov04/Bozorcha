import os
import re
import json
import base64
import time
import asyncio
import logging
import traceback
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
    update_1c_system_settings,
    _async_persist_synced_products
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


def get_active_1c_url(override_url: Optional[str] = None) -> str:
    """
    Returns currently active 1C URL from dynamic system settings / Database FIRST.
    Fallbacks to process.env.ONEC_API_URL / API_1C_URL.
    Sanitizes trailing slashes and ensures /GetTovarList suffix.
    """
    if override_url and str(override_url).strip():
        cleaned = clean_1c_url(override_url)
        if cleaned:
            cleaned = cleaned.rstrip('/')
            if not cleaned.endswith("/GetTovarList"):
                cleaned = f"{cleaned}/GetTovarList"
            print(f"[1C CRITICAL DEBUG] Making HTTP request to OVERRIDE URL: {cleaned}", flush=True)
            return cleaned

    # 1. Fetch from DB settings first
    db_val = (
        get_system_setting("ONEC_API_URL") or
        get_system_setting("api_1c_url") or
        get_system_setting("1c_endpoint") or
        get_system_setting("endpoint_url")
    )
    
    # 2. Fallback to env variable ONEC_API_URL / API_1C_URL
    env_val = os.getenv("ONEC_API_URL", "").strip() or os.getenv("API_1C_URL", "").strip()

    raw_url = db_val or env_val or DEFAULT_1C_URL
    cleaned = clean_1c_url(raw_url)

    if not cleaned:
        cleaned = clean_1c_url(DEFAULT_1C_URL)

    # 3. Clean trailing slashes
    cleaned = cleaned.rstrip('/')

    # 4. Ensure URL ends with /GetTovarList
    if not cleaned.endswith("/GetTovarList"):
        cleaned = f"{cleaned}/GetTovarList"

    print(f"[1C CRITICAL DEBUG] Making HTTP request to EXACT URL: {cleaned}", flush=True)
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


def _extract_items_list(data: Any) -> list:
    """Helper to extract list of product items from various 1C JSON/dict structures."""
    if data is None:
        return []

    if isinstance(data, list):
        print(f"DEBUG 1C RAW RESPONSE TYPE: list, LEN: {len(data)}", flush=True)
        return data

    if isinstance(data, str):
        trimmed = data.strip().lstrip('\ufeff')
        if trimmed.startswith("{") or trimmed.startswith("["):
            try:
                parsed = json.loads(trimmed)
                return _extract_items_list(parsed)
            except Exception as e:
                print("1C JSON parse error in _extract_items_list:", e, flush=True)
        return []

    if isinstance(data, dict):
        print(f"DEBUG 1C RAW RESPONSE KEYS: {list(data.keys())}", flush=True)
        
        # Priority 1: Check "data" key (can be list, JSON string, or wrapper dict)
        if "data" in data and data["data"] is not None:
            d_val = data["data"]
            if isinstance(d_val, list):
                print(f"DEBUG: Found {len(d_val)} product items under 'data' key.", flush=True)
                return d_val
            elif isinstance(d_val, str):
                try:
                    parsed_d = json.loads(d_val.strip().lstrip('\ufeff'))
                    res = _extract_items_list(parsed_d)
                    if res:
                        return res
                except Exception:
                    pass
            elif isinstance(d_val, dict):
                res = _extract_items_list(d_val)
                if res:
                    return res

        # Priority 2: Check "items" key
        if "items" in data and data["items"] is not None:
            items_val = data["items"]
            if isinstance(items_val, list):
                print(f"DEBUG: Found {len(items_val)} product items under 'items' key.", flush=True)
                return items_val
            elif isinstance(items_val, str):
                try:
                    parsed_items = json.loads(items_val.strip().lstrip('\ufeff'))
                    res = _extract_items_list(parsed_items)
                    if res:
                        return res
                except Exception:
                    pass
            elif isinstance(items_val, dict):
                res = _extract_items_list(items_val)
                if res:
                    return res

        # Priority 3: Check other standard key names
        for key in ["Tovary", "products", "GetTovarList", "Tovari", "tovary", "goods", "rows", "payload", "result", "value", "content", "list", "Товары", "товары", "Номенклатура", "номенклатура", "Catalog", "catalog", "Товар", "товар"]:
            if key in data and data[key] is not None:
                val = data[key]
                if isinstance(val, list):
                    print(f"DEBUG: Found {len(val)} product items under key '{key}'.", flush=True)
                    return val
                elif isinstance(val, (dict, str)):
                    res = _extract_items_list(val)
                    if res:
                        return res

        # Priority 4: Dynamic scan of dictionary values for list of dicts
        for key, val in data.items():
            if isinstance(val, list) and len(val) > 0 and isinstance(val[0], dict):
                print(f"DEBUG: Found product array under dynamic key '{key}' with {len(val)} items.", flush=True)
                return val

        # Priority 5: Single item dict
        if any(k in data for k in ["id", "sku", "SKU", "Code", "code", "Код", "код", "Name", "name", "Наименование", "barcode"]):
            print("DEBUG: Response dict represents a single product item.", flush=True)
            return [data]

    return []


async def fetch_1c_products(force_refresh: bool = False, timeout_seconds: Optional[int] = None, endpoint_url: Optional[str] = None) -> dict:
    """
    Asynchronously fetches product catalog from 1C HTTP Service.
    Loops through pages (limit/offset or page=1,2,3...) until 0 items are returned.
    Sets HTTP Client Timeout to 300 seconds (5 minutes) to prevent socket timeouts on large payloads.
    """
    global _cache_data, _cache_time

    active_url = get_active_1c_url(override_url=endpoint_url)
    active_user = get_active_1c_user()
    active_pass = get_active_1c_pass()
    ttl = int(get_system_setting("cache_ttl", 300))
    eff_timeout = max(180.0, float(timeout_seconds or get_system_setting("api_1c_timeout", 300.0) or 300.0))

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
        "User-Agent": "Bozorcha/1.0",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Bypass-Tunnel-Reminder": "true",
        "X-Requested-With": "XMLHttpRequest"
    }

    # Set HTTP Client Timeout to at least 180 seconds (3 minutes)
    timeout = aiohttp.ClientTimeout(total=eff_timeout, sock_read=eff_timeout, connect=60.0)
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
            print(f"=== 1C FETCH DEBUG ===", flush=True)
            print(f"Target URL: {active_url}", flush=True)
            print(f"Timeout setting: {eff_timeout}s", flush=True)
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

                    print(f"[1C PAGINATION] Requesting Page {page}: {target_url}", flush=True)
                    print(f"[1C DEBUG] Requesting URL: {target_url}", flush=True)
                    print(f"[1C DEBUG] Sent Headers: {headers}", flush=True)
                    async with session.get(target_url, auth=auth, headers=headers) as response:
                        status = response.status
                        raw_text = await response.text()

                        print(f"[1C DEBUG] Response Status: {status}", flush=True)
                        print(f"[1C DEBUG] Raw Body Preview: {raw_text[:500]}", flush=True)
                        print(f"=== 1C STATUS: {status} ===", flush=True)
                        print(f"=== 1C RAW BODY: {raw_text[:500]} ===", flush=True)
                        print("=== 1C RESPONSE DEBUG ===", flush=True)
                        print("Status:", status, flush=True)
                        print("Raw Body (first 300 chars):", raw_text[:300], flush=True)
                        print("=========================", flush=True)

                        if status == 200:
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
                            print(f"DEBUG [Parsed Items Count]: {len(page_items)}", flush=True)
                            if len(page_items) > 0:
                                sample_str = str(page_items[0])[:200].encode('ascii', errors='replace').decode('ascii')
                                print(f"DEBUG [Sample First Item]: {sample_str}", flush=True)

                            if not page_items:
                                # 0 items returned -> catalog end reached
                                print(f"[1C PAGINATION] Page {page} returned 0 items. Loop finished.", flush=True)
                                break

                            accumulated_items.extend(page_items)

                            # If page 1 returned non-paginated data (e.g. text/xml/dict or single list without paging support)
                            # or fewer than 5 items, check if loop should continue
                            if page == 1 and isinstance(raw_data, str) and not raw_data.strip().startswith("["):
                                break

                            page += 1
                        elif status in (401, 403):
                            warning_msg = "1C login yoki paroli noto'g'ri (401/403 Basic Auth)"
                            logger.warning(f"1C Auth Error ({status}) at {target_url}: {warning_msg}")
                            if page == 1:
                                return {
                                    "success": False,
                                    "error": warning_msg,
                                    "detail": raw_text[:300],
                                    "status_code": status,
                                    "data": None
                                }
                            break
                        elif status == 404:
                            if page > 1:
                                # Next page 404 means pagination reached the end
                                print(f"[1C PAGINATION] Page {page} returned 404. End of catalog.", flush=True)
                                break
                            warning_msg = "1C HTTP xizmati topilmadi (404 Not Found)."
                            return {
                                "success": False,
                                "error": warning_msg,
                                "url": target_url,
                                "detail": raw_text[:300],
                                "status_code": 404,
                                "data": None
                            }
                        else:
                            if page > 1:
                                break
                            warning_msg = f"1C serveridan xato javob qaytdi (HTTP {status}): {raw_text[:200]}"
                            return {
                                "success": False,
                                "error": warning_msg,
                                "status_code": status,
                                "detail": raw_text[:300],
                                "data": None
                            }

            # Check if 0 items total were parsed
            if len(accumulated_items) == 0:
                err_msg = "1C API bo'sh ro'yxat qaytardi. 1C HTTP Servis funksiyasini tekshiring."
                print(f"DEBUG 1C FETCH ERROR: {err_msg} (0 items parsed)", flush=True)
                logger.warning(err_msg)
                return {
                    "success": False,
                    "error": err_msg,
                    "message": err_msg,
                    "detail": "1C serveridan hech qanday tovar ma'lumoti olinmadi. 1C HTTP Servis funksiyasini va Ngrok manzilini tekshiring.",
                    "status_code": 400,
                    "data": None
                }

            # Update in-memory cache with accumulated catalog items
            _cache_data = accumulated_items
            _cache_time = time.time()

            print(f"DEBUG: Parsed {len(accumulated_items)} items total from 1C response.")
            print(f"[1C FETCH COMPLETE] Total accumulated items fetched: {len(accumulated_items)}")

            return {
                "success": True,
                "cached": False,
                "data": accumulated_items,
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


async def sync_products_from_1c(force_refresh: bool = True, endpoint_url: Optional[str] = None) -> dict:
    """
    Fetches latest products from 1C and upserts into local database.
    Uncategorized items receive category_id = None.
    Returns fresh list of uncategorized products instantly.
    """
    fetch_res = await fetch_1c_products(force_refresh=force_refresh, endpoint_url=endpoint_url)

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

    # Await database persistence so is_syncing remains True during PostgreSQL batch updates
    products_to_persist = sync_result.get("products") or []
    if products_to_persist:
        await _async_persist_synced_products(products_to_persist)

    # Instantly include fresh uncategorized products list
    sync_result["uncategorized_products"] = get_uncategorized_products()

    return sync_result


_1c_sync_state = {
    "is_syncing": False,
    "last_sync_time": None,
    "last_result": None,
    "error": None
}


def get_1c_sync_state() -> dict:
    """Returns current active background sync state."""
    return {
        "is_syncing": _1c_sync_state["is_syncing"],
        "last_sync_time": _1c_sync_state["last_sync_time"],
        "last_result": _1c_sync_state["last_result"],
        "error": _1c_sync_state["error"]
    }


async def run_background_1c_sync(force_refresh: bool = True, raw_payload: Any = None, endpoint_url: Optional[str] = None) -> dict:
    """Spawns 1C product fetching & database upsert asynchronously in background."""
    global _1c_sync_state
    if _1c_sync_state["is_syncing"]:
        return {
            "success": True,
            "is_syncing": True,
            "message": "Sinxronlash jarayoni allaqachon fonda ishlamoqda..."
        }

    if endpoint_url:
        update_1c_config(api_url=endpoint_url)

    _1c_sync_state["is_syncing"] = True
    _1c_sync_state["error"] = None

    async def _worker():
        global _1c_sync_state
        try:
            print("DEBUG: Starting 1C Fetch...")
            print("[BACKGROUND 1C SYNC] Task started in background...")
            if raw_payload is not None:
                res = sync_1c_products(raw_payload)
                products_to_persist = res.get("products") or []
                if products_to_persist:
                    await _async_persist_synced_products(products_to_persist)
            else:
                res = await sync_products_from_1c(force_refresh=force_refresh, endpoint_url=endpoint_url)
            _1c_sync_state["last_result"] = res
            _1c_sync_state["last_sync_time"] = time.time()
            fetched = res.get('total_received', res.get('count', 0))
            saved = res.get('synced_count', res.get('count', 0))
            print(f"[SYNC COMPLETED] Total Fetched: {fetched}, Saved/Updated in DB: {saved}")
            print(f"[BACKGROUND 1C SYNC] Task finished successfully: {saved} items synced.")
        except Exception as e:
            print("CRITICAL ERROR IN 1C BACKGROUND SYNC:")
            print(traceback.format_exc())
            logger.error(f"CRITICAL ERROR IN 1C BACKGROUND SYNC: {e}", exc_info=True)
            _1c_sync_state["error"] = str(e)
            _1c_sync_state["last_result"] = {
                "success": False,
                "error": str(e),
                "detail": traceback.format_exc(),
                "count": 0,
                "synced_count": 0
            }
        finally:
            _1c_sync_state["is_syncing"] = False

    asyncio.create_task(_worker())

    return {
        "success": True,
        "is_syncing": True,
        "message": "1C bilan sinxronlash fonda boshlandi. Sahifani yangilab turing."
    }



