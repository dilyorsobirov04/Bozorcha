// Telegram WebApp SDK
const tg = window.Telegram?.WebApp;
const ADMIN_ID = 7351189083;

// App State
let currentScreen = 'onboarding';
let products = [];
let categories = [];
let currentCategory = 'all';
let currentSubcategory = 'all';
let currentSort = 'default'; // 'default', 'price_asc', 'price_desc', 'discount_only'
let selectedPaymentMethod = 'cash'; // 'cash' or 'click'
let activeOrder = null;
let cart = {}; // { productId: { item: product, weight: 1.0, qty: 1 } }
let selectedDetailProduct = null;
let currentSelectedWeight = 1.0;
let isAdminMode = false;
let targetAdminProductId = null;
let trackingInterval = null;
let remainingMinutes = 14;

document.addEventListener('DOMContentLoaded', () => {
    initTelegramApp();
    loadCategories();
    loadProducts();
    initSlideToPay();
    setupNavigationListeners();

    // Check if returning user has already seen welcome onboarding
    try {
        const hasSeenWelcome = localStorage.getItem('hasSeenWelcome');
        if (hasSeenWelcome === 'true') {
            navigateTo('home', true);
        }
    } catch (e) {
        console.warn('localStorage not accessible', e);
    }
});

function initTelegramApp() {
    if (tg) {
        tg.ready();
        tg.expand();

        if (tg.setHeaderColor) {
            tg.setHeaderColor('#090d16');
        }

        const user = tg.initDataUnsafe?.user;
        const userId = user?.id || ADMIN_ID;

        // Admin tugmasi tekshiruvi
        if (userId == ADMIN_ID || userId === 7351189083) {
            const adminBtn = document.getElementById('admin-mode-toggle');
            if (adminBtn) adminBtn.style.display = 'block';
        }
    }
}

// ----------------- NAVIGATION LISTENERS & SHOPPING HANDLER -----------------
function setupNavigationListeners() {
    const startBtns = document.querySelectorAll('#start-shopping-btn, .start-shopping-btn, [data-action="start-shopping"]');
    startBtns.forEach(btn => {
        btn.onclick = (e) => {
            if (e) e.preventDefault();
            startShopping();
        };
    });
}

function startShopping(eventOrUrl = null) {
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }

    // Persist that user has completed/seen welcome
    try {
        localStorage.setItem('hasSeenWelcome', 'true');
    } catch (e) {
        console.warn('localStorage not accessible', e);
    }

    if (typeof eventOrUrl === 'string') {
        if (eventOrUrl.startsWith('http://') || eventOrUrl.startsWith('https://')) {
            if (tg?.openLink) {
                tg.openLink(eventOrUrl);
            } else {
                window.open(eventOrUrl, '_blank');
            }
            return;
        } else if (eventOrUrl) {
            window.location.href = eventOrUrl;
            return;
        }
    }

    // Immediately transition to 'home' store view
    navigateTo('home', false);

    // Make sure onboarding screen is explicitly hidden and home screen is active
    const onboardingScreen = document.getElementById('screen-onboarding');
    if (onboardingScreen) {
        onboardingScreen.classList.remove('active');
        onboardingScreen.style.display = 'none';
    }

    const homeScreen = document.getElementById('screen-home');
    if (homeScreen) {
        homeScreen.classList.add('active');
        homeScreen.style.display = 'block';
    }

    // Render products immediately
    renderHomeProducts();

    // Smooth scroll down to products section
    requestAnimationFrame(() => {
        setTimeout(() => {
            scrollToProducts();
        }, 50);
    });
}

function scrollToProducts() {
    const target = document.getElementById('products-section') || 
                   document.getElementById('shop-main') ||
                   document.getElementById('shop') || 
                   document.getElementById('home-products-grid') ||
                   document.getElementById('home-categories-bar');
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// ----------------- SCREEN NAVIGATION -----------------
function navigateTo(screenId, shouldScrollToTop = true) {
    currentScreen = screenId;
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none';
    });

    const targetScreen = document.getElementById(`screen-${screenId}`);
    if (targetScreen) {
        targetScreen.classList.add('active');
        targetScreen.style.display = 'block';
        if (shouldScrollToTop) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    // Bottom Navigation Bar update
    const navBar = document.getElementById('bottom-nav-bar');
    if (navBar) {
        if (screenId === 'onboarding') {
            navBar.style.display = 'none';
        } else {
            navBar.style.display = 'flex';
        }
    }

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        const onclickAttr = item.getAttribute('onclick') || '';
        if (onclickAttr.includes(`'${screenId}'`)) {
            item.classList.add('active');
        }
    });

    if (screenId === 'home') {
        renderHomeProducts();
    } else if (screenId === 'checkout') {
        renderCheckout();
    } else if (screenId === 'tracking') {
        startLiveTrackingTimer();
    }
}

// ----------------- PRODUCTS FETCHING & RENDERING -----------------
async function loadProducts() {
    try {
        const res = await fetch('/api/products?limit=50');
        if (res.ok) {
            const data = await res.json();
            products = data.items || data;
            renderHomeProducts();
        } else {
            useFallbackProducts();
        }
    } catch (e) {
        useFallbackProducts();
    }
}

function useFallbackProducts() {
    products = [
        {
            id: 101,
            category_id: 1,
            name: "Organik Avokado Hass",
            unit: "kg",
            price: 68000,
            old_price: 85000,
            discount_percent: 20,
            stock: 42,
            description: "Yangi uzilgan, yog'li va nozik ta'mga ega premium darajadagi organik avokado.",
            nutrition: { cal: "160 kcal", protein: "2g", fat: "15g" },
            image_url: "assets/organic_avocado.png",
            is_promo: true
        },
        {
            id: 102,
            category_id: 1,
            name: "Qulupnay Premium Sweet",
            unit: "kg",
            price: 45000,
            old_price: 60000,
            discount_percent: 25,
            stock: 28,
            description: "Shirali va xushbo'y yangi uzilgan tabiiy qulupnay.",
            nutrition: { cal: "32 kcal", protein: "0.7g", fat: "0.3g" },
            image_url: "https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=500&auto=format&fit=crop&q=60",
            is_promo: true
        },
        {
            id: 103,
            category_id: 2,
            name: "Fermer Suti 3.2% Bio",
            unit: "dona",
            price: 14000,
            old_price: 16500,
            discount_percent: 15,
            stock: 50,
            description: "Tabiiy pasterizatsiyalangan yangi sig'ir suti.",
            nutrition: { cal: "60 kcal", protein: "3.2g", fat: "3.2g" },
            image_url: "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=500&auto=format&fit=crop&q=60",
            is_promo: true
        },
        {
            id: 104,
            category_id: 3,
            name: "Mol Go'shti Ribeye Steyk",
            unit: "kg",
            price: 145000,
            old_price: 180000,
            discount_percent: 19,
            stock: 18,
            description: "Marmar mol go'shti, mayin va suvli gril steyk uchun eng yaxshi tanlov.",
            nutrition: { cal: "250 kcal", protein: "26g", fat: "17g" },
            image_url: "https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=500&auto=format&fit=crop&q=60",
            is_promo: true
        },
        {
            id: 105,
            category_id: 4,
            name: "Fransuzcha Kruassan Butter",
            unit: "dona",
            price: 18000,
            old_price: 24000,
            discount_percent: 25,
            stock: 35,
            description: "Haqiqiy sariyog' bilan qatlamali tayyorlangan issiq nonvoyxona kruassani.",
            nutrition: { cal: "400 kcal", protein: "8g", fat: "21g" },
            image_url: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=500&auto=format&fit=crop&q=60",
            is_promo: true
        },
        {
            id: 106,
            category_id: 5,
            name: "Apelsin Sharbati Fresh 1L",
            unit: "dona",
            price: 22000,
            old_price: 28000,
            discount_percent: 21,
            stock: 40,
            description: "100% tabiiy siqilgan apelsin sharbati, shakarsiz.",
            nutrition: { cal: "45 kcal", protein: "0.7g", fat: "0.2g" },
            image_url: "https://images.unsplash.com/photo-1613478223719-2ab802602423?w=500&auto=format&fit=crop&q=60",
            is_promo: true
        }
    ];
    renderHomeProducts();
}

