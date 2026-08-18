import asyncio
import logging
import sys
import uvicorn
from aiogram import Bot, Dispatcher
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from aiogram.fsm.storage.memory import MemoryStorage

from config import BOT_TOKEN, WEBAPP_URL
from handlers import start_router, admin_router, common_router
from server import app, application, handler, create_webapp_server, set_bot_instance


async def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        stream=sys.stdout
    )

    if not BOT_TOKEN or BOT_TOKEN == "YOUR_BOT_TOKEN_HERE":
        raise ValueError("BOT_TOKEN .env faylida ko'rsatilmagan! Iltimos .env fayliga BOT_TOKEN kiriting.")

    # Bot va Dispatcher yaratish
    bot = Bot(
        token=BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML)
    )
    set_bot_instance(bot)
    dp = Dispatcher(storage=MemoryStorage())

    # Routerlarni Dispatcher'ga ulash (start, admin, common)
    dp.include_router(start_router)
    dp.include_router(admin_router)
    dp.include_router(common_router)

    # TMA WebApp HTTP Serverini background task sifatida ishga tushirish (Uvicorn ASGI)
    config = uvicorn.Config(app=app, host="0.0.0.0", port=8000, log_level="warning")
    server = uvicorn.Server(config)
    server_task = asyncio.create_task(server.serve())

    logging.info(f"🌐 Telegram Mini App HTTP Server ishga tushdi: {WEBAPP_URL}")
    logging.info("🚀 Bot polling va TMA server muvaffaqiyatli ishga tushirildi...")

    try:
        await dp.start_polling(bot)
    finally:
        server.should_exit = True
        await server_task
        await bot.session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logging.info("Mini App to'xtatildi.")
