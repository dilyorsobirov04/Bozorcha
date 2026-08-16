import os
from dotenv import load_dotenv

# .env faylini yuklash
load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()

# Config sozlamalari
ADMINS = [7351189083]
CHANNEL_URL = "https://t.me/bozorchakanal"

# Telegram Mini App (TMA) URL (Telegram WebApp tugmasi faqat HTTPS havolalarni qabul qiladi)
raw_webapp_url = os.getenv("WEBAPP_URL", "https://bozorcha.vercel.app").strip()

if raw_webapp_url.startswith("http://"):
    WEBAPP_URL = raw_webapp_url.replace("http://", "https://", 1)
else:
    WEBAPP_URL = raw_webapp_url
