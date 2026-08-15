from aiogram.types import ReplyKeyboardMarkup, KeyboardButton, WebAppInfo
from config import WEBAPP_URL

def get_main_reply_keyboard(is_admin: bool = False) -> ReplyKeyboardMarkup:
    """
    Bosh menyu reply klaviaturasini qaytaradi.
    TMA (Telegram Mini App) tugmasi: 🛒 Do'konga kirish (web_app=WebAppInfo(url=WEBAPP_URL))
    WEBAPP_URL tekshirilib faqat HTTPS protocol orqali uzatiladi.
    """
    keyboard_layout = [
        [
            KeyboardButton(
                text="🛒 Do'konga kirish",
                web_app=WebAppInfo(url=WEBAPP_URL)
            )
        ],
        [
            KeyboardButton(text="🛍 Mahsulotlar"),
            KeyboardButton(text="🛒 Savatcha")
        ]
    ]

    if is_admin:
        keyboard_layout.append([
            KeyboardButton(text="🖼 Rasmsiz mahsulotlar"),
            KeyboardButton(text="📊 Statistika")
        ])
        keyboard_layout.append([
            KeyboardButton(text="📢 Bizning kanal")
        ])
    else:
        keyboard_layout.append([
            KeyboardButton(text="📢 Bizning kanal")
        ])

    keyboard = ReplyKeyboardMarkup(
        keyboard=keyboard_layout,
        resize_keyboard=True,
        persistent=True
    )
    return keyboard
