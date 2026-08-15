import os
import sys
import logging
from aiohttp import web

from db import (
    get_all_products,
    get_discount_products,
    get_discounted_products_api,
    get_no_photo_products_api,
    update_product_photo_and_stock
)


async def handle_get_products(request):
    page = int(request.rel_url.query.get("page", 1))
    limit = int(request.rel_url.query.get("limit", 100))

    data = get_all_products(page=page, limit=limit)
    return web.json_response(data)


async def handle_get_discount_products(request):
    page = int(request.rel_url.query.get("page", 1))
    limit = int(request.rel_url.query.get("limit", 100))

    data = get_discount_products(page=page, limit=limit)
    return web.json_response(data)


async def handle_get_discounted_products_api(request):
    discounted_items = get_discounted_products_api()
    return web.json_response(discounted_items)


async def handle_get_no_photo_products_api(request):
    category_id = request.rel_url.query.get("category_id")
    no_photo_items = get_no_photo_products_api(category_id=category_id)
    return web.json_response(no_photo_items)


async def handle_post_update_photo_api(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    product_id = data.get("product_id")
    if not product_id:
        return web.json_response({"error": "product_id is required"}, status=400)

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
        return web.json_response({"error": "Product not found"}, status=404)

    return web.json_response({
        "success": True,
        "message": f"Mahsulot #{product_id} muvaffaqiyatli yangilandi!",
        "product": updated_product
    })


async def handle_index_redirect(request):
    return web.HTTPFound("/webapp/index.html")


def create_webapp_server():
    app = web.Application()

    app.router.add_get("/api/products", handle_get_products)
    app.router.add_get("/api/discount-products", handle_get_discount_products)

    app.router.add_get("/api/products/discounted", handle_get_discounted_products_api)
    app.router.add_get("/api/products/no-photo", handle_get_no_photo_products_api)
    app.router.add_post("/api/products/update-photo", handle_post_update_photo_api)

    app.router.add_get("/webapp", handle_index_redirect)

    webapp_path = os.path.join(os.path.dirname(__file__), "webapp")
    app.router.add_static("/webapp/", webapp_path, show_index=True)

    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    app = create_webapp_server()
    print("🚀 Telegram Mini App HTTP Server 8000-portda ishga tushmoqda...")
    web.run_app(app, host="0.0.0.0", port=8000)
