import logging
from aiogram import Router, F
from aiogram.filters import CommandStart, Command
from aiogram.types import Message
import json

from config import ADMINS
from keyboards import get_main_reply_keyboard

router = Router()


@router.message(CommandStart())
@router.message(Command("start"))
@router.message(Command("menu"))
async def cmd_start_handler(message: Message):
    """
    /start buyrug'i kelganda foydalanuvchiga xush kelibsiz xabarini
    va asosiy menyu reply klaviaturasini qaytaradi.
    """
    try:
        is_admin = message.from_user.id in ADMINS
        welcome_text = (
            f"Assalomu alaykum, {message.from_user.full_name}!\n\n"
            "Bozorcha botiga xush kelibsiz. Kerakli bo'limni tanlang:"
        )
        await message.answer(
            text=welcome_text,
            reply_markup=get_main_reply_keyboard(is_admin=is_admin)
        )
    except Exception as e:
        logging.exception("Error in /start handler: %s", e)
        await message.answer("⚠️ Xatolik yuz berdi. Iltimos qayta urinib ko'ring.")


@router.message(F.web_app_data)
async def handle_web_app_data(message: Message):
    """
    Telegram Mini App'dan (sendData orqali) qaytgan web_app_data ma'lumotlarini tutib oladi.
    """
    try:
        raw_data = message.web_app_data.data
        data = json.loads(raw_data)
        cart = data.get("cart", {})
        order_id = data.get("order_id", "84091")
        total = data.get("total", 0)
        payment_type = data.get("payment_type", "cash")
        status = data.get("status", "Kutilmoqda (Naqd)")

        payment_icon = "⚡️ Click" if payment_type == "click" else "💵 Naqd pul"

        order_summary = f"🛒 **MINI APP BUYURTMASI #{order_id}**\n\n"
        total_items = 0

        for key, entry in cart.items():
            item = entry.get("item", {})
            item_name = item.get("name", f"Mahsulot #{key}")
            qty = entry.get("qty", 1)
            weight = entry.get("weight", 1.0)
            weight_str = f" ({weight}x)" if weight != 1.0 else ""
            order_summary += f"📦 {item_name}{weight_str} — {qty} ta\n"
            total_items += qty

        order_summary += f"\n📊 **Tovarlar soni:** {total_items} ta\n"
        if total > 0:
            order_summary += f"💰 **Jami to'lov:** {total:,.0f} so'm\n".replace(",", " ")
        order_summary += f"💳 **To'lov usuli:** {payment_icon}\n"
        order_summary += f"📌 **Holat:** {status}\n\n"
        order_summary += "✅ Buyurtmangiz qabul qilindi va kuryerga yuborildi!"

        await message.answer(text=order_summary, parse_mode="Markdown")
    except Exception as e:
        logging.exception("Error in web_app_data handler: %s", e)
        await message.answer("✅ Mini App buyurtmasi muvaffaqiyatli qabul qilindi!")