function selectCategory(catId) {
    currentCategory = catId;
    currentSubcategory = 'all';

    document.querySelectorAll('#home-categories-bar .cat-pill').forEach(pill => {
        if (pill.getAttribute('data-cat') === String(catId)) {
            pill.classList.add('active');
        } else {
            pill.classList.remove('active');
        }
    });

    renderHomeSubcategoryPills();
    renderHomeProducts();
}

function selectSubcategory(subcatId) {
    currentSubcategory = subcatId;

    document.querySelectorAll('#home-subcategories-bar .subcat-pill').forEach(pill => {
        if (pill.getAttribute('data-subcat') === String(subcatId)) {
            pill.classList.add('active');
        } else {
            pill.classList.remove('active');
        }
    });

    renderHomeProducts();
}

function filterByPromo() {
    selectCategory('all');
    setSort('discount_only');
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
    scrollToProducts();
}

function handleSearch() {
    const searchInput = document.getElementById('home-search');
    const clearBtn = document.getElementById('search-clear-btn');
    const query = (searchInput?.value || '').trim();

    if (clearBtn) {
        if (query.length > 0) {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
        }
    }

    renderHomeProducts();
}

function clearSearch() {
    const searchInput = document.getElementById('home-search');
    const clearBtn = document.getElementById('search-clear-btn');
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
    if (clearBtn) {
        clearBtn.classList.add('hidden');
    }
    renderHomeProducts();
}

function setSort(sortType) {
    currentSort = sortType;
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.selectionChanged();
    }

    document.querySelectorAll('#sort-filter-bar .sort-chip').forEach(chip => {
        if (chip.getAttribute('data-sort') === sortType) {
            chip.classList.add('active');
        } else {
            chip.classList.remove('active');
        }
    });

    renderHomeProducts();
}

function resetAllFilters() {
    currentCategory = 'all';
    currentSubcategory = 'all';
    currentSort = 'default';

    const searchInput = document.getElementById('home-search');
    if (searchInput) searchInput.value = '';
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) clearBtn.classList.add('hidden');

    document.querySelectorAll('#home-categories-bar .cat-pill').forEach(pill => {
        if (pill.getAttribute('data-cat') === 'all') {
            pill.classList.add('active');
        } else {
            pill.classList.remove('active');
        }
    });

    document.querySelectorAll('#sort-filter-bar .sort-chip').forEach(chip => {
        if (chip.getAttribute('data-sort') === 'default') {
            chip.classList.add('active');
        } else {
            chip.classList.remove('active');
        }
    });

    const subcatBar = document.getElementById('home-subcategories-bar');
    if (subcatBar) subcatBar.classList.add('hidden');

    renderHomeProducts();
}

function focusSearch() {
    const searchInput = document.getElementById('home-search');
    if (searchInput) searchInput.focus();
}

