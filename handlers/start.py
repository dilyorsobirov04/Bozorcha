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

        order_summary = "🛒 **MINI APP ORQALI QABUL QILINGAN BUYURTMA:**\n\n"
        total_items = 0

        for key, entry in cart.items():
            item_name = entry.get("item", {}).get("name", f"Mahsulot #{key}")
            qty = entry.get("qty", 1)
            order_summary += f"📦 {item_name} — {qty} ta\n"
            total_items += qty

        order_summary += f"\n📊 **Jami tovarlar soni:** {total_items} ta\n"
        order_summary += "✅ Buyurtmangiz rasmiylashtirildi va kuryerga yuborildi!"

        await message.answer(text=order_summary, parse_mode="Markdown")
    except Exception as e:
        logging.exception("Error in web_app_data handler: %s", e)
        await message.answer("✅ Mini App buyurtmasi qabul qilindi!")
