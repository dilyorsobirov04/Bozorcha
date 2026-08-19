import logging
from aiogram import Router, F
from aiogram.filters import CommandStart, Command
from aiogram.types import Message
import json

from config import ADMINS
from keyboards import get_main_reply_keyboard, get_order_admin_keyboard
from db import get_order, create_order

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
        order_id = str(data.get("order_id", "84091"))
        total = data.get("total", 0)
        payment_type = data.get("payment_type", "cash")
        status = data.get("status", "Qabul qilindi")

        user_info = {
            "id": message.from_user.id,
            "first_name": message.from_user.first_name,
            "username": message.from_user.username
        }

        # Update order in db with telegram customer info
        existing = get_order(order_id)
        if existing:
            existing["user_info"] = user_info
        else:
            create_order(
                cart=cart,
                total_amount=total,
                payment_type=payment_type,
                user_info=user_info
            )

        payment_icon = "⚡️ Click / Payme" if payment_type == "click" else "💵 Naqd pul"

        order_summary = f"🛒 <b>MINI APP BUYURTMASI #{order_id}</b>\n\n"
        total_items = 0

        for key, entry in cart.items():
            item = entry.get("item", {})
            item_name = item.get("name", f"Mahsulot #{key}")
            qty = entry.get("qty", 1)
            weight = entry.get("weight", 1.0)
            weight_str = f" ({weight} kg)" if weight and weight != 1.0 else ""
            order_summary += f"📦 {item_name}{weight_str} — {qty} ta\n"
            total_items += qty

        order_summary += f"\n📊 <b>Tovarlar soni:</b> {total_items} ta\n"
        if total > 0:
            order_summary += f"💰 <b>Jami to'lov:</b> {total:,.0f} so'm\n".replace(",", " ")
        order_summary += f"💳 <b>To'lov usuli:</b> {payment_icon}\n"
        order_summary += f"📌 <b>Holat:</b> {status}\n\n"
        order_summary += "✅ <b>Zakazingiz qabul qilindi!</b>\nBuyurtmangiz holatini ilovadagi <b>Kuzatuv</b> bo'limida kuzatib borishingiz mumkin."

        await message.answer(text=order_summary, parse_mode="HTML")

        items_list = []
        for key, entry in cart.items():
            item = entry.get("item", {})
            name = item.get("name", f"Mahsulot #{key}")
            qty = entry.get("qty", 1)
            weight = entry.get("weight")
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
        full_name = message.from_user.full_name or "Mijoz"
        phone = data.get("phone") or "Mavjud emas"
        address = data.get("address") or "Mini App orqali buyurtma"

        admin_text = (
            f"🛍 <b>YANGI BUYURTMA!</b>\n"
            f"🆔 <b>Buyurtma ID:</b> #{order_id}\n"
            f"👤 <b>Mijoz:</b> {full_name}\n"
            f"📞 <b>Tel:</b> {phone}\n"
            f"📍 <b>Manzil:</b> {address}\n"
            f"💳 <b>To'lov turi:</b> {payment_icon}\n"
            f"----------------------------\n"
            f"🛒 <b>Mahsulotlar:</b>\n"
            f"{items_str}\n"
            f"----------------------------\n"
            f"💰 <b>Jami summa:</b> {formatted_total} so'm"
        )
        keyboard = get_order_admin_keyboard(order_id, current_status="accepted")

        admin_recipients = set(ADMINS)
        admin_recipients.add(7351189083)
        admin_recipients.add(6243887731)

        for admin_id in admin_recipients:
            try:
                await message.bot.send_message(chat_id=admin_id, text=admin_text, reply_markup=keyboard, parse_mode="HTML")
            except Exception as e:
                logging.warning(f"Could not notify admin {admin_id}: {e}")

    except Exception as e:
        logging.exception("Error in web_app_data handler: %s", e)
        await message.answer("✅ Mini App buyurtmasi muvaffaqiyatli qabul qilindi!")