function renderHomeProducts() {
    const grid = document.getElementById('home-products-grid');
    if (!grid) return;
    const query = (document.getElementById('home-search')?.value || '').toLowerCase().trim();
    const headingText = document.getElementById('products-heading-text');

    let filtered = [...products];

    // Category filter
    if (currentCategory !== 'all') {
        if (currentSubcategory !== 'all') {
            filtered = filtered.filter(p => String(p.category_id) === String(currentSubcategory));
        } else {
            const subIds = categories
                .filter(c => String(c.parent_id) === String(currentCategory))
                .map(c => String(c.id));
            const targetIds = new Set([String(currentCategory), ...subIds]);
            filtered = filtered.filter(p => targetIds.has(String(p.category_id)));
        }
    }

    // Real-time search filter (title, description, recommendation)
    if (query) {
        filtered = filtered.filter(p => {
            const nameMatch = (p.name || '').toLowerCase().includes(query);
            const descMatch = (p.description || '').toLowerCase().includes(query);
            const recMatch = (p.recommendation || '').toLowerCase().includes(query);
            return nameMatch || descMatch || recMatch;
        });
        if (headingText) {
            headingText.innerText = `Qidiruv natijalari (${filtered.length})`;
        }
    } else {
        if (headingText) {
            if (currentSort === 'discount_only') {
                headingText.innerText = 'Chegirmali mahsulotlar';
            } else if (currentSort === 'price_asc') {
                headingText.innerText = 'Arzonroq mahsulotlar';
            } else if (currentSort === 'price_desc') {
                headingText.innerText = 'Qimmatroq mahsulotlar';
            } else {
                headingText.innerText = 'Ommabop mahsulotlar';
            }
        }
    }

    // Sort & Discount filtering
    if (currentSort === 'discount_only') {
        filtered = filtered.filter(p => (p.discount_percent && p.discount_percent > 0) || (p.old_price && p.old_price > p.price) || p.is_promo);
        filtered.sort((a, b) => (b.discount_percent || 0) - (a.discount_percent || 0));
    } else if (currentSort === 'price_asc') {
        filtered.sort((a, b) => (a.price || 0) - (b.price || 0));
    } else if (currentSort === 'price_desc') {
        filtered.sort((a, b) => (b.price || 0) - (a.price || 0));
    }

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px 10px; color: var(--text-muted);">
                <div style="font-size: 36px; margin-bottom: 8px;">🔍</div>
                <p style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">Hech narsa topilmadi</p>
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px;">Boshqa so'z bilan qidirib ko'ring yoki filtrlarni tozalang</p>
                <button class="banner-action-btn" onclick="resetAllFilters()" style="margin: 0 auto; display: inline-block;">Filtrlarni tozalash</button>
            </div>
        `;
        return;
    }

    grid.innerHTML = filtered.map(p => {
        const hasDiscount = p.discount_percent && p.discount_percent > 0;
        const formattedPrice = (p.price || 0).toLocaleString('uz-UZ') + " so'm";
        const formattedOldPrice = p.old_price ? (p.old_price || 0).toLocaleString('uz-UZ') + " so'm" : '';

        return `
            <div class="product-card" onclick="openProductModal(${p.id})">
                ${hasDiscount ? `<div class="discount-badge-corner">-${p.discount_percent}%</div>` : ''}
                <div class="product-card-img-wrap">
                    <img src="${p.image_url}" alt="${p.name}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1542838132-92c53300491e?w=500&auto=format&fit=crop&q=60'">
                </div>
                <span class="product-unit-tag">${p.unit || 'dona'}</span>
                <h4 class="product-title">${p.name}</h4>
                <div class="card-bottom-row">
                    <div class="price-stack">
                        ${hasDiscount ? `<span class="card-old-price">${formattedOldPrice}</span>` : ''}
                        <span class="card-price">${formattedPrice}</span>
                    </div>
                    <button class="quick-add-btn" onclick="event.stopPropagation(); quickAddToCart(${p.id})">+</button>
                </div>
            </div>
        `;
    }).join('');
}

// ----------------- 3. PRODUCT DETAILS MODAL -----------------
function openProductModal(productId) {
    selectedDetailProduct = products.find(p => p.id == productId);
    if (!selectedDetailProduct) return;

    currentSelectedWeight = 1.0;

    document.getElementById('detail-product-img').src = selectedDetailProduct.image_url;
    document.getElementById('detail-product-title').innerText = selectedDetailProduct.name;
    document.getElementById('detail-stock-badge').innerText = `📊 Qoldiq: ${selectedDetailProduct.stock} ${selectedDetailProduct.unit || 'ta'}`;
    document.getElementById('detail-product-desc').innerText = selectedDetailProduct.description || '';

    // Nutrition
    const nut = selectedDetailProduct.nutrition || { cal: "160 kcal", protein: "2g", fat: "15g" };
    document.getElementById('nutri-cal').innerText = nut.cal;
    document.getElementById('nutri-protein').innerText = nut.protein;
    document.getElementById('nutri-fat').innerText = nut.fat;

    // Reset weight selector pills
    document.querySelectorAll('.weight-btn').forEach(btn => {
        if (btn.getAttribute('data-weight') === '1.0') {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    updateModalPrice();

    const modal = document.getElementById('modal-product-detail');
    modal.classList.remove('hidden');
}

function closeProductModal(event) {
    document.getElementById('modal-product-detail').classList.add('hidden');
}

function selectWeight(weight) {
    currentSelectedWeight = weight;
    document.querySelectorAll('.weight-btn').forEach(btn => {
        if (parseFloat(btn.getAttribute('data-weight')) === weight) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    updateModalPrice();
}

function updateModalPrice() {
    if (!selectedDetailProduct) return;

    const basePrice = selectedDetailProduct.price;
    const baseOldPrice = selectedDetailProduct.old_price;

    const calcPrice = Math.round(basePrice * currentSelectedWeight);
    const calcOldPrice = baseOldPrice ? Math.round(baseOldPrice * currentSelectedWeight) : 0;

    document.getElementById('detail-current-price').innerText = calcPrice.toLocaleString('uz-UZ') + " so'm";
    if (calcOldPrice > 0) {
        document.getElementById('detail-old-price').innerText = calcOldPrice.toLocaleString('uz-UZ') + " so'm";
        document.getElementById('detail-old-price').style.display = 'block';
    } else {
        document.getElementById('detail-old-price').style.display = 'none';
    }
}

function addCurrentProductToCart() {
    if (!selectedDetailProduct) return;

    const pid = selectedDetailProduct.id;
    const cartKey = `${pid}_${currentSelectedWeight}`;

    if (cart[cartKey]) {
        cart[cartKey].qty += 1;
    } else {
        cart[cartKey] = {
            item: selectedDetailProduct,
            weight: currentSelectedWeight,
            qty: 1
        };
    }

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('success');
    }

    updateNavCartBadge();
    closeProductModal();
}

function quickAddToCart(productId) {
    const prod = products.find(p => p.id == productId);
    if (!prod) return;

    const cartKey = `${productId}_1.0`;
    if (cart[cartKey]) {
        cart[cartKey].qty += 1;
    } else {
        cart[cartKey] = {
            item: prod,
            weight: 1.0,
            qty: 1
        };
    }

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }

    updateNavCartBadge();
}

function updateNavCartBadge() {
    const totalQty = Object.values(cart).reduce((sum, entry) => sum + entry.qty, 0);
    const badge = document.getElementById('nav-cart-count');
    if (badge) {
        badge.innerText = totalQty;
    }
}

// ----------------- 4. SHOPPING CART & CHECKOUT -----------------
function renderCheckout() {
    const list = document.getElementById('checkout-items-list');
    const entries = Object.entries(cart);

    if (entries.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🛒</div>
                <h4>Savatchangiz bo'sh</h4>
                <p>Katalogdan sevimli tovarlaringizni qo'shing.</p>
            </div>
        `;
        document.getElementById('bill-subtotal').innerText = '0 so\'m';
        document.getElementById('bill-discount').innerText = '-0 so\'m';
        document.getElementById('bill-total').innerText = '0 so\'m';
        return;
    }

    let subtotal = 0;
    let totalDiscount = 0;

    list.innerHTML = entries.map(([key, entry]) => {
        const item = entry.item;
        const weightText = entry.weight === 1.0 ? '' : ` (${entry.weight}x)`;
        const itemPrice = Math.round(item.price * entry.weight);
        const itemOldPrice = item.old_price ? Math.round(item.old_price * entry.weight) : itemPrice;

        const rowTotal = itemPrice * entry.qty;
        subtotal += rowTotal;
        totalDiscount += (itemOldPrice - itemPrice) * entry.qty;

        return `
            <div class="cart-item-row">
                <img src="${item.image_url}" alt="${item.name}" class="cart-item-thumb">
                <div class="cart-item-meta">
                    <h4>${item.name}${weightText}</h4>
                    <span>${rowTotal.toLocaleString('uz-UZ')} so'm</span>
                </div>
                <div class="qty-stepper">
                    <button class="qty-btn" onclick="updateCartItemQty('${key}', -1)">-</button>
                    <span class="qty-val">${entry.qty}</span>
                    <button class="qty-btn" onclick="updateCartItemQty('${key}', 1)">+</button>
                </div>
            </div>
        `;
    }).join('');

    const finalTotal = subtotal;

    document.getElementById('bill-subtotal').innerText = (subtotal + totalDiscount).toLocaleString('uz-UZ') + " so'm";
    document.getElementById('bill-discount').innerText = `-${totalDiscount.toLocaleString('uz-UZ')} so'm`;
    document.getElementById('bill-total').innerText = finalTotal.toLocaleString('uz-UZ') + " so'm";
}

