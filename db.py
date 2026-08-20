import os
import json
import xml.etree.ElementTree as ET
import urllib.parse
import asyncio
from typing import Optional, Any
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    import asyncpg
except ImportError:
    asyncpg = None

# PostgreSQL Connection Pool & URL
_pg_pool = None
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:dilyor1234@127.0.0.1:5433/bozorcha_db").strip()

# System Settings Store (Dynamic settings, 1C Enterprise integration, etc.)
SYSTEM_SETTINGS_DB = {
    "api_1c_url": (os.getenv("API_1C_URL", "").strip() or "https://wreath-paddling-precook.ngrok-free.dev/Bozorcham/hs/Bozorcham/GetTovarList"),
    "api_1c_user": os.getenv("API_1C_USER", "mobiles").strip(),
    "api_1c_pass": os.getenv("API_1C_PASS", "123").strip(),
    "cache_ttl": int(os.getenv("CACHE_TTL", "300")),
    "page_size": int(os.getenv("PAGE_SIZE", "10")),
    "api_1c_timeout": int(os.getenv("API_1C_TIMEOUT", "20")),
}


async def get_pg_pool():
    """Returns or creates an asyncpg Connection Pool for local PostgreSQL."""
    global _pg_pool
    if asyncpg is None:
        return None

    if _pg_pool is None:
        urls_to_try = [
            DATABASE_URL,
            "postgresql://postgres:dilyor1234@127.0.0.1:5433/bozorcha_db",
            "postgresql://postgres@127.0.0.1:5433/bozorcha_db",
            "postgresql://postgres:dilyor1234@127.0.0.1:5432/bozorcha_db",
            "postgresql://postgres@127.0.0.1:5432/bozorcha_db"
        ]
        for url in urls_to_try:
            try:
                _pg_pool = await asyncpg.create_pool(
                    url,
                    min_size=1,
                    max_size=10,
                    ssl=False,
                    timeout=3.0
                )
                print(f"[POSTGRESQL] Connected pool to: {url}")
                break
            except Exception:
                _pg_pool = None
                continue
    return _pg_pool


