from aiogram.types import ReplyKeyboardMarkup, KeyboardButton, WebAppInfo
from config import WEBAPP_URL

def get_main_reply_keyboard(is_admin: bool = False) -> ReplyKeyboardMarkup:
    """
    Bosh menyu reply klaviaturasi (mobil qurilmalar uchun moslashtirilgan):
    1-qator: 🛒 Do'konga kirish (Telegram Mini App WebApp tugmasi)
    2-qator: 📣 Bizning kanal
    """
    keyboard_layout = [
        [
            KeyboardButton(
                text="🛒 Do'konga kirish",
                web_app=WebAppInfo(url=WEBAPP_URL)
            )
        ],
        [
            KeyboardButton(text="📣 Bizning kanal")
        ]
    ]

    return ReplyKeyboardMarkup(
        keyboard=keyboard_layout,
        resize_keyboard=True,
        is_persistent=True,
        input_field_placeholder="Bo'limni tanlang..."
    )