function updateCartItemQty(cartKey, delta) {
    if (!cart[cartKey]) return;

    cart[cartKey].qty += delta;
    if (cart[cartKey].qty <= 0) {
        delete cart[cartKey];
    }

    updateNavCartBadge();
    renderCheckout();
}

function selectTimeSlot(element) {
    document.querySelectorAll('.slot-pill').forEach(p => p.classList.remove('active'));
    element.classList.add('active');
}

function showAddressPicker() {
    alert("Manzil tanlash: Toshkent shahar, Chilonzor 9-kvartal 14-uy");
}

// ----------------- "SLIDE TO PAY" INTERACTIVE COMPONENT -----------------
function initSlideToPay() {
    const track = document.getElementById('slide-track');
    const thumb = document.getElementById('slide-thumb');
    const fill = document.getElementById('slide-fill');

    if (!track || !thumb) return;

    let isDragging = false;
    let startX = 0;
    let maxDrag = 0;

    function onStart(clientX) {
        if (Object.keys(cart).length === 0) {
            alert("Savatchangiz bo'sh!");
            return;
        }
        isDragging = true;
        startX = clientX;
        maxDrag = track.offsetWidth - thumb.offsetWidth - 8;
        thumb.style.cursor = 'grabbing';
    }

    function onMove(clientX) {
        if (!isDragging) return;
        let delta = clientX - startX;
        if (delta < 0) delta = 0;
        if (delta > maxDrag) delta = maxDrag;

        thumb.style.transform = `translateX(${delta}px)`;
        const percentage = (delta / maxDrag) * 100;
        fill.style.width = `${percentage}%`;

        if (percentage >= 90) {
            isDragging = false;
            triggerPaymentSuccess();
        }
    }

    function onEnd() {
        if (!isDragging) return;
        isDragging = false;
        thumb.style.cursor = 'grab';
        thumb.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        fill.style.transition = 'width 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        thumb.style.transform = 'translateX(0px)';
        fill.style.width = '0%';

        setTimeout(() => {
            thumb.style.transition = '';
            fill.style.transition = '';
        }, 300);
    }

    // Touch Events
    thumb.addEventListener('touchstart', e => onStart(e.touches[0].clientX));
    window.addEventListener('touchmove', e => onMove(e.touches[0].clientX));
    window.addEventListener('touchend', onEnd);

    // Mouse Events
    thumb.addEventListener('mousedown', e => onStart(e.clientX));
    window.addEventListener('mousemove', e => onMove(e.clientX));
    window.addEventListener('mouseup', onEnd);
}

function selectPaymentMethod(method) {
    selectedPaymentMethod = method;
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.selectionChanged();
    }

    const cashCard = document.getElementById('payment-method-cash');
    const clickCard = document.getElementById('payment-method-click');
    const labelEl = document.getElementById('selected-payment-label');
    const slideLabel = document.getElementById('slide-pay-label');
    const thumbIcon = document.getElementById('slide-thumb-icon');

    if (method === 'click') {
        cashCard?.classList.remove('active');
        clickCard?.classList.add('active');
        if (labelEl) {
            labelEl.innerText = '⚡️ Click';
            labelEl.className = 'payment-active-pill click-badge';
        }
        if (slideLabel) slideLabel.innerText = 'Click orqali to\'lash ➔';
        if (thumbIcon) thumbIcon.innerText = '⚡️';
    } else {
        clickCard?.classList.remove('active');
        cashCard?.classList.add('active');
        if (labelEl) {
            labelEl.innerText = '💵 Naqd pul';
            labelEl.className = 'payment-active-pill cash-badge';
        }
        if (slideLabel) slideLabel.innerText = 'Naqd to\'lov uchun suring ➔';
        if (thumbIcon) thumbIcon.innerText = '💵';
    }
}

async function triggerPaymentSuccess() {
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('success');
    }

    // Calculate total amount
    let subtotal = 0;
    Object.values(cart).forEach(entry => {
        const itemPrice = Math.round(entry.item.price * entry.weight);
        subtotal += itemPrice * entry.qty;
    });

    const activeSlot = document.querySelector('.slot-pill.active .slot-title')?.innerText || '15 - 25 daqiqa';
    const user = tg?.initDataUnsafe?.user;

    const orderPayload = {
        cart: cart,
        total_amount: subtotal,
        payment_type: selectedPaymentMethod,
        address: "Chilonzor 9-kvartal, 14-uy",
        delivery_time: activeSlot,
        user_info: user ? { id: user.id, first_name: user.first_name, username: user.username } : {}
    };

    let createdOrder = null;

    try {
        const res = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderPayload)
        });
        if (res.ok) {
            const data = await res.json();
            createdOrder = data.order || data;
        }
    } catch (e) {
        console.warn('Could not post order to API, using client fallback', e);
    }

    if (!createdOrder) {
        const fallbackId = "84" + Math.floor(100 + Math.random() * 900);
        createdOrder = {
            id: fallbackId,
            order_id: fallbackId,
            cart: cart,
            total_amount: subtotal,
            payment_type: selectedPaymentMethod,
            payment_method_name: selectedPaymentMethod === 'click' ? 'Click' : 'Naqd pul',
            status: selectedPaymentMethod === 'click' ? "To'langan (Click)" : "Kutilmoqda (Naqd)",
            click_url: `https://my.click.uz/services/pay?service_id=32514&merchant_id=21458&amount=${subtotal}&transaction_param=${fallbackId}`
        };
    }

    activeOrder = createdOrder;

    // Send data to Telegram Bot if WebApp context exists
    if (tg) {
        try {
            tg.sendData(JSON.stringify({
                order_id: createdOrder.id,
                total: subtotal,
                payment_type: selectedPaymentMethod,
                payment_method_name: selectedPaymentMethod === 'click' ? 'Click' : 'Naqd pul',
                status: createdOrder.status,
                cart: cart
            }));
        } catch (err) {
            console.log('tg.sendData not available in this view');
        }
    }

    // Update Live Tracking Screen Elements
    const trackingOrderId = document.getElementById('tracking-order-id');
    if (trackingOrderId) {
        trackingOrderId.innerText = `Buyurtma #${createdOrder.id}`;
    }

    const trackingPayBadge = document.getElementById('tracking-payment-badge');
    if (trackingPayBadge) {
        if (selectedPaymentMethod === 'click') {
            trackingPayBadge.innerText = '⚡️ Click';
            trackingPayBadge.className = 'status-live-chip payment-live-chip';
        } else {
            trackingPayBadge.innerText = '💵 Naqd pul';
            trackingPayBadge.className = 'status-live-chip';
        }
    }

    const trackingTotal = document.getElementById('tracking-order-total');
    if (trackingTotal) {
        trackingTotal.innerText = subtotal.toLocaleString('uz-UZ') + " so'm";
    }

    const trackingStatus = document.getElementById('tracking-order-status');
    if (trackingStatus) {
        const orderStatus = createdOrder.status || (selectedPaymentMethod === 'click' ? "To'langan (Click)" : "Kutilmoqda (Naqd)");
        trackingStatus.innerText = orderStatus;
        if (selectedPaymentMethod === 'click') {
            trackingStatus.className = 'summary-status-badge status-paid';
        } else {
            trackingStatus.className = 'summary-status-badge status-pending';
        }
    }

    const clickActionBox = document.getElementById('tracking-click-action');
    if (clickActionBox) {
        if (selectedPaymentMethod === 'click' && createdOrder.click_url) {
            clickActionBox.classList.remove('hidden');
        } else {
            clickActionBox.classList.add('hidden');
        }
    }

    // Reset Cart and Navigate to Live Tracking Screen
    cart = {};
    updateNavCartBadge();
    navigateTo('tracking');
}