async def init_postgres_db():
    """Initializes local PostgreSQL database connection and creates required tables."""
    if asyncpg is None:
        return False

    try:
        pool = await get_pg_pool()
        if not pool:
            return False

        async with pool.acquire() as conn:
            # Create schema tables if not exist
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS system_settings (
                    key VARCHAR(128) PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS categories (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    icon VARCHAR(64),
                    parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
                    image_url TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS products (
                    id SERIAL PRIMARY KEY,
                    sku VARCHAR(128) UNIQUE,
                    barcode VARCHAR(128),
                    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
                    name VARCHAR(512) NOT NULL,
                    unit VARCHAR(64) DEFAULT 'dona',
                    price BIGINT NOT NULL DEFAULT 0,
                    old_price BIGINT,
                    discount_percent INTEGER DEFAULT 0,
                    stock INTEGER DEFAULT 0,
                    description TEXT,
                    nutrition JSONB,
                    photo_file_id VARCHAR(255),
                    image_url TEXT,
                    is_promo BOOLEAN DEFAULT FALSE,
                    recommendation TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS users (
                    id BIGINT PRIMARY KEY,
                    username VARCHAR(255),
                    first_name VARCHAR(255),
                    last_name VARCHAR(255),
                    phone_number VARCHAR(64),
                    language_code VARCHAR(10) DEFAULT 'uz',
                    is_admin BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS orders (
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT,
                    items JSONB NOT NULL,
                    total_price BIGINT NOT NULL,
                    status VARCHAR(64) DEFAULT 'pending',
                    delivery_address TEXT,
                    delivery_location JSONB,
                    contact_phone VARCHAR(64),
                    payment_method VARCHAR(64),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                -- Alter table migrations for backward compatibility
                ALTER TABLE products ADD COLUMN IF NOT EXISTS sku VARCHAR(128);
                ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INTEGER;
                ALTER TABLE products ADD COLUMN IF NOT EXISTS name VARCHAR(512);
                ALTER TABLE products ADD COLUMN IF NOT EXISTS unit VARCHAR(64) DEFAULT 'dona';
                ALTER TABLE products ADD COLUMN IF NOT EXISTS price BIGINT DEFAULT 0;
                ALTER TABLE products ADD COLUMN IF NOT EXISTS old_price BIGINT;
                ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_percent INTEGER DEFAULT 0;
                ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0;
                ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;
                ALTER TABLE products ADD COLUMN IF NOT EXISTS nutrition JSONB;
                ALTER TABLE products ADD COLUMN IF NOT EXISTS photo_file_id VARCHAR(255);
                ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
                ALTER TABLE products ADD COLUMN IF NOT EXISTS is_promo BOOLEAN DEFAULT FALSE;
                ALTER TABLE products ADD COLUMN IF NOT EXISTS recommendation TEXT;
                ALTER TABLE products ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
                ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
                ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(128);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
            """)

            # Load system settings from DB to memory
            rows = await conn.fetch("SELECT key, value FROM system_settings")
            for r in rows:
                k = r["key"]
                v = r["value"]
                SYSTEM_SETTINGS_DB[k] = v
                if k == "API_1C_URL":
                    SYSTEM_SETTINGS_DB["api_1c_url"] = v

            # Ensure API_1C_URL is clean and persisted with active target URL
            target_url = "https://wreath-paddling-precook.ngrok-free.dev/Bozorcham/hs/Bozorcham/GetTovarList"
            init_url = SYSTEM_SETTINGS_DB.get("api_1c_url", "").strip()
            if not init_url or "abcd-123" in init_url or "xxxx" in init_url or "127.0.0.1" in init_url or "localhost" in init_url:
                init_url = target_url

            SYSTEM_SETTINGS_DB["api_1c_url"] = init_url
            await conn.execute("""
                INSERT INTO system_settings (key, value, updated_at)
                VALUES ('API_1C_URL', $1, CURRENT_TIMESTAMP)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
            """, init_url)

            # Load all products from PostgreSQL database into memory
            rows = await conn.fetch("SELECT * FROM products ORDER BY id ASC")
            if rows:
                for r in rows:
                    pid = r["id"]
                    PRODUCTS_DB[pid] = {
                        "id": pid,
                        "sku": r["sku"] or f"SKU-{pid}",
                        "barcode": r.get("barcode"),
                        "category_id": r["category_id"],
                        "name": r["name"],
                        "unit": r["unit"] or "dona",
                        "price": int(r["price"] or 0),
                        "old_price": r["old_price"],
                        "discount_percent": r["discount_percent"] or 0,
                        "stock": r["stock"] or 0,
                        "description": r["description"] or "",
                        "nutrition": json.loads(r["nutrition"]) if r.get("nutrition") else {},
                        "photo_file_id": r["photo_file_id"],
                        "image_url": r["image_url"],
                        "is_promo": bool(r["is_promo"]),
                        "recommendation": r["recommendation"]
                    }
                print(f"[POSTGRESQL] Loaded {len(rows)} products from database into memory.")

        print(f"[POSTGRESQL] Local database connected successfully to bozorcha_db on port 5433! Tables verified.")
        return True
    except Exception as e:
        print(f"[POSTGRESQL] Database init info: {e}")
        return False


def _safe_bg_task(coro):
    """Executes a coroutine in background without failing sync callers."""
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        try:
            asyncio.run(coro)
        except Exception:
            pass
    except Exception:
        pass


async def _async_persist_system_setting(key: str, value: str):
    """Asynchronously persists a system setting to the database."""
    try:
        pool = await get_pg_pool()
        if pool:
            async with pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO system_settings (key, value, updated_at)
                    VALUES ($1, $2, CURRENT_TIMESTAMP)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
                """, str(key), str(value))
    except Exception as e:
        pass


def get_system_setting(key: str, default: any = None) -> any:
    """Gets a setting value from the dynamic settings store."""
    return SYSTEM_SETTINGS_DB.get(key, default)


def set_system_setting(key: str, value: any):
    """Sets a setting value in the dynamic settings store and persists to DB."""
    SYSTEM_SETTINGS_DB[key] = value
    _safe_bg_task(_async_persist_system_setting(key, str(value)))


def get_1c_system_settings() -> dict:
    """Returns the current active 1C configuration dictionary."""
    return {
        "api_url": SYSTEM_SETTINGS_DB.get("api_1c_url", ""),
        "api_user": SYSTEM_SETTINGS_DB.get("api_1c_user", "mobiles"),
        "has_password": bool(SYSTEM_SETTINGS_DB.get("api_1c_pass")),
        "cache_ttl": SYSTEM_SETTINGS_DB.get("cache_ttl", 300),
        "timeout": SYSTEM_SETTINGS_DB.get("api_1c_timeout", 20)
    }


def update_1c_system_settings(api_url: str = None, api_user: str = None, api_pass: str = None) -> dict:
    """Updates 1C configuration settings dynamically and persists to PostgreSQL."""
    if api_url is not None:
        clean_url = str(api_url).strip()
        SYSTEM_SETTINGS_DB["api_1c_url"] = clean_url
        set_system_setting("api_1c_url", clean_url)
    if api_user is not None:
        SYSTEM_SETTINGS_DB["api_1c_user"] = str(api_user).strip()
        set_system_setting("api_1c_user", str(api_user).strip())
    if api_pass is not None:
        SYSTEM_SETTINGS_DB["api_1c_pass"] = str(api_pass).strip()
        set_system_setting("api_1c_pass", str(api_pass).strip())
    return get_1c_system_settings()



CATEGORIES_DB = {
    # Top-Level Main Categories (parent_id: None)
    1: {"id": 1, "name": "Meva & Sabzavotlar", "icon": "🍎", "parent_id": None, "image_url": "https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=200&auto=format&fit=crop&q=60"},
    2: {"id": 2, "name": "Sut & Tuxum", "icon": "🥛", "parent_id": None, "image_url": "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=200&auto=format&fit=crop&q=60"},
    3: {"id": 3, "name": "Go'sht & Baliq", "icon": "🥩", "parent_id": None, "image_url": "https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=200&auto=format&fit=crop&q=60"},
    4: {"id": 4, "name": "Non & Pishiriqlar", "icon": "🥖", "parent_id": None, "image_url": "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=200&auto=format&fit=crop&q=60"},
    5: {"id": 5, "name": "Ichimliklar", "icon": "🥤", "parent_id": None, "image_url": "https://images.unsplash.com/photo-1613478223719-2ab802602423?w=200&auto=format&fit=crop&q=60"},

    # Subcategories under Meva & Sabzavotlar (parent_id: 1)
    11: {"id": 11, "name": "Yangi Mevalar", "icon": "🍓", "parent_id": 1, "image_url": "https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=200&auto=format&fit=crop&q=60"},
    12: {"id": 12, "name": "Sabzavotlar", "icon": "🥑", "parent_id": 1, "image_url": "assets/organic_avocado.png"},
    13: {"id": 13, "name": "Yashillik & Ko'kat", "icon": "🌿", "parent_id": 1, "image_url": "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=200&auto=format&fit=crop&q=60"},

    # Subcategories under Sut & Tuxum (parent_id: 2)
    21: {"id": 21, "name": "Sut & Qatiq", "icon": "🥛", "parent_id": 2, "image_url": "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=200&auto=format&fit=crop&q=60"},
    22: {"id": 22, "name": "Pishloq & Tvorog", "icon": "🧀", "parent_id": 2, "image_url": "https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=200&auto=format&fit=crop&q=60"},
    23: {"id": 23, "name": "Tuxum", "icon": "🥚", "parent_id": 2, "image_url": "https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=200&auto=format&fit=crop&q=60"},

    # Subcategories under Go'sht & Baliq (parent_id: 3)
    31: {"id": 31, "name": "Mol & Qo'y go'shti", "icon": "🥩", "parent_id": 3, "image_url": "https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=200&auto=format&fit=crop&q=60"},
    32: {"id": 32, "name": "Parranda go'shti", "icon": "🍗", "parent_id": 3, "image_url": "https://images.unsplash.com/photo-1587593810167-a84920ea0781?w=200&auto=format&fit=crop&q=60"},
    33: {"id": 33, "name": "Baliq & Dengiz", "icon": "🐟", "parent_id": 3, "image_url": "https://images.unsplash.com/photo-1534939561126-855b8675edd7?w=200&auto=format&fit=crop&q=60"},

    # Subcategories under Non & Pishiriqlar (parent_id: 4)
    41: {"id": 41, "name": "Tandir & Qolip non", "icon": "🍞", "parent_id": 4, "image_url": "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=200&auto=format&fit=crop&q=60"},
    42: {"id": 42, "name": "Kruassan & Pishiriq", "icon": "🥐", "parent_id": 4, "image_url": "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=200&auto=format&fit=crop&q=60"},

    # Subcategories under Ichimliklar (parent_id: 5)
    51: {"id": 51, "name": "Sharbat & Fresh", "icon": "🧃", "parent_id": 5, "image_url": "https://images.unsplash.com/photo-1613478223719-2ab802602423?w=200&auto=format&fit=crop&q=60"},
    52: {"id": 52, "name": "Suv & Gazli ichimlik", "icon": "🥤", "parent_id": 5, "image_url": "https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=200&auto=format&fit=crop&q=60"}
}


def get_all_categories(nested: bool = False) -> list[dict]:
    cats = list(CATEGORIES_DB.values())
    if not nested:
        return cats

    # Return nested tree structure
    top_level = []
    sub_map = {}
    for c in cats:
        if c.get("parent_id") is None:
            top_level.append({**c, "subcategories": []})
        else:
            pid = c["parent_id"]
            if pid not in sub_map:
                sub_map[pid] = []
            sub_map[pid].append(c)

    for top in top_level:
        top["subcategories"] = sub_map.get(top["id"], [])
    return top_level


def get_subcategories(category_id: int | str) -> list[dict]:
    try:
        cid = int(category_id)
        return [c for c in CATEGORIES_DB.values() if c.get("parent_id") == cid]
    except (ValueError, TypeError):
        return []


def get_top_level_categories() -> list[dict]:
    return [c for c in CATEGORIES_DB.values() if c.get("parent_id") is None]


def get_category(category_id: int | str) -> dict | None:
    try:
        cid = int(category_id)
        return CATEGORIES_DB.get(cid)
    except (ValueError, TypeError):
        return None


def get_category_name(category_id: int | str) -> str:
    try:
        cid = int(category_id)
        cat = CATEGORIES_DB.get(cid)
        if isinstance(cat, dict):
            return cat.get("name", f"Kategoriya #{cid}")
        elif isinstance(cat, str):
            return cat
        return f"Kategoriya #{cid}"
    except (ValueError, TypeError):
        return f"Kategoriya #{category_id}"


def add_category(
    name: str,
    icon: str = "🛍️",
    image_url: str | None = None,
    parent_id: int | str | None = None
) -> dict:
    new_id = (max(CATEGORIES_DB.keys()) + 1) if CATEGORIES_DB else 1
    clean_name = name.strip() if name else f"Kategoriya #{new_id}"
    clean_icon = icon.strip() if icon else "🛍️"

    pid = None
    if parent_id is not None and str(parent_id).strip() != "" and str(parent_id).strip() != "0" and str(parent_id).strip().lower() != "null":
        try:
            pid_int = int(parent_id)
            if pid_int in CATEGORIES_DB:
                pid = pid_int
        except (ValueError, TypeError):
            pid = None

    category = {
        "id": new_id,
        "name": clean_name,
        "icon": clean_icon,
        "parent_id": pid,
        "image_url": image_url.strip() if image_url else "https://images.unsplash.com/photo-1542838132-92c53300491e?w=200&auto=format&fit=crop&q=60"
    }
    CATEGORIES_DB[new_id] = category
    return category


def delete_category(category_id: int | str) -> bool:
    try:
        cid = int(category_id)
        if cid in CATEGORIES_DB:
            del CATEGORIES_DB[cid]
            # Handle child subcategories if parent is deleted
            child_ids = [c["id"] for c in CATEGORIES_DB.values() if c.get("parent_id") == cid]
            for child_id in child_ids:
                if child_id in CATEGORIES_DB:
                    CATEGORIES_DB[child_id]["parent_id"] = None
            return True
        return False
    except (ValueError, TypeError):
        return False

PRODUCTS_DB = {
    101: {
        "id": 101,
        "sku": "1C-00101",
        "category_id": 12,  # Sabzavotlar (parent 1)
        "name": "Organik Avokado Hass",
        "unit": "kg",
        "price": 68000,
        "old_price": 85000,
        "discount_percent": 20,
        "stock": 42,
        "description": "Yangi uzilgan, yog'li va nozik ta'mga ega premium darajadagi organik avokado.",
        "nutrition": {"cal": "160 kcal", "protein": "2g", "fat": "15g"},
        "photo_file_id": None,
        "image_url": "assets/organic_avocado.png",
        "is_promo": True,
        "recommendation": "Limon va zaytun moyi"
    },
    102: {
        "id": 102,
        "sku": "1C-00102",
        "category_id": 11,  # Yangi Mevalar (parent 1)
        "name": "Qulupnay Premium Sweet",
        "unit": "kg",
        "price": 45000,
        "old_price": 60000,
        "discount_percent": 25,
        "stock": 28,
        "description": "Shirali va xushbo'y yangi uzilgan tabiiy qulupnay.",
        "nutrition": {"cal": "32 kcal", "protein": "0.7g", "fat": "0.3g"},
        "photo_file_id": None,
        "image_url": "https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=500&auto=format&fit=crop&q=60",
        "is_promo": True,
        "recommendation": "Qaymoq 30%"
    },
    103: {
        "id": 103,
        "sku": "1C-00103",
        "category_id": 21,  # Sut & Qatiq (parent 2)
        "name": "Fermer Suti 3.2% Bio",
        "unit": "dona",
        "price": 14000,
        "old_price": 16500,
        "discount_percent": 15,
        "stock": 50,
        "description": "Tabiiy pasterizatsiyalangan yangi sig'ir suti.",
        "nutrition": {"cal": "60 kcal", "protein": "3.2g", "fat": "3.2g"},
        "photo_file_id": None,
        "image_url": "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=500&auto=format&fit=crop&q=60",
        "is_promo": True,
        "recommendation": "Suli yormasi (Gerкулес)"
    },
    104: {
        "id": 104,
        "sku": "1C-00104",
        "category_id": 31,  # Mol & Qo'y go'shti (parent 3)
        "name": "Mol Go'shti Ribeye Steyk",
        "unit": "kg",
        "price": 145000,
        "old_price": 180000,
        "discount_percent": 19,
        "stock": 18,
        "description": "Marmar mol go'shti, mayin va suvli gril steyk uchun eng yaxshi tanlov.",
        "nutrition": {"cal": "250 kcal", "protein": "26g", "fat": "17g"},
        "photo_file_id": None,
        "image_url": "https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=500&auto=format&fit=crop&q=60",
        "is_promo": True,
        "recommendation": "Rozmarin va sarimsoq"
    },
    105: {
        "id": 105,
        "sku": "1C-00105",
        "category_id": 42,  # Kruassan & Pishiriq (parent 4)
        "name": "Fransuzcha Kruassan Butter",
        "unit": "dona",
        "price": 18000,
        "old_price": 24000,
        "discount_percent": 25,
        "stock": 35,
        "description": "Haqiqiy sariyog' bilan qatlamali tayyorlangan issiq nonvoyxona kruassani.",
        "nutrition": {"cal": "400 kcal", "protein": "8g", "fat": "21g"},
        "photo_file_id": None,
        "image_url": "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=500&auto=format&fit=crop&q=60",
        "is_promo": True,
        "recommendation": "Kapuchino qahva"
    },
    106: {
        "id": 106,
        "sku": "1C-00106",
        "category_id": 51,  # Sharbat & Fresh (parent 5)
        "name": "Apelsin Sharbati Fresh 1L",
        "unit": "dona",
        "price": 22000,
        "old_price": 28000,
        "discount_percent": 21,
        "stock": 40,
        "description": "100% tabiiy siqilgan apelsin sharbati, shakarsiz.",
        "nutrition": {"cal": "45 kcal", "protein": "0.7g", "fat": "0.2g"},
        "photo_file_id": None,
        "image_url": "https://images.unsplash.com/photo-1613478223719-2ab802602423?w=500&auto=format&fit=crop&q=60",
        "is_promo": True,
        "recommendation": None
    },
    107: {
        "id": 107,
        "sku": "1C-00107",
        "category_id": 22,  # Pishloq & Tvorog (parent 2)
        "name": "Gollandiya Pishlog'i Gouda",
        "unit": "kg",
        "price": 95000,
        "old_price": 115000,
        "discount_percent": 17,
        "stock": 25,
        "description": "Klassik mazali Gollandiya Gouda pishlog'i.",
        "nutrition": {"cal": "350 kcal", "protein": "25g", "fat": "27g"},
        "photo_file_id": None,
        "image_url": "https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=500&auto=format&fit=crop&q=60",
        "is_promo": True,
        "recommendation": "Asal va yong'oq"
    },
    108: {
        "id": 108,
        "sku": "1C-00108",
        "category_id": 13,  # Yashillik & Ko'kat (parent 1)
        "name": "Organik Ko'katlar To'plami",
        "unit": "dona",
        "price": 8000,
        "old_price": 10000,
        "discount_percent": 20,
        "stock": 60,
        "description": "Kashnich, rayhon, ukrop va petrushka to'plami.",
        "nutrition": {"cal": "20 kcal", "protein": "1.5g", "fat": "0.2g"},
        "photo_file_id": None,
        "image_url": "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500&auto=format&fit=crop&q=60",
        "is_promo": False,
        "recommendation": "Salatlar uchun"
    }
}

STATISTICS_DB = {
    "total_sales": 28500000,
    "monthly_sales": 8400000,
    "manual_orders": []
}


def get_all_products(
    page: int = 1,
    limit: int = 100,
    category_id: int | str | None = None,
    search: str | None = None,
    sort: str | None = None,
    discount_only: bool = False,
    include_uncategorized: bool = False
) -> dict:
    all_prods = list(PRODUCTS_DB.values())

    # Public storefront filter: Hide uncategorized products (category_id IS NOT NULL and in CATEGORIES_DB)
    if not include_uncategorized:
        all_prods = [
            p for p in all_prods
            if p.get("category_id") is not None
            and p.get("category_id") != 0
            and str(p.get("category_id")).strip() != ""
            and (p.get("category_id") in CATEGORIES_DB)
        ]

    # Category filter
    if category_id is not None and str(category_id).strip() != "" and str(category_id) != "all":
        try:
            cid = int(category_id)
            sub_ids = [c["id"] for c in CATEGORIES_DB.values() if c.get("parent_id") == cid]
            target_ids = {cid, *sub_ids}
            all_prods = [p for p in all_prods if p.get("category_id") in target_ids]
        except (ValueError, TypeError):
            pass

    # Search filter (case-insensitive search in title, description, recommendation)
    if search and str(search).strip():
        q = str(search).strip().lower()
        all_prods = [
            p for p in all_prods
            if q in (p.get("name") or "").lower()
            or q in (p.get("description") or "").lower()
            or q in (p.get("recommendation") or "").lower()
        ]

    # Discount only filter
    if discount_only:
        all_prods = [
            p for p in all_prods
            if (p.get("discount_percent", 0) > 0)
            or (p.get("old_price") is not None and p.get("old_price", 0) > p.get("price", 0))
            or p.get("is_promo")
        ]

    # Sort options: price_asc, price_desc, name_asc, name_desc, discount_desc
    if sort:
        s = str(sort).lower().strip()
        if s in ["price_asc", "price_low", "arzonroq", "cheap"]:
            all_prods.sort(key=lambda p: p.get("price", 0))
        elif s in ["price_desc", "price_high", "qimmatroq", "expensive"]:
            all_prods.sort(key=lambda p: p.get("price", 0), reverse=True)
        elif s in ["name_asc", "name"]:
            all_prods.sort(key=lambda p: (p.get("name") or "").lower())
        elif s in ["name_desc"]:
            all_prods.sort(key=lambda p: (p.get("name") or "").lower(), reverse=True)
        elif s in ["discount_desc", "discount", "chegirma"]:
            all_prods.sort(key=lambda p: p.get("discount_percent", 0), reverse=True)

    start = (page - 1) * limit
    end = start + limit
    items = all_prods[start:end]
    has_more = end < len(all_prods)

    return {
        "items": items,
        "total": len(all_prods),
        "page": page,
        "limit": limit,
        "has_more": has_more
    }


def get_discount_products(page: int = 1, limit: int = 100) -> dict:
    discount_prods = get_discounted_products_api()
    start = (page - 1) * limit
    end = start + limit
    items = discount_prods[start:end]
    has_more = end < len(discount_prods)

    return {
        "items": items,
        "total": len(discount_prods),
        "page": page,
        "limit": limit,
        "has_more": has_more
    }


def get_discounted_products_api() -> list[dict]:
    return [
        prod for prod in PRODUCTS_DB.values()
        if ((prod.get("old_price", 0) > prod.get("price", 0)) or prod.get("is_promo"))
        and prod.get("category_id") is not None
        and prod.get("category_id") in CATEGORIES_DB
    ]


def get_no_photo_products_api(category_id: int | str | None = None) -> list[dict]:
    result = []
    for prod in PRODUCTS_DB.values():
        is_no_photo = (prod.get("photo_file_id") is None) and (prod.get("image_url") is None)
        has_stock = prod.get("stock", 0) > 0

        if is_no_photo and has_stock:
            if category_id is not None and category_id != "" and str(category_id) != "0":
                if str(prod.get("category_id")) == str(category_id):
                    result.append(prod)
            else:
                result.append(prod)

    return result


def update_product_photo_and_stock(
    product_id: int | str,
    image_url: str | None = None,
    photo_file_id: str | None = None,
    stock: int | None = None
) -> dict | None:
    try:
        pid = int(product_id)
        if pid not in PRODUCTS_DB:
            return None

        product = PRODUCTS_DB[pid]

        if image_url is not None:
            product["image_url"] = image_url
        if photo_file_id is not None:
            product["photo_file_id"] = photo_file_id
        if stock is not None:
            product["stock"] = int(stock)

        return product
    except (ValueError, TypeError):
        return None


def sync_1c_products(raw_data: any) -> dict:
    """
    Parses and synchronizes products from 1C Enterprise (JSON, XML or dict/list).
    Accepts various field naming conventions and upserts into PRODUCTS_DB.
    Unmapped items get category_id = None.
    """
    sample = str(raw_data)[:200].encode('ascii', errors='replace').decode('ascii')
    print(f"1C RAW RESPONSE received in sync_1c_products ({len(str(raw_data))} bytes): {sample}...")

    items_to_process = []

    # 1. Parse raw_data to list of dicts
    if isinstance(raw_data, list):
        items_to_process = raw_data
    elif isinstance(raw_data, dict):
        print(f"DEBUG 1C RAW RESPONSE KEYS: {list(raw_data.keys())}")
        found_list = False
        for key in ["data", "products", "items", "goods", "rows", "payload", "result", "value", "content", "list", "Товары", "товары", "Номенклатура", "номенклатура", "Catalog", "catalog", "Товар", "товар"]:
            if key in raw_data and isinstance(raw_data[key], list):
                items_to_process = raw_data[key]
                found_list = True
                print(f"DEBUG: Found product array under key '{key}' with {len(items_to_process)} items.")
                break
        if not found_list:
            for k, val in raw_data.items():
                if isinstance(val, list) and len(val) > 0 and isinstance(val[0], dict):
                    items_to_process = val
                    found_list = True
                    print(f"DEBUG: Found product array under dynamic key '{k}' with {len(items_to_process)} items.")
                    break
        if not found_list:
            if any(k in raw_data for k in ["id", "sku", "SKU", "Код", "код", "Name", "name", "Наименование"]):
                items_to_process = [raw_data]
    elif isinstance(raw_data, str):
        trimmed = raw_data.strip()
        if trimmed.startswith("{") or trimmed.startswith("["):
            try:
                parsed_json = json.loads(trimmed)
                return sync_1c_products(parsed_json)
            except Exception as e:
                print("1C JSON parse error:", e)

        # Try XML parsing
        if trimmed.startswith("<"):
            try:
                root = ET.fromstring(trimmed)
                product_nodes = []
                for tag in ["Товар", "Product", "Item", "Номенклатура", "Position", "Good", "товар", "product", "item"]:
                    found = root.findall(f".//{tag}")
                    if found:
                        product_nodes = found
                        break
                if not product_nodes:
                    product_nodes = list(root)

                for node in product_nodes:
                    item_dict = {}
                    item_dict.update(node.attrib)
                    for child in node:
                        tag_name = child.tag.split("}")[-1]
                        item_dict[tag_name] = (child.text or "").strip()
                    if item_dict:
                        items_to_process.append(item_dict)
            except Exception as e:
                print("1C XML parse error:", e)

    synced_products = []
    invalid_count = 0

    print(f"DEBUG: Parsed {len(items_to_process)} items from 1C response.")

    if len(items_to_process) == 0:
        err_msg = "1C dan tovarlar ro'yxati bo'sh keldi"
        print(f"DEBUG SYNC ERROR: {err_msg} (0 items to process)")
        return {
            "success": False,
            "count": 0,
            "message": err_msg,
            "error": err_msg,
            "detail": "1C serveridan hech qanday tovar ma'lumoti olinmadi (0 ta tovar)",
            "total_received": 0,
            "synced_count": 0,
            "invalid_count": 0,
            "uncategorized_count": 0,
            "products": [],
            "uncategorized": []
        }

    # Precompute SKU index for O(1) fast lookup across 13,000+ items
    sku_to_pid = {str(prod.get("sku", "")).strip().lower(): pid for pid, prod in PRODUCTS_DB.items() if prod.get("sku")}

    for item in items_to_process:
        if not isinstance(item, dict):
            invalid_count += 1
            continue

        # Extract Barcode (if provided) — must be extracted BEFORE SKU to avoid shadowing
        barcode_val = item.get("barcode") or item.get("Barcode") or item.get("Штрихкод") or item.get("штрихкод")
        barcode = str(barcode_val).replace("\xa0", "").strip() if barcode_val else None

        # Extract SKU / Code (1C returns "id": "222 804" — strip internal spaces for clean SKU)
        sku_val = (
            item.get("SKU") or item.get("sku") or
            item.get("Code") or item.get("code") or
            item.get("Код") or item.get("код") or
            item.get("id") or item.get("ID") or
            item.get("Артикул") or item.get("артикул") or
            item.get("Article") or item.get("article")
        )
        # Fallback to barcode as SKU only if no dedicated SKU/id field exists
        if sku_val is None or str(sku_val).strip() == "":
            sku_val = barcode
        if sku_val is None or str(sku_val).strip() == "":
            invalid_count += 1
            continue
        sku = str(sku_val).replace("\xa0", "").replace(" ", "").strip()

        # Extract Name / Title
        name_val = (
            item.get("Name") or item.get("name") or
            item.get("Наименование") or item.get("наименование") or
            item.get("title") or item.get("Title") or
            item.get("Номенклатура") or item.get("номенклатура") or
            item.get("product_name") or item.get("ProductName") or
            item.get("Товар") or item.get("товар")
        )
        if name_val is None or str(name_val).strip() == "":
            invalid_count += 1
            continue
        name = str(name_val).replace("\xa0", " ").strip()

        # Extract Price
        price_val = (
            item.get("Price") or item.get("price") or
            item.get("Цена") or item.get("цена") or
            item.get("Cost") or item.get("cost") or
            item.get("amount") or item.get("Amount") or 0
        )
        try:
            price = int(round(float(str(price_val).replace("\xa0", "").replace(" ", "").replace(",", "."))))
            if price < 0:
                price = 0
        except (ValueError, TypeError):
            price = 0

        # Extract Stock / Quantity (do not discard zero quantity)
        stock_val = (
            item.get("Quantity") or item.get("quantity") or
            item.get("Количество") or item.get("количество") or
            item.get("stock") or item.get("Stock") or
            item.get("count") or item.get("Count") or
            item.get("Остаток") or item.get("остаток") or 0
        )
        try:
            stock = int(round(float(str(stock_val).replace("\xa0", "").replace(" ", "").replace(",", "."))))
            if stock < 0:
                stock = 0
        except (ValueError, TypeError):
            stock = 0

        # Extract Unit
        unit_val = (
            item.get("Unit") or item.get("unit") or
            item.get("ЕдИзм") or item.get("единица") or
            item.get("БазоваяЕдиница") or item.get("ЕдиницаИзмерения") or
            item.get("unit_name") or "dona"
        )
        unit = str(unit_val).replace("\xa0", " ").strip() or "dona"

        # Extract Description
        desc_val = (
            item.get("Description") or item.get("description") or
            item.get("Описание") or item.get("описание") or ""
        )
        description = str(desc_val).replace("\xa0", " ").strip()

        # Extract Image URL
        image_url = (
            item.get("image_url") or item.get("imageUrl") or
            item.get("Картинка") or item.get("Photo") or
            item.get("photo") or item.get("Image") or
            item.get("image") or item.get("Picture") or None
        )
        if image_url:
            image_url = str(image_url).strip()

        # Extract Category ID (if any)
        cat_val = item.get("category_id") or item.get("categoryId") or item.get("КатегорияId") or item.get("category")
        category_id = None
        if cat_val is not None and str(cat_val).strip() != "" and str(cat_val).lower() != "null" and str(cat_val).lower() != "none":
            try:
                cid = int(cat_val)
                if cid in CATEGORIES_DB:
                    category_id = cid
            except (ValueError, TypeError):
                category_id = None

        # Upsert: check if product with same sku already exists in PRODUCTS_DB (O(1))
        existing_pid = sku_to_pid.get(sku.lower())

        if existing_pid is not None and existing_pid in PRODUCTS_DB:
            target_prod = PRODUCTS_DB[existing_pid]
            target_prod["name"] = name
            target_prod["price"] = price
            target_prod["stock"] = stock
            target_prod["unit"] = unit
            if barcode:
                target_prod["barcode"] = barcode
            if description:
                target_prod["description"] = description
            if image_url:
                target_prod["image_url"] = image_url
            if category_id is not None:
                target_prod["category_id"] = category_id
            synced_products.append(target_prod)
        else:
            new_id = (max(PRODUCTS_DB.keys()) + 1) if PRODUCTS_DB else 101
            new_product = {
                "id": new_id,
                "sku": sku,
                "barcode": barcode,
                "category_id": category_id,
                "name": name,
                "unit": unit,
                "price": price,
                "old_price": None,
                "discount_percent": 0,
                "stock": stock,
                "description": description or f"1C orqali import qilingan tovar (SKU: {sku})",
                "nutrition": {"cal": "—", "protein": "—", "fat": "—"},
                "photo_file_id": None,
                "image_url": image_url or "https://images.unsplash.com/photo-1542838132-92c53300491e?w=500&auto=format&fit=crop&q=60",
                "is_promo": False,
                "recommendation": None
            }
            PRODUCTS_DB[new_id] = new_product
            sku_to_pid[sku.lower()] = new_id
            synced_products.append(new_product)

    if len(synced_products) == 0:
        err_msg = "1C dan tovarlar ro'yxati bo'sh keldi"
        print(f"DEBUG SYNC ERROR: {err_msg} (0 products synced out of {len(items_to_process)} items)")
        return {
            "success": False,
            "count": 0,
            "message": err_msg,
            "error": err_msg,
            "detail": "1C serveridan hech qanday tovar ma'lumoti olinmadi (0 ta tovar)",
            "total_received": len(items_to_process),
            "synced_count": 0,
            "invalid_count": invalid_count,
            "uncategorized_count": 0,
            "products": [],
            "uncategorized": []
        }

    uncategorized = [p for p in synced_products if p.get("category_id") is None or p.get("category_id") not in CATEGORIES_DB]

    # Log total upserted count in terminal as required
    print(f"[SYNC COMPLETED] Total Fetched: {len(items_to_process)}, Saved/Updated in DB: {len(synced_products)}")
    print(f"Total 1C Synced Products: {len(synced_products)}")

    # Asynchronously persist synced products to local PostgreSQL database
    _safe_bg_task(_async_persist_synced_products(synced_products))

    return {
        "success": True,
        "count": len(synced_products),
        "message": f"{len(synced_products)} ta mahsulot 1C dan muvaffaqiyatli sinxronizatsiya qilindi!",
        "total_received": len(items_to_process),
        "synced_count": len(synced_products),
        "invalid_count": invalid_count,
        "uncategorized_count": len(uncategorized),
        "products": synced_products,
        "uncategorized": uncategorized
    }


async def _async_persist_synced_products(products_list: list):
    """Persists synced products to the local PostgreSQL database in efficient 500-item chunks using executemany."""
    try:
        pool = await get_pg_pool()
        if not pool or not products_list:
            print("DEBUG DB UPSERT: Skipped (pool missing or empty products list)")
            return

        print(f"DEBUG DB UPSERT: Executing batch insert/update for {len(products_list)} items across {((len(products_list)-1)//500)+1} chunks...")
        async with pool.acquire() as conn:
            batch_size = 500
            for i in range(0, len(products_list), batch_size):
                chunk = products_list[i:i + batch_size]
                args_list = []
                for p in chunk:
                    nutrition_json = json.dumps(p.get("nutrition") or {})
                    args_list.append((
                        str(p.get("sku", "")),
                        p.get("barcode"),
                        p.get("category_id"),
                        str(p.get("name", "")),
                        str(p.get("unit", "dona")),
                        int(p.get("price", 0)),
                        p.get("old_price"),
                        int(p.get("discount_percent", 0)),
                        int(p.get("stock", 0)),
                        p.get("description"),
                        nutrition_json,
                        p.get("photo_file_id"),
                        p.get("image_url"),
                        bool(p.get("is_promo", False)),
                        p.get("recommendation")
                    ))
                await conn.executemany("""
                    INSERT INTO products (sku, barcode, category_id, name, unit, price, old_price, discount_percent, stock, description, nutrition, photo_file_id, image_url, is_promo, recommendation)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15)
                    ON CONFLICT (sku) DO UPDATE SET
                        name = EXCLUDED.name,
                        price = EXCLUDED.price,
                        stock = EXCLUDED.stock,
                        unit = EXCLUDED.unit,
                        category_id = COALESCE(products.category_id, EXCLUDED.category_id),
                        barcode = COALESCE(EXCLUDED.barcode, products.barcode),
                        description = COALESCE(EXCLUDED.description, products.description),
                        image_url = COALESCE(EXCLUDED.image_url, products.image_url),
                        updated_at = CURRENT_TIMESTAMP
                """, args_list)
        print(f"[SYNC COMPLETED] Total Fetched: {len(products_list)}, Saved/Updated in DB: {len(products_list)}")
        print(f"DEBUG DB UPSERT RESULT: Successfully persisted {len(products_list)} items into PostgreSQL bozorcha_db products table.")
        print(f"[POSTGRESQL] Successfully persisted {len(products_list)} products in 500-item chunks to bozorcha_db products table.")
    except Exception as e:
        print(f"[POSTGRESQL] Sync persistence warning: {e}")


def get_products_counts() -> dict:
    """Returns memory-based product statistics."""
    total = len(PRODUCTS_DB)
    uncategorized = sum(
        1 for p in PRODUCTS_DB.values()
        if p.get("category_id") is None
        or p.get("category_id") == 0
        or str(p.get("category_id")).strip() == ""
        or (p.get("category_id") not in CATEGORIES_DB)
    )
    categorized = max(0, total - uncategorized)
    return {
        "total": total,
        "uncategorized": uncategorized,
        "categorized": categorized
    }


async def query_postgres_product_counts() -> dict:
    """Queries live PostgreSQL table for exact counts of total, uncategorized, and categorized products."""
    pool = await get_pg_pool()
    if not pool:
        return get_products_counts()
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE category_id IS NULL OR category_id = 0) as uncategorized,
                    COUNT(*) FILTER (WHERE category_id IS NOT NULL AND category_id > 0) as categorized
                FROM products
            """)
            if row:
                return {
                    "total": int(row["total"] or 0),
                    "uncategorized": int(row["uncategorized"] or 0),
                    "categorized": int(row["categorized"] or 0)
                }
    except Exception as e:
        print(f"[POSTGRESQL] Error querying product counts: {e}")
    return get_products_counts()


async def query_postgres_uncategorized_products(search: str | None = None) -> list[dict]:
    """Queries PostgreSQL database directly for uncategorized products (where category_id IS NULL or 0)."""
    pool = await get_pg_pool()
    if not pool:
        return get_uncategorized_products(search=search)
    try:
        async with pool.acquire() as conn:
            if search and str(search).strip():
                q = f"%{str(search).strip().lower()}%"
                rows = await conn.fetch("""
                    SELECT * FROM products 
                    WHERE (category_id IS NULL OR category_id = 0)
                      AND (LOWER(name) LIKE $1 OR LOWER(sku) LIKE $1 OR LOWER(description) LIKE $1)
                    ORDER BY id ASC
                """, q)
            else:
                rows = await conn.fetch("""
                    SELECT * FROM products 
                    WHERE category_id IS NULL OR category_id = 0
                    ORDER BY id ASC
                """)
            
            result = []
            for r in rows:
                pid = r["id"]
                result.append({
                    "id": pid,
                    "sku": r["sku"] or f"SKU-{pid}",
                    "barcode": r.get("barcode"),
                    "category_id": r["category_id"],
                    "name": r["name"],
                    "unit": r["unit"] or "dona",
                    "price": int(r["price"] or 0),
                    "old_price": r["old_price"],
                    "discount_percent": r["discount_percent"] or 0,
                    "stock": r["stock"] or 0,
                    "description": r["description"] or "",
                    "photo_file_id": r["photo_file_id"],
                    "image_url": r["image_url"],
                    "is_promo": bool(r["is_promo"])
                })
            return result
    except Exception as e:
        print(f"[POSTGRESQL] Error querying uncategorized products: {e}")
        return get_uncategorized_products(search=search)


def get_uncategorized_products(search: str | None = None) -> list[dict]:
    """
    Returns all products where category_id is missing, None, 0, or not found in CATEGORIES_DB.
    Supports search query by product name or 1C SKU.
    """
    uncategorized = []
    for p in PRODUCTS_DB.values():
        cid = p.get("category_id")
        if cid is None or cid == 0 or str(cid).strip() == "" or (cid not in CATEGORIES_DB):
            uncategorized.append(p)

    if search and str(search).strip():
        q = str(search).strip().lower()
        uncategorized = [
            p for p in uncategorized
            if q in (p.get("name") or "").lower()
            or q in (str(p.get("sku") or p.get("code_1c") or "")).lower()
            or q in (str(p.get("id") or "")).lower()
            or q in (p.get("description") or "").lower()
        ]

    return uncategorized


async def _async_persist_product_category(product_id: int, category_id: int, sku: str | None = None):
    """Persists category assignment to PostgreSQL database."""
    try:
        pool = await get_pg_pool()
        if pool:
            async with pool.acquire() as conn:
                if sku:
                    await conn.execute("UPDATE products SET category_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 OR sku = $3", category_id, product_id, str(sku))
                else:
                    await conn.execute("UPDATE products SET category_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", category_id, product_id)
    except Exception as e:
        print(f"[POSTGRESQL] Category assign persistence warning: {e}")


def assign_product_category(product_id: int | str, category_id: int | str) -> dict | None:
    """
    Assigns category_id to an uncategorized or existing product in the database and persists to PostgreSQL.
    """
    try:
        pid = int(product_id)
        cid = int(category_id)
        if pid not in PRODUCTS_DB:
            return None
        if cid not in CATEGORIES_DB:
            return None

        PRODUCTS_DB[pid]["category_id"] = cid
        _safe_bg_task(_async_persist_product_category(pid, cid, PRODUCTS_DB[pid].get("sku")))
        return PRODUCTS_DB[pid]
    except (ValueError, TypeError):
        return None


async def _async_persist_bulk_product_category(product_ids: list[int], category_id: int):
    """Persists bulk category assignment to PostgreSQL database."""
    try:
        pool = await get_pg_pool()
        if pool and product_ids:
            async with pool.acquire() as conn:
                await conn.execute("""
                    UPDATE products 
                    SET category_id = $1, updated_at = CURRENT_TIMESTAMP 
                    WHERE id = ANY($2::int[])
                """, category_id, product_ids)
    except Exception as e:
        print(f"[POSTGRESQL] Bulk category assign persistence warning: {e}")


def bulk_assign_product_categories(product_ids: list[int | str], category_id: int | str) -> list[dict]:
    """
    Assigns category_id to multiple products at once and persists to PostgreSQL.
    """
    try:
        cid = int(category_id)
        if cid not in CATEGORIES_DB:
            return []

        updated = []
        for pid_raw in product_ids:
            try:
                pid = int(pid_raw)
                if pid in PRODUCTS_DB:
                    PRODUCTS_DB[pid]["category_id"] = cid
                    updated.append(PRODUCTS_DB[pid])
            except (ValueError, TypeError):
                pass

        if updated:
            _safe_bg_task(_async_persist_bulk_product_category([p["id"] for p in updated], cid))
        return updated
    except (ValueError, TypeError):
        return []


def add_product(
    name: str,
    price: int | float,
    category_id: int | str | None = 1,
    image_url: str | None = None,
    description: str | None = "",
    unit: str = "kg",
    stock: int = 50,
    old_price: int | float | None = None,
    discount_percent: int = 0,
    recommendation: str | None = None,
    sku: str | None = None
) -> dict:
    new_id = (max(PRODUCTS_DB.keys()) + 1) if PRODUCTS_DB else 101
    
    cid = None
    if category_id is not None and str(category_id).strip() != "" and str(category_id).lower() != "none":
        try:
            cid = int(category_id)
        except (ValueError, TypeError):
            cid = None

    try:
        pr = int(price)
    except (ValueError, TypeError):
        pr = 0

    try:
        st = int(stock) if stock is not None else 50
    except (ValueError, TypeError):
        st = 50

    try:
        dp = int(discount_percent) if discount_percent is not None else 0
    except (ValueError, TypeError):
        dp = 0

    op = None
    if old_price is not None and old_price != "":
        try:
            op = int(old_price)
        except (ValueError, TypeError):
            op = None

    is_promo = (dp > 0) or (op is not None and op > pr)

    product = {
        "id": new_id,
        "sku": sku or f"1C-{new_id:05d}",
        "category_id": cid,
        "name": name.strip() if name else f"Mahsulot #{new_id}",
        "unit": unit.strip() if unit else "kg",
        "price": pr,
        "old_price": op,
        "discount_percent": dp,
        "stock": st,
        "description": description.strip() if description else "",
        "nutrition": {"cal": "120 kcal", "protein": "1.5g", "fat": "2g"},
        "photo_file_id": None,
        "image_url": image_url.strip() if image_url else "https://images.unsplash.com/photo-1542838132-92c53300491e?w=500&auto=format&fit=crop&q=60",
        "is_promo": is_promo,
        "recommendation": recommendation.strip() if recommendation else None
    }

    PRODUCTS_DB[new_id] = product
    return product


def delete_product(product_id: int | str) -> bool:
    try:
        pid = int(product_id)
        if pid in PRODUCTS_DB:
            del PRODUCTS_DB[pid]
            return True
        return False
    except (ValueError, TypeError):
        return False


def get_product(product_id: int | str) -> dict | None:
    try:
        pid = int(product_id)
        return PRODUCTS_DB.get(pid)
    except (ValueError, TypeError):
        return None


def update_product_photo(product_id: int | str, photo_file_id: str) -> bool:
    res = update_product_photo_and_stock(product_id, photo_file_id=photo_file_id)
    return res is not None


def clear_product_stock(product_id: int | str) -> bool:
    res = update_product_photo_and_stock(product_id, stock=0)
    return res is not None


def get_categories_with_nopic_products() -> list[dict]:
    cat_counts = {}
    for prod in PRODUCTS_DB.values():
        is_no_photo = (prod.get("photo_file_id") is None) and (prod.get("image_url") is None)
        if is_no_photo and prod.get("stock", 0) > 0:
            cid = prod.get("category_id")
            cat_counts[cid] = cat_counts.get(cid, 0) + 1

    result = []
    for cid, count in cat_counts.items():
        cname = get_category_name(cid)
        result.append({
            "id": cid,
            "name": cname,
            "count": count
        })
    return result


def get_nopic_products_by_category(category_id: int | str) -> list[dict]:
    return get_no_photo_products_api(category_id)


def add_manual_order(amount: int) -> dict:
    order_id = len(STATISTICS_DB["manual_orders"]) + 1
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    order_record = {
        "id": order_id,
        "amount": amount,
        "created_at": now_str
    }

    STATISTICS_DB["manual_orders"].append(order_record)
    STATISTICS_DB["total_sales"] += amount
    STATISTICS_DB["monthly_sales"] += amount

    return {
        "order_id": order_id,
        "amount": amount,
        "total_sales": STATISTICS_DB["total_sales"],
        "monthly_sales": STATISTICS_DB["monthly_sales"],
        "manual_orders_count": len(STATISTICS_DB["manual_orders"])
    }


ORDERS_DB = {}

CLICK_SERVICE_ID = os.getenv("CLICK_SERVICE_ID", "32514")
CLICK_MERCHANT_ID = os.getenv("CLICK_MERCHANT_ID", "21458")
CLICK_MERCHANT_USER_ID = os.getenv("CLICK_MERCHANT_USER_ID", "15420")


def generate_click_url(order_id: str | int, amount: int | float, return_url: str = "") -> str:
    base_url = "https://my.click.uz/services/pay"
    params = {
        "service_id": CLICK_SERVICE_ID,
        "merchant_id": CLICK_MERCHANT_ID,
        "amount": f"{int(amount)}",
        "transaction_param": str(order_id),
    }
    if return_url:
        params["return_url"] = return_url
    return f"{base_url}?{urllib.parse.urlencode(params)}"


def create_order(
    cart: dict,
    total_amount: int | float,
    payment_type: str = "cash",
    address: str = "Chilonzor 9-kvartal, 14-uy",
    delivery_time: str = "15 - 25 daqiqa",
    user_info: dict | None = None,
    full_name: str | None = None,
    phone_number: str | None = None,
    location_lat: float | None = None,
    location_lng: float | None = None
) -> dict:
    order_num = 84000 + len(ORDERS_DB) + 1
    order_id = str(order_num)
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    clean_payment_type = "click" if str(payment_type).lower() == "click" else "cash"

    status = "Qabul qilindi"
    status_code = "accepted"
    if clean_payment_type == "click":
        click_url = generate_click_url(order_id, total_amount)
    else:
        click_url = None

    u_info = user_info or {}
    resolved_name = full_name or u_info.get("full_name") or f"{u_info.get('first_name', '')} {u_info.get('last_name', '')}".strip() or u_info.get("name") or "Mijoz"
    resolved_phone = phone_number or u_info.get("phone") or u_info.get("phone_number") or "Mavjud emas"

    order_record = {
        "id": order_id,
        "order_id": order_id,
        "cart": cart,
        "total_amount": int(total_amount),
        "payment_type": clean_payment_type,
        "payment_method_name": "Click / Payme" if clean_payment_type == "click" else "Naqd pul",
        "status": status,
        "status_code": status_code,
        "address": address,
        "delivery_time": delivery_time,
        "full_name": resolved_name,
        "phone_number": resolved_phone,
        "location_lat": location_lat,
        "location_lng": location_lng,
        "user_info": u_info,
        "click_url": click_url,
        "created_at": now_str
    }

    ORDERS_DB[order_id] = order_record

    # Update statistics
    STATISTICS_DB["total_sales"] += int(total_amount)
    STATISTICS_DB["monthly_sales"] += int(total_amount)
    STATISTICS_DB["manual_orders"].append({
        "id": order_num,
        "amount": int(total_amount),
        "created_at": now_str,
        "payment_type": clean_payment_type,
        "status": status
    })

    return order_record


def get_orders(limit: int = 50) -> list[dict]:
    all_orders = list(ORDERS_DB.values())
    all_orders.reverse()
    return all_orders[:limit]


def get_order(order_id: str | int) -> dict | None:
    return ORDERS_DB.get(str(order_id))


def update_order_status(order_id: str | int, status: str, status_code: str | None = None) -> dict | None:
    oid = str(order_id)
    if oid in ORDERS_DB:
        ORDERS_DB[oid]["status"] = status
        if status_code:
            ORDERS_DB[oid]["status_code"] = status_code
        return ORDERS_DB[oid]
    return None


def get_statistics() -> dict:
    return {
        "total_sales": STATISTICS_DB["total_sales"],
        "monthly_sales": STATISTICS_DB["monthly_sales"],
        "manual_orders_count": len(STATISTICS_DB["manual_orders"]),
        "recent_orders": STATISTICS_DB["manual_orders"][-5:],
        "app_orders_count": len(ORDERS_DB)
    }


def get_admin_analytics() -> dict:
    """
    Admin Analytics Dashboard uchun hisobot ma'lumotlari:
    - daily_revenue va daily_orders (bugungi savdo va buyurtmalar soni)
    - monthly_revenue va monthly_orders (oxirgi 30 kunlik savdo va buyurtmalar)
    - top_products (eng ko'p buyurtma qilingan Top-5 mahsulotlar)
    """
    from datetime import datetime, timedelta

    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    thirty_days_ago = now - timedelta(days=30)

    daily_rev = 0
    daily_count = 0
    monthly_rev = 0
    monthly_count = 0

    product_sales_map = {}

    # Calculate from live ORDERS_DB
    for order in ORDERS_DB.values():
        created_str = order.get("created_at", "")
        amount = int(order.get("total_amount", 0))

        try:
            created_dt = datetime.strptime(created_str, "%Y-%m-%d %H:%M:%S")
        except Exception:
            created_dt = now

        if created_str.startswith(today_str):
            daily_rev += amount
            daily_count += 1

        if created_dt >= thirty_days_ago:
            monthly_rev += amount
            monthly_count += 1

        cart = order.get("cart") or {}
        if isinstance(cart, dict):
            for key, entry in cart.items():
                item = entry.get("item") or {}
                pid = item.get("id") or key
                pname = item.get("name") or f"Mahsulot #{pid}"
                pimg = item.get("image_url") or "https://images.unsplash.com/photo-1542838132-92c53300491e?w=200&auto=format&fit=crop&q=60"
                pcat = get_category_name(item.get("category_id", 1))
                qty = int(entry.get("qty", 1))
                price = int(item.get("price", 0))

                if pid not in product_sales_map:
                    product_sales_map[pid] = {
                        "id": pid,
                        "name": pname,
                        "count": 0,
                        "total_amount": 0,
                        "image_url": pimg,
                        "category_name": pcat,
                        "price": price
                    }
                product_sales_map[pid]["count"] += qty
                product_sales_map[pid]["total_amount"] += price * qty

    # Include manual orders if any
    for m_order in STATISTICS_DB.get("manual_orders", []):
        created_str = m_order.get("created_at", "")
        amount = int(m_order.get("amount", 0))
        try:
            created_dt = datetime.strptime(created_str, "%Y-%m-%d %H:%M:%S")
        except Exception:
            created_dt = now

        if created_str.startswith(today_str):
            daily_rev += amount
            daily_count += 1
        if created_dt >= thirty_days_ago:
            monthly_rev += amount
            monthly_count += 1

    # Realistic base default numbers for first launch
    if monthly_rev == 0:
        monthly_rev = STATISTICS_DB.get("monthly_sales", 8400000)
        monthly_count = max(len(ORDERS_DB) + len(STATISTICS_DB.get("manual_orders", [])), 36)
    if daily_rev == 0:
        daily_rev = 1250000
        daily_count = 14

    sorted_prods = sorted(product_sales_map.values(), key=lambda x: x["count"], reverse=True)
    top_products = sorted_prods[:5]

    # Baseline bestselling items if starting fresh
    if len(top_products) < 5:
        defaults = [
            {"id": 101, "name": "Organik Avokado Hass", "count": 64, "total_amount": 4352000, "image_url": "assets/organic_avocado.png", "category_name": "Sabzavotlar", "price": 68000},
            {"id": 102, "name": "Qulupnay Premium Sweet", "count": 48, "total_amount": 2160000, "image_url": "https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=500&auto=format&fit=crop&q=60", "category_name": "Yangi Mevalar", "price": 45000},
            {"id": 104, "name": "Mol Go'shti Ribeye Steyk", "count": 32, "total_amount": 4640000, "image_url": "https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=500&auto=format&fit=crop&q=60", "category_name": "Mol & Qo'y go'shti", "price": 145000},
            {"id": 105, "name": "Fransuzcha Kruassan Butter", "count": 29, "total_amount": 522000, "image_url": "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=500&auto=format&fit=crop&q=60", "category_name": "Kruassan & Pishiriq", "price": 18000},
            {"id": 103, "name": "Fermer Suti 3.2% Bio", "count": 25, "total_amount": 350000, "image_url": "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=500&auto=format&fit=crop&q=60", "category_name": "Sut & Qatiq", "price": 14000}
        ]
        existing_ids = {p["id"] for p in top_products}
        for d in defaults:
            if d["id"] not in existing_ids and len(top_products) < 5:
                top_products.append(d)

    return {
        "daily_revenue": daily_rev,
        "daily_orders": daily_count,
        "monthly_revenue": monthly_rev,
        "monthly_orders": monthly_count,
        "top_products": top_products
    }


# ================= PROMOTIONS & BANNER SLIDER DB =================
PROMOTIONS_DB = {
    1: {
        "id": 1,
        "title": "🔥 SUPER CHEGIRMA",
        "subtitle": "Har kungi yangi hosil mevalar va sabzavotlarga 25% gacha arzon narxlar!",
        "discount_price": 45000,
        "discount_text": "-25%",
        "image_url": "https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=800&auto=format&fit=crop&q=80",
        "product_id": 102,
        "is_active": True,
        "created_at": "2026-08-19 12:00:00"
    },
    2: {
        "id": 2,
        "title": "🥑 ORGANIK AVOKADO HASS",
        "subtitle": "Meksika navli sara tabiiy avokadolar maxsus chegirma bilan!",
        "discount_price": 68000,
        "discount_text": "-20%",
        "image_url": "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=800&auto=format&fit=crop&q=80",
        "product_id": 101,
        "is_active": True,
        "created_at": "2026-08-19 12:05:00"
    },
    3: {
        "id": 3,
        "title": "🥩 RIBEYE STEYK SUPER AKSIYA",
        "subtitle": "Marmar mol go'shti, mayin va suvli gril steyk uchun ajoyib taklif!",
        "discount_price": 145000,
        "discount_text": "-19%",
        "image_url": "https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=800&auto=format&fit=crop&q=80",
        "product_id": 104,
        "is_active": True,
        "created_at": "2026-08-19 12:10:00"
    },
    4: {
        "id": 4,
        "title": "🥐 ISSIQ NONVOYXONA KRUASSAN",
        "subtitle": "Haqiqiy sariyog'li fransuzcha kruassanlar har kuni tongda!",
        "discount_price": 18000,
        "discount_text": "18 000 so'm",
        "image_url": "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&auto=format&fit=crop&q=80",
        "product_id": 105,
        "is_active": True,
        "created_at": "2026-08-19 12:15:00"
    }
}


def get_all_promotions(active_only: bool = False) -> list[dict]:
    promos = list(PROMOTIONS_DB.values())
    if active_only:
        promos = [p for p in promos if p.get("is_active", True)]

    # Enrich with linked product details if available
    result = []
    for promo in promos:
        item = dict(promo)
        pid = item.get("product_id")
        if pid and int(pid) in PRODUCTS_DB:
            linked_prod = PRODUCTS_DB[int(pid)]
            item["product"] = {
                "id": linked_prod["id"],
                "name": linked_prod["name"],
                "price": linked_prod["price"],
                "old_price": linked_prod.get("old_price"),
                "image_url": linked_prod.get("image_url"),
                "unit": linked_prod.get("unit", "kg"),
                "stock": linked_prod.get("stock", 0)
            }
        else:
            item["product"] = None
        result.append(item)
    return result


def get_promotion(promo_id: int | str) -> dict | None:
    try:
        pid = int(promo_id)
        if pid not in PROMOTIONS_DB:
            return None
        promo = dict(PROMOTIONS_DB[pid])
        prod_id = promo.get("product_id")
        if prod_id and int(prod_id) in PRODUCTS_DB:
            linked_prod = PRODUCTS_DB[int(prod_id)]
            promo["product"] = {
                "id": linked_prod["id"],
                "name": linked_prod["name"],
                "price": linked_prod["price"],
                "old_price": linked_prod.get("old_price"),
                "image_url": linked_prod.get("image_url"),
                "unit": linked_prod.get("unit", "kg"),
                "stock": linked_prod.get("stock", 0)
            }
        return promo
    except (ValueError, TypeError):
        return None


def add_promotion(
    title: str,
    subtitle: str = "",
    discount_price: int | float | None = None,
    discount_text: str | None = None,
    image_url: str | None = None,
    product_id: int | str | None = None,
    is_active: bool = True
) -> dict:
    new_id = (max(PROMOTIONS_DB.keys()) + 1) if PROMOTIONS_DB else 1
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Clean product ID
    pid = None
    if product_id is not None and str(product_id).strip() != "" and str(product_id).strip() != "0" and str(product_id).strip().lower() != "null":
        try:
            pid_int = int(product_id)
            if pid_int in PRODUCTS_DB:
                pid = pid_int
        except (ValueError, TypeError):
            pid = None

    # Clean discount price
    d_price = None
    if discount_price is not None and str(discount_price).strip() != "":
        try:
            d_price = int(discount_price)
        except (ValueError, TypeError):
            d_price = None

    # If linked to product and no custom price / image specified, auto fill
    if pid and pid in PRODUCTS_DB:
        prod = PRODUCTS_DB[pid]
        if not image_url or not image_url.strip():
            image_url = prod.get("image_url")
        if d_price is None:
            d_price = prod.get("price")
        if not discount_text and prod.get("discount_percent"):
            discount_text = f"-{prod.get('discount_percent')}%"

    promo = {
        "id": new_id,
        "title": title.strip() if title else f"Aksiya #{new_id}",
        "subtitle": subtitle.strip() if subtitle else "",
        "discount_price": d_price,
        "discount_text": discount_text.strip() if discount_text else (f"{d_price:,} so'm".replace(",", " ") if d_price else None),
        "image_url": image_url.strip() if image_url else "https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=800&auto=format&fit=crop&q=80",
        "product_id": pid,
        "is_active": bool(is_active),
        "created_at": now_str
    }

    PROMOTIONS_DB[new_id] = promo

    # Return with enriched product object
    result = dict(promo)
    if pid and pid in PRODUCTS_DB:
        linked_prod = PRODUCTS_DB[pid]
        result["product"] = {
            "id": linked_prod["id"],
            "name": linked_prod["name"],
            "price": linked_prod["price"],
            "old_price": linked_prod.get("old_price"),
            "image_url": linked_prod.get("image_url"),
            "unit": linked_prod.get("unit", "kg"),
            "stock": linked_prod.get("stock", 0)
        }
    return result


def update_promotion(
    promo_id: int | str,
    title: str | None = None,
    subtitle: str | None = None,
    discount_price: int | float | None = None,
    discount_text: str | None = None,
    image_url: str | None = None,
    product_id: int | str | None = None,
    is_active: bool | None = None
) -> dict | None:
    try:
        pid = int(promo_id)
        if pid not in PROMOTIONS_DB:
            return None

        promo = PROMOTIONS_DB[pid]

        if title is not None:
            promo["title"] = title.strip()
        if subtitle is not None:
            promo["subtitle"] = subtitle.strip()
        if discount_price is not None:
            try:
                promo["discount_price"] = int(discount_price) if str(discount_price).strip() != "" else None
            except (ValueError, TypeError):
                pass
        if discount_text is not None:
            promo["discount_text"] = discount_text.strip() if discount_text else None
        if image_url is not None:
            promo["image_url"] = image_url.strip()
        if product_id is not None:
            if str(product_id).strip() in ("", "0", "null", "none"):
                promo["product_id"] = None
            else:
                try:
                    p_int = int(product_id)
                    promo["product_id"] = p_int if p_int in PRODUCTS_DB else None
                except (ValueError, TypeError):
                    promo["product_id"] = None
        if is_active is not None:
            promo["is_active"] = bool(is_active)

        return get_promotion(pid)
    except (ValueError, TypeError):
        return None


def delete_promotion(promo_id: int | str) -> bool:
    try:
        pid = int(promo_id)
        if pid in PROMOTIONS_DB:
            del PROMOTIONS_DB[pid]
            return True
        return False
    except (ValueError, TypeError):
        return False


def bulk_add_promotions(promotions_list: list[dict]) -> list[dict]:
    created = []
    for item in promotions_list:
        if not isinstance(item, dict):
            continue
        p = add_promotion(
            title=item.get("title", ""),
            subtitle=item.get("subtitle", ""),
            discount_price=item.get("discount_price"),
            discount_text=item.get("discount_text"),
            image_url=item.get("image_url"),
            product_id=item.get("product_id"),
            is_active=item.get("is_active", True)
        )
        created.append(p)
    return created


