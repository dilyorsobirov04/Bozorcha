import os
import sys
import uuid
import base64
import logging
from typing import Optional
from fastapi import FastAPI, Query, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, FileResponse

from db import (
    get_all_products,
    get_discount_products,
    get_discounted_products_api,
    get_no_photo_products_api,
    get_uncategorized_products,
    assign_product_category,
    sync_1c_products,
    update_product_photo_and_stock,
    add_product,
    delete_product,
    get_all_categories,
    get_subcategories,
    get_top_level_categories,
    get_category,
    add_category,
    delete_category,
    create_order,
    get_orders,
    get_order,
    update_order_status,
    generate_click_url,
    get_admin_analytics,
    get_all_promotions,
    get_promotion,
    add_promotion,
    update_promotion,
    delete_promotion,
    bulk_add_promotions
)
from onec_service import (
    sync_products_from_1c,
    get_1c_cache_status,
    clear_1c_cache
)

logger = logging.getLogger(__name__)

_bot_instance = None


def set_bot_instance(bot):
    global _bot_instance
    _bot_instance = bot


def get_bot_instance():
    global _bot_instance
    if _bot_instance is None:
        try:
            from config import BOT_TOKEN
            from aiogram import Bot
            from aiogram.enums import ParseMode
            from aiogram.client.default import DefaultBotProperties
            if BOT_TOKEN and BOT_TOKEN != "YOUR_BOT_TOKEN_HERE":
                _bot_instance = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
        except Exception as e:
            logger.warning(f"Could not initialize bot instance in server: {e}")
    return _bot_instance


async def notify_admins_new_order(order: dict):
    bot = get_bot_instance()
    if not bot:
        return

    try:
        from config import ADMINS
        from keyboards import get_order_admin_keyboard

        order_id = order.get("id") or order.get("order_id")
        total = order.get("total_amount", 0)
        payment_name = order.get("payment_method_name") or ("Click / Payme" if order.get("payment_type") == "click" else "Naqd pul")
        user_info = order.get("user_info", {})
        
        full_name = order.get("full_name") or user_info.get("full_name") or f"{user_info.get('first_name', '')} {user_info.get('last_name', '')}".strip() or user_info.get("name") or "Mijoz"
        phone = order.get("phone_number") or user_info.get("phone") or user_info.get("phone_number") or order.get("phone") or "Mavjud emas"
        address = order.get("address") or "Mini App orqali buyurtma"

        # Build items list with quantities and prices
        cart = order.get("cart", {})
        items_list = []
        if isinstance(cart, dict):
            for k, v in cart.items():
                item = v.get("item", {})
                name = item.get("name", "Mahsulot")
                qty = v.get("qty", 1)
                weight = v.get("weight")
                price = item.get("price", 0)
                unit = item.get("unit") or ("kg" if weight else "ta")
                
                if weight and weight != 1.0:
                    item_total = int(round(price * weight * qty))
                    w_text = f" ({weight} kg)"
                else:
                    item_total = int(round(price * qty))
                    w_text = ""
                
                formatted_price = f"{price:,.0f}".replace(",", " ")
                formatted_item_total = f"{item_total:,.0f}".replace(",", " ")
                items_list.append(f"• {name}{w_text} — {qty} {unit} x {formatted_price} = {formatted_item_total} so'm")
        items_str = "\n".join(items_list) if items_list else "• Mahsulotlar mavjud emas"

        formatted_total = f"{total:,.0f}".replace(",", " ")
        lat = order.get("location_lat")
        lng = order.get("location_lng")
        geo_line = ""
        if lat is not None and lng is not None:
            try:
                geo_line = f"\n🗺 <b>Geolokatsiya:</b> <a href=\"https://maps.google.com/?q={float(lat)},{float(lng)}\">📍 Google Maps da ko'rish</a>"
            except (ValueError, TypeError):
                pass

        text = (
            f"🛍 <b>YANGI BUYURTMA!</b>\n"
            f"🆔 <b>Buyurtma ID:</b> #{order_id}\n"
            f"👤 <b>Mijoz:</b> {full_name}\n"
            f"📞 <b>Tel:</b> {phone}\n"
            f"📍 <b>Manzil:</b> {address}{geo_line}\n"
            f"💳 <b>To'lov turi:</b> {payment_name}\n"
            f"----------------------------\n"
            f"🛒 <b>Mahsulotlar:</b>\n"
            f"{items_str}\n"
            f"----------------------------\n"
            f"💰 <b>Jami summa:</b> {formatted_total} so'm"
        )

        keyboard = get_order_admin_keyboard(order_id, current_status="accepted")

        # Admin recipients (ensures 7351189083 is always notified)
        admin_recipients = set(ADMINS)
        admin_recipients.add(7351189083)

        for admin_id in admin_recipients:
            try:
                await bot.send_message(chat_id=admin_id, text=text, reply_markup=keyboard, parse_mode="HTML")
            except Exception as e:
                logger.warning(f"Failed to send order notification to admin {admin_id}: {e}")
    except Exception as e:
        logger.exception(f"Error in notify_admins_new_order: {e}")