function openClickPaymentUrl() {
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
    const url = activeOrder?.click_url || "https://my.click.uz";
    if (tg && tg.openLink) {
        tg.openLink(url);
    } else {
        window.open(url, '_blank');
    }
}

// ----------------- 5. LIVE ORDER TRACKING -----------------
function startLiveTrackingTimer() {
    remainingMinutes = 14;
    const countdownEl = document.getElementById('eta-countdown');
    if (countdownEl) {
        countdownEl.innerText = `${remainingMinutes} daqiqa`;
    }

    if (trackingInterval) clearInterval(trackingInterval);

    trackingInterval = setInterval(() => {
        if (remainingMinutes > 1) {
            remainingMinutes--;
            if (countdownEl) {
                countdownEl.innerText = `${remainingMinutes} daqiqa`;
            }
        }
    }, 45000);
}

function callCourier() {
    alert("Kuryerga qo'ng'iroq qilinmoqda: +998 90 123 45 67 (Jasur)");
}

function chatCourier() {
    alert("Kuryer bilan chat: 'Assalomu alaykum, eshik oldidaman.'");
}

function callSupport() {
    alert("Mijozlarni qo'llab-quvvatlash xizmati: +998 71 200 00 00");
}

// ----------------- CATEGORIES FETCHING & RENDERING -----------------
async function loadCategories() {
    try {
        const res = await fetch('/api/categories');
        if (res.ok) {
            categories = await res.json();
        } else {
            useFallbackCategories();
        }
    } catch (e) {
        useFallbackCategories();
    }
    renderHomeCategoryPills();
    renderHomeSubcategoryPills();
    renderCategoryDropdownOptions();
    renderParentCategoryDropdownOptions();
    renderAdminCategoriesList();
}

function useFallbackCategories() {
    categories = [
        { id: 1, name: "Meva & Sabzavotlar", icon: "🍎", parent_id: null, image_url: "https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=200&auto=format&fit=crop&q=60" },
        { id: 2, name: "Sut & Tuxum", icon: "🥛", parent_id: null, image_url: "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=200&auto=format&fit=crop&q=60" },
        { id: 3, name: "Go'sht & Baliq", icon: "🥩", parent_id: null, image_url: "https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=200&auto=format&fit=crop&q=60" },
        { id: 4, name: "Non & Pishiriqlar", icon: "🥖", parent_id: null, image_url: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=200&auto=format&fit=crop&q=60" },
        { id: 5, name: "Ichimliklar", icon: "🥤", parent_id: null, image_url: "https://images.unsplash.com/photo-1613478223719-2ab802602423?w=200&auto=format&fit=crop&q=60" },
        { id: 11, name: "Yangi Mevalar", icon: "🍓", parent_id: 1, image_url: "https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=200&auto=format&fit=crop&q=60" },
        { id: 12, name: "Sabzavotlar", icon: "🥑", parent_id: 1, image_url: "assets/organic_avocado.png" },
        { id: 13, name: "Yashillik & Ko'kat", icon: "🌿", parent_id: 1, image_url: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=200&auto=format&fit=crop&q=60" },
        { id: 21, name: "Sut & Qatiq", icon: "🥛", parent_id: 2, image_url: "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=200&auto=format&fit=crop&q=60" },
        { id: 22, name: "Pishloq & Tvorog", icon: "🧀", parent_id: 2, image_url: "https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=200&auto=format&fit=crop&q=60" },
        { id: 23, name: "Tuxum", icon: "🥚", parent_id: 2, image_url: "https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=200&auto=format&fit=crop&q=60" },
        { id: 31, name: "Mol & Qo'y go'shti", icon: "🥩", parent_id: 3, image_url: "https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=200&auto=format&fit=crop&q=60" },
        { id: 32, name: "Parranda go'shti", icon: "🍗", parent_id: 3, image_url: "https://images.unsplash.com/photo-1587593810167-a84920ea0781?w=200&auto=format&fit=crop&q=60" },
        { id: 33, name: "Baliq & Dengiz", icon: "🐟", parent_id: 3, image_url: "https://images.unsplash.com/photo-1534939561126-855b8675edd7?w=200&auto=format&fit=crop&q=60" },
        { id: 41, name: "Tandir & Qolip non", icon: "🍞", parent_id: 4, image_url: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=200&auto=format&fit=crop&q=60" },
        { id: 42, name: "Kruassan & Pishiriq", icon: "🥐", parent_id: 4, image_url: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=200&auto=format&fit=crop&q=60" },
        { id: 51, name: "Sharbat & Fresh", icon: "🧃", parent_id: 5, image_url: "https://images.unsplash.com/photo-1613478223719-2ab802602423?w=200&auto=format&fit=crop&q=60" },
        { id: 52, name: "Suv & Gazli ichimlik", icon: "🥤", parent_id: 5, image_url: "https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=200&auto=format&fit=crop&q=60" }
    ];
}

function renderHomeCategoryPills() {
    const bar = document.getElementById('home-categories-bar');
    if (!bar) return;

    const topCategories = categories.filter(c => !c.parent_id);

    let html = `
        <div class="cat-pill ${currentCategory === 'all' ? 'active' : ''}" data-cat="all" onclick="selectCategory('all')">
            <span class="cat-icon">🛍️</span>
            <span class="cat-name">Barchasi</span>
        </div>
    `;

    topCategories.forEach(cat => {
        const isActive = String(currentCategory) === String(cat.id);
        html += `
            <div class="cat-pill ${isActive ? 'active' : ''}" data-cat="${cat.id}" onclick="selectCategory('${cat.id}')">
                <span class="cat-icon">${cat.icon || '📦'}</span>
                <span class="cat-name">${cat.name}</span>
            </div>
        `;
    });

    bar.innerHTML = html;
}

function renderHomeSubcategoryPills() {
    const subBar = document.getElementById('home-subcategories-bar');
    if (!subBar) return;

    if (currentCategory === 'all') {
        subBar.classList.add('hidden');
        subBar.innerHTML = '';
        return;
    }

    const subcats = categories.filter(c => String(c.parent_id) === String(currentCategory));

    if (subcats.length === 0) {
        subBar.classList.add('hidden');
        subBar.innerHTML = '';
        return;
    }

    let html = `
        <div class="subcat-pill ${currentSubcategory === 'all' ? 'active' : ''}" data-subcat="all" onclick="selectSubcategory('all')">
            <span>Barchasi</span>
        </div>
    `;

    subcats.forEach(sub => {
        const isActive = String(currentSubcategory) === String(sub.id);
        html += `
            <div class="subcat-pill ${isActive ? 'active' : ''}" data-subcat="${sub.id}" onclick="selectSubcategory('${sub.id}')">
                <span>${sub.icon || '🏷️'}</span>
                <span>${sub.name}</span>
            </div>
        `;
    });

    subBar.innerHTML = html;
    subBar.classList.remove('hidden');
}

function renderCategoryDropdownOptions() {
    const select = document.getElementById('add-prod-category');
    if (!select) return;

    const topCategories = categories.filter(c => !c.parent_id);
    let html = '';

    topCategories.forEach(top => {
        const subcats = categories.filter(c => String(c.parent_id) === String(top.id));
        if (subcats.length > 0) {
            html += `<optgroup label="${top.icon || '📁'} ${top.name}">`;
            html += `<option value="${top.id}">⭐ ${top.name} (Umumiy toifa)</option>`;
            subcats.forEach(sub => {
                html += `<option value="${sub.id}">&nbsp;&nbsp;↳ ${sub.icon || '🏷️'} ${sub.name}</option>`;
            });
            html += `</optgroup>`;
        } else {
            html += `<option value="${top.id}">${top.icon || '📁'} ${top.name}</option>`;
        }
    });

    const orphanSubcats = categories.filter(c => c.parent_id && !topCategories.some(t => t.id == c.parent_id));
    if (orphanSubcats.length > 0) {
        html += `<optgroup label="Boshqa toifalar">`;
        orphanSubcats.forEach(sub => {
            html += `<option value="${sub.id}">${sub.icon || '🏷️'} ${sub.name}</option>`;
        });
        html += `</optgroup>`;
    }

    select.innerHTML = html;
}

function renderParentCategoryDropdownOptions() {
    const select = document.getElementById('add-cat-parent');
    if (!select) return;

    const topCategories = categories.filter(c => !c.parent_id);

    let html = `<option value="">📁 Asosiy Kategoriya (Ota kategoriya yo'q)</option>`;
    topCategories.forEach(top => {
        html += `<option value="${top.id}">${top.icon || '📁'} ${top.name} (Ota kategoriya)</option>`;
    });

    select.innerHTML = html;
}

// ----------------- ADMIN REJIM & TO'LIQ BOSHQARUV -----------------
let currentAdminTab = 'add-prod';
let deleteTarget = { type: null, id: null, name: "" };

function toggleAdminMode() {
    isAdminMode = !isAdminMode;
    if (isAdminMode) {
        navigateTo('admin');
        switchAdminTab('add-prod');
        loadAdminCards();
        renderAdminCategoriesList();
    } else {
        navigateTo('home');
    }
}

function switchAdminTab(tab) {
    currentAdminTab = tab;
    const btnAddProd = document.getElementById('tab-btn-add-prod');
    const btnProdList = document.getElementById('tab-btn-prod-list');
    const btnCatList = document.getElementById('tab-btn-categories');

    const viewAddProd = document.getElementById('admin-view-add-prod');
    const viewProdList = document.getElementById('admin-view-prod-list');
    const viewCatList = document.getElementById('admin-view-categories');

    [btnAddProd, btnProdList, btnCatList].forEach(btn => btn?.classList.remove('active'));
    [viewAddProd, viewProdList, viewCatList].forEach(v => v?.classList.add('hidden'));

    if (tab === 'add-prod') {
        btnAddProd?.classList.add('active');
        viewAddProd?.classList.remove('hidden');
        renderCategoryDropdownOptions();
    } else if (tab === 'prod-list') {
        btnProdList?.classList.add('active');
        viewProdList?.classList.remove('hidden');
        loadAdminCards();
    } else if (tab === 'categories') {
        btnCatList?.classList.add('active');
        viewCatList?.classList.remove('hidden');
        renderParentCategoryDropdownOptions();
        renderAdminCategoriesList();
    }
}

// --- Image Upload Helpers ---
async function uploadImageFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        if (res.ok) {
            const data = await res.json();
            return data.url;
        }
    } catch (e) {
        console.warn('API upload failed, falling back to local Data URI', e);
    }

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
    });
}

