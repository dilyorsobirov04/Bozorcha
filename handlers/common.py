import logging
from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery
from config import ADMINS
from db import get_product
from keyboards import get_main_reply_keyboard, get_channel_inline_keyboard, get_product_card_keyboard

router = Router()


@router.message(F.text == "📢 Bizning kanal")
async def show_channel_info(message: Message):
    try:
        await message.answer(
            text="📢 Bizning rasmiy kanalimizga a'zo bo'ling va eng so'nggi yangiliklardan xabardor bo'ling!",
            reply_markup=get_channel_inline_keyboard()
        )
    except Exception as e:
        logging.exception("Error in show_channel_info: %s", e)


@router.message(F.text == "🛍 Mahsulotlar")
@router.message(Command("product"))
async def show_sample_product(message: Message):
    try:
        is_admin = message.from_user.id in ADMINS
        product_id = 101
        product_data = get_product(product_id)

        if not product_data:
            name = "Organik Avokado Hass"
            price = "68,000 so'm"
            stock = 42
            desc = "Yangi uzilgan, yog'li va nozik ta'mga ega premium darajadagi organik avokado."
            photo = None
            is_promo = True
            recommendation = None
        else:
            name = product_data.get("name")
            price = f"{product_data.get('price'):,} so'm".replace(",", " ")
            stock = product_data.get("stock")
            desc = product_data.get("description")
            photo = product_data.get("photo_file_id")
            is_promo = product_data.get("is_promo", False)
            recommendation = product_data.get("recommendation")

        product_caption = (
            f"📦 **{name} (ID: #{product_id})**\n\n"
            f"💰 Narxi: {price}\n"
            f"📊 Qoldiq: {stock} ta\n"
            f"📝 Tavsif: {desc}\n"
        )

        if not is_promo and recommendation:
            product_caption += f"\n💡 *Hurmatli mijoz, ushbu mahsulot bilan birga {recommendation} ham olishni xohlaysizmi?*\n"

        if is_admin:
            product_caption += "\n⚡️ *Siz Adminsiz (Maxsus boshqaruv menyusi)*"

        kb = get_product_card_keyboard(
            product_id=product_id,
            is_admin=is_admin,
            is_promo=is_promo,
            recommendation=recommendation
        )

        if photo:
            await message.answer_photo(
                photo=photo,
                caption=product_caption,
                reply_markup=kb,
                parse_mode="Markdown"
            )
        else:
            await message.answer(
                text=product_caption,
                reply_markup=kb,
                parse_mode="Markdown"
            )
    except Exception as e:
        logging.exception("Error in show_sample_product: %s", e)
        await message.answer("⚠️ Mahsulot ma'lumotlarini yuklashda xatolik yuz berdi.")
