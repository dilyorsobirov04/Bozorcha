import os
import sys
import logging
from typing import Optional
from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, FileResponse

from db import (
    get_all_products,
    get_discount_products,
    get_discounted_products_api,
    get_no_photo_products_api,
    update_product_photo_and_stock,
    add_product,
    delete_product
)

logger = logging.getLogger(__name__)


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

    @app.get("/api/health")
    async def health_check():
        return {"status": "ok", "service": "Bozorcha Mini App API"}

    @app.get("/api/products")
    async def handle_get_products(
        page: int = Query(1, ge=1, description="Page number"),
        limit: int = Query(100, ge=1, le=500, description="Items per page")
    ):
        data = get_all_products(page=page, limit=limit)
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

    @app.post("/api/products/update-photo")
    async def handle_post_update_photo(request: Request):
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
    async def handle_delete_product(product_id: int):
        success = delete_product(product_id)
        if not success:
            raise HTTPException(status_code=404, detail="Mahsulot topilmadi yoki allaqachon o'chirilgan")

        return {
            "success": True,
            "message": f"Mahsulot #{product_id} muvaffaqiyatli o'chirildi!",
            "product_id": product_id
        }

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