async function handleProductFilePicked(event) {
    const file = event.target.files[0];
    if (!file) return;

    showToast("Rasm yuklanmoqda... ⏳", "success");
    const uploadedUrl = await uploadImageFile(file);

    const imgInput = document.getElementById('add-prod-image');
    if (imgInput) imgInput.value = uploadedUrl;
    updateAddImagePreview();
    showToast("Rasm muvaffaqiyatli yuklandi! 📸", "success");
}

async function handleCategoryFilePicked(event) {
    const file = event.target.files[0];
    if (!file) return;

    showToast("Kategoriya rasmi yuklanmoqda... ⏳", "success");
    const uploadedUrl = await uploadImageFile(file);

    const imgInput = document.getElementById('add-cat-image');
    if (imgInput) imgInput.value = uploadedUrl;
    updateCatImagePreview();
    showToast("Kategoriya rasmi yuklandi! 📸", "success");
}

function updateAddImagePreview() {
    const input = document.getElementById('add-prod-image');
    const previewWrap = document.getElementById('add-image-preview-wrap');
    const previewImg = document.getElementById('add-image-preview');
    const url = (input?.value || '').trim();

    if (url) {
        if (previewImg) previewImg.src = url;
        if (previewWrap) previewWrap.classList.remove('hidden');
    } else {
        if (previewWrap) previewWrap.classList.add('hidden');
    }
}

function updateCatImagePreview() {
    const input = document.getElementById('add-cat-image');
    const previewWrap = document.getElementById('add-cat-preview-wrap');
    const previewImg = document.getElementById('add-cat-preview');
    const url = (input?.value || '').trim();

    if (url) {
        if (previewImg) previewImg.src = url;
        if (previewWrap) previewWrap.classList.remove('hidden');
    } else {
        if (previewWrap) previewWrap.classList.add('hidden');
    }
}

