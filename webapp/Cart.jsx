import React, { useState } from 'react';

/**
 * Minimalistik va Ixcham Savatcha (Cart / Checkout) Komponenti
 * 
 * Faqat 3 ta asosiy blokni o'z ichiga oladi:
 * 1. Savatdagi mahsulotlar ro'yxati (+ / - o'zgartirish, o'chirish, bo'sh holat)
 * 2. To'lov usulini tanlash (Naqd pul / Click & Payme)
 * 3. Umumiy hisob-kitob va Buyurtmani tasdiqlash tugmasi
 */
export default function Cart({
  items = [],
  onUpdateQty,
  onCheckout,
  onBackToCatalog
}) {
  const [paymentMethod, setPaymentMethod] = useState('cash'); // 'cash' | 'click'
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Umumiy summani hisoblash
  const totalPrice = items.reduce((sum, item) => {
    const multiplier = item.is_weight ? (item.weight || 1.0) : 1.0;
    const unitPrice = Math.round((item.price || 0) * multiplier);
    return sum + unitPrice * (item.qty || 1);
  }, 0);

  // Buyurtmani tasdiqlash
  const handleConfirmOrder = async () => {
    if (items.length === 0) return;
    setIsSubmitting(true);
    try {
      if (onCheckout) {
        await onCheckout({
          items,
          totalPrice,
          paymentMethod
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // 1-holat: Savat bo'sh bo'lganda
  if (!items || items.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <button style={styles.backBtn} onClick={onBackToCatalog}>←</button>
          <h2 style={styles.headerTitle}>Savatcha</h2>
          <div style={{ width: 36 }} />
        </div>

        <div style={styles.emptyCard}>
          <div style={styles.emptyIcon}>🛒</div>
          <h3 style={styles.emptyTitle}>Savatchangiz bo'sh</h3>
          <p style={styles.emptyDesc}>Katalogdan sevimli tovarlaringizni tanlang va savatga qo'shing.</p>
          <button style={styles.emptyActionBtn} onClick={onBackToCatalog}>
            Katalogga o'tish
          </button>
        </div>
      </div>
    );
  }

  // 2-holat: Savatda mahsulotlar bo'lganda (3 ta element)
  return (
    <div style={styles.container}>
      {/* Sarlavha */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onBackToCatalog}>←</button>
        <h2 style={styles.headerTitle}>Savatcha</h2>
        <div style={{ width: 36 }} />
      </div>

      <div style={styles.body}>
        {/* ================= 1. MAHSULOTLAR RO'YXATI ================= */}
        <div style={styles.itemsList}>
          {items.map((cartItem) => {
            const isWeight = cartItem.is_weight;
            let weightLabel = '';
            if (isWeight) {
              weightLabel = cartItem.weight < 1 
                ? `${cartItem.weight * 1000} g` 
                : `${cartItem.weight} kg`;
            } else {
              weightLabel = `${cartItem.qty} dona`;
            }

            const multiplier = isWeight ? (cartItem.weight || 1.0) : 1.0;
            const itemTotal = Math.round((cartItem.price || 0) * multiplier) * (cartItem.qty || 1);

            return (
              <div key={cartItem.id || cartItem.key} style={styles.itemRow}>
                <img 
                  src={cartItem.image_url || 'https://via.placeholder.com/80'} 
                  alt={cartItem.name} 
                  style={styles.itemThumb} 
                />
                
                <div style={styles.itemInfo}>
                  <h4 style={styles.itemName}>{cartItem.name}</h4>
                  <div style={styles.itemMetaRow}>
                    <span style={styles.itemUnit}>({weightLabel})</span>
                    <span style={styles.itemPrice}>{itemTotal.toLocaleString('uz-UZ')} so'm</span>
                  </div>
                </div>

                {/* Soni / Stepper (+ / -) */}
                <div style={styles.stepper}>
                  <button 
                    style={styles.stepperBtn} 
                    onClick={() => onUpdateQty && onUpdateQty(cartItem, -1)}
                    title="Kamaytirish"
                  >
                    {cartItem.qty === 1 ? '🗑' : '-'}
                  </button>
                  <span style={styles.stepperVal}>{cartItem.qty}</span>
                  <button 
                    style={styles.stepperBtn} 
                    onClick={() => onUpdateQty && onUpdateQty(cartItem, 1)}
                    title="Ko'paytirish"
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ================= 2. TO'LOV USULI ================= */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardTitle}>💳 To'lov usuli</span>
            <span style={styles.activePill}>
              {paymentMethod === 'cash' ? '💵 Naqd pul' : '⚡️ Click / Payme'}
            </span>
          </div>

          <div style={styles.paymentGrid}>
            {/* Naqd pul */}
            <div 
              style={{
                ...styles.paymentOption,
                ...(paymentMethod === 'cash' ? styles.paymentOptionActive : {})
              }}
              onClick={() => setPaymentMethod('cash')}
            >
              <div style={styles.radioCircle}>
                {paymentMethod === 'cash' && <div style={styles.radioDot} />}
              </div>
              <span style={styles.paymentIcon}>💵</span>
              <div>
                <div style={styles.paymentName}>Naqd pul</div>
                <div style={styles.paymentDesc}>Yetkazilganda to'lash</div>
              </div>
            </div>

            {/* Click / Payme */}
            <div 
              style={{
                ...styles.paymentOption,
                ...(paymentMethod === 'click' ? styles.paymentOptionActive : {})
              }}
              onClick={() => setPaymentMethod('click')}
            >
              <div style={styles.radioCircle}>
                {paymentMethod === 'click' && <div style={styles.radioDot} />}
              </div>
              <span style={styles.paymentIcon}>⚡️</span>
              <div>
                <div style={styles.paymentName}>Click / Payme</div>
                <div style={styles.paymentDesc}>Onlayn to'lov</div>
              </div>
            </div>
          </div>
        </div>

        {/* ================= 3. JAMI HISOB VA TASDIQLASH TUGMASI ================= */}
        <div style={styles.summaryCard}>
          <div style={styles.totalRow}>
            <span style={styles.totalLabel}>Jami to'lov:</span>
            <span style={styles.totalAmount}>{totalPrice.toLocaleString('uz-UZ')} so'm</span>
          </div>

          <button 
            style={{
              ...styles.checkoutBtn,
              ...(isSubmitting ? styles.checkoutBtnDisabled : {})
            }}
            disabled={isSubmitting}
            onClick={handleConfirmOrder}
          >
            <span>{isSubmitting ? "Buyurtma berilmoqda..." : "Buyurtmani tasdiqlash"}</span>
            <span style={styles.btnArrow}>→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Minimalistik dizayn stillari (Dark Glassmorphism)
const styles = {
  container: {
    maxWidth: '480px',
    margin: '0 auto',
    padding: '16px',
    color: '#ffffff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
    boxSizing: 'border-box'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px'
  },
  backBtn: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    background: 'rgba(15, 23, 42, 0.6)',
    color: '#ffffff',
    fontSize: '18px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  headerTitle: {
    fontSize: '18px',
    fontWeight: '700',
    margin: 0
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  // 1. Items List
  itemsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  itemRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    background: 'rgba(15, 23, 42, 0.7)',
    borderRadius: '16px',
    border: '1px solid rgba(255, 255, 255, 0.08)'
  },
  itemThumb: {
    width: '54px',
    height: '54px',
    borderRadius: '12px',
    objectFit: 'cover',
    background: '#1e293b'
  },
  itemInfo: {
    flex: 1,
    minWidth: 0
  },
  itemName: {
    fontSize: '14px',
    fontWeight: '700',
    margin: '0 0 4px 0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  itemMetaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  itemUnit: {
    fontSize: '12px',
    color: '#94a3b8'
  },
  itemPrice: {
    fontSize: '13px',
    fontWeight: '800',
    color: '#ff2a4d'
  },
  stepper: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'rgba(15, 23, 42, 0.9)',
    borderRadius: '999px',
    padding: '4px 6px',
    border: '1px solid rgba(255, 255, 255, 0.1)'
  },
  stepperBtn: {
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(255, 255, 255, 0.1)',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  stepperVal: {
    fontSize: '13px',
    fontWeight: '700',
    minWidth: '18px',
    textAlign: 'center'
  },
  // 2. Payment Method
  card: {
    background: 'rgba(15, 23, 42, 0.7)',
    borderRadius: '16px',
    padding: '14px',
    border: '1px solid rgba(255, 255, 255, 0.08)'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '10px'
  },
  cardTitle: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#e2e8f0'
  },
  activePill: {
    fontSize: '11px',
    fontWeight: '700',
    color: '#ff2a4d',
    background: 'rgba(255, 42, 77, 0.15)',
    padding: '2px 8px',
    borderRadius: '999px',
    border: '1px solid rgba(255, 42, 77, 0.3)'
  },
  paymentGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '10px'
  },
  paymentOption: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px',
    background: 'rgba(15, 23, 42, 0.6)',
    borderRadius: '12px',
    border: '1.5px solid rgba(255, 255, 255, 0.08)',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  paymentOptionActive: {
    borderColor: '#ff2a4d',
    background: 'linear-gradient(135deg, rgba(255, 42, 77, 0.18) 0%, rgba(15, 23, 42, 0.9) 100%)',
    boxShadow: '0 4px 15px rgba(255, 42, 77, 0.25)'
  },
  radioCircle: {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    border: '1.5px solid #64748b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  radioDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#ff2a4d'
  },
  paymentIcon: {
    fontSize: '18px'
  },
  paymentName: {
    fontSize: '12px',
    fontWeight: '700',
    lineHeight: '1.2'
  },
  paymentDesc: {
    fontSize: '10px',
    color: '#94a3b8',
    marginTop: '2px'
  },
  // 3. Summary & Checkout
  summaryCard: {
    background: 'rgba(15, 23, 42, 0.8)',
    borderRadius: '16px',
    padding: '16px',
    border: '1px solid rgba(255, 255, 255, 0.08)'
  },
  totalRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '14px'
  },
  totalLabel: {
    fontSize: '15px',
    fontWeight: '700',
    color: '#ffffff'
  },
  totalAmount: {
    fontSize: '20px',
    fontWeight: '800',
    color: '#ff2a4d'
  },
  checkoutBtn: {
    width: '100%',
    height: '50px',
    borderRadius: '14px',
    background: 'linear-gradient(135deg, #ff2a4d 0%, #dc2626 100%)',
    border: 'none',
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: '800',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    boxShadow: '0 6px 20px rgba(255, 42, 77, 0.4)',
    transition: 'all 0.2s ease'
  },
  checkoutBtnDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed'
  },
  btnArrow: {
    fontSize: '18px',
    fontWeight: 'bold'
  },
  // Empty State
  emptyCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '48px 20px',
    background: 'rgba(15, 23, 42, 0.5)',
    borderRadius: '20px',
    border: '1px dashed rgba(255, 255, 255, 0.1)',
    margin: '20px 0'
  },
  emptyIcon: {
    fontSize: '48px',
    marginBottom: '12px'
  },
  emptyTitle: {
    fontSize: '18px',
    fontWeight: '700',
    margin: '0 0 6px 0'
  },
  emptyDesc: {
    fontSize: '13px',
    color: '#94a3b8',
    maxWidth: '260px',
    margin: '0 0 18px 0',
    lineHeight: '1.4'
  },
  emptyActionBtn: {
    padding: '10px 24px',
    borderRadius: '999px',
    background: 'linear-gradient(135deg, #ff2a4d 0%, #dc2626 100%)',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: '700',
    border: 'none',
    cursor: 'pointer'
  }
};