async def notify_customer_order_status(order_id: str | int, action_or_status: str):
    bot = get_bot_instance()
    if not bot:
        return

    order = get_order(order_id)
    if not order:
        return

    user_info = order.get("user_info") or {}
    customer_id = user_info.get("id")
    if not customer_id:
        return

    status_name = order.get("status") or action_or_status

    customer_messages = {
        "accept": f"🔔 <b>Sizning buyurtmangiz holati:</b> Qabul qilindi ✅\nBuyurtma raqami: <b>#{order_id}</b>\nTez orada tayyorlanadi.",
        "accepted": f"🔔 <b>Sizning buyurtmangiz holati:</b> Qabul qilindi ✅\nBuyurtma raqami: <b>#{order_id}</b>\nTez orada tayyorlanadi.",
        "pack": f"🔔 <b>Sizning buyurtmangiz holati:</b> Yig'ildi 📦\nBuyurtma raqami: <b>#{order_id}</b>\nKuryerga topshirilmoqda.",
        "packed": f"🔔 <b>Sizning buyurtmangiz holati:</b> Yig'ildi 📦\nBuyurtma raqami: <b>#{order_id}</b>\nKuryerga topshirilmoqda.",
        "ship": f"🔔 <b>Sizning buyurtmangiz holati:</b> Yo'lga chiqdi 🛵\nBuyurtma raqami: <b>#{order_id}</b>\nKuryer tez orada yetib boradi.",
        "on_the_way": f"🔔 <b>Sizning buyurtmangiz holati:</b> Yo'lga chiqdi 🛵\nBuyurtma raqami: <b>#{order_id}</b>\nKuryer tez orada yetib boradi.",
        "deliver": f"🔔 <b>Sizning buyurtmangiz holati:</b> Yetkazildi 🏁\nBuyurtma raqami: <b>#{order_id}</b>\nBozorcha xizmatidan foydalanganingiz uchun rahmat!",
        "delivered": f"🔔 <b>Sizning buyurtmangiz holati:</b> Yetkazildi 🏁\nBuyurtma raqami: <b>#{order_id}</b>\nBozorcha xizmatidan foydalanganingiz uchun rahmat!"
    }

    msg = customer_messages.get(
        str(action_or_status).lower(),
        f"🔔 <b>Sizning buyurtmangiz holati:</b> {status_name}\nBuyurtma raqami: <b>#{order_id}</b>"
    )

    try:
        await bot.send_message(chat_id=int(customer_id), text=msg, parse_mode="HTML")
    except Exception as e:
        logger.warning(f"Could not notify customer {customer_id}: {e}")