// --- Product Creation & List ---
async function submitAddNewProduct() {
    const nameInput = document.getElementById('add-prod-name');
    const priceInput = document.getElementById('add-prod-price');
    const unitInput = document.getElementById('add-prod-unit');
    const catInput = document.getElementById('add-prod-category');
    const stockInput = document.getElementById('add-prod-stock');
    const imageInput = document.getElementById('add-prod-image');
    const descInput = document.getElementById('add-prod-desc');
    const submitBtn = document.getElementById('btn-submit-add-product');

    const name = (nameInput?.value || '').trim();
    const price = parseInt(priceInput?.value || '0', 10);
    const unit = unitInput?.value || 'kg';
    const category_id = parseInt(catInput?.value || '1', 10);
    const stock = parseInt(stockInput?.value || '50', 10);
    const image_url = (imageInput?.value || '').trim();
    const description = (descInput?.value || '').trim();

    if (!name) {
        showToast("Iltimos, mahsulot nomini kiriting!", "error");
        nameInput?.focus();
        return;
    }

    if (!price || price <= 0) {
        showToast("Iltimos, yaroqli narx kiriting!", "error");
        priceInput?.focus();
        return;
    }

    const payload = {
        name,
        price,
        unit,
        category_id,
        stock,
        image_url: image_url || "https://images.unsplash.com/photo-1542838132-92c53300491e?w=500&auto=format&fit=crop&q=60",
        description
    };

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>⏳ Saqlanmoqda...</span>`;
    }

    try {
        const res = await fetch('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const data = await res.json();
            showToast(`'${name}' muvaffaqiyatli qo'shildi! 🎉`, "success");

            document.getElementById('form-add-product')?.reset();
            const previewWrap = document.getElementById('add-image-preview-wrap');
            if (previewWrap) previewWrap.classList.add('hidden');

            await loadProducts();
            switchAdminTab('prod-list');
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || "Mahsulot qo'shishda xatolik yuz berdi!", "error");
        }
    } catch (e) {
        showToast("Server bilan bog'lanishda xatolik!", "error");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<span>➕ Mahsulotni Saqlash</span>`;
        }
    }
}

function getCategoryHierarchyName(categoryId) {
    const cat = categories.find(c => c.id == categoryId);
    if (!cat) return "Boshqa";
    if (cat.parent_id) {
        const parent = categories.find(c => c.id == cat.parent_id);
        if (parent) {
            return `${parent.icon || ''} ${parent.name} › ${cat.icon || ''} ${cat.name}`;
        }
    }
    return `${cat.icon || ''} ${cat.name}`;
}

function loadAdminCards(filteredList = null) {
    const grid = document.getElementById('admin-products-grid');
    const countEl = document.getElementById('admin-prod-count');
    const listToRender = filteredList !== null ? filteredList : products;

    if (countEl) countEl.innerText = products.length;
    if (!grid) return;

    if (listToRender.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px 10px; color: var(--text-muted);">
                <div style="font-size: 32px; margin-bottom: 8px;">📦</div>
                <p style="font-size: 14px; font-weight: 600;">Mahsulotlar topilmadi</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = listToRender.map(p => {
        const catName = getCategoryHierarchyName(p.category_id);
        const formattedPrice = (p.price || 0).toLocaleString('uz-UZ') + " so'm";
        const unit = p.unit || "kg";
        const safeName = (p.name || '').replace(/'/g, "\\'");

        return `
            <div id="admin-card-${p.id}" class="admin-card">
                <div class="admin-card-img-wrap">
                    <img src="${p.image_url}" alt="${p.name}" onerror="this.src='https://images.unsplash.com/photo-1542838132-92c53300491e?w=500&auto=format&fit=crop&q=60'">
                </div>
                <div>
                    <h4 class="admin-card-title" title="${p.name}">${p.name}</h4>
                    <div class="admin-card-cat" title="${catName}">${catName} • ${p.stock || 0} ${unit}</div>
                    <div class="admin-card-price">${formattedPrice}</div>
                </div>
                <div class="admin-card-actions">
                    <button class="admin-delete-btn" onclick="confirmDeleteProduct(${p.id}, '${safeName}')">
                        🗑️ O'chirish
                    </button>
                    <button class="admin-upload-btn" onclick="triggerAdminPhoto(${p.id})">
                        🖼️ Rasm yuklash
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function filterAdminProducts() {
    const query = (document.getElementById('admin-search-input')?.value || '').toLowerCase().trim();
    if (!query) {
        loadAdminCards();
        return;
    }
    const filtered = products.filter(p => (p.name || '').toLowerCase().includes(query));
    loadAdminCards(filtered);
}

// --- Category Creation & Tree List ---
async function submitAddNewCategory() {
    const nameInput = document.getElementById('add-cat-name');
    const iconInput = document.getElementById('add-cat-icon');
    const imageInput = document.getElementById('add-cat-image');
    const parentSelect = document.getElementById('add-cat-parent');
    const submitBtn = document.getElementById('btn-submit-add-cat');

    const name = (nameInput?.value || '').trim();
    const icon = (iconInput?.value || '🛍️').trim();
    const image_url = (imageInput?.value || '').trim();
    const parent_id = parentSelect?.value ? parseInt(parentSelect.value, 10) : null;

    if (!name) {
        showToast("Iltimos, kategoriya nomini kiriting!", "error");
        nameInput?.focus();
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>⏳ Saqlanmoqda...</span>`;
    }

    try {
        const res = await fetch('/api/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, icon, image_url, parent_id })
        });

        if (res.ok) {
            const isSub = parent_id !== null;
            showToast(`'${name}' ${isSub ? 'subkategoriyasi' : 'kategoriyasi'} qo'shildi! 🎉`, "success");
            document.getElementById('form-add-category')?.reset();
            const previewWrap = document.getElementById('add-cat-preview-wrap');
            if (previewWrap) previewWrap.classList.add('hidden');

            await loadCategories();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || "Kategoriya qo'shishda xatolik!", "error");
        }
    } catch (e) {
        showToast("Server bilan bog'lanishda xatolik!", "error");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<span>➕ Kategoriyani Saqlash</span>`;
        }
    }
}

function renderAdminCategoriesList() {
    const listEl = document.getElementById('admin-categories-list');
    const countEl = document.getElementById('admin-cat-count');

    if (countEl) countEl.innerText = categories.length;
    if (!listEl) return;

    if (categories.length === 0) {
        listEl.innerHTML = `
            <div style="text-align: center; padding: 30px 10px; color: var(--text-muted);">
                <p>Hozircha kategoriyalar yo'q</p>
            </div>
        `;
        return;
    }

    const topCategories = categories.filter(c => !c.parent_id);

    listEl.innerHTML = topCategories.map(top => {
        const subcats = categories.filter(c => String(c.parent_id) === String(top.id));
        const subIds = subcats.map(s => s.id);
        const allCatIds = [top.id, ...subIds];
        const totalProdsCount = products.filter(p => allCatIds.includes(p.category_id)).length;
        const safeTopName = (top.name || '').replace(/'/g, "\\'");

        let subcatsHtml = '';
        if (subcats.length > 0) {
            subcatsHtml = `
                <div class="admin-cat-sub-list">
                    ${subcats.map(sub => {
                        const subProdCount = products.filter(p => p.category_id == sub.id).length;
                        const safeSubName = (sub.name || '').replace(/'/g, "\\'");
                        return `
                            <div id="admin-cat-card-${sub.id}" class="admin-cat-sub-item">
                                <div class="admin-cat-sub-left">
                                    <span style="color: var(--text-muted); font-size: 11px;">└──</span>
                                    <span>${sub.icon || '🏷️'}</span>
                                    <span style="font-weight: 600; color: var(--text-primary);">${sub.name}</span>
                                    <span style="font-size: 11px; color: var(--text-muted); margin-left: 4px;">(${subProdCount} tovar)</span>
                                </div>
                                <button class="admin-cat-del-btn" style="padding: 4px 8px; font-size: 11px;" onclick="confirmDeleteCategory(${sub.id}, '${safeSubName}', true)">
                                    🗑️
                                </button>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        return `
            <div class="admin-cat-tree-wrap">
                <div id="admin-cat-card-${top.id}" class="admin-cat-tree-parent">
                    <div class="admin-cat-left">
                        <div class="admin-cat-icon-wrap">
                            ${top.image_url && top.image_url.startsWith('http') 
                                ? `<img src="${top.image_url}" alt="${top.name}">` 
                                : `<span>${top.icon || '📁'}</span>`}
                        </div>
                        <div>
                            <div class="admin-cat-name">
                                ${top.icon ? top.icon + ' ' : ''}${top.name}
                                <span class="admin-cat-parent-badge">Asosiy</span>
                            </div>
                            <div class="admin-cat-meta">${subcats.length} ta subkategoriya • jami ${totalProdsCount} ta tovar</div>
                        </div>
                    </div>
                    <button class="admin-cat-del-btn" onclick="confirmDeleteCategory(${top.id}, '${safeTopName}', false)">
                        🗑️ O'chirish
                    </button>
                </div>
                ${subcatsHtml}
            </div>
        `;
    }).join('');
}

// --- Unified Delete Handling ---
function confirmDeleteProduct(productId, productName) {
    deleteTarget = { type: 'product', id: productId, name: productName };
    const modal = document.getElementById('modal-delete-confirm');
    const title = document.getElementById('delete-modal-title');
    const desc = document.getElementById('delete-modal-desc');

    if (title) title.innerText = "Mahsulotni o'chirish";
    if (desc) {
        desc.innerHTML = `Haqiqatan ham <strong>"${productName}"</strong> mahsulotini tizimdan butunlay o'chirmoqchimisiz?`;
    }
    if (modal) modal.classList.remove('hidden');
}

function confirmDeleteCategory(categoryId, categoryName, isSubcategory = false) {
    deleteTarget = { type: 'category', id: categoryId, name: categoryName };
    const modal = document.getElementById('modal-delete-confirm');
    const title = document.getElementById('delete-modal-title');
    const desc = document.getElementById('delete-modal-desc');

    if (title) title.innerText = isSubcategory ? "Subkategoriyani o'chirish" : "Asosiy Kategoriyani o'chirish";
    if (desc) {
        desc.innerHTML = isSubcategory
            ? `Haqiqatan ham <strong>"${categoryName}"</strong> subkategoriyasini o'chirmoqchimisiz?`
            : `Haqiqatan ham <strong>"${categoryName}"</strong> asosiy kategoriyasini o'chirmoqchimisiz? (Barcha ichki subkategoriyalar mustaqil bo'lib qoladi)`;
    }
    if (modal) modal.classList.remove('hidden');
}

function closeDeleteConfirmModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('modal-delete-confirm');
    if (modal) modal.classList.add('hidden');
    deleteTarget = { type: null, id: null, name: "" };
}

async function executeDelete() {
    if (!deleteTarget.type || !deleteTarget.id) return;

    const btn = document.getElementById('btn-confirm-delete');
    if (btn) {
        btn.disabled = true;
        btn.innerText = "O'chirilmoqda...";
    }

    const { type, id } = deleteTarget;

    try {
        if (type === 'product') {
            const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
            if (res.ok) {
                const card = document.getElementById(`admin-card-${id}`);
                if (card) {
                    card.classList.add('card-removing');
                    setTimeout(() => card.remove(), 350);
                }

                showToast("Mahsulot muvaffaqiyatli o'chirildi! 🗑️", "success");
                closeDeleteConfirmModal();

                products = products.filter(p => p.id != id);
                renderHomeProducts();
                const countEl = document.getElementById('admin-prod-count');
                if (countEl) countEl.innerText = products.length;
                renderAdminCategoriesList();
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(err.detail || "O'chirishda xatolik yuz berdi!", "error");
                closeDeleteConfirmModal();
            }
        } else if (type === 'category') {
            const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
            if (res.ok) {
                const card = document.getElementById(`admin-cat-card-${id}`);
                if (card) {
                    card.classList.add('card-removing');
                    setTimeout(() => card.remove(), 350);
                }

                showToast("Kategoriya muvaffaqiyatli o'chirildi! 🗑️", "success");
                closeDeleteConfirmModal();

                await loadCategories();
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(err.detail || "Kategoriyani o'chirishda xatolik!", "error");
                closeDeleteConfirmModal();
            }
        }
    } catch (e) {
        showToast("Server bilan bog'lanishda xatolik!", "error");
        closeDeleteConfirmModal();
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = "Ha, o'chirish";
        }
    }
}

function triggerAdminPhoto(productId) {
    targetAdminProductId = productId;
    const picker = document.getElementById('file-picker');
    if (picker) picker.click();
}

async function handleFilePicked(event) {
    const file = event.target.files[0];
    if (!file || !targetAdminProductId) return;

    showToast("Rasm yuklanmoqda... ⏳", "success");
    const uploadedUrl = await uploadImageFile(file);

    try {
        const res = await fetch('/api/products/update-photo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                product_id: targetAdminProductId,
                image_url: uploadedUrl
            })
        });

        if (res.ok) {
            showToast("Mahsulot rasmi yangilandi! 🖼️", "success");
            await loadProducts();
            loadAdminCards();
        } else {
            showToast("Rasmni yangilashda xatolik yuz berdi", "error");
        }
    } catch (e) {
        showToast("Server xatosi", "error");
    }

    event.target.value = '';
    targetAdminProductId = null;
}

