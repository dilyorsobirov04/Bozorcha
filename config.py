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

# 1C Enterprise Integration Settings
CACHE_TTL = int(os.getenv("CACHE_TTL", "300"))
PAGE_SIZE = int(os.getenv("PAGE_SIZE", "10"))
API_1C_URL = os.getenv("API_1C_URL", "http://localhost:8080/Bozorcham/hs/Bozorcham/GetTovarList").strip()
API_1C_USER = os.getenv("API_1C_USER", "mobiles").strip()
API_1C_PASS = os.getenv("API_1C_PASS", "123").strip()

