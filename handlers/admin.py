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
    CATEGORIES_DB
)
from keyboards import (
    get_stats_inline_keyboard,
    get_nopic_categories_keyboard,
    get_nopic_product_card_keyboard
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
