from datetime import datetime

CATEGORIES_DB = {
    1: "Meva & Sabzavotlar",
    2: "Sut & Tuxum",
    3: "Go'sht & Baliq",
    4: "Non & Pishiriqlar",
    5: "Ichimliklar"
}

PRODUCTS_DB = {
    101: {
        "id": 101,
        "category_id": 1,
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
        "category_id": 1,
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
        "category_id": 2,
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
        "category_id": 3,
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
        "category_id": 4,
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
        "category_id": 5,
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
    }
}

STATISTICS_DB = {
    "total_sales": 28500000,
    "monthly_sales": 8400000,
    "manual_orders": []
}


def get_all_products(page: int = 1, limit: int = 100) -> dict:
    all_prods = list(PRODUCTS_DB.values())
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
        if (prod.get("old_price", 0) > prod.get("price", 0)) or prod.get("is_promo")
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


def add_product(
    name: str,
    price: int | float,
    category_id: int | str = 1,
    image_url: str | None = None,
    description: str | None = "",
    unit: str = "kg",
    stock: int = 50,
    old_price: int | float | None = None,
    discount_percent: int = 0,
    recommendation: str | None = None
) -> dict:
    new_id = (max(PRODUCTS_DB.keys()) + 1) if PRODUCTS_DB else 101
    try:
        cid = int(category_id)
    except (ValueError, TypeError):
        cid = 1

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
        cname = CATEGORIES_DB.get(cid, f"Kategoriya #{cid}")
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


def get_statistics() -> dict:
    return {
        "total_sales": STATISTICS_DB["total_sales"],
        "monthly_sales": STATISTICS_DB["monthly_sales"],
        "manual_orders_count": len(STATISTICS_DB["manual_orders"]),
        "recent_orders": STATISTICS_DB["manual_orders"][-5:]
    }
