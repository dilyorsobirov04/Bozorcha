import os
from dotenv import load_dotenv

# .env faylini yuklash
load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()

# Config sozlamalari
ADMINS = [7351189083, 6243887731]
CHANNEL_URL = "https://t.me/bozorchakanal"

# Telegram Mini App (TMA) URL (Telegram WebApp tugmasi faqat HTTPS havolalarni qabul qiladi)
raw_webapp_url = os.getenv("WEBAPP_URL", "https://bozorcha.vercel.app").strip()

if raw_webapp_url.startswith("http://"):
    WEBAPP_URL = raw_webapp_url.replace("http://", "https://", 1)
else:
    WEBAPP_URL = raw_webapp_url

# Database Connection URL (Local PostgreSQL / Cloud)
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres@localhost:5433/bozorcha_db").strip()

# 1C Enterprise Integration Settings (Ngrok / Public IP / Local)
CACHE_TTL = int(os.getenv("CACHE_TTL", "300"))
PAGE_SIZE = int(os.getenv("PAGE_SIZE", "10"))
API_1C_URL = os.getenv("API_1C_URL", "").strip()
API_1C_USER = os.getenv("API_1C_USER", "mobiles").strip()
API_1C_PASS = os.getenv("API_1C_PASS", "123").strip()
API_1C_TIMEOUT = int(os.getenv("API_1C_TIMEOUT", "20"))