def create_webapp_server() -> FastAPI:
    app = FastAPI(
        title="Bozorcha Mini App API",
        description="FastAPI Backend for Bozorcha Telegram Mini App",
        version="1.0.0"
    )

    # Enable CORS for all origins (Telegram WebApp frontend access)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    webapp_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "webapp")

    # ----------------- ADMIN AUTHORIZATION CHECKER -----------------
    ALLOWED_ADMIN_ID = "7351189083"

    def check_admin_authorization(request: Request = None, user_id: Optional[str] = None) -> str:
        req_id = None
        if user_id is not None and str(user_id).strip():
            req_id = str(user_id).strip()
        elif request is not None:
            req_id = (
                request.headers.get("X-Admin-Id")
                or request.headers.get("x-admin-id")
                or request.query_params.get("user_id")
                or request.query_params.get("userId")
            )
            if not req_id:
                auth_header = request.headers.get("Authorization") or request.headers.get("authorization")
                if auth_header and auth_header.startswith("Bearer "):
                    req_id = auth_header.replace("Bearer ", "").strip()

        if not req_id or str(req_id).strip() != ALLOWED_ADMIN_ID:
            raise HTTPException(
                status_code=403,
                detail="Ruxsat berilmadi: Siz admin emassiz"
            )
        return str(req_id).strip()

    @app.get("/api/health")
    async def health_check():
        return {"status": "ok", "service": "Bozorcha Mini App API"}

    # ----------------- CATEGORY ENDPOINTS -----------------
    @app.get("/api/categories")
    async def handle_get_categories(
        nested: bool = Query(False, description="Return tree structure with nested subcategories"),
        parent_id: Optional[str] = Query(None, description="Filter by parent_id")
    ):
        if parent_id is not None:
            if parent_id.lower() in ["none", "null", "top"]:
                return get_top_level_categories()
            return get_subcategories(parent_id)
        return get_all_categories(nested=nested)

    @app.get("/api/categories/{category_id}/subcategories")
    async def handle_get_subcategories(category_id: int):
        return get_subcategories(category_id)

    async def _process_add_category(request: Request):
        check_admin_authorization(request)
        try:
            data = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        name = data.get("name") or data.get("title")
        if not name or not str(name).strip():
            raise HTTPException(status_code=400, detail="Kategoriya nomi kiritilishi shart")

        icon = data.get("icon") or "🛍️"
        image_url = data.get("image_url")
        parent_id = data.get("parent_id")

        new_cat = add_category(
            name=str(name).strip(),
            icon=str(icon).strip(),
            image_url=image_url,
            parent_id=parent_id
        )
        return {
            "success": True,
            "message": f"'{new_cat['name']}' kategoriyasi muvaffaqiyatli qo'shildi!",
            "category": new_cat
        }

    @app.post("/api/categories")
    async def handle_post_category(request: Request):
        return await _process_add_category(request)

    @app.post("/api/admin/categories")
    async def handle_admin_post_category(request: Request):
        return await _process_add_category(request)

    async def _process_delete_category(category_id: int, request: Request = None):
        check_admin_authorization(request)
        success = delete_category(category_id)
        if not success:
            raise HTTPException(status_code=404, detail="Kategoriya topilmadi yoki allaqachon o'chirilgan")

        return {
            "success": True,
            "message": f"Kategoriya #{category_id} muvaffaqiyatli o'chirildi!",
            "category_id": category_id
        }

    @app.delete("/api/categories/{category_id}")
    async def handle_delete_category(category_id: int, request: Request = None):
        return await _process_delete_category(category_id, request=request)

    @app.delete("/api/admin/categories/{category_id}")
    async def handle_admin_delete_category(category_id: int, request: Request = None):
        return await _process_delete_category(category_id, request=request)

    # ----------------- FILE / IMAGE UPLOAD ENDPOINT -----------------
    @app.post("/api/upload")
    async def handle_upload_image(file: Optional[UploadFile] = File(None), request: Request = None):
        if file:
            try:
                contents = await file.read()
                filename = file.filename or "upload.png"
                ext = os.path.splitext(filename)[1].lower()
                if ext not in [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"]:
                    ext = ".png"

                unique_name = f"upload_{uuid.uuid4().hex[:10]}{ext}"
                upload_dir = os.path.join(webapp_path, "assets", "uploads")

                try:
                    os.makedirs(upload_dir, exist_ok=True)
                    file_path = os.path.join(upload_dir, unique_name)
                    with open(file_path, "wb") as f:
                        f.write(contents)
                    return {
                        "success": True,
                        "url": f"/assets/uploads/{unique_name}",
                        "filename": unique_name
                    }
                except Exception:
                    # In read-only serverless environment fallback to base64 Data URI
                    mime_type = file.content_type or "image/png"
                    b64_str = base64.b64encode(contents).decode("utf-8")
                    data_uri = f"data:{mime_type};base64,{b64_str}"
                    return {
                        "success": True,
                        "url": data_uri,
                        "filename": unique_name
                    }
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Rasm yuklashda xatolik: {str(e)}")

        # Check JSON payload for base64 data
        if request:
            try:
                body = await request.json()
                data_uri = body.get("image") or body.get("data") or body.get("url")
                if data_uri:
                    return {
                        "success": True,
                        "url": data_uri,
                        "filename": "image.png"
                    }
            except Exception:
                pass

        raise HTTPException(status_code=400, detail="Fayl yoki rasm ma'lumoti topilmadi")

    # ----------------- PROMOTIONS & BANNER SLIDER ENDPOINTS -----------------
    @app.get("/api/promotions")
    async def handle_get_promotions(
        active_only: bool = Query(True, description="Filter only active promotions"),
        user_id: Optional[str] = Query(None, description="Admin user ID"),
        request: Request = None
    ):
        is_admin = False
        if not active_only or user_id:
            try:
                check_admin_authorization(request, user_id)
                is_admin = True
            except HTTPException:
                is_admin = False

        promos = get_all_promotions(active_only=active_only and not is_admin)
        return {
            "success": True,
            "promotions": promos,
            "total": len(promos)
        }

    @app.get("/api/promotions/{promo_id}")
    async def handle_get_promotion(promo_id: int):
        promo = get_promotion(promo_id)
        if not promo:
            raise HTTPException(status_code=404, detail="Aksiya banneri topilmadi")
        return {
            "success": True,
            "promotion": promo
        }

    @app.post("/api/admin/promotions")
    @app.post("/api/promotions")
    async def handle_create_promotions(request: Request):
        check_admin_authorization(request)
        try:
            data = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        # Handle bulk dynamic promotions if 'promotions' list is provided
        if "promotions" in data and isinstance(data["promotions"], list):
            items = data["promotions"]
            if not items:
                raise HTTPException(status_code=400, detail="Aksiyalar ro'yxati bo'sh")
            created_list = bulk_add_promotions(items)
            return {
                "success": True,
                "message": f"{len(created_list)} ta aksiya muvaffaqiyatli saqlandi!",
                "promotions": created_list
            }

        title = data.get("title") or data.get("name")
        if not title or not str(title).strip():
            raise HTTPException(status_code=400, detail="Aksiya sarlavhasi kiritilishi shart")

        subtitle = data.get("subtitle") or data.get("description") or ""
        discount_price = data.get("discount_price") or data.get("price")
        discount_text = data.get("discount_text") or data.get("discount_badge")
        image_url = data.get("image_url")
        product_id = data.get("product_id")
        is_active = data.get("is_active", True)

        new_promo = add_promotion(
            title=str(title).strip(),
            subtitle=str(subtitle).strip(),
            discount_price=discount_price,
            discount_text=discount_text,
            image_url=image_url,
            product_id=product_id,
            is_active=is_active
        )

        return {
            "success": True,
            "message": f"'{new_promo['title']}' aksiyasi muvaffaqiyatli qo'shildi!",
            "promotion": new_promo
        }

    @app.put("/api/admin/promotions/{promo_id}")
    @app.post("/api/admin/promotions/{promo_id}")
    async def handle_update_promotion(promo_id: int, request: Request):
        check_admin_authorization(request)
        try:
            data = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        title = data.get("title")
        subtitle = data.get("subtitle")
        discount_price = data.get("discount_price")
        discount_text = data.get("discount_text")
        image_url = data.get("image_url")
        product_id = data.get("product_id")
        is_active = data.get("is_active")

        updated = update_promotion(
            promo_id=promo_id,
            title=title,
            subtitle=subtitle,
            discount_price=discount_price,
            discount_text=discount_text,
            image_url=image_url,
            product_id=product_id,
            is_active=is_active
        )

        if not updated:
            raise HTTPException(status_code=404, detail="Aksiya topilmadi yoki yangilab bo'lmadi")

        return {
            "success": True,
            "message": f"Aksiya #{promo_id} yangilandi!",
            "promotion": updated
        }

    @app.delete("/api/admin/promotions/{promo_id}")
    @app.delete("/api/promotions/{promo_id}")
    async def handle_delete_promotion(promo_id: int, request: Request = None):
        check_admin_authorization(request)
        success = delete_promotion(promo_id)
        if not success:
            raise HTTPException(status_code=404, detail="Aksiya topilmadi yoki allaqachon o'chirilgan")

        return {
            "success": True,
            "message": f"Aksiya #{promo_id} muvaffaqiyatli o'chirildi!",
            "promo_id": promo_id
        }

    # ----------------- PRODUCT ENDPOINTS -----------------
    @app.get("/api/products")
    async def handle_get_products(
        page: int = Query(1, ge=1, description="Page number"),
        limit: int = Query(100, ge=1, le=500, description="Items per page"),
        category_id: Optional[str] = Query(None, description="Category or subcategory ID filter"),
        search: Optional[str] = Query(None, description="Search query string"),
        sort: Optional[str] = Query(None, description="Sorting parameter: price_asc, price_desc, name_asc, name_desc, discount_desc"),
        discount_only: bool = Query(False, description="Filter only discounted/promo products")
    ):
        data = get_all_products(
            page=page,
            limit=limit,
            category_id=category_id,
            search=search,
            sort=sort,
            discount_only=discount_only
        )
        return data

    @app.get("/api/discount-products")
    async def handle_get_discount_products(
        page: int = Query(1, ge=1, description="Page number"),
        limit: int = Query(100, ge=1, le=500, description="Items per page")
    ):
        data = get_discount_products(page=page, limit=limit)
        return data

    @app.get("/api/products/discounted")
    async def handle_get_discounted_products():
        discounted_items = get_discounted_products_api()
        return discounted_items

    @app.get("/api/products/no-photo")
    async def handle_get_no_photo_products(
        category_id: Optional[str] = Query(None, description="Category ID filter")
    ):
        no_photo_items = get_no_photo_products_api(category_id=category_id)
        return no_photo_items

    # ----------------- UNCATEGORIZED 1C PRODUCTS & ASSIGNMENT -----------------
    @app.post("/api/admin/sync-1c")
    @app.get("/api/admin/sync-1c")
    @app.post("/api/sync-1c")
    async def handle_sync_1c(request: Request, force: bool = Query(True, description="Force refresh from 1C ignoring cache")):
        # Check authorization if admin query param or header is present
        user_id = request.query_params.get("user_id") or request.query_params.get("userId")
        if user_id or request.headers.get("X-Admin-Id") or request.headers.get("Authorization"):
            try:
                check_admin_authorization(request)
            except Exception:
                pass

        raw_data = None
        has_body = False

        try:
            body_bytes = await request.body()
            if body_bytes and len(body_bytes.strip()) > 0:
                has_body = True
                content_type = request.headers.get("content-type", "").lower()
                if "application/json" in content_type:
                    try:
                        raw_data = await request.json()
                    except Exception:
                        raw_data = body_bytes.decode("utf-8", errors="ignore")
                elif "xml" in content_type or "text" in content_type:
                    raw_data = body_bytes.decode("utf-8", errors="ignore")
                else:
                    try:
                        raw_data = await request.json()
                    except Exception:
                        raw_data = body_bytes.decode("utf-8", errors="ignore")
        except Exception:
            has_body = False

        if has_body and raw_data is not None:
            # Sync directly from provided payload
            print("1C RAW RESPONSE:", raw_data)
            logger.info(f"1C RAW RESPONSE: {raw_data}")
            result = sync_1c_products(raw_data)
            return result
        else:
            # Fetch directly from configured 1C HTTP Service URL
            result = await sync_products_from_1c(force_refresh=force)
            return result

    @app.get("/api/admin/1c/status")
    async def handle_1c_status(request: Request = None):
        check_admin_authorization(request)
        return {
            "success": True,
            "cache": get_1c_cache_status()
        }

    @app.get("/api/admin/products/uncategorized")
    async def handle_get_uncategorized_products(
        search: Optional[str] = Query(None, description="Search by name or 1C SKU"),
        request: Request = None
    ):
        check_admin_authorization(request)
        items = get_uncategorized_products(search=search)
        return {
            "success": True,
            "total": len(items),
            "products": items
        }

    @app.patch("/api/admin/products/{product_id}/assign-category")
    @app.post("/api/admin/products/{product_id}/assign-category")
    async def handle_assign_product_category(
        product_id: int,
        category_id: Optional[int] = Query(None),
        request: Request = None
    ):
        check_admin_authorization(request)
        target_cat_id = category_id
        if target_cat_id is None and request:
            try:
                body = await request.json()
                if isinstance(body, dict):
                    target_cat_id = body.get("category_id") or body.get("categoryId")
            except Exception:
                pass

        if target_cat_id is None:
            raise HTTPException(status_code=400, detail="category_id parametri talab qilinadi")

        updated_prod = assign_product_category(product_id, target_cat_id)
        if not updated_prod:
            raise HTTPException(status_code=404, detail="Mahsulot yoki kategoriya topilmadi")

        cat = get_category(target_cat_id) or {}
        cat_name = cat.get("name", f"Kategoriya #{target_cat_id}")

        return {
            "success": True,
            "message": f"'{updated_prod.get('name')}' muvaffaqiyatli '{cat_name}' bo'limiga biriktirildi! 🎉",
            "product": updated_prod,
            "category": cat
        }

    @app.post("/api/products/update-photo")
    async def handle_post_update_photo(request: Request):
        check_admin_authorization(request)
        try:
            data = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        product_id = data.get("product_id")
        if not product_id:
            raise HTTPException(status_code=400, detail="product_id is required")

        image_url = data.get("image_url")
        photo_file_id = data.get("photo_file_id")
        stock = data.get("stock")

        updated_product = update_product_photo_and_stock(
            product_id=product_id,
            image_url=image_url,
            photo_file_id=photo_file_id,
            stock=stock
        )

        if not updated_product:
            raise HTTPException(status_code=404, detail="Product not found")

        return {
            "success": True,
            "message": f"Mahsulot #{product_id} muvaffaqiyatli yangilandi!",
            "product": updated_product
        }

    @app.post("/api/products")
    async def handle_post_product(request: Request):
        check_admin_authorization(request)
        try:
            data = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        name = data.get("name") or data.get("title")
        if not name or not str(name).strip():
            raise HTTPException(status_code=400, detail="Mahsulot nomi kiritilishi shart")

        price = data.get("price")
        if price is None:
            raise HTTPException(status_code=400, detail="Mahsulot narxi kiritilishi shart")
        try:
            price_val = int(price)
            if price_val < 0:
                raise ValueError()
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Mahsulot narxi musbat son bo'lishi kerak")

        category_id = data.get("category_id", 1)
        image_url = data.get("image_url")
        description = data.get("description", "")
        unit = data.get("unit", "kg")
        stock = data.get("stock", 50)
        old_price = data.get("old_price")
        discount_percent = data.get("discount_percent", 0)

        new_product = add_product(
            name=str(name).strip(),
            price=price_val,
            category_id=category_id,
            image_url=image_url,
            description=description,
            unit=unit,
            stock=stock,
            old_price=old_price,
            discount_percent=discount_percent
        )

        return {
            "success": True,
            "message": f"'{new_product['name']}' mahsuloti muvaffaqiyatli qo'shildi!",
            "product": new_product
        }

    @app.delete("/api/products/{product_id}")
    async def handle_delete_product(product_id: int, request: Request = None):
        check_admin_authorization(request)
        success = delete_product(product_id)
        if not success:
            raise HTTPException(status_code=404, detail="Mahsulot topilmadi yoki allaqachon o'chirilgan")

        return {
            "success": True,
            "message": f"Mahsulot #{product_id} muvaffaqiyatli o'chirildi!",
            "product_id": product_id
        }

    # ----------------- ORDERS & PAYMENT ENDPOINTS -----------------
    @app.post("/api/orders")
    async def handle_create_order(request: Request):
        try:
            data = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON payload")

        cart = data.get("cart") or data.get("items") or data.get("cart_items") or {}
        total_amount = data.get("total_amount") or data.get("total") or data.get("total_price") or 0
        payment_type = data.get("payment_type") or data.get("payment_method") or "cash"
        address = data.get("address") or "Mini App orqali buyurtma"
        delivery_time = data.get("delivery_time") or "15 - 25 daqiqa"
        user_info = data.get("user_info") or data.get("user") or {}
        full_name = data.get("full_name") or data.get("name")
        phone_number = data.get("phone_number") or data.get("phone")
        location_lat = data.get("location_lat") or data.get("lat")
        location_lng = data.get("location_lng") or data.get("lng")

        try:
            total_val = int(total_amount)
        except (ValueError, TypeError):
            total_val = 0

        # Auto-calculate total from cart if 0
        if total_val <= 0 and isinstance(cart, dict):
            for entry in cart.values():
                item = entry.get("item", {})
                price = item.get("price", 0)
                weight = entry.get("weight", 1.0)
                qty = entry.get("qty", 1)
                total_val += int(round(price * weight * qty))

        order = create_order(
            cart=cart,
            total_amount=total_val,
            payment_type=payment_type,
            address=address,
            delivery_time=delivery_time,
            user_info=user_info,
            full_name=full_name,
            phone_number=phone_number,
            location_lat=location_lat,
            location_lng=location_lng
        )

        # Notify Telegram Admin Bot in background
        try:
            import asyncio
            asyncio.create_task(notify_admins_new_order(order))
        except Exception as e:
            logger.warning(f"Could not trigger admin notification task: {e}")

        return {
            "success": True,
            "order_id": order["id"],
            "order": order,
            "payment_type": order["payment_type"],
            "status": order["status"],
            "click_url": order.get("click_url"),
            "message": "Buyurtma muvaffaqiyatli qabul qilindi!"
        }

    @app.get("/api/orders")
    async def handle_get_orders(limit: int = Query(50, ge=1, le=200)):
        orders = get_orders(limit=limit)
        return {
            "success": True,
            "orders": orders,
            "total": len(orders)
        }

    @app.get("/api/orders/{order_id}")
    async def handle_get_order(order_id: str):
        order = get_order(order_id)
        if not order:
            raise HTTPException(status_code=404, detail="Buyurtma topilmadi")
        return {
            "success": True,
            "order": order
        }

    @app.post("/api/orders/{order_id}/status")
    async def handle_update_order_status(order_id: str, request: Request):
        check_admin_authorization(request)
        try:
            data = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON payload")

        status = data.get("status")
        status_code = data.get("status_code")
        if not status and not status_code:
            raise HTTPException(status_code=400, detail="Status ko'rsatilishi shart")

        status_map = {
            "accept": ("Qabul qilindi", "accepted"),
            "accepted": ("Qabul qilindi", "accepted"),
            "pack": ("Yig'ildi", "packed"),
            "packed": ("Yig'ildi", "packed"),
            "ship": ("Yo'lga chiqdi", "on_the_way"),
            "on_the_way": ("Yo'lga chiqdi", "on_the_way"),
            "deliver": ("Yetkazildi", "delivered"),
            "delivered": ("Yetkazildi", "delivered"),
        }

        if status_code in status_map:
            status_text, s_code = status_map[status_code]
        elif status:
            status_text = status
            s_code = status_code or "accepted"
        else:
            status_text = "Qabul qilindi"
            s_code = "accepted"

        updated = update_order_status(order_id, status=status_text, status_code=s_code)
        if not updated:
            raise HTTPException(status_code=404, detail="Buyurtma topilmadi")

        # Notify customer via Telegram bot in background
        try:
            import asyncio
            asyncio.create_task(notify_customer_order_status(order_id, s_code))
        except Exception as e:
            logger.warning(f"Could not trigger customer notification task: {e}")

        return {
            "success": True,
            "order": updated
        }

    # ----------------- ADMIN ORDERS ENDPOINT -----------------
    @app.get("/api/admin/orders")
    async def handle_get_admin_orders(
        user_id: Optional[str] = Query(None, description="Admin Telegram ID"),
        limit: int = Query(50, ge=1, le=200),
        request: Request = None
    ):
        check_admin_authorization(request, user_id)
        orders = get_orders(limit=limit)
        return {
            "success": True,
            "orders": orders,
            "total": len(orders)
        }

    # ----------------- ADMIN ANALYTICS ENDPOINT -----------------
    @app.get("/api/admin/stats")
    async def handle_get_admin_stats(
        user_id: Optional[str] = Query(None, description="Admin Telegram ID"),
        request: Request = None
    ):
        check_admin_authorization(request, user_id)
        stats = get_admin_analytics()
        return stats

    # Direct static file routes for root-level asset requests
    @app.get("/styles.css")
    async def get_root_styles():
        css_file = os.path.join(webapp_path, "styles.css")
        if os.path.exists(css_file):
            return FileResponse(css_file, media_type="text/css")
        raise HTTPException(status_code=404, detail="CSS not found")

    @app.get("/app.js")
    async def get_root_app_js():
        js_file = os.path.join(webapp_path, "app.js")
        if os.path.exists(js_file):
            return FileResponse(js_file, media_type="application/javascript")
        raise HTTPException(status_code=404, detail="JS not found")

    @app.get("/assets/{asset_name:path}")
    async def get_root_asset(asset_name: str):
        asset_file = os.path.join(webapp_path, "assets", asset_name)
        if os.path.exists(asset_file):
            return FileResponse(asset_file)
        raise HTTPException(status_code=404, detail="Asset not found")

    @app.get("/")
    async def handle_root():
        index_file = os.path.join(webapp_path, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file, media_type="text/html")
        return RedirectResponse(url="/webapp/index.html")

    @app.get("/webapp")
    async def handle_webapp_redirect():
        return RedirectResponse(url="/webapp/index.html")

    # Static files mounting for /webapp and /static
    if os.path.isdir(webapp_path):
        app.mount("/webapp", StaticFiles(directory=webapp_path, html=True), name="webapp")
        app.mount("/static", StaticFiles(directory=webapp_path, html=True), name="static")

    return app


# Top-level ASGI exports for Vercel Serverless Functions
app = create_webapp_server()
application = app
handler = app

if __name__ == "__main__":
    import uvicorn
    logging.basicConfig(level=logging.INFO)
    print("🚀 Telegram Mini App HTTP Server 8000-portda ishga tushmoqda...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