function showToast(message, type = "success") {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-message toast-${type}`;
    const icon = type === 'success' ? '✅' : '⚠️';
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Explicit window bindings for Telegram WebApp compatibility
window.startShopping = startShopping;
window.scrollToProducts = scrollToProducts;
window.navigateTo = navigateTo;
window.filterByPromo = filterByPromo;
window.handleSearch = handleSearch;
window.clearSearch = clearSearch;
window.focusSearch = focusSearch;
window.setSort = setSort;
window.resetAllFilters = resetAllFilters;
window.selectCategory = selectCategory;
window.selectSubcategory = selectSubcategory;
window.openProductModal = openProductModal;
window.closeProductModal = closeProductModal;
window.setProductDetailWeight = setProductDetailWeight;
window.addProductModalToCart = addProductModalToCart;
window.quickAddToCart = quickAddToCart;
window.updateCartItemQty = updateCartItemQty;
window.selectTimeSlot = selectTimeSlot;
window.showAddressPicker = showAddressPicker;
window.selectPaymentMethod = selectPaymentMethod;
window.triggerPaymentSuccess = triggerPaymentSuccess;
window.openClickPaymentUrl = openClickPaymentUrl;
window.callCourier = callCourier;
window.chatCourier = chatCourier;
window.callSupport = callSupport;
window.toggleAdminMode = toggleAdminMode;
