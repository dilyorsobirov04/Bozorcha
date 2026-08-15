import asyncio
import logging
import sys
from aiogram import Bot, Dispatcher
from aiogram.enums import ParseMode
from aiogram.client.default import DefaultBotProperties
from aiogram.fsm.storage.memory import MemoryStorage
from aiohttp import web

from config import BOT_TOKEN, WEBAPP_URL
from handlers import start_router, admin_router, common_router
from server import create_webapp_server


async def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        stream=sys.stdout
    )

    # Bot va Dispatcher yaratish
    bot = Bot(
        token=BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML)
    )
    dp = Dispatcher(storage=MemoryStorage())

    # Routerlarni Dispatcher'ga ulash (start, admin, common)
    dp.include_router(start_router)
    dp.include_router(admin_router)
    dp.include_router(common_router)

    # TMA WebApp HTTP Serverini background task sifatida ishga tushirish
    webapp_app = create_webapp_server()
    runner = web.AppRunner(webapp_app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 8000)
    await site.start()
    logging.info(f"🌐 Telegram Mini App HTTP Server ishga tushdi: {WEBAPP_URL}")

    logging.info("🚀 Bot polling va TMA server muvaffaqiyatli ishga tushirildi...")
    try:
        await dp.start_polling(bot)
    finally:
        await runner.cleanup()
        await bot.session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logging.info("🛑 Bot va Mini App to'xtatildi.")
