from aiogram.fsm.state import StatesGroup, State

class ProductAdminStates(StatesGroup):
    """
    Admin mahsulot boshqaruvi uchun FSM holatlari.
    """
    waiting_for_product_photo = State()


class AdminStatsState(StatesGroup):
    """
    Admin statistika va qo'lda zakaz kiritish uchun FSM holatlari.
    """
    waiting_for_manual_order_amount = State()
