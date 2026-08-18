import logging
from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import CallbackQuery, Message
from aiogram.fsm.context import FSMContext

from config import ADMINS
from states import ProductAdminStates, AdminStatsState
from db import (
    update_product_photo,
    get_product,
    add_manual_order,
    get_statistics,
    get_categories_with_nopic_products,
    get_nopic_products_by_category,
    clear_product_stock,
    CATEGORIES_DB,
    get_order,
    update_order_status
)
from keyboards import (
    get_stats_inline_keyboard,
    get_nopic_categories_keyboard,
    get_nopic_product_card_keyboard,
    get_order_admin_keyboard
)

router = Router()


@router.message(F.text == "🖼 Rasmsiz mahsulotlar")
@router.message(Command("nopic"))
async def cmd_nopic_products(message: Message):
    try:
        if message.from_user.id not in ADMINS:
            await message.answer("❌ Siz admin emassiz!")
            return

        categories = get_categories_with_nopic_products()
        if not categories:
            await message.answer("✅ Hozirda rasmsiz va qoldig'i mavjud bo'lgan mahsulotlar yo'q!")
            return

        await message.answer(
            text="🖼 **Rasmsiz va qoldig'i bor mahsulotlarga ega kategoriyalar:**",
            reply_markup=get_nopic_categories_keyboard(categories),
            parse_mode="Markdown"
        )
    except Exception as e:
        logging.exception("Error in cmd_nopic_products: %s", e)


@router.message(F.text == "📊 Statistika")
@router.message(Command("stats"))
async def show_admin_statistics(message: Message):
    try:
        if message.from_user.id not in ADMINS:
            await message.answer("❌ Ushbu bo'lim faqat adminlar uchun!")
            return

        stats = get_statistics()
        total_sales_str = f"{stats['total_sales']:,}".replace(",", " ")
        monthly_sales_str = f"{stats['monthly_sales']:,}".replace(",", " ")
        manual_count = stats['manual_orders_count']

        report_text = (
            "📊 **BOT SAVDO STATISTIKASI VA HISOBOTI**\n\n"
            f"💰 **Umumiy tushum:** {total_sales_str} so'm\n"
            f"📅 **Ushbu oylik savdo:** {monthly_sales_str} so'm\n"
            f"📞 **Qo'lda kiritilgan telefon zakazlar:** {manual_count} ta\n\n"
            "Qo'lda (telefon orqali) qabul qilingan zakazni bazaga qo'shish uchun quyidagi tugmani bosing:"
        )

        await message.answer(
            text=report_text,
            reply_markup=get_stats_inline_keyboard(),
            parse_mode="Markdown"
        )
    except Exception as e:
        logging.exception("Error in show_admin_statistics: %s", e)


@router.callback_query(F.data == "add_manual_order")
async def process_add_manual_order_click(callback: CallbackQuery, state: FSMContext):
    try:
        if callback.from_user.id not in ADMINS:
            await callback.answer("❌ Siz admin emassiz!", show_alert=True)
            return

        await callback.answer()
        await state.set_state(AdminStatsState.waiting_for_manual_order_amount)

        await callback.message.answer(
            "💰 **Telefon orqali qabul qilingan zakaz summasini kiriting:**\n\n"
            "Faqat raqamlardan iborat summa yozing (masalan: `150000`).\n"
            "Bekor qilish uchun /cancel deb yozing.",
            parse_mode="Markdown"
        )
    except Exception as e:
        logging.exception("Error in process_add_manual_order_click: %s", e)


@router.message(AdminStatsState.waiting_for_manual_order_amount)
async def process_manual_order_amount_input(message: Message, state: FSMContext):
    try:
        clean_text = message.text.replace(" ", "").strip()
        if not clean_text.isdigit() or int(clean_text) <= 0:
            await message.answer("⚠️ Iltimos, faqat musbat raqamlarda summa kiriting (masalan: `150000`).")
            return

        amount = int(clean_text)
        result = add_manual_order(amount)
        await state.clear()

        amount_str = f"{amount:,}".replace(",", " ")
        await message.answer(f"✅ Telefon zakazi bazaga qo'shildi: {amount_str} so'm!")
    except Exception as e:
        logging.exception("Error in process_manual_order_amount_input: %s", e)


@router.callback_query(F.data.startswith("order_status:"))
async def process_order_status_change(callback: CallbackQuery):
    """
    Admin tomonidan buyurtma holatini o'zgartirish callback handleri:
    - [ ✅ Qabul qilish ] -> "Zakazingiz qabul qilindi"
    - [ 📦 Yig'ildi ]
    - [ 🛵 Yo'lga chiqdi ]
    - [ 🎉 Yetkazildi ]
    """
    try:
        if callback.from_user.id not in ADMINS:
            await callback.answer("❌ Siz admin emassiz!", show_alert=True)
            return

        parts = callback.data.split(":")
        if len(parts) != 3:
            await callback.answer("⚠️ Noto'g'ri so'rov!")
            return

        _, action, order_id = parts

        status_map = {
            "accept": ("Qabul qilindi", "accepted", "Zakazingiz qabul qilindi"),
            "pack": ("Yig'ildi", "packed", "Buyurtma yig'ildi"),
            "ship": ("Yo'lga chiqdi", "on_the_way", "Buyurtma kuryerga berildi (Yo'lda)"),
            "deliver": ("Yetkazildi", "delivered", "Buyurtma yetkazildi")
        }

        if action not in status_map:
            await callback.answer("⚠️ Noma'lum status!")
            return

        status_text, status_code, popup_text = status_map[action]

        updated = update_order_status(order_id, status=status_text, status_code=status_code)
        if not updated:
            await callback.answer("⚠️ Buyurtma topilmadi!", show_alert=True)
            return

        # Show popup alert to Admin
        await callback.answer(popup_text, show_alert=True)

        # Notify customer via Telegram if user_id is present
        user_info = updated.get("user_info") or {}
        customer_id = user_info.get("id")

        customer_messages = {
            "accept": f"🔔 <b>Sizning buyurtmangiz holati:</b> Qabul qilindi ✅\nBuyurtma raqami: <b>#{order_id}</b>\nTez orada tayyorlanadi.",
            "pack": f"🔔 <b>Sizning buyurtmangiz holati:</b> Yig'ildi 📦\nBuyurtma raqami: <b>#{order_id}</b>\nKuryerga topshirilmoqda.",
            "ship": f"🔔 <b>Sizning buyurtmangiz holati:</b> Yo'lga chiqdi 🛵\nBuyurtma raqami: <b>#{order_id}</b>\nKuryer tez orada yetib boradi.",
            "deliver": f"🔔 <b>Sizning buyurtmangiz holati:</b> Yetkazildi 🏁\nBuyurtma raqami: <b>#{order_id}</b>\nBozorcha xizmatidan foydalanganingiz uchun rahmat!"
        }

        if customer_id:
            try:
                await callback.bot.send_message(
                    chat_id=int(customer_id),
                    text=customer_messages[action],
                    parse_mode="HTML"
                )
            except Exception as e:
                logging.warning(f"Could not notify customer {customer_id}: {e}")

        # Update Admin inline keyboard to highlight the current active button
        new_keyboard = get_order_admin_keyboard(order_id, current_status=status_code)

        try:
            await callback.message.edit_reply_markup(reply_markup=new_keyboard)
        except Exception as edit_err:
            logging.info(f"Keyboard already up to date: {edit_err}")

    except Exception as e:
        logging.exception("Error in process_order_status_change: %s", e)
        await callback.answer("⚠️ Xatolik yuz berdi!", show_alert=True)

