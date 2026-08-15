from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from config import CHANNEL_URL


def get_channel_inline_keyboard() -> InlineKeyboardMarkup:
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="👉 Kanalga o'tish",
                    url=CHANNEL_URL
                )
            ]
        ]
    )
    return keyboard


def get_stats_inline_keyboard() -> InlineKeyboardMarkup:
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="📞 Telefon zakaz qo'shish",
                    callback_data="add_manual_order"
                )
            ]
        ]
    )
    return keyboard


def get_product_card_keyboard(
    product_id: int | str,
    is_admin: bool = False,
    is_promo: bool = False,
    recommendation: str | None = None
) -> InlineKeyboardMarkup:
    inline_keyboard = []

    if is_admin:
        inline_keyboard.append([
            InlineKeyboardButton(
                text="🔥 Aksiyaga qo'shish",
                callback_data=f"admin_add_sale:{product_id}"
            ),
            InlineKeyboardButton(
                text="🗑 Qoldiqni o'chirish",
                callback_data=f"admin_clear_stock:{product_id}"
            )
        ])
        inline_keyboard.append([
            InlineKeyboardButton(
                text="➕ Qoldiq qo'shish",
                callback_data=f"admin_add_stock:{product_id}"
            ),
            InlineKeyboardButton(
                text="🖼 Rasm almashtirish",
                callback_data=f"admin_change_photo:{product_id}"
            )
        ])
    else:
        inline_keyboard.append([
            InlineKeyboardButton(
                text="🛒 Savatchaga qo'shish",
                callback_data=f"add_to_cart:{product_id}"
            )
        ])

    if not is_promo and recommendation:
        inline_keyboard.append([
            InlineKeyboardButton(
                text=f"💡 Tavsiya: {recommendation}",
                callback_data=f"cross_sell:{product_id}"
            )
        ])

    return InlineKeyboardMarkup(inline_keyboard=inline_keyboard)


def get_nopic_categories_keyboard(categories: list[dict]) -> InlineKeyboardMarkup:
    inline_keyboard = []
    for cat in categories:
        cat_id = cat["id"]
        cat_name = cat["name"]
        count = cat["count"]
        inline_keyboard.append([
            InlineKeyboardButton(
                text=f"📁 {cat_name} ({count} ta)",
                callback_data=f"nopic_cat:{cat_id}:0"
            )
        ])
    return InlineKeyboardMarkup(inline_keyboard=inline_keyboard)


def get_nopic_product_card_keyboard(
    product_id: int | str,
    cat_id: int | str,
    page: int,
    total_pages: int
) -> InlineKeyboardMarkup:
    nav_row = []

    if page > 0:
        nav_row.append(
            InlineKeyboardButton(text="⬅️ Oldingi", callback_data=f"nopic_cat:{cat_id}:{page - 1}")
        )
    else:
        nav_row.append(
            InlineKeyboardButton(text="⛔️", callback_data="nopic_noop")
        )

    nav_row.append(
        InlineKeyboardButton(text=f"📄 {page + 1}/{total_pages}", callback_data="nopic_noop")
    )

    if page < total_pages - 1:
        nav_row.append(
            InlineKeyboardButton(text="Keyingi ➡️", callback_data=f"nopic_cat:{cat_id}:{page + 1}")
        )
    else:
        nav_row.append(
            InlineKeyboardButton(text="⛔️", callback_data="nopic_noop")
        )

    inline_keyboard = [
        [
            InlineKeyboardButton(
                text="🖼 Rasm yuklash",
                callback_data=f"nopic_upload_photo:{product_id}:{cat_id}:{page}"
            ),
            InlineKeyboardButton(
                text="🗑 Qoldiqni o'chirish",
                callback_data=f"nopic_clear_stock:{product_id}:{cat_id}:{page}"
            )
        ],
        nav_row,
        [
            InlineKeyboardButton(
                text="🔙 Kategoriyalarga qaytish",
                callback_data="nopic_categories"
            )
        ]
    ]

    return InlineKeyboardMarkup(inline_keyboard=inline_keyboard)
