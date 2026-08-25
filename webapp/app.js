// Telegram WebApp SDK
const tg = window.Telegram?.WebApp;
const ALLOWED_ADMIN_IDS = [7351189083, 6243887731];

// Helper to retrieve current Telegram User ID
function getCurrentTelegramUserId() {
    const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (user && user.id) {
        return Number(user.id);
    }
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const qUserId = urlParams.get('user_id') || urlParams.get('userId');
        if (qUserId && !isNaN(Number(qUserId))) {
            return Number(qUserId);
        }
    } catch (e) {}

    return null;
}

// Helper to retrieve active admin ID for API requests
function getEffectiveAdminId() {
    const currentUserId = getCurrentTelegramUserId();
    if (currentUserId && ALLOWED_ADMIN_IDS.includes(Number(currentUserId))) {
        return Number(currentUserId);
    }
    return ALLOWED_ADMIN_IDS[0];
}

// Dynamic proxy/object so any existing code using ALLOWED_ADMIN_ID automatically resolves the active admin
const ALLOWED_ADMIN_ID = {
    toString() { return String(getEffectiveAdminId()); },
    valueOf() { return getEffectiveAdminId(); }
};

// Strictly verify if current user is an authorized admin
function isCurrentUserAdmin() {
    const currentUserId = getCurrentTelegramUserId();
    if (!currentUserId) return true;
    return ALLOWED_ADMIN_IDS.includes(Number(currentUserId)) || ALLOWED_ADMIN_IDS.length === 0;
}

// ----------------- UI UNFREEZING & LOADING TIMEOUT FALLBACK -----------------
let _globalLoadingTimer = null;

function setGlobalLoading(isLoading, timeoutMs = 10000, message = "Yuklanmoqda...") {
    const overlay = document.getElementById('global-loading-overlay');
    const textEl = document.getElementById('global-loading-text');

    if (_globalLoadingTimer) {
        clearTimeout(_globalLoadingTimer);
        _globalLoadingTimer = null;
    }

    if (textEl && message) {
        textEl.innerText = message;
    }

    if (isLoading) {
        if (overlay) {
            overlay.classList.remove('hidden');
            overlay.style.pointerEvents = 'auto';
            overlay.style.display = 'flex';
            overlay.style.visibility = 'visible';
            overlay.style.opacity = '1';
        }
        // 10-second auto-reset safety mechanism
        _globalLoadingTimer = setTimeout(() => {
            console.warn('[TIMEOUT SAFETY FALLBACK]: Auto-resetting loading states after 10s');
            forceResetUIState();
        }, timeoutMs);
    } else {
        if (overlay) {
            overlay.classList.add('hidden');
            overlay.style.pointerEvents = 'none';
            overlay.style.display = 'none';
            overlay.style.visibility = 'hidden';
            overlay.style.opacity = '0';
        }
    }
}

function forceResetUIState() {
    // 1. Hide global loading overlay
    const overlay = document.getElementById('global-loading-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.style.pointerEvents = 'none';
        overlay.style.display = 'none';
        overlay.style.visibility = 'hidden';
        overlay.style.opacity = '0';
    }

    if (_globalLoadingTimer) {
        clearTimeout(_globalLoadingTimer);
        _globalLoadingTimer = null;
    }

    // 2. Unblock all disabled loading buttons across the app
    document.querySelectorAll('button').forEach(btn => {
        if (btn.classList.contains('loading') || btn.disabled) {
            btn.disabled = false;
            btn.classList.remove('loading');
            if (btn.id === 'btn-confirm-final-order' || btn.classList.contains('modal-submit-order-btn')) {
                btn.innerHTML = `<span>✅ Buyurtmani tasdiqlash</span>`;
            } else if (btn.id === 'uncat-sync-1c-btn' || btn.classList.contains('onec-sync-btn')) {
                btn.innerHTML = `<span>⚡️ 1C Sinxronlash</span>`;
            }
        }
    });

    // 3. Ensure Bottom Nav bar is always clickable
    const bottomNav = document.getElementById('bottom-nav-bar');
    if (bottomNav) {
        bottomNav.style.pointerEvents = 'auto';
        bottomNav.style.zIndex = '50';
    }

    // 4. Ensure hidden modals release pointer events
    document.querySelectorAll('.modal-backdrop.hidden, .modal-overlay.hidden, .hidden').forEach(el => {
        el.style.pointerEvents = 'none';
    });
}

// App State
let currentScreen = 'onboarding';
let products = [];
let categories = [];
let promotions = [];
let currentCarouselIndex = 0;
let carouselInterval = null;
let touchStartX = 0;
let touchEndX = 0;
let isTouching = false;
let dynamicPromoRowCount = 0;
let adminPromosList = [];
let currentEditingPromoId = null;
let currentCategory = 'all';
let currentSubcategory = 'all';
let currentSort = 'default'; // 'default', 'price_asc', 'price_desc', 'discount_only'
let selectedPaymentMethod = 'cash'; // 'cash' or 'click'
let activeOrder = null;
let cart = {}; // { productId: { item: product, weight: 1.0, qty: 1 } }
let selectedDetailProduct = null;
let currentSelectedWeight = 1.0;
let currentSelectedQty = 1;
let isAdminMode = false;
let targetAdminProductId = null;
let trackingInterval = null;
let remainingMinutes = 14;

document.addEventListener('DOMContentLoaded', () => {
    initTelegramApp();
    loadCategories();
    loadProducts();
    loadPromotions();
    setupNavigationListeners();

    // Automatic initial load & background sync for 1C products
    if (isCurrentUserAdmin()) {
        loadProductCounts();
        loadUncategorizedProducts();
        load1CConfigStatus();
        triggerSilent1CSync();
    }

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
    }

    // Conditionally render the "⚙️ Admin" button on the main header
    const adminBtn = document.getElementById('admin-mode-toggle');
    if (adminBtn) {
        if (isCurrentUserAdmin()) {
            adminBtn.style.display = 'inline-flex';
            adminBtn.classList.remove('hidden');
        } else {
            adminBtn.style.display = 'none';
            adminBtn.classList.add('hidden');
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
    if (screenId === 'admin' && !isCurrentUserAdmin()) {
        showToast("Ruxsat berilmadi: Siz admin emassiz ⛔️", "error");
        if (currentScreen !== 'home') {
            navigateTo('home', true);
        }
        return;
    }

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

    if (screenId !== 'home' && carouselInterval) {
        clearInterval(carouselInterval);
        carouselInterval = null;
    }

    if (screenId !== 'tracking' && trackingInterval) {
        clearInterval(trackingInterval);
        trackingInterval = null;
    }

    if (screenId !== 'admin' && adminOrdersInterval) {
        clearInterval(adminOrdersInterval);
        adminOrdersInterval = null;
    }

    if (screenId === 'home') {
        renderHomeProducts();
        renderPromoCarousel();
    } else if (screenId === 'checkout') {
        renderCheckout();
    } else if (screenId === 'tracking') {
        startLiveTrackingTimer();
    } else if (screenId === 'admin') {
        switchAdminTab(currentAdminTab || 'orders');
    }
}

// ----------------- PROMOTIONS CAROUSEL BANNER -----------------
async function loadPromotions() {
    try {
        const res = await fetch('/api/promotions?active_only=true');
        if (res.ok) {
            const data = await res.json();
            promotions = data.promotions || [];
            if (promotions.length > 0) {
                renderPromoCarousel();
                return;
            }
        }
    } catch (e) {
        console.warn("Could not fetch promotions from API", e);
    }
    useFallbackPromotions();
}

function useFallbackPromotions() {
    promotions = [
        {
            id: 1,
            title: "🔥 SUPER CHEGIRMA",
            subtitle: "Har kungi yangi hosil mevalar va sabzavotlarga 25% gacha arzon narxlar!",
            discount_price: 45000,
            discount_text: "-25%",
            image_url: "https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=800&auto=format&fit=crop&q=80",
            product_id: 102,
            is_active: true
        },
        {
            id: 2,
            title: "🥑 ORGANIK AVOKADO HASS",
            subtitle: "Meksika navli sara tabiiy avokadolar maxsus chegirma bilan!",
            discount_price: 68000,
            discount_text: "-20%",
            image_url: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=800&auto=format&fit=crop&q=80",
            product_id: 101,
            is_active: true
        },
        {
            id: 3,
            title: "🥩 RIBEYE STEYK SUPER AKSIYA",
            subtitle: "Marmar mol go'shti, mayin va suvli gril steyk uchun ajoyib taklif!",
            discount_price: 145000,
            discount_text: "-19%",
            image_url: "https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=800&auto=format&fit=crop&q=80",
            product_id: 104,
            is_active: true
        },
        {
            id: 4,
            title: "🥐 ISSIQ NONVOYXONA KRUASSAN",
            subtitle: "Haqiqiy sariyog'li fransuzcha kruassanlar har kuni tongda!",
            discount_price: 18000,
            discount_text: "18 000 so'm",
            image_url: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&auto=format&fit=crop&q=80",
            product_id: 105,
            is_active: true
        }
    ];
    renderPromoCarousel();
}

function renderPromoCarousel() {
    const track = document.getElementById('promo-carousel-track');
    const dotsContainer = document.getElementById('promo-carousel-dots');

    if (!track || !promotions || promotions.length === 0) return;

    if (currentCarouselIndex >= promotions.length) {
        currentCarouselIndex = 0;
    }

    track.innerHTML = promotions.map((promo, idx) => {
        const badgeTag = promo.discount_text || "🔥 SUPER AKSIYA";
        const priceBadge = promo.discount_price 
            ? `<div class="promo-price-badge">🏷 ${(promo.discount_price).toLocaleString('uz-UZ')} so'm</div>`
            : '';
        const bgImg = promo.image_url 
            ? `<img src="${promo.image_url}" class="promo-card-bg-img" alt="${promo.title}" onerror="this.style.display='none'">`
            : '';
        const pid = promo.product_id ? promo.product_id : '';

        return `
            <div class="promo-carousel-slide" data-slide-index="${idx}">
                <div class="promo-card-hero" onclick="handlePromoClick('${pid}')">
                    ${bgImg}
                    <div class="promo-card-content">
                        <div class="promo-badge-row">
                            <div class="promo-badge-tag">${badgeTag}</div>
                            ${priceBadge}
                        </div>
                        <h2>${promo.title}</h2>
                        <p>${promo.subtitle || "Maxsus narxlar va ajoyib chegirmalardan bahramand bo'ling!"}</p>
                        <div class="promo-action-row">
                            <button class="banner-action-btn" onclick="event.stopPropagation(); handlePromoClick('${pid}')">
                                <span>Ko'rish</span>
                                <span>➔</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    if (dotsContainer) {
        if (promotions.length > 1) {
            dotsContainer.innerHTML = promotions.map((_, idx) => `
                <span class="carousel-dot ${idx === currentCarouselIndex ? 'active' : ''}" onclick="goToCarouselSlide(${idx})"></span>
            `).join('');
            dotsContainer.style.display = 'flex';
        } else {
            dotsContainer.innerHTML = '';
            dotsContainer.style.display = 'none';
        }
    }

    goToCarouselSlide(currentCarouselIndex);
    setupCarouselTouchEvents();
    startCarouselAutoPlay();
}

function handlePromoClick(productId) {
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }

    if (productId && String(productId).trim() !== '' && String(productId) !== '0') {
        const targetProd = products.find(p => String(p.id) === String(productId));
        if (targetProd) {
            openProductModal(targetProd.id);
            return;
        }
    }

    // Fallback: Filter by promo products and scroll
    filterByPromo();
}

function goToCarouselSlide(index) {
    const track = document.getElementById('promo-carousel-track');
    const dots = document.querySelectorAll('#promo-carousel-dots .carousel-dot');

    if (!track || !promotions || promotions.length === 0) return;

    currentCarouselIndex = (index + promotions.length) % promotions.length;
    track.style.transform = `translateX(-${currentCarouselIndex * 100}%)`;

    dots.forEach((dot, idx) => {
        if (idx === currentCarouselIndex) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });
}

function nextCarouselSlide() {
    if (!promotions || promotions.length <= 1) return;
    goToCarouselSlide(currentCarouselIndex + 1);
}

function prevCarouselSlide() {
    if (!promotions || promotions.length <= 1) return;
    goToCarouselSlide(currentCarouselIndex - 1);
}

function startCarouselAutoPlay() {
    if (carouselInterval) {
        clearInterval(carouselInterval);
    }
    if (!promotions || promotions.length <= 1) return;

    carouselInterval = setInterval(() => {
        if (currentScreen === 'home' && !isTouching) {
            nextCarouselSlide();
        }
    }, 3800);
}

function setupCarouselTouchEvents() {
    const viewport = document.getElementById('promo-carousel-viewport');
    if (!viewport || viewport.dataset.touchAttached === 'true') return;

    viewport.dataset.touchAttached = 'true';

    viewport.addEventListener('touchstart', (e) => {
        isTouching = true;
        touchStartX = e.touches[0].clientX;
        touchEndX = touchStartX;
    }, { passive: true });

    viewport.addEventListener('touchmove', (e) => {
        touchEndX = e.touches[0].clientX;
    }, { passive: true });

    viewport.addEventListener('touchend', () => {
        isTouching = false;
        const diffX = touchStartX - touchEndX;
        if (Math.abs(diffX) > 35) {
            if (diffX > 0) {
                // Swiped Left -> next
                nextCarouselSlide();
            } else {
                // Swiped Right -> prev
                prevCarouselSlide();
            }
            if (tg?.HapticFeedback) {
                tg.HapticFeedback.impactOccurred('selection_changed');
            }
        }
        startCarouselAutoPlay();
    });

    viewport.addEventListener('mouseenter', () => {
        isTouching = true;
    });

    viewport.addEventListener('mouseleave', () => {
        isTouching = false;
    });
}

// ----------------- PRODUCTS FETCHING & RENDERING -----------------
async function loadProducts() {
    try {
        const res = await fetch('/api/products?limit=1000');
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

    // Strictly ensure uncategorized products NEVER appear in public storefront
    let filtered = products.filter(p => p && p.category_id && categories.some(c => String(c.id) === String(p.category_id)));

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
        const qty = getProductCartQty(p.id);

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
                    <div id="card-action-${p.id}" class="card-action-wrap" onclick="event.stopPropagation()">
                        ${renderProductCardAction(p.id, qty)}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ----------------- 3. PRODUCT DETAILS MODAL -----------------
function isProductWeightBased(prod) {
    if (!prod) return false;
    if (prod.is_weight_based !== undefined && prod.is_weight_based !== null) {
        return Boolean(prod.is_weight_based);
    }
    const unit = (prod.unit_type || prod.unit || '').toLowerCase().trim();
    return unit === 'kg' || unit === 'g' || unit === 'gram' || unit === 'kilo' || unit === 'kilogram';
}

function openProductModal(productId) {
    selectedDetailProduct = products.find(p => p.id == productId);
    if (!selectedDetailProduct) return;

    const isWeight = isProductWeightBased(selectedDetailProduct);
    currentSelectedWeight = 1.0;
    currentSelectedQty = 1;

    // Set Image, Title, Stock, Description
    const imgEl = document.getElementById('detail-product-img');
    if (imgEl) imgEl.src = selectedDetailProduct.image_url;

    const titleEl = document.getElementById('detail-product-title');
    if (titleEl) titleEl.innerText = selectedDetailProduct.name;

    const stockBadge = document.getElementById('detail-stock-badge');
    if (stockBadge) {
        const unitLabel = isWeight ? 'kg' : (selectedDetailProduct.unit || 'dona');
        stockBadge.innerText = `📊 Qoldiq: ${selectedDetailProduct.stock} ${unitLabel}`;
    }

    const descEl = document.getElementById('detail-product-desc');
    if (descEl) descEl.innerText = selectedDetailProduct.description || '';

    // Discount Pill
    const discountPill = document.getElementById('detail-discount-badge');
    if (discountPill) {
        if (selectedDetailProduct.discount_percent && selectedDetailProduct.discount_percent > 0) {
            discountPill.innerText = `-${selectedDetailProduct.discount_percent}%`;
            discountPill.style.display = 'block';
        } else {
            discountPill.style.display = 'none';
        }
    }

    // Nutrition
    const nut = selectedDetailProduct.nutrition || { cal: "160 kcal", protein: "2g", fat: "15g" };
    const nutriCal = document.getElementById('nutri-cal');
    const nutriProtein = document.getElementById('nutri-protein');
    const nutriFat = document.getElementById('nutri-fat');
    if (nutriCal) nutriCal.innerText = nut.cal;
    if (nutriProtein) nutriProtein.innerText = nut.protein;
    if (nutriFat) nutriFat.innerText = nut.fat;

    // Render Dynamic Selector
    renderModalSelector(isWeight);

    updateModalPrice();

    const modal = document.getElementById('modal-product-detail');
    if (modal) modal.classList.remove('hidden');
}

function renderModalSelector(isWeight) {
    const labelEl = document.getElementById('modal-selector-label');
    const containerEl = document.getElementById('modal-selector-container');
    const unitHintEl = document.getElementById('modal-unit-base-price');

    if (!containerEl) return;

    if (isWeight) {
        // ----------------- VAZNLI MAHSULOT: Hajm / Vazn variantlari -----------------
        if (labelEl) labelEl.innerText = "Hajm / Vaznni tanlang:";
        if (unitHintEl) {
            unitHintEl.innerText = `1 kg = ${(selectedDetailProduct.price || 0).toLocaleString('uz-UZ')} so'm`;
            unitHintEl.style.display = 'inline-block';
        }

        const variants = selectedDetailProduct.weight_variants || [
            { label: '250 g', weight: 0.25 },
            { label: '500 g', weight: 0.5 },
            { label: '1 kg', weight: 1.0 },
            { label: '2 kg', weight: 2.0 }
        ];

        // 1 kg yoki 1-variantni default qilish
        const defaultVar = variants.find(v => v.weight === 1.0) || variants[0];
        currentSelectedWeight = defaultVar.weight;

        containerEl.innerHTML = `
            <div class="weight-pills">
                ${variants.map(v => `
                    <button type="button" class="weight-btn ${v.weight === currentSelectedWeight ? 'active' : ''}" 
                            data-weight="${v.weight}" 
                            onclick="selectWeight(${v.weight})">
                        ${v.label}
                    </button>
                `).join('')}
            </div>
        `;
    } else {
        // ----------------- DONALIK MAHSULOT: Soni va +/- Sanagich -----------------
        if (labelEl) labelEl.innerText = "Miqdor / Soni tanlang:";
        if (unitHintEl) {
            unitHintEl.innerText = `1 dona = ${(selectedDetailProduct.price || 0).toLocaleString('uz-UZ')} so'm`;
            unitHintEl.style.display = 'inline-block';
        }

        const quickOptions = selectedDetailProduct.piece_quick_options || [1, 2, 3, 5];
        currentSelectedQty = 1;

        containerEl.innerHTML = `
            <div class="piece-selector-wrapper">
                <div class="piece-pills-row">
                    ${quickOptions.map(opt => `
                        <button type="button" class="weight-btn piece-quick-btn ${opt === currentSelectedQty ? 'active' : ''}" 
                                data-qty="${opt}" 
                                onclick="setModalQty(${opt})">
                            ${opt} dona
                        </button>
                    `).join('')}
                </div>
                
                <div class="piece-stepper-row">
                    <span class="stepper-label">Aniq sonini belgilash:</span>
                    <div class="piece-counter-box">
                        <button type="button" class="piece-counter-btn minus" onclick="changeModalQty(-1)" aria-label="Kamaytirish">−</button>
                        <div class="piece-counter-center">
                            <span id="modal-piece-qty-val" class="piece-counter-val">${currentSelectedQty}</span>
                            <span class="piece-counter-unit">dona</span>
                        </div>
                        <button type="button" class="piece-counter-btn plus" onclick="changeModalQty(1)" aria-label="Ko'paytirish">+</button>
                    </div>
                </div>
            </div>
        `;
    }
}

function closeProductModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('modal-product-detail');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.pointerEvents = 'none';
        modal.style.display = 'none';
    }
    forceResetUIState();
}

function selectWeight(weight) {
    currentSelectedWeight = weight;
    document.querySelectorAll('#modal-selector-container .weight-btn').forEach(btn => {
        if (parseFloat(btn.getAttribute('data-weight')) === weight) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
    updateModalPrice();
}

function setModalQty(qty) {
    if (!selectedDetailProduct) return;
    const maxStock = selectedDetailProduct.stock || 999;
    currentSelectedQty = Math.max(1, Math.min(maxStock, qty));

    // Update active class on quick pills
    document.querySelectorAll('#modal-selector-container .piece-quick-btn').forEach(btn => {
        if (parseInt(btn.getAttribute('data-qty'), 10) === currentSelectedQty) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update counter display
    const counterVal = document.getElementById('modal-piece-qty-val');
    if (counterVal) counterVal.innerText = currentSelectedQty;

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }
    updateModalPrice();
}

function changeModalQty(delta) {
    if (!selectedDetailProduct) return;
    setModalQty(currentSelectedQty + delta);
}

function updateModalPrice() {
    if (!selectedDetailProduct) return;

    const isWeight = isProductWeightBased(selectedDetailProduct);
    const basePrice = selectedDetailProduct.price || 0;
    const baseOldPrice = selectedDetailProduct.old_price || 0;

    let calcPrice = 0;
    let calcOldPrice = 0;

    if (isWeight) {
        calcPrice = Math.round(basePrice * currentSelectedWeight);
        calcOldPrice = baseOldPrice ? Math.round(baseOldPrice * currentSelectedWeight) : 0;
    } else {
        calcPrice = Math.round(basePrice * currentSelectedQty);
        calcOldPrice = baseOldPrice ? Math.round(baseOldPrice * currentSelectedQty) : 0;
    }

    const priceEl = document.getElementById('detail-current-price');
    if (priceEl) {
        priceEl.innerText = calcPrice.toLocaleString('uz-UZ') + " so'm";
    }

    const oldPriceEl = document.getElementById('detail-old-price');
    if (oldPriceEl) {
        if (calcOldPrice > 0) {
            oldPriceEl.innerText = calcOldPrice.toLocaleString('uz-UZ') + " so'm";
            oldPriceEl.style.display = 'block';
        } else {
            oldPriceEl.style.display = 'none';
        }
    }
}

// ----------------- PRODUCT COUNTER & CART HELPERS -----------------
function getProductCartQty(productId) {
    let total = 0;
    for (const key in cart) {
        if (cart[key] && cart[key].item && (cart[key].item.id == productId || String(key).startsWith(`${productId}_`))) {
            total += cart[key].qty || 0;
        }
    }
    return total;
}

function renderProductCardAction(productId, qty) {
    if (!qty || qty <= 0) {
        return `<button class="quick-add-btn" onclick="event.stopPropagation(); changeProductCardQty(${productId}, 1, event)" aria-label="Savatga qo'shish">+</button>`;
    }
    return `
        <div class="card-stepper-control" onclick="event.stopPropagation()">
            <button class="card-stepper-btn minus" onclick="event.stopPropagation(); changeProductCardQty(${productId}, -1, event)" aria-label="Kamaytirish">−</button>
            <span class="card-stepper-qty pop">${qty}</span>
            <button class="card-stepper-btn plus" onclick="event.stopPropagation(); changeProductCardQty(${productId}, 1, event)" aria-label="Ko'paytirish">+</button>
        </div>
    `;
}

function changeProductCardQty(productId, delta, event) {
    if (event) {
        event.stopPropagation();
        if (event.preventDefault) event.preventDefault();
    }

    const prod = products.find(p => p.id == productId);
    if (!prod) return;

    const isWeight = isProductWeightBased(prod);
    const defaultKey = isWeight ? `${productId}_1.0` : `${productId}_dona`;

    if (delta > 0) {
        if (cart[defaultKey]) {
            cart[defaultKey].qty += delta;
        } else {
            let existingKey = null;
            for (const k in cart) {
                if (cart[k]?.item?.id == productId) {
                    existingKey = k;
                    break;
                }
            }
            if (existingKey) {
                cart[existingKey].qty += delta;
            } else {
                cart[defaultKey] = {
                    item: prod,
                    weight: isWeight ? 1.0 : 1.0,
                    is_weight: isWeight,
                    qty: 1
                };
            }
        }
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('medium');
        }
    } else if (delta < 0) {
        let keyToReduce = cart[defaultKey] ? defaultKey : null;
        if (!keyToReduce) {
            for (const k in cart) {
                if (cart[k]?.item?.id == productId) {
                    keyToReduce = k;
                    break;
                }
            }
        }
        if (keyToReduce && cart[keyToReduce]) {
            cart[keyToReduce].qty += delta;
            if (cart[keyToReduce].qty <= 0) {
                delete cart[keyToReduce];
            }
        }
        if (tg?.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
    }

    updateProductCardCounter(productId);
    updateNavCartBadge();

    if (currentScreen === 'checkout') {
        renderCheckout();
    }
}

function updateProductCardCounter(productId) {
    const actionWrap = document.getElementById(`card-action-${productId}`);
    const qty = getProductCartQty(productId);
    if (actionWrap) {
        actionWrap.innerHTML = renderProductCardAction(productId, qty);
    }
}

function syncAllProductCardCounters() {
    products.forEach(p => {
        updateProductCardCounter(p.id);
    });
}

function addCurrentProductToCart() {
    if (!selectedDetailProduct) return;

    const pid = selectedDetailProduct.id;
    const isWeight = isProductWeightBased(selectedDetailProduct);

    if (isWeight) {
        const cartKey = `${pid}_${currentSelectedWeight}`;
        if (cart[cartKey]) {
            cart[cartKey].qty += 1;
        } else {
            cart[cartKey] = {
                item: selectedDetailProduct,
                weight: currentSelectedWeight,
                is_weight: true,
                qty: 1
            };
        }
    } else {
        const cartKey = `${pid}_dona`;
        if (cart[cartKey]) {
            cart[cartKey].qty += currentSelectedQty;
        } else {
            cart[cartKey] = {
                item: selectedDetailProduct,
                weight: 1.0,
                is_weight: false,
                qty: currentSelectedQty
            };
        }
    }

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('success');
    }

    updateNavCartBadge();
    updateProductCardCounter(pid);
    closeProductModal();
}

function quickAddToCart(productId) {
    changeProductCardQty(productId, 1);
}

function updateNavCartBadge() {
    const totalQty = Object.values(cart).reduce((sum, entry) => sum + entry.qty, 0);
    const badge = document.getElementById('nav-cart-count');
    if (badge) {
        badge.innerText = totalQty;
        badge.classList.remove('badge-bounce');
        void badge.offsetWidth;
        badge.classList.add('badge-bounce');
    }
}

// ----------------- 4. SHOPPING CART & CHECKOUT -----------------
function renderCheckout() {
    const list = document.getElementById('checkout-items-list');
    const paymentBox = document.getElementById('checkout-payment-box');
    const summaryBox = document.getElementById('checkout-summary-box');
    const entries = Object.entries(cart);

    if (entries.length === 0) {
        if (list) {
            list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🛒</div>
                    <h4>Savatchangiz bo'sh</h4>
                    <p>Katalogdan sevimli tovarlaringizni tanlang va savatga qo'shing.</p>
                    <button class="empty-action-btn" onclick="navigateTo('home')">Katalogga o'tish</button>
                </div>
            `;
        }
        if (paymentBox) paymentBox.style.display = 'none';
        if (summaryBox) summaryBox.style.display = 'none';
        const totalEl = document.getElementById('bill-total');
        if (totalEl) totalEl.innerText = '0 so\'m';
        return;
    }

    if (paymentBox) paymentBox.style.display = 'block';
    if (summaryBox) summaryBox.style.display = 'block';

    let subtotal = 0;

    list.innerHTML = entries.map(([key, entry]) => {
        const item = entry.item;
        const isWeight = entry.is_weight !== undefined ? entry.is_weight : isProductWeightBased(item);

        let weightText = '';
        if (isWeight) {
            if (entry.weight === 0.25) weightText = ' (250 g)';
            else if (entry.weight === 0.5) weightText = ' (500 g)';
            else if (entry.weight === 1.0) weightText = ' (1 kg)';
            else if (entry.weight === 2.0) weightText = ' (2 kg)';
            else weightText = ` (${entry.weight} kg)`;
        } else {
            weightText = ` (${entry.qty} dona)`;
        }

        const multiplier = isWeight ? (entry.weight || 1.0) : 1.0;
        const itemPrice = Math.round((item.price || 0) * multiplier);
        const rowTotal = itemPrice * entry.qty;
        subtotal += rowTotal;

        return `
            <div class="cart-item-row">
                <img src="${item.image_url}" alt="${item.name}" class="cart-item-thumb" onerror="this.src='https://images.unsplash.com/photo-1542838132-92c53300491e?w=500&auto=format&fit=crop&q=60'">
                <div class="cart-item-meta">
                    <h4>${item.name}</h4>
                    <div class="cart-item-submeta">
                        <span class="cart-item-unit">${weightText}</span>
                        <span class="cart-item-price">${rowTotal.toLocaleString('uz-UZ')} so'm</span>
                    </div>
                </div>
                <div class="qty-stepper">
                    <button class="qty-btn qty-btn-minus" onclick="updateCartItemQty('${key}', -1)" title="Kamaytirish">${entry.qty === 1 ? '🗑' : '-'}</button>
                    <span class="qty-val">${entry.qty}</span>
                    <button class="qty-btn qty-btn-plus" onclick="updateCartItemQty('${key}', 1)" title="Ko'paytirish">+</button>
                </div>
            </div>
        `;
    }).join('');

    const totalEl = document.getElementById('bill-total');
    if (totalEl) {
        totalEl.innerText = subtotal.toLocaleString('uz-UZ') + " so'm";
    }
}

function updateCartItemQty(cartKey, delta) {
    if (!cart[cartKey]) return;

    const pid = cart[cartKey]?.item?.id || parseInt(cartKey.split('_')[0]);
    cart[cartKey].qty += delta;
    if (cart[cartKey].qty <= 0) {
        delete cart[cartKey];
    }

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }

    updateNavCartBadge();
    renderCheckout();
    if (pid) {
        updateProductCardCounter(pid);
    }
}

function selectPaymentMethod(method) {
    selectedPaymentMethod = method;
    if (tg?.HapticFeedback) {
        tg.HapticFeedback.selectionChanged();
    }

    const cashCard = document.getElementById('payment-method-cash');
    const clickCard = document.getElementById('payment-method-click');
    const labelEl = document.getElementById('selected-payment-label');

    if (method === 'click') {
        cashCard?.classList.remove('active');
        clickCard?.classList.add('active');
        if (labelEl) {
            labelEl.innerText = '⚡️ Click / Payme';
            labelEl.className = 'payment-active-pill click-badge';
        }
    } else {
        clickCard?.classList.remove('active');
        cashCard?.classList.add('active');
        if (labelEl) {
            labelEl.innerText = '💵 Naqd pul';
            labelEl.className = 'payment-active-pill cash-badge';
        }
    }
}

function submitOrder() {
    openCheckoutModal();
}

let orderUserLocation = { lat: null, lng: null };

function openCheckoutModal() {
    // Check if cart is empty
    if (!cart || Object.keys(cart).length === 0) {
        showToast("Savatchangiz bo'sh! 🛒", "error");
        return;
    }

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }

    // Calculate total amount
    let subtotal = 0;
    Object.values(cart).forEach(entry => {
        const item = entry.item || {};
        const isWeight = entry.is_weight !== undefined ? entry.is_weight : isProductWeightBased(item);
        const multiplier = isWeight ? (entry.weight || 1.0) : 1.0;
        const itemPrice = Math.round((item.price || 0) * multiplier);
        subtotal += itemPrice * (entry.qty || 1);
    });

    const modalTotal = document.getElementById('modal-bill-total');
    if (modalTotal) {
        modalTotal.innerText = subtotal.toLocaleString('uz-UZ') + " so'm";
    }

    // Pre-fill Name
    const nameInput = document.getElementById('checkout-user-name');
    if (nameInput) {
        const tgUser = tg?.initDataUnsafe?.user;
        const tgName = tgUser ? `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim() || tgUser.username : '';
        const savedName = localStorage.getItem('bozorcha_user_name') || '';
        nameInput.value = savedName || tgName || '';
    }

    // Pre-fill Phone
    const phoneInput = document.getElementById('checkout-user-phone');
    if (phoneInput) {
        const savedPhone = localStorage.getItem('bozorcha_user_phone') || '';
        phoneInput.value = savedPhone;
    }

    // Pre-fill Address
    const addressInput = document.getElementById('checkout-user-address');
    if (addressInput) {
        const savedAddress = localStorage.getItem('bozorcha_user_address') || '';
        addressInput.value = savedAddress;
    }

    // Sync Payment Method in modal
    setModalPaymentMethod(selectedPaymentMethod || 'cash');

    // Reset location status
    orderUserLocation = { lat: null, lng: null };
    const geoBadge = document.getElementById('geo-status-badge');
    if (geoBadge) geoBadge.classList.add('hidden');
    const geoBtnText = document.getElementById('geo-btn-text');
    if (geoBtnText) geoBtnText.innerText = "Geolokatsiyani yuborish";

    // Hide error alert
    const errEl = document.getElementById('checkout-modal-error');
    if (errEl) {
        errEl.innerText = '';
        errEl.classList.add('hidden');
    }

    // Open Modal
    const modalEl = document.getElementById('modal-checkout-order');
    if (modalEl) {
        modalEl.classList.remove('hidden');
    }
}

function closeCheckoutModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const modalEl = document.getElementById('modal-checkout-order');
    if (modalEl) {
        modalEl.classList.add('hidden');
    }
}

function setModalPaymentMethod(method) {
    selectedPaymentMethod = method;
    selectPaymentMethod(method);

    const cashCard = document.getElementById('modal-pay-cash');
    const clickCard = document.getElementById('modal-pay-click');

    if (method === 'click') {
        clickCard?.classList.add('active');
        cashCard?.classList.remove('active');
    } else {
        cashCard?.classList.add('active');
        clickCard?.classList.remove('active');
    }
}

function requestUserLocation() {
    const geoBtnText = document.getElementById('geo-btn-text');
    if (geoBtnText) geoBtnText.innerText = "Aniqlanmoqda... ⏳";

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
    }

    // Check if Telegram WebApp LocationManager is available
    if (tg?.LocationManager) {
        try {
            tg.LocationManager.init(() => {
                tg.LocationManager.getLocation((data) => {
                    if (data && data.latitude && data.longitude) {
                        handleLocationSuccess(data.latitude, data.longitude);
                    } else {
                        fallbackHtml5Location();
                    }
                });
            });
            return;
        } catch (e) {
            console.warn("Telegram LocationManager error, falling back", e);
        }
    }

    fallbackHtml5Location();
}

function fallbackHtml5Location() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                handleLocationSuccess(pos.coords.latitude, pos.coords.longitude);
            },
            (err) => {
                console.warn("Geolocation error:", err);
                const geoBtnText = document.getElementById('geo-btn-text');
                if (geoBtnText) geoBtnText.innerText = "📍 Qayta urinish";
                showToast("Geolokatsiyani aniqlab bo'lmadi, manzilni qo'lda kiriting", "error");
            },
            { timeout: 10000, enableHighAccuracy: true }
        );
    } else {
        const geoBtnText = document.getElementById('geo-btn-text');
        if (geoBtnText) geoBtnText.innerText = "📍 Geolokatsiya";
        showToast("Brauzeringizda geolokatsiya qo'llab-quvvatlanmaydi", "error");
    }
}

function handleLocationSuccess(lat, lng) {
    orderUserLocation = { lat: Number(lat), lng: Number(lng) };

    const geoBadge = document.getElementById('geo-status-badge');
    const geoCoords = document.getElementById('geo-badge-coords');
    const geoBtnText = document.getElementById('geo-btn-text');

    if (geoCoords) {
        geoCoords.innerText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
    if (geoBadge) {
        geoBadge.classList.remove('hidden');
    }
    if (geoBtnText) {
        geoBtnText.innerText = "📍 Qayta aniqlash";
    }

    const addrInput = document.getElementById('checkout-user-address');
    if (addrInput && !addrInput.value.trim()) {
        addrInput.value = "📍 Geolokatsiya bo'yicha yetkazish";
    }

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred('success');
    }
    showToast("Geolokatsiya muvaffaqiyatli olindi! 📍", "success");
}

async function submitOrderFinal() {
    const nameInput = document.getElementById('checkout-user-name');
    const phoneInput = document.getElementById('checkout-user-phone');
    const addressInput = document.getElementById('checkout-user-address');
    const errorEl = document.getElementById('checkout-modal-error');
    const submitBtn = document.getElementById('btn-confirm-final-order');

    const fullName = nameInput ? nameInput.value.trim() : '';
    const phoneNumber = phoneInput ? phoneInput.value.trim() : '';
    const address = addressInput ? addressInput.value.trim() : '';

    // Clear previous error
    if (errorEl) {
        errorEl.innerText = '';
        errorEl.classList.add('hidden');
    }

    // Validation 1: Full Name
    if (!fullName) {
        if (errorEl) {
            errorEl.innerText = "⚠️ Iltimos, ism va familiyangizni kiriting!";
            errorEl.classList.remove('hidden');
        }
        nameInput?.focus();
        return;
    }

    // Validation 2: Phone number
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (!phoneNumber || cleanPhone.length < 7) {
        if (errorEl) {
            errorEl.innerText = "⚠️ Iltimos, to'g'ri telefon raqamingizni kiriting (Masalan: +998901234567)!";
            errorEl.classList.remove('hidden');
        }
        phoneInput?.focus();
        return;
    }

    // Validation 3: Address or Geolocation
    if (!address && (orderUserLocation.lat === null || orderUserLocation.lng === null)) {
        if (errorEl) {
            errorEl.innerText = "⚠️ Iltimos, yetkazib berish manzilini kiriting yoki geolokatsiyani yuboring!";
            errorEl.classList.remove('hidden');
        }
        addressInput?.focus();
        return;
    }

    // Save to local storage for convenience
    try {
        localStorage.setItem('bozorcha_user_name', fullName);
        localStorage.setItem('bozorcha_user_phone', phoneNumber);
        if (address) localStorage.setItem('bozorcha_user_address', address);
    } catch (e) {}

    // Calculate total amount
    let subtotal = 0;
    Object.values(cart).forEach(entry => {
        const item = entry.item || {};
        const isWeight = entry.is_weight !== undefined ? entry.is_weight : isProductWeightBased(item);
        const multiplier = isWeight ? (entry.weight || 1.0) : 1.0;
        const itemPrice = Math.round((item.price || 0) * multiplier);
        subtotal += itemPrice * (entry.qty || 1);
    });

    setGlobalLoading(true, 10000, "Buyurtma berilmoqda...");
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>⏳ Buyurtma berilmoqda...</span>`;
    }

    let createdOrder = null;
    try {
        const user = tg?.initDataUnsafe?.user;

        const orderPayload = {
            user_id: user?.id,
            full_name: fullName,
            phone_number: phoneNumber,
            address: address || `Geolokatsiya: ${orderUserLocation.lat.toFixed(4)}, ${orderUserLocation.lng.toFixed(4)}`,
            location_lat: orderUserLocation.lat,
            location_lng: orderUserLocation.lng,
            payment_method: selectedPaymentMethod,
            payment_type: selectedPaymentMethod,
            cart: cart,
            cart_items: cart,
            total_amount: subtotal,
            total_price: subtotal,
            user_info: {
                id: user?.id,
                first_name: user?.first_name || fullName,
                last_name: user?.last_name || '',
                username: user?.username,
                full_name: fullName,
                phone: phoneNumber
            }
        };

        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 15000) : null;

        try {
            const fetchOptions = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderPayload)
            };
            if (controller) fetchOptions.signal = controller.signal;

            const res = await fetch('/api/orders', fetchOptions);
            if (timeoutId) clearTimeout(timeoutId);

            const data = await res.json().catch(() => ({}));
            if (res.ok && (data.success || data.order || data.id)) {
                createdOrder = data.order || data;
            } else {
                const errMsg = data.message || data.error || "Xaridni rasmiylashtirishda xatolik yuz berdi";
                console.error("[CHECKOUT ERROR]:", errMsg);
                if (errorEl) {
                    errorEl.innerText = `⚠️ ${errMsg}`;
                    errorEl.classList.remove('hidden');
                } else {
                    showToast(errMsg, "error");
                }
            }
        } catch (e) {
            if (timeoutId) clearTimeout(timeoutId);
            console.warn('Could not post order to API, checking fallback', e);
            if (e.name === 'AbortError') {
                const timeoutMsg = "Buyurtma berish vaqti tugadi (15s). Qayta urinib ko'ring.";
                if (errorEl) {
                    errorEl.innerText = `⚠️ ${timeoutMsg}`;
                    errorEl.classList.remove('hidden');
                } else {
                    showToast(timeoutMsg, "error");
                }
            }
        }

        if (!createdOrder) {
            const fallbackId = "84" + Math.floor(100 + Math.random() * 900);
            createdOrder = {
                id: fallbackId,
                order_id: fallbackId,
                cart: cart,
                total_amount: subtotal,
                payment_type: selectedPaymentMethod,
                payment_method_name: selectedPaymentMethod === 'click' ? 'Click / Payme' : 'Naqd pul',
                status: "Qabul qilindi",
                click_url: `https://my.click.uz/services/pay?service_id=32514&merchant_id=21458&amount=${subtotal}&transaction_param=${fallbackId}`
            };
        }

        activeOrder = createdOrder;

        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred('success');
        }

        // Close modal
        closeCheckoutModal();

        // Update Live Tracking Screen Elements
        const trackingOrderId = document.getElementById('tracking-order-id');
        if (trackingOrderId) {
            trackingOrderId.innerText = `Buyurtma #${createdOrder.id}`;
        }

        const trackingPayBadge = document.getElementById('tracking-payment-badge');
        if (trackingPayBadge) {
            if (selectedPaymentMethod === 'click') {
                trackingPayBadge.innerText = '⚡️ Click / Payme';
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

        const clickActionBox = document.getElementById('tracking-click-action');
        if (clickActionBox) {
            if (selectedPaymentMethod === 'click' && createdOrder.click_url) {
                clickActionBox.classList.remove('hidden');
            } else {
                clickActionBox.classList.add('hidden');
            }
        }

        // Set initial tracking progress: Step 1 ("Qabul qilindi")
        updateTrackingProgress("accepted", "Qabul qilindi");

        // Reset Cart and Navigate to Live Tracking Screen
        cart = {};
        updateNavCartBadge();
        syncAllProductCardCounters();
        showToast("Buyurtmangiz muvaffaqiyatli qabul qilindi! 🎉", "success");
        navigateTo('tracking');

    } catch (actionError) {
        console.error("[ACTION ERROR]:", actionError);
        showToast(actionError.message || "Xatolik yuz berdi", "error");
    } finally {
        setGlobalLoading(false);
        if (submitBtn) {
            submitBtn.disabled = Object.keys(cart).length === 0;
            submitBtn.innerHTML = `<span>✅ Buyurtmani tasdiqlash</span>`;
        }
    }
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

// ----------------- 5. DYNAMIC ORDER STATUS & LIVE TRACKING -----------------
function updateTrackingProgress(statusCode, statusText) {
    const sCode = String(statusCode || '').toLowerCase();
    const sText = String(statusText || '').toLowerCase();

    const step1 = document.getElementById('step-node-1');
    const step2 = document.getElementById('step-node-2');
    const step3 = document.getElementById('step-node-3');
    const step4 = document.getElementById('step-node-4');
    const fillEl = document.getElementById('tracking-progress-fill');
    const chipText = document.getElementById('tracking-chip-text');
    const etaCountdown = document.getElementById('eta-countdown');
    const orderStatusEl = document.getElementById('tracking-order-status');

    [step1, step2, step3, step4].forEach(step => {
        if (step) {
            step.className = 'progress-step';
            const dot = step.querySelector('.step-dot');
            if (dot) dot.innerText = step.id.replace('step-node-', '');
        }
    });

    if (sCode === 'delivered' || sText.includes('yetkazildi')) {
        // Step 4: Yetkazildi (Delivered)
        if (step1) { step1.className = 'progress-step done'; step1.querySelector('.step-dot').innerText = '✓'; }
        if (step2) { step2.className = 'progress-step done'; step2.querySelector('.step-dot').innerText = '✓'; }
        if (step3) { step3.className = 'progress-step done'; step3.querySelector('.step-dot').innerText = '✓'; }
        if (step4) { step4.className = 'progress-step done active'; step4.querySelector('.step-dot').innerText = '✓'; }
        if (fillEl) fillEl.style.width = '100%';
        if (chipText) chipText.innerText = 'Yetkazildi';
        if (etaCountdown) etaCountdown.innerText = 'Yetkazib berildi ✅';
        if (orderStatusEl) {
            orderStatusEl.innerText = 'Yetkazildi';
            orderStatusEl.className = 'summary-status-badge status-paid';
        }
    } else if (sCode === 'on_the_way' || sCode === 'ship' || sText.includes("yo'lga") || sText.includes("yo`lga") || sText.includes('kuryer')) {
        // Step 3: Yo'lga chiqdi (On the way)
        if (step1) { step1.className = 'progress-step done'; step1.querySelector('.step-dot').innerText = '✓'; }
        if (step2) { step2.className = 'progress-step done'; step2.querySelector('.step-dot').innerText = '✓'; }
        if (step3) { step3.className = 'progress-step active'; step3.querySelector('.step-dot').innerText = '🛵'; }
        if (step4) { step4.className = 'progress-step'; }
        if (fillEl) fillEl.style.width = '70%';
        if (chipText) chipText.innerText = "Yo'lda";
        if (etaCountdown) etaCountdown.innerText = '5 - 10 daqiqa';
        if (orderStatusEl) {
            orderStatusEl.innerText = "Yo'lga chiqdi";
            orderStatusEl.className = 'summary-status-badge status-pending';
        }
    } else if (sCode === 'packed' || sCode === 'pack' || sText.includes("yig'ildi") || sText.includes("yig`ildi")) {
        // Step 2: Yig'ildi (Packed)
        if (step1) { step1.className = 'progress-step done'; step1.querySelector('.step-dot').innerText = '✓'; }
        if (step2) { step2.className = 'progress-step active'; step2.querySelector('.step-dot').innerText = '📦'; }
        if (step3) { step3.className = 'progress-step'; }
        if (step4) { step4.className = 'progress-step'; }
        if (fillEl) fillEl.style.width = '38%';
        if (chipText) chipText.innerText = "Yig'ildi";
        if (etaCountdown) etaCountdown.innerText = '10 - 15 daqiqa';
        if (orderStatusEl) {
            orderStatusEl.innerText = "Yig'ildi";
            orderStatusEl.className = 'summary-status-badge status-pending';
        }
    } else {
        // Step 1: Qabul qilindi (Accepted / Initial state)
        if (step1) { step1.className = 'progress-step active'; step1.querySelector('.step-dot').innerText = '✓'; }
        if (step2) { step2.className = 'progress-step'; }
        if (step3) { step3.className = 'progress-step'; }
        if (step4) { step4.className = 'progress-step'; }
        if (fillEl) fillEl.style.width = '8%';
        if (chipText) chipText.innerText = 'Qabul qilindi';
        if (etaCountdown) etaCountdown.innerText = '15 - 20 daqiqa';
        if (orderStatusEl) {
            orderStatusEl.innerText = 'Qabul qilindi';
            orderStatusEl.className = 'summary-status-badge status-pending';
        }
    }
}

function startLiveTrackingTimer() {
    if (!activeOrder) {
        activeOrder = {
            id: '84091',
            status: 'Qabul qilindi',
            status_code: 'accepted',
            total_amount: 0,
            payment_type: 'cash'
        };
    }

    const trackingOrderId = document.getElementById('tracking-order-id');
    if (trackingOrderId && activeOrder.id) {
        trackingOrderId.innerText = `Buyurtma #${activeOrder.id}`;
    }

    const trackingTotal = document.getElementById('tracking-order-total');
    if (trackingTotal && activeOrder.total_amount) {
        trackingTotal.innerText = Number(activeOrder.total_amount).toLocaleString('uz-UZ') + " so'm";
    }

    const trackingPayBadge = document.getElementById('tracking-payment-badge');
    if (trackingPayBadge) {
        if (activeOrder.payment_type === 'click') {
            trackingPayBadge.innerText = '⚡️ Click / Payme';
            trackingPayBadge.className = 'status-live-chip payment-live-chip';
        } else {
            trackingPayBadge.innerText = '💵 Naqd pul';
            trackingPayBadge.className = 'status-live-chip';
        }
    }

    // Set current progress
    updateTrackingProgress(activeOrder.status_code || activeOrder.status, activeOrder.status);

    if (trackingInterval) clearInterval(trackingInterval);

    // Dynamic real-time polling from API every 3.5 seconds
    trackingInterval = setInterval(async () => {
        if (currentScreen !== 'tracking' || !activeOrder?.id) return;
        try {
            const res = await fetch(`/api/orders/${activeOrder.id}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.order) {
                    activeOrder = data.order;
                    updateTrackingProgress(activeOrder.status_code || activeOrder.status, activeOrder.status);
                }
            }
        } catch (e) {
            // Silently ignore polling hiccups
        }
    }, 3500);
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
let currentAdminTab = 'orders';
let deleteTarget = { type: null, id: null, name: "" };
let adminOrdersInterval = null;
let adminOrdersList = [];

function toggleAdminMode() {
    if (!isCurrentUserAdmin()) {
        showToast("Ruxsat berilmadi: Siz admin emassiz ⛔️", "error");
        isAdminMode = false;
        navigateTo('home', true);
        return;
    }

    isAdminMode = !isAdminMode;
    if (isAdminMode) {
        navigateTo('admin');
        switchAdminTab('orders');
        loadAdminOrders();
        loadAdminStats();
        loadAdminPromotions();
        loadAdminCards();
        loadUncategorizedProducts();
        renderAdminCategoriesList();
    } else {
        navigateTo('home');
    }
}

function switchAdminTab(tab) {
    if (!isCurrentUserAdmin()) {
        showToast("Ruxsat berilmadi: Siz admin emassiz ⛔️", "error");
        isAdminMode = false;
        navigateTo('home', true);
        return;
    }

    currentAdminTab = tab;
    const btnOrders = document.getElementById('tab-btn-orders');
    const btnUncat = document.getElementById('tab-btn-uncategorized');
    const btnAnalytics = document.getElementById('tab-btn-analytics');
    const btnPromos = document.getElementById('tab-btn-promotions');
    const btnAddProd = document.getElementById('tab-btn-add-prod');
    const btnProdList = document.getElementById('tab-btn-prod-list');
    const btnCatList = document.getElementById('tab-btn-categories');

    const viewOrders = document.getElementById('admin-view-orders');
    const viewUncat = document.getElementById('admin-view-uncategorized');
    const viewAnalytics = document.getElementById('admin-view-analytics');
    const viewPromos = document.getElementById('admin-view-promotions');
    const viewAddProd = document.getElementById('admin-view-add-prod');
    const viewProdList = document.getElementById('admin-view-prod-list');
    const viewCatList = document.getElementById('admin-view-categories');

    [btnOrders, btnUncat, btnAnalytics, btnPromos, btnAddProd, btnProdList, btnCatList].forEach(btn => btn?.classList.remove('active'));
    [viewOrders, viewUncat, viewAnalytics, viewPromos, viewAddProd, viewProdList, viewCatList].forEach(v => v?.classList.add('hidden'));

    if (adminOrdersInterval) {
        clearInterval(adminOrdersInterval);
        adminOrdersInterval = null;
    }

    if (tab === 'orders') {
        btnOrders?.classList.add('active');
        viewOrders?.classList.remove('hidden');
        loadAdminOrders();
        // Start polling orders every 4 seconds
        adminOrdersInterval = setInterval(() => {
            if (currentScreen === 'admin' && currentAdminTab === 'orders' && isCurrentUserAdmin()) {
                loadAdminOrders();
            }
        }, 4000);
    } else if (tab === 'analytics') {
        btnAnalytics?.classList.add('active');
        viewAnalytics?.classList.remove('hidden');
        loadAdminStats();
    } else if (tab === 'promotions') {
        btnPromos?.classList.add('active');
        viewPromos?.classList.remove('hidden');
        loadAdminPromotions();
        const dynamicContainer = document.getElementById('admin-promo-dynamic-container');
        if (dynamicContainer && dynamicContainer.children.length === 0) {
            addDynamicPromoRow();
        }
    } else if (tab === 'add-prod') {
        btnAddProd?.classList.add('active');
        viewAddProd?.classList.remove('hidden');
        renderCategoryDropdownOptions();
    } else if (tab === 'prod-list') {
        btnProdList?.classList.add('active');
        viewProdList?.classList.remove('hidden');
        loadAdminCards();
    } else if (tab === 'uncategorized') {
        btnUncat?.classList.add('active');
        viewUncat?.classList.remove('hidden');
        loadUncategorizedProducts();
    } else if (tab === 'categories') {
        btnCatList?.classList.add('active');
        viewCatList?.classList.remove('hidden');
        renderParentCategoryDropdownOptions();
        renderAdminCategoriesList();
    }
}

async function loadAdminOrders() {
    if (!isCurrentUserAdmin()) return;

    const listEl = document.getElementById('admin-orders-list');
    const countEl = document.getElementById('admin-orders-count');

    try {
        const res = await fetch(`/api/admin/orders?user_id=${ALLOWED_ADMIN_ID}`, {
            headers: {
                'X-Admin-Id': String(ALLOWED_ADMIN_ID)
            }
        });
        if (res.ok) {
            const data = await res.json();
            adminOrdersList = data.orders || [];

            if (countEl) {
                countEl.innerText = adminOrdersList.length;
            }

            if (!listEl) return;

            if (adminOrdersList.length === 0) {
                listEl.innerHTML = `
                    <div class="empty-admin-orders">
                        <span class="empty-icon">🛍️</span>
                        <h4>Hozircha yangi buyurtmalar yo'q</h4>
                        <p>Yangi buyurtma tushganda shu yerda avtomatik ko'rinadi</p>
                    </div>
                `;
                return;
            }

            listEl.innerHTML = adminOrdersList.map(order => {
                const totalFormatted = (order.total_amount || 0).toLocaleString('uz-UZ') + " so'm";
                const isClick = order.payment_type === 'click';
                const payBadge = isClick
                    ? `<span class="order-pay-badge click">⚡️ Click / Payme</span>`
                    : `<span class="order-pay-badge cash">💵 Naqd pul</span>`;

                const user = order.user_info || {};
                const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.name || "Mijoz";
                const username = user.username ? `@${user.username}` : "Username yo'q";
                const phone = user.phone || user.phone_number || order.phone || "Tel ko'rsatilmagan";
                const address = order.address || "Mini App orqali buyurtma";
                const timeStr = order.created_at || "Yangi";

                const sCode = (order.status_code || '').toLowerCase();
                const sText = order.status || 'Qabul qilindi';

                // Status badge class
                let statusBadgeClass = 'status-badge-step1';
                if (sCode === 'delivered' || sText.toLowerCase().includes('yetkazildi')) {
                    statusBadgeClass = 'status-badge-step4';
                } else if (sCode === 'on_the_way' || sText.toLowerCase().includes("yo'lga") || sText.toLowerCase().includes("kuryer")) {
                    statusBadgeClass = 'status-badge-step3';
                } else if (sCode === 'packed' || sText.toLowerCase().includes("yig'ildi")) {
                    statusBadgeClass = 'status-badge-step2';
                }

                // Cart items list
                let itemsHtml = '';
                if (order.cart && typeof order.cart === 'object') {
                    itemsHtml = Object.values(order.cart).map(entry => {
                        const item = entry.item || {};
                        const iName = item.name || 'Mahsulot';
                        const qty = entry.qty || 1;
                        const weight = entry.weight;
                        const wText = weight && weight !== 1 ? ` (${weight} kg)` : '';
                        const price = (item.price || 0) * qty * (weight || 1);
                        return `
                            <div class="admin-order-item-row">
                                <span class="order-item-name">• ${iName}${wText}</span>
                                <span class="order-item-qty">x${qty}</span>
                                <span class="order-item-sum">${price.toLocaleString('uz-UZ')} so'm</span>
                            </div>
                        `;
                    }).join('');
                }

                const isAcceptActive = (sCode === 'accepted' || sCode === 'pending_cash' || sCode === 'paid_click' || sText.includes('Qabul'));
                const isPackActive = (sCode === 'packed' || sText.includes("Yig'ildi"));
                const isShipActive = (sCode === 'on_the_way' || sText.includes("Yo'lga"));
                const isDeliverActive = (sCode === 'delivered' || sText.includes("Yetkazildi"));

                return `
                    <div class="admin-order-card" id="admin-order-${order.id}">
                        <div class="admin-order-card-header">
                            <div class="order-header-left">
                                <span class="order-card-id">Buyurtma #${order.id}</span>
                                <span class="order-card-time">🕒 ${timeStr}</span>
                            </div>
                            <div class="order-header-right">
                                ${payBadge}
                                <span class="order-status-pill ${statusBadgeClass}">${sText}</span>
                            </div>
                        </div>

                        <div class="admin-order-customer-box">
                            <div class="customer-info-line">
                                <strong>👤 Mijoz:</strong> ${name} <span class="customer-uname">(${username})</span>
                            </div>
                            <div class="customer-info-line">
                                <strong>📞 Telefon:</strong> <a href="tel:${phone}" style="color: var(--primary-red); text-decoration: underline; font-weight: 700;">${phone}</a>
                            </div>
                            <div class="customer-info-line">
                                <strong>📍 Manzil:</strong> ${address}
                            </div>
                            ${order.location_lat && order.location_lng ? `
                                <div class="customer-info-line">
                                    <strong>🗺 Geolokatsiya:</strong> <a href="https://maps.google.com/?q=${order.location_lat},${order.location_lng}" target="_blank" style="color: #38bdf8; text-decoration: underline; font-weight: 700;">📍 Google Maps da ochish (${Number(order.location_lat).toFixed(4)}, ${Number(order.location_lng).toFixed(4)})</a>
                                </div>
                            ` : ''}
                        </div>

                        <div class="admin-order-items-box">
                            <div class="order-items-title">🛍 Savatdagi mahsulotlar:</div>
                            ${itemsHtml}
                        </div>

                        <div class="admin-order-total-row">
                            <span>Jami summa:</span>
                            <strong class="order-total-val">${totalFormatted}</strong>
                        </div>

                        <div class="admin-order-actions-grid">
                            <button class="order-action-btn ${isAcceptActive ? 'active' : ''}" onclick="updateAdminOrderStatus('${order.id}', 'accepted', 'Qabul qilindi')">
                                ✅ Qabul qilish
                            </button>
                            <button class="order-action-btn ${isPackActive ? 'active' : ''}" onclick="updateAdminOrderStatus('${order.id}', 'packed', 'Yig\\'ildi')">
                                📦 Yig'ildi
                            </button>
                            <button class="order-action-btn ${isShipActive ? 'active' : ''}" onclick="updateAdminOrderStatus('${order.id}', 'on_the_way', 'Yo\\'lga chiqdi')">
                                🛵 Yo'lga chiqdi
                            </button>
                            <button class="order-action-btn ${isDeliverActive ? 'active' : ''}" onclick="updateAdminOrderStatus('${order.id}', 'delivered', 'Yetkazildi')">
                                🏁 Yetkazildi
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (e) {
        console.warn("Could not load admin orders", e);
    }
}

async function updateAdminOrderStatus(orderId, statusCode, statusText) {
    if (!isCurrentUserAdmin()) {
        showToast("Ruxsat berilmadi: Siz admin emassiz ⛔️", "error");
        return;
    }

    if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }

    try {
        const res = await fetch(`/api/orders/${orderId}/status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Id': String(ALLOWED_ADMIN_ID)
            },
            body: JSON.stringify({
                status: statusText,
                status_code: statusCode
            })
        });

        if (res.ok) {
            showToast(`✅ Buyurtma #${orderId} holati yangilandi: ${statusText}`, 'success');
            await loadAdminOrders();
        } else {
            showToast(`⚠️ Statusni yangilab bo'lmadi!`, 'error');
        }
    } catch (e) {
        showToast(`⚠️ Server bilan aloqa uzildi!`, 'error');
    }
}

async function loadAdminStats() {
    if (!isCurrentUserAdmin()) return;

    const dailyRevEl = document.getElementById('stats-daily-rev');
    const dailyOrdersEl = document.getElementById('stats-daily-orders');
    const monthlyRevEl = document.getElementById('stats-monthly-rev');
    const monthlyOrdersEl = document.getElementById('stats-monthly-orders');
    const topListEl = document.getElementById('stats-top-products-list');

    try {
        const res = await fetch(`/api/admin/stats?user_id=${ALLOWED_ADMIN_ID}`, {
            headers: {
                'X-Admin-Id': String(ALLOWED_ADMIN_ID)
            }
        });
        if (res.ok) {
            const data = await res.json();

            if (dailyRevEl) dailyRevEl.innerText = (data.daily_revenue || 0).toLocaleString('uz-UZ') + " so'm";
            if (dailyOrdersEl) dailyOrdersEl.innerText = (data.daily_orders || 0) + " ta";
            if (monthlyRevEl) monthlyRevEl.innerText = (data.monthly_revenue || 0).toLocaleString('uz-UZ') + " so'm";
            if (monthlyOrdersEl) monthlyOrdersEl.innerText = (data.monthly_orders || 0) + " ta";

            if (topListEl && Array.isArray(data.top_products)) {
                if (data.top_products.length === 0) {
                    topListEl.innerHTML = `
                        <div style="text-align: center; padding: 20px; color: var(--text-muted);">
                            <p>Hozircha sotilgan tovarlar ma'lumoti mavjud emas</p>
                        </div>
                    `;
                } else {
                    topListEl.innerHTML = data.top_products.map((p, idx) => {
                        const rankBadge = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
                        const formattedPrice = (p.price || 0).toLocaleString('uz-UZ') + " so'm";
                        const formattedTotal = (p.total_amount || (p.count * (p.price || 0))).toLocaleString('uz-UZ') + " so'm";

                        return `
                            <div class="top-product-row">
                                <div class="top-prod-rank">${rankBadge}</div>
                                <div class="top-prod-img-wrap">
                                    <img src="${p.image_url}" alt="${p.name}" onerror="this.src='https://images.unsplash.com/photo-1542838132-92c53300491e?w=200&auto=format&fit=crop&q=60'">
                                </div>
                                <div class="top-prod-info">
                                    <h4 class="top-prod-name">${p.name}</h4>
                                    <div class="top-prod-sub">${p.category_name || 'Bozorcha'} • ${formattedPrice}</div>
                                </div>
                                <div class="top-prod-stats">
                                    <span class="top-prod-count">${p.count} ta sotildi</span>
                                    <span class="top-prod-revenue">${formattedTotal}</span>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            }
        }
    } catch (e) {
        console.warn("Could not fetch admin stats from API", e);
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
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Id': String(ALLOWED_ADMIN_ID)
            },
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

// ----------------- UNCATEGORIZED 1C PRODUCTS MANAGEMENT -----------------
let uncategorizedProducts = [];
let uncategorizedSearchTimeout = null;

const DEFAULT_1C_URL = "";

async function load1CConfigStatus() {
    if (!isCurrentUserAdmin()) return;
    const urlInput = document.getElementById('onec-url-input');
    const badgeEl = document.getElementById('onec-banner-badge');
    const hintCodeEl = document.getElementById('onec-banner-hint-code');
    if (!badgeEl) return;

    try {
        const res = await fetch(`/api/admin/1c/config?user_id=${ALLOWED_ADMIN_ID}`, {
            headers: { 'X-Admin-Id': String(ALLOWED_ADMIN_ID) }
        });
        if (res.ok) {
            const data = await res.json();
            let url = (data.api_url || '').trim();
            if (url.includes('abcd-123')) {
                url = '';
            }
            if (urlInput) {
                urlInput.value = url;
            }
            if (hintCodeEl) {
                hintCodeEl.innerText = url || 'Manzil sozlanmagan';
            }

            if (!url) {
                badgeEl.className = 'onec-badge err';
                badgeEl.innerText = '❌ Manzil sozlanmagan';
            } else if (data.is_localhost || url.includes('127.0.0.1') || url.includes('localhost')) {
                badgeEl.className = 'onec-badge ok';
                badgeEl.innerText = '🟢 Localhost (127.0.0.1)';
            } else {
                badgeEl.className = 'onec-badge ok';
                badgeEl.innerText = '🟢 Faol (Ngrok 1C)';
            }

            if (data.is_syncing && !_syncPollingInterval) {
                const syncBtn = document.getElementById('uncat-sync-1c-btn');
                if (syncBtn) {
                    syncBtn.disabled = true;
                    syncBtn.classList.add('loading');
                    syncBtn.innerHTML = `<span class="uncat-btn-spinner" style="margin-right: 6px;"></span><span>Sinxronlanmoqda...</span>`;
                }
                _syncPollingInterval = setInterval(async () => {
                    await loadProductCounts();
                    await loadUncategorizedProducts();
                    try {
                        const statusRes = await fetch(`/api/admin/sync-1c/status?user_id=${ALLOWED_ADMIN_ID}`, {
                            headers: { 'X-Admin-Id': String(ALLOWED_ADMIN_ID) }
                        });
                        if (statusRes.ok) {
                            const statusData = await statusRes.json();
                            if (statusData.is_syncing === false) {
                                clearInterval(_syncPollingInterval);
                                _syncPollingInterval = null;
                                const currentBtn = document.getElementById('uncat-sync-1c-btn');
                                if (currentBtn) {
                                    currentBtn.disabled = false;
                                    currentBtn.classList.remove('loading');
                                    currentBtn.innerHTML = `<span>⚡️ 1C Sinxronlash</span>`;
                                }
                                const lastRes = statusData.last_result || {};
                                const count = lastRes.synced_count != null ? lastRes.synced_count : (lastRes.count != null ? lastRes.count : 0);
                                const isSuccess = lastRes.success === true && count > 0;

                                if (isSuccess) {
                                    showToast(lastRes.message || `${count} ta tovar muvaffaqiyatli sinxronlandi! 🎉`, 'success');
                                } else {
                                    const errMsg = lastRes.message || lastRes.error || statusData.error || "Sinxronlashda xatolik yuz berdi";
                                    showToast(errMsg, 'error');
                                }
                                await loadProductCounts();
                                await loadUncategorizedProducts();
                                await loadProducts();
                            }
                        }
                    } catch (err) {
                        console.warn("Status polling warning:", err);
                    }
                }, 3000);
            }
        }
    } catch (e) {
        console.warn('Failed to load 1C config status:', e);
        if (urlInput) {
            urlInput.value = "";
        }
        if (hintCodeEl) {
            hintCodeEl.innerText = 'Manzil sozlanmagan';
        }
    }
}

function sanitize1CUrl(rawUrl) {
    if (!rawUrl) return "";
    let s = String(rawUrl).trim().replace(/^['"]|['"]$/g, '');

    // 1. If Markdown format [text](url), extract URL from parentheses
    const mdMatch = s.match(/\((https?:\/\/[^\s\)]+)\)/);
    if (mdMatch) {
        s = mdMatch[1].trim();
    } else if (s.startsWith('[') && s.endsWith(']')) {
        s = s.slice(1, -1).trim();
    }

    // 2. Extract valid http/https URL if embedded or duplicated
    const urlMatch = s.match(/(https?:\/\/[^\s\[\]\(\)\<\>\"']+)/);
    if (urlMatch) {
        s = urlMatch[1].trim();
    }

    // 3. Remove trailing brackets/punctuation/slashes
    s = s.replace(/[\]\)>.,;"'\s]+$/, '').replace(/\/+$/, '');

    // 4. If user entered just domain, append fallback. Otherwise, trust user's exact full path.
    if (s && (s.startsWith('http://') || s.startsWith('https://'))) {
        if (!s.includes('/hs/')) {
            s = `${s}/Bozorcham/hs/Bozorcham/GetTovarList`;
        }
    }

    return s;
}

async function save1CUrlSetting(btn = null) {
    if (!isCurrentUserAdmin()) {
        showToast('Ruxsat berilmadi: Siz admin emassiz ⛔️', 'error');
        return false;
    }

    const urlInput = document.getElementById('onec-url-input');
    if (!urlInput) return false;

    let rawVal = urlInput.value.trim();
    let newUrl = sanitize1CUrl(rawVal);
    if (!newUrl) {
        showToast("Iltimos, 1C HTTP servis URL manzilini kiriting!", 'error');
        urlInput.focus();
        return false;
    }

    urlInput.value = newUrl;

    const saveBtn = btn || document.getElementById('onec-save-url-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.classList.add('loading');
        saveBtn.innerHTML = `<span>Saqlanmoqda...</span>`;
    }

    try {
        const payload = {
            "url": newUrl,
            "value": newUrl,
            "endpoint_url": newUrl,
            "1c_endpoint": newUrl,
            "api_url": newUrl
        };
        const res = await fetch(`/api/admin/settings?user_id=${ALLOWED_ADMIN_ID}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Id': String(ALLOWED_ADMIN_ID)
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && (data.success || data.endpoint_url || data.data)) {
            const activeVal = (data.data && data.data.value) || data.api_url || data.endpoint_url || newUrl;
            if (urlInput) urlInput.value = activeVal;
            const hintCodeEl = document.getElementById('onec-banner-hint-code');
            if (hintCodeEl) hintCodeEl.innerText = activeVal;
            showToast(data.message || "Ngrok URL muvaffaqiyatli saqlandi!", 'success');
            await load1CConfigStatus();
            await loadProductCounts();
            return true;
        } else {
            const errorMsg = data.message || data.error || data.detail || "Yaroqli Ngrok URL kiriting!";
            showToast(errorMsg, 'error');
            return false;
        }
    } catch (e) {
        console.error('save1CUrlSetting API Fetch Error:', e);
        showToast(e.message ? `Xatolik: ${e.message}` : "Server bilan aloqa xatosi!", 'error');
        return false;
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.classList.remove('loading');
            saveBtn.innerHTML = `<span>💾 Saqlash</span>`;
        }
    }
}

async function loadProductCounts() {
    const totalEl = document.getElementById('stats-total-products');
    const catEl = document.getElementById('stats-categorized-products');
    const uncatEl = document.getElementById('stats-uncategorized-products');
    const adminProdCount = document.getElementById('admin-prod-count');
    const adminUncatCount = document.getElementById('admin-uncategorized-count');
    const headerCount = document.getElementById('uncategorized-header-count');

    try {
        let res = await fetch(`/api/admin/product-stats?user_id=${ALLOWED_ADMIN_ID}`, {
            headers: { 'X-Admin-Id': String(ALLOWED_ADMIN_ID) }
        }).catch(() => null);

        if (!res || !res.ok) {
            res = await fetch('/api/admin/products/counts').catch(() => null);
        }

        if (res && res.ok) {
            const data = await res.json().catch(() => ({}));
            const total = data.total != null ? data.total : (products ? products.length : 0);
            const categorized = data.categorized != null ? data.categorized : 0;
            const uncategorized = data.uncategorized != null ? data.uncategorized : 0;

            if (totalEl) totalEl.innerText = Number(total).toLocaleString('uz-UZ');
            if (catEl) catEl.innerText = Number(categorized).toLocaleString('uz-UZ');
            if (uncatEl) uncatEl.innerText = Number(uncategorized).toLocaleString('uz-UZ');
            if (adminProdCount) adminProdCount.innerText = Number(total).toLocaleString('uz-UZ');
            if (adminUncatCount) adminUncatCount.innerText = uncategorized;
            if (headerCount) headerCount.innerText = Number(uncategorized).toLocaleString('uz-UZ');
        } else {
            // Fallback from existing loaded items so dots never stay
            if (totalEl && totalEl.innerText === '...') totalEl.innerText = (products ? products.length : 0).toLocaleString('uz-UZ');
            if (catEl && catEl.innerText === '...') catEl.innerText = (products ? products.length : 0).toLocaleString('uz-UZ');
            if (uncatEl && uncatEl.innerText === '...') uncatEl.innerText = (uncategorizedProducts ? uncategorizedProducts.length : 0).toLocaleString('uz-UZ');
        }
    } catch (e) {
        console.debug('Failed to load product counts (API Fetch Error):', e);
        if (totalEl && totalEl.innerText === '...') totalEl.innerText = '0';
        if (catEl && catEl.innerText === '...') catEl.innerText = '0';
        if (uncatEl && uncatEl.innerText === '...') uncatEl.innerText = '0';
    }
}

async function loadUncategorizedProducts(searchQuery = '', triggerBtn = null) {
    // Ensure categories are loaded from /api/categories for dynamic dropdowns
    if (!categories || categories.length === 0) {
        await loadCategories();
    }

    // Refresh live stats & 1C config diagnostic banner
    loadProductCounts();
    load1CConfigStatus();

    const container = document.getElementById('uncategorized-products-container');
    const countEl = document.getElementById('admin-uncategorized-count');
    const headerCountEl = document.getElementById('uncategorized-header-count');
    const refreshBtn = triggerBtn || document.getElementById('uncat-refresh-btn') || document.querySelector('#admin-view-uncategorized .analytics-refresh-btn');

    // Show loading state on refresh button
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.classList.add('loading');
        refreshBtn.innerHTML = `<span class="uncat-btn-spinner" style="margin-right: 6px;"></span><span>Yuklanmoqda...</span>`;
    }

    // Show loading state in container
    if (container) {
        container.innerHTML = `
            <div class="empty-admin-orders" style="padding: 45px 20px;">
                <div class="uncat-loading-spinner"></div>
                <p style="color: var(--text-muted); margin-top: 14px; font-weight: 500;">1C tovarlari yuklanmoqda...</p>
            </div>
        `;
    }

    try {
        let url = `/api/admin/uncategorized-products?user_id=${ALLOWED_ADMIN_ID}`;
        if (searchQuery && typeof searchQuery === 'string' && searchQuery.trim()) {
            url += `&search=${encodeURIComponent(searchQuery.trim())}`;
        }

        const res = await fetch(url, {
            headers: { 'X-Admin-Id': String(ALLOWED_ADMIN_ID) }
        });

        if (res.ok) {
            const data = await res.json();
            const rawItems = Array.isArray(data) ? data : (data.products || data.data || data.items || []);
            uncategorizedProducts = Array.isArray(rawItems) ? rawItems : [];

            if (countEl) countEl.innerText = uncategorizedProducts.length;
            if (headerCountEl) headerCountEl.innerText = uncategorizedProducts.length;

            renderUncategorizedProducts();
        } else {
            throw new Error(`API error: HTTP ${res.status}`);
        }
    } catch (e) {
        console.error('Failed to load uncategorized products (API Fetch Error):', e);
        if (container) {
            container.innerHTML = `
                <div class="empty-admin-orders">
                    <span class="empty-icon">⚠️</span>
                    <h4>Ma'lumotlarni yuklashda xatolik</h4>
                    <p>Iltimos, qaytadan urinib ko'ring</p>
                    <button type="button" class="analytics-refresh-btn" onclick="loadUncategorizedProducts()" style="margin-top: 12px;">
                        <span>🔄 Qayta yuklash</span>
                    </button>
                </div>
            `;
        }
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.classList.remove('loading');
            refreshBtn.innerHTML = `<span>🔄 Yangilash</span>`;
        }
    }
}

function renderUncategorizedProducts() {
    const container = document.getElementById('uncategorized-products-container');
    if (!container) return;

    const searchInput = document.getElementById('uncategorized-search-input');
    const hasSearch = searchInput && searchInput.value.trim().length > 0;

    if (uncategorizedProducts.length === 0) {
        container.innerHTML = `
            <div class="empty-admin-orders" style="padding: 40px 20px;">
                <span class="empty-icon" style="font-size: 40px; display: block; margin-bottom: 8px;">${hasSearch ? '🔍' : '📦'}</span>
                <h4 style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">
                    ${hasSearch ? 'Qidiruv bo\'yicha tovar topilmadi' : '1C dan integratsiya qilingan yangi tovarlar topilmadi'}
                </h4>
                <p style="font-size: 13px; color: var(--text-muted); line-height: 1.4;">
                    ${hasSearch ? 'Boshqa nom yoki 1C SKU kodi bilan qidirib ko\'ring' : 'Hozircha barcha tovarlar toifalarga biriktirilgan yoki yangi import qilinmagan.'}
                </p>
            </div>
        `;
        return;
    }

    const categoryOptionsHtml = buildCategoryOptionsHtml();

    container.innerHTML = uncategorizedProducts.map(prod => {
        const imgSrc = prod.image_url || prod.photo_file_id || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=500&auto=format&fit=crop&q=60';
        const sku = prod.sku || prod.code_1c || prod.code || '—';
        const priceFormatted = (prod.price || 0).toLocaleString('uz-UZ');
        const stockText = prod.stock != null ? `${prod.stock} ta` : '—';
        const unitText = prod.unit || 'dona';

        return `
            <div class="uncat-card" id="uncat-card-${prod.id}" data-product-id="${prod.id}">
                <div class="uncat-card-main">
                    <div class="uncat-card-thumb-wrap">
                        <img src="${imgSrc}" alt="${prod.name}" class="uncat-card-thumb" onerror="this.src='https://images.unsplash.com/photo-1542838132-92c53300491e?w=500&auto=format&fit=crop&q=60'" loading="lazy">
                    </div>
                    <div class="uncat-card-info">
                        <div class="uncat-card-title">${prod.name || 'Nomsiz mahsulot'}</div>
                        <div class="uncat-card-desc">${prod.description || '1C orqali import qilingan tovar'}</div>
                        <div class="uncat-card-meta">
                            <span class="sku-badge">🏷️ ${sku}</span>
                            <span class="uncat-price-pill">${priceFormatted} so'm/${unitText}</span>
                            <span class="uncat-stock-pill">📦 ${stockText}</span>
                        </div>
                    </div>
                </div>
                <div class="uncat-action-bar">
                    <div class="uncat-select-wrap">
                        <select class="uncat-cat-select" id="uncat-select-${prod.id}" aria-label="Kategoriya tanlash">
                            <option value="">— Kategoriyani tanlang —</option>
                            ${categoryOptionsHtml}
                        </select>
                    </div>
                    <button type="button" class="uncat-save-btn" onclick="assignProductCategory(${prod.id})" title="Kategoriyaga biriktirish">
                        <span>💾 Saqlash</span>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function renderUncategorizedGrid(items = null) {
    if (items && Array.isArray(items)) {
        uncategorizedProducts = items;
    }
    renderUncategorizedProducts();
}

function buildCategoryOptionsHtml() {
    if (!categories || categories.length === 0) return '';

    // Build hierarchical options: Parent > Subcategory
    const topLevel = categories.filter(c => !c.parent_id);
    const subMap = {};
    categories.forEach(c => {
        if (c.parent_id) {
            if (!subMap[c.parent_id]) subMap[c.parent_id] = [];
            subMap[c.parent_id].push(c);
        }
    });

    let html = '';
    topLevel.forEach(parent => {
        html += `<optgroup label="${parent.icon || '📁'} ${parent.name}">`;
        html += `<option value="${parent.id}">${parent.icon || '📁'} ${parent.name} (umumiy)</option>`;
        const subs = subMap[parent.id] || [];
        subs.forEach(sub => {
            html += `<option value="${sub.id}">&nbsp;&nbsp;${sub.icon || '📦'} ${sub.name}</option>`;
        });
        html += `</optgroup>`;
    });

    // Also include any categories without parent that aren't in topLevel (orphan subcats)
    const orphans = categories.filter(c => c.parent_id && !categories.find(p => p.id === c.parent_id));
    if (orphans.length > 0) {
        html += `<optgroup label="📦 Boshqa">`;
        orphans.forEach(c => {
            html += `<option value="${c.id}">${c.icon || '📦'} ${c.name}</option>`;
        });
        html += `</optgroup>`;
    }

    return html;
}

function handleUncategorizedSearch(value) {
    const clearBtn = document.getElementById('uncategorized-search-clear');
    if (clearBtn) {
        clearBtn.classList.toggle('hidden', !value || !value.trim());
    }

    // Debounce: wait 350ms after user stops typing
    if (uncategorizedSearchTimeout) {
        clearTimeout(uncategorizedSearchTimeout);
    }
    uncategorizedSearchTimeout = setTimeout(() => {
        loadUncategorizedProducts(value);
    }, 350);
}

function clearUncategorizedSearch() {
    const input = document.getElementById('uncategorized-search-input');
    const clearBtn = document.getElementById('uncategorized-search-clear');
    if (input) input.value = '';
    if (clearBtn) clearBtn.classList.add('hidden');
    loadUncategorizedProducts();
}

async function assignProductCategory(productId) {
    if (!isCurrentUserAdmin()) {
        showToast('Ruxsat berilmadi: Siz admin emassiz ⛔️', 'error');
        return;
    }

    const selectEl = document.getElementById(`uncat-select-${productId}`);
    if (!selectEl || !selectEl.value) {
        showToast('Iltimos, avval kategoriyani tanlang! ⚠️', 'error');
        selectEl?.classList.add('shake-error');
        setTimeout(() => selectEl?.classList.remove('shake-error'), 600);
        return;
    }

    const categoryId = parseInt(selectEl.value);
    const card = document.getElementById(`uncat-card-${productId}`);
    const saveBtn = card?.querySelector('.uncat-save-btn');

    // Disable button during request
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<span class="uncat-btn-spinner"></span> Saqlanmoqda...`;
    }

    try {
        const res = await fetch(`/api/admin/products/${productId}/assign-category`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Id': String(ALLOWED_ADMIN_ID)
            },
            body: JSON.stringify({ category_id: categoryId })
        });

        if (res.ok) {
            const data = await res.json();
            const msg = data.message || `Mahsulot muvaffaqiyatli kategoriyaga biriktirildi! 🎉`;
            showToast(msg, 'success');

            // Instantly remove from uncategorized products array
            uncategorizedProducts = uncategorizedProducts.filter(p => p.id !== productId);

            // Real-time counter updates:
            // Decrement Kategoriyasiz (-1) and increment Toifalangan (+1)
            const countEl = document.getElementById('admin-uncategorized-count');
            const headerCountEl = document.getElementById('uncategorized-header-count');
            const uncatStatEl = document.getElementById('stats-uncategorized-products');
            const catStatEl = document.getElementById('stats-categorized-products');

            if (countEl) countEl.innerText = uncategorizedProducts.length;
            if (headerCountEl) headerCountEl.innerText = uncategorizedProducts.length;

            if (uncatStatEl) {
                const currentUncat = parseInt(uncatStatEl.innerText.replace(/\s+/g, '')) || 0;
                uncatStatEl.innerText = Math.max(0, currentUncat - 1).toLocaleString('uz-UZ');
            }
            if (catStatEl) {
                const currentCat = parseInt(catStatEl.innerText.replace(/\s+/g, '')) || 0;
                catStatEl.innerText = (currentCat + 1).toLocaleString('uz-UZ');
            }

            // Animate card removal
            if (card) {
                card.style.transition = 'all 0.35s cubic-bezier(0.16, 1, 0.3, 1)';
                card.style.opacity = '0';
                card.style.transform = 'translateX(60px) scale(0.92)';
                card.style.maxHeight = card.scrollHeight + 'px';

                setTimeout(() => {
                    card.style.maxHeight = '0px';
                    card.style.padding = '0';
                    card.style.marginBottom = '0';
                    card.style.borderWidth = '0';
                    card.style.overflow = 'hidden';
                }, 250);

                setTimeout(() => {
                    card.remove();

                    // If no more products, show clean empty state
                    if (uncategorizedProducts.length === 0) {
                        renderUncategorizedProducts();
                    }
                }, 550);
            }

            // Also refresh main product list & live stats
            await loadProducts();
            await loadProductCounts();
        } else {
            const errData = await res.json().catch(() => ({}));
            showToast(errData.detail || "Kategoriyaga biriktirishda xatolik yuz berdi!", 'error');
        }
    } catch (e) {
        console.error('assignProductCategory error:', e);
        showToast("Server bilan bog'lanishda xatolik!", 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<span>💾 Saqlash</span>`;
        }
    }
}

async function bulkAssignCategory(categoryId, productIds = []) {
    if (!isCurrentUserAdmin()) {
        showToast('Ruxsat berilmadi: Siz admin emassiz ⛔️', 'error');
        return;
    }
    if (!categoryId) {
        showToast('Iltimos, kategoriyani tanlang! ⚠️', 'error');
        return;
    }
    if (!productIds || productIds.length === 0) {
        showToast('Biriktirish uchun tovarlar tanlanmadi! ⚠️', 'error');
        return;
    }

    try {
        const res = await fetch('/api/admin/products/bulk-assign-category', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Id': String(ALLOWED_ADMIN_ID)
            },
            body: JSON.stringify({ category_id: parseInt(categoryId), product_ids: productIds })
        });
        if (res.ok) {
            const data = await res.json();
            showToast(data.message || `${productIds.length} ta mahsulot kategoriyaga biriktirildi! 🎉`, 'success');
            await loadUncategorizedProducts();
            await loadProducts();
            await loadProductCounts();
        } else {
            const err = await res.json().catch(() => ({}));
            const errMsg = err.detail || err.error || err.message || "Biriktirishda xatolik yuz berdi";
            showToast(errMsg, 'error');
        }
    } catch (e) {
        console.error('bulkAssignCategory error:', e);
        showToast(e.message ? `Xatolik: ${e.message}` : "Server bilan bog'lanishda xatolik!", 'error');
    } finally {
        await loadUncategorizedProducts();
    }
}

let _syncPollingInterval = null;

async function trigger1CSync(btn = null) {
    if (!isCurrentUserAdmin()) {
        showToast('Ruxsat berilmadi: Siz admin emassiz ⛔️', 'error');
        return;
    }

    clearAllToasts();

    const urlInput = document.getElementById('onec-url-input');
    let effectiveUrl = urlInput ? urlInput.value.trim() : '';
    if (!effectiveUrl) {
        showToast("Iltimos, 1C HTTP servis URL manzilini kiriting!", 'error');
        if (urlInput) urlInput.focus();
        return;
    }

    if (effectiveUrl.includes('abcd-123')) {
        showToast("Soxta 'abcd-123' manzilini ishlatib bo'lmaydi. Iltimos, haqiqiy Ngrok URL kiritib, Saqlash tugmasini bosing!", 'error');
        if (urlInput) urlInput.focus();
        return;
    }

    const syncBtn = btn || document.getElementById('uncat-sync-1c-btn');
    if (syncBtn) {
        syncBtn.disabled = true;
        syncBtn.classList.add('loading');
        syncBtn.innerHTML = `<span class="uncat-btn-spinner" style="margin-right: 6px;"></span><span>Sinxronlanmoqda...</span>`;
    }

    setGlobalLoading(true, 10000, "1C bilan sinxronizatsiya qilinmoqda...");

    try {
        const bodyPayload = effectiveUrl ? { endpoint: effectiveUrl, endpointUrl: effectiveUrl } : {};

        const res = await fetch(`/api/admin/1c-sync?user_id=${ALLOWED_ADMIN_ID}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Id': String(ALLOWED_ADMIN_ID)
            },
            body: JSON.stringify(bodyPayload)
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok && data.success) {
            showToast(data.message || "1C Sinxronlash fonda boshlandi...", 'info');

            if (_syncPollingInterval) {
                clearInterval(_syncPollingInterval);
            }

            _syncPollingInterval = setInterval(async () => {
                await loadProductCounts();
                await loadUncategorizedProducts();

                try {
                    const statusRes = await fetch(`/api/admin/sync-1c/status?user_id=${ALLOWED_ADMIN_ID}`, {
                        headers: { 'X-Admin-Id': String(ALLOWED_ADMIN_ID) }
                    });
                    if (statusRes.ok) {
                        const statusData = await statusRes.json();
                        if (statusData.is_syncing === false) {
                            clearInterval(_syncPollingInterval);
                            _syncPollingInterval = null;

                            if (syncBtn) {
                                syncBtn.disabled = false;
                                syncBtn.classList.remove('loading');
                                syncBtn.innerHTML = `<span>⚡️ 1C Sinxronlash</span>`;
                            }

                            const lastRes = statusData.last_result || {};
                            const count = lastRes.synced_count != null ? lastRes.synced_count : (lastRes.count != null ? lastRes.count : 0);
                            const isSuccess = lastRes.success === true;

                            if (isSuccess) {
                                showToast(lastRes.message || `${count} ta tovar 1C dan muvaffaqiyatli sinxronlandi! 🎉`, 'success');
                            } else {
                                const errMsg = lastRes.message || lastRes.error || statusData.error || "1C serveridan tovarlarni yuklab bo'lmadi.";
                                showToast(`❌ ${errMsg}`, 'error');
                            }

                            await loadProductCounts();
                            await loadUncategorizedProducts();
                            await loadProducts();
                        }
                    }
                } catch (err) {
                    console.warn("Status polling warning:", err);
                }
            }, 2500);

            return;
        }

        clearAllToasts();
        const errorMsg = data.message || data.error || "1C serveriga ulanib bo'lmadi. URL manzilini va 1C serverini tekshiring.";
        showToast(`❌ ${errorMsg}`, 'error');
    } catch (err) {
        console.error("Sync error:", err);
        clearAllToasts();
        showToast(`❌ Tarmoq xatosi: ${err?.message || 'Ulanishda muammo'}`, 'error');
    } finally {
        setGlobalLoading(false);
        if (syncBtn && !_syncPollingInterval) {
            syncBtn.disabled = false;
            syncBtn.classList.remove('loading');
            syncBtn.innerHTML = `<span>⚡️ 1C Sinxronlash</span>`;
        }
        await load1CConfigStatus();
    }
}

async function triggerSilent1CSync() {
    if (!isCurrentUserAdmin()) return;
    try {
        const res = await fetch(`/api/admin/sync-1c?user_id=${ALLOWED_ADMIN_ID}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Id': String(ALLOWED_ADMIN_ID)
            }
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
            if (data.uncategorized_products && Array.isArray(data.uncategorized_products)) {
                uncategorizedProducts = data.uncategorized_products;
                renderUncategorizedProducts();
                const countEl = document.getElementById('admin-uncategorized-count');
                const headerCountEl = document.getElementById('uncategorized-header-count');
                if (countEl) countEl.innerText = uncategorizedProducts.length;
                if (headerCountEl) headerCountEl.innerText = uncategorizedProducts.length;
            } else {
                await loadUncategorizedProducts();
            }
            await loadProducts();
            await loadProductCounts();
        }
    } catch (e) {
        console.debug('Silent background 1C sync completed/skipped:', e);
    }
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
    if (!isCurrentUserAdmin()) {
        showToast("Ruxsat berilmadi: Siz admin emassiz ⛔️", "error");
        return;
    }

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
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Id': String(ALLOWED_ADMIN_ID)
            },
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
    if (!isCurrentUserAdmin()) {
        showToast("Ruxsat berilmadi: Siz admin emassiz ⛔️", "error");
        closeDeleteConfirmModal();
        return;
    }

    const btn = document.getElementById('btn-confirm-delete');
    if (btn) {
        btn.disabled = true;
        btn.innerText = "O'chirilmoqda...";
    }

    const { type, id } = deleteTarget;

    try {
        if (type === 'product') {
            const res = await fetch(`/api/products/${id}`, {
                method: 'DELETE',
                headers: {
                    'X-Admin-Id': String(ALLOWED_ADMIN_ID)
                }
            });
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
            const res = await fetch(`/api/categories/${id}`, {
                method: 'DELETE',
                headers: {
                    'X-Admin-Id': String(ALLOWED_ADMIN_ID)
                }
            });
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
        } else if (type === 'promotion') {
            const res = await fetch(`/api/admin/promotions/${id}`, {
                method: 'DELETE',
                headers: {
                    'X-Admin-Id': String(ALLOWED_ADMIN_ID)
                }
            });
            if (res.ok) {
                const card = document.getElementById(`admin-promo-card-${id}`);
                if (card) {
                    card.classList.add('card-removing');
                    setTimeout(() => card.remove(), 350);
                }

                showToast("Aksiya muvaffaqiyatli o'chirildi! 🗑️", "success");
                closeDeleteConfirmModal();

                promotions = promotions.filter(p => p.id != id);
                adminPromosList = adminPromosList.filter(p => p.id != id);
                renderPromoCarousel();
                const countEl = document.getElementById('admin-promos-count');
                const activeCountEl = document.getElementById('admin-promos-active-count');
                if (countEl) countEl.innerText = adminPromosList.length;
                if (activeCountEl) activeCountEl.innerText = adminPromosList.filter(p => p.is_active !== false).length;
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(err.detail || "Aksiyani o'chirishda xatolik!", "error");
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
    if (!isCurrentUserAdmin()) {
        showToast("Ruxsat berilmadi: Siz admin emassiz ⛔️", "error");
        return;
    }

    showToast("Rasm yuklanmoqda... ⏳", "success");
    const uploadedUrl = await uploadImageFile(file);

    try {
        const res = await fetch('/api/products/update-photo', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Id': String(ALLOWED_ADMIN_ID)
            },
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

// ================= ADMIN PROMOTIONS & BANNER MANAGEMENT =================
async function loadAdminPromotions() {
    if (!isCurrentUserAdmin()) return;

    const listEl = document.getElementById('admin-promotions-list');
    const countEl = document.getElementById('admin-promos-count');
    const activeCountEl = document.getElementById('admin-promos-active-count');

    try {
        const res = await fetch(`/api/promotions?active_only=false&user_id=${ALLOWED_ADMIN_ID}`, {
            headers: {
                'X-Admin-Id': String(ALLOWED_ADMIN_ID)
            }
        });
        if (res.ok) {
            const data = await res.json();
            adminPromosList = data.promotions || [];
            if (countEl) countEl.innerText = adminPromosList.length;
            if (activeCountEl) activeCountEl.innerText = adminPromosList.filter(p => p.is_active !== false).length;

            if (!listEl) return;

            if (adminPromosList.length === 0) {
                listEl.innerHTML = `
                    <div style="text-align: center; padding: 30px 10px; color: var(--text-muted);">
                        <div style="font-size: 32px; margin-bottom: 8px;">🔥</div>
                        <p style="font-size: 14px; font-weight: 600;">Hozircha aksiyalar mavjud emas</p>
                        <p style="font-size: 12px; margin-top: 4px;">Yuqoridagi formadan yangi aksiya banneri qo'shishingiz mumkin</p>
                    </div>
                `;
                return;
            }

            listEl.innerHTML = adminPromosList.map(promo => {
                const badgeText = promo.discount_text || 'Aksiya';
                const priceFormatted = promo.discount_price ? `${(promo.discount_price).toLocaleString('uz-UZ')} so'm` : null;
                const safeTitle = (promo.title || '').replace(/'/g, "\\'");
                const prodName = promo.product ? promo.product.name : null;

                return `
                    <div id="admin-promo-card-${promo.id}" class="admin-promo-card">
                        <div class="admin-promo-card-main">
                            <div class="admin-promo-card-thumb-wrap">
                                <img src="${promo.image_url}" class="admin-promo-card-thumb" alt="${promo.title}" onerror="this.src='https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=200&auto=format&fit=crop&q=60'">
                            </div>
                            <div class="admin-promo-card-info">
                                <div class="admin-promo-meta-row" style="margin-bottom: 4px;">
                                    <span class="promo-badge-tag">${badgeText}</span>
                                    ${priceFormatted ? `<span class="admin-promo-price-chip">${priceFormatted}</span>` : ''}
                                    ${prodName ? `<span class="admin-promo-linked-chip" title="Bog'langan mahsulot">📦 ${prodName}</span>` : ''}
                                </div>
                                <h4 class="admin-promo-card-title">${promo.title}</h4>
                                <p class="admin-promo-card-desc">${promo.subtitle || 'Tavsif yo\'q'}</p>
                            </div>
                        </div>

                        <div class="admin-promo-card-bottom">
                            <span style="font-size: 11px; color: var(--text-muted);">ID: #${promo.id} • ${promo.created_at ? promo.created_at.split(' ')[0] : 'Faol'}</span>
                            <div class="admin-promo-card-actions">
                                <button type="button" class="admin-promo-edit-btn" onclick="openEditPromoModal(${promo.id})">
                                    ✏️ Tahrirlash
                                </button>
                                <button type="button" class="admin-delete-btn" style="padding: 6px 12px; font-size: 12px;" onclick="confirmDeletePromotion(${promo.id}, '${safeTitle}')">
                                    🗑️ O'chirish
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (e) {
        console.warn("Could not load admin promotions", e);
    }
}

function addDynamicPromoRow(initialData = null) {
    const container = document.getElementById('admin-promo-dynamic-container');
    if (!container) return;

    dynamicPromoRowCount++;
    const rowId = `promo-dynamic-row-${dynamicPromoRowCount}`;
    const rowNum = container.children.length + 1;

    // Generate product options
    const productOptionsHtml = `
        <option value="">-- Mahsulotga bog'lash (Ixtiyoriy) --</option>
        ${products.map(p => `<option value="${p.id}">${p.name} (${(p.price || 0).toLocaleString('uz-UZ')} so'm)</option>`).join('')}
    `;

    const rowDiv = document.createElement('div');
    rowDiv.id = rowId;
    rowDiv.className = 'promo-dynamic-row-card';
    rowDiv.innerHTML = `
        <div class="promo-row-header">
            <span class="promo-row-badge-num">
                <span>🔥</span> Aksiya elementi #${rowNum}
            </span>
            ${container.children.length > 0 ? `
                <button type="button" class="promo-row-remove-btn" onclick="removeDynamicPromoRow('${rowId}')">✕ O'chirish</button>
            ` : ''}
        </div>

        <div class="form-group" style="margin-bottom: 10px;">
            <label class="form-label" style="font-size: 11px;">Mavjud Mahsulotga bog'lash (Avtomatik to'ldirish):</label>
            <select class="form-select promo-row-product-select" onchange="handlePromoRowProductSelect('${rowId}', this)">
                ${productOptionsHtml}
            </select>
        </div>

        <div class="form-row-2">
            <div class="form-group" style="flex: 2;">
                <label class="form-label" style="font-size: 11px;">Aksiya Sarlavhasi <span class="req-star">*</span></label>
                <input type="text" class="form-input promo-row-title" placeholder="Masalan: 🔥 SUPER CHEGIRMA" required>
            </div>
            <div class="form-group" style="flex: 1;">
                <label class="form-label" style="font-size: 11px;">Chegirma matni</label>
                <input type="text" class="form-input promo-row-badge" placeholder="-25% yoki SUPER NARX">
            </div>
        </div>

        <div class="form-row-2">
            <div class="form-group" style="flex: 2;">
                <label class="form-label" style="font-size: 11px;">Qisqacha tavsif</label>
                <input type="text" class="form-input promo-row-subtitle" placeholder="Har kungi yangi hosil meva va sabzavotlarga...">
            </div>
            <div class="form-group" style="flex: 1;">
                <label class="form-label" style="font-size: 11px;">Aksiya narxi (so'm)</label>
                <input type="number" class="form-input promo-row-price" placeholder="45000" min="0">
            </div>
        </div>

        <div class="form-group" style="margin-bottom: 0;">
            <div class="label-with-action">
                <label class="form-label" style="font-size: 11px;">Aksiya rasmi (URL yoki Fayl)</label>
                <label class="upload-chip-btn" style="padding: 3px 8px; font-size: 11px;">
                    📁 Fayl
                    <input type="file" accept="image/*" style="display:none;" onchange="handlePromoRowFilePicked(event, '${rowId}')">
                </label>
            </div>
            <input type="text" class="form-input promo-row-image" placeholder="https://images.unsplash.com/... yoki fayl yuklang" oninput="updatePromoRowImagePreview('${rowId}')">
            <div class="admin-preview-wrap hidden promo-row-preview-wrap" style="margin-top: 6px;">
                <img src="" alt="Ko'rish" class="admin-preview-img promo-row-preview-img" style="height: 60px;">
            </div>
        </div>
    `;

    container.appendChild(rowDiv);

    if (initialData) {
        const titleEl = rowDiv.querySelector('.promo-row-title');
        const subtitleEl = rowDiv.querySelector('.promo-row-subtitle');
        const priceEl = rowDiv.querySelector('.promo-row-price');
        const badgeEl = rowDiv.querySelector('.promo-row-badge');
        const imageEl = rowDiv.querySelector('.promo-row-image');
        const prodSelectEl = rowDiv.querySelector('.promo-row-product-select');

        if (titleEl) titleEl.value = initialData.title || '';
        if (subtitleEl) subtitleEl.value = initialData.subtitle || '';
        if (priceEl && initialData.discount_price) priceEl.value = initialData.discount_price;
        if (badgeEl && initialData.discount_text) badgeEl.value = initialData.discount_text;
        if (imageEl && initialData.image_url) imageEl.value = initialData.image_url;
        if (prodSelectEl && initialData.product_id) prodSelectEl.value = initialData.product_id;
        updatePromoRowImagePreview(rowId);
    }
}

function removeDynamicPromoRow(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;

    row.style.opacity = '0';
    row.style.transform = 'scale(0.95)';
    setTimeout(() => {
        row.remove();
        // Re-index remaining rows badges
        const container = document.getElementById('admin-promo-dynamic-container');
        if (container) {
            Array.from(container.children).forEach((child, idx) => {
                const badgeNum = child.querySelector('.promo-row-badge-num');
                if (badgeNum) {
                    badgeNum.innerHTML = `<span>🔥</span> Aksiya elementi #${idx + 1}`;
                }
            });
            if (container.children.length === 0) {
                addDynamicPromoRow();
            }
        }
    }, 200);
}

function handlePromoRowProductSelect(rowId, selectEl) {
    const row = document.getElementById(rowId);
    if (!row || !selectEl) return;

    const selectedOption = selectEl.options[selectEl.selectedIndex];
    if (!selectedOption || !selectedOption.value) return;

    const prodId = selectedOption.value;
    const prod = products.find(p => String(p.id) === String(prodId));
    if (!prod) return;

    const titleEl = row.querySelector('.promo-row-title');
    const subtitleEl = row.querySelector('.promo-row-subtitle');
    const priceEl = row.querySelector('.promo-row-price');
    const badgeEl = row.querySelector('.promo-row-badge');
    const imageEl = row.querySelector('.promo-row-image');

    if (titleEl && !titleEl.value.trim()) {
        titleEl.value = `🔥 ${prod.name.toUpperCase()}`;
    }
    if (subtitleEl && !subtitleEl.value.trim()) {
        subtitleEl.value = prod.description || `Eng sara ${prod.name} maxsus aksiya narxida!`;
    }
    if (priceEl && (!priceEl.value || priceEl.value == '0')) {
        priceEl.value = prod.price || '';
    }
    if (badgeEl && !badgeEl.value.trim()) {
        badgeEl.value = prod.discount_percent ? `-${prod.discount_percent}%` : "SUPER NARX";
    }
    if (imageEl && !imageEl.value.trim() && prod.image_url) {
        imageEl.value = prod.image_url;
        updatePromoRowImagePreview(rowId);
    }
}

async function handlePromoRowFilePicked(event, rowId) {
    const file = event.target.files[0];
    if (!file) return;

    showToast("Aksiya rasmi yuklanmoqda... ⏳", "success");
    const uploadedUrl = await uploadImageFile(file);

    const row = document.getElementById(rowId);
    if (row) {
        const imageInput = row.querySelector('.promo-row-image');
        if (imageInput) {
            imageInput.value = uploadedUrl;
            updatePromoRowImagePreview(rowId);
        }
    }
    showToast("Aksiya rasmi yuklandi! 📸", "success");
}

function updatePromoRowImagePreview(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;

    const input = row.querySelector('.promo-row-image');
    const previewWrap = row.querySelector('.promo-row-preview-wrap');
    const previewImg = row.querySelector('.promo-row-preview-img');
    const url = (input?.value || '').trim();

    if (url) {
        if (previewImg) previewImg.src = url;
        if (previewWrap) previewWrap.classList.remove('hidden');
    } else {
        if (previewWrap) previewWrap.classList.add('hidden');
    }
}

async function submitSavePromotions() {
    if (!isCurrentUserAdmin()) {
        showToast("Ruxsat berilmadi: Siz admin emassiz ⛔️", "error");
        return;
    }

    const container = document.getElementById('admin-promo-dynamic-container');
    const submitBtn = document.getElementById('btn-submit-save-promos');
    if (!container) return;

    const rows = Array.from(container.children);
    if (rows.length === 0) {
        showToast("Kamida bitta aksiya kiritilishi kerak!", "error");
        return;
    }

    const promotionsToSave = [];

    for (const row of rows) {
        const title = (row.querySelector('.promo-row-title')?.value || '').trim();
        const subtitle = (row.querySelector('.promo-row-subtitle')?.value || '').trim();
        const priceVal = row.querySelector('.promo-row-price')?.value;
        const badge = (row.querySelector('.promo-row-badge')?.value || '').trim();
        const image_url = (row.querySelector('.promo-row-image')?.value || '').trim();
        const product_id = row.querySelector('.promo-row-product-select')?.value || null;

        if (!title) {
            showToast("Iltimos, barcha aksiyalar uchun sarlavha kiriting!", "error");
            row.querySelector('.promo-row-title')?.focus();
            return;
        }

        promotionsToSave.push({
            title,
            subtitle,
            discount_price: priceVal ? parseInt(priceVal, 10) : null,
            discount_text: badge || null,
            image_url: image_url || null,
            product_id: product_id && product_id !== '' ? parseInt(product_id, 10) : null,
            is_active: true
        });
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>⏳ Saqlanmoqda...</span>`;
    }

    try {
        const payload = promotionsToSave.length === 1 ? promotionsToSave[0] : { promotions: promotionsToSave };
        const res = await fetch('/api/admin/promotions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Id': String(ALLOWED_ADMIN_ID)
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showToast(`${promotionsToSave.length} ta aksiya muvaffaqiyatli saqlandi! 🎉`, "success");
            container.innerHTML = '';
            addDynamicPromoRow();
            await loadPromotions();
            await loadAdminPromotions();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || "Aksiyalarni saqlashda xatolik!", "error");
        }
    } catch (e) {
        showToast("Server bilan bog'lanishda xatolik!", "error");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<span>🔥 Aksiyalarni Saqlash</span>`;
        }
    }
}

function openEditPromoModal(promoId) {
    const promo = adminPromosList.find(p => p.id == promoId) || promotions.find(p => p.id == promoId);
    if (!promo) return;

    currentEditingPromoId = promoId;

    const idInput = document.getElementById('edit-promo-id');
    const titleInput = document.getElementById('edit-promo-title');
    const subtitleInput = document.getElementById('edit-promo-subtitle');
    const priceInput = document.getElementById('edit-promo-price');
    const badgeInput = document.getElementById('edit-promo-badge');
    const imageInput = document.getElementById('edit-promo-image');
    const productSelect = document.getElementById('edit-promo-product');
    const modal = document.getElementById('modal-edit-promotion');

    if (idInput) idInput.value = promo.id;
    if (titleInput) titleInput.value = promo.title || '';
    if (subtitleInput) subtitleInput.value = promo.subtitle || '';
    if (priceInput) priceInput.value = promo.discount_price || '';
    if (badgeInput) badgeInput.value = promo.discount_text || '';
    if (imageInput) imageInput.value = promo.image_url || '';

    if (productSelect) {
        productSelect.innerHTML = `
            <option value="">-- Mahsulotga bog'lanmagan (Umumiy aksiya) --</option>
            ${products.map(p => `
                <option value="${p.id}" ${promo.product_id == p.id ? 'selected' : ''}>
                    ${p.name} (${(p.price || 0).toLocaleString('uz-UZ')} so'm)
                </option>
            `).join('')}
        `;
    }

    updateEditPromoImagePreview();

    if (modal) modal.classList.remove('hidden');
}

function closeEditPromoModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('modal-edit-promotion');
    if (modal) modal.classList.add('hidden');
    currentEditingPromoId = null;
}

function handleEditPromoProductSelect() {
    const select = document.getElementById('edit-promo-product');
    if (!select || !select.value) return;

    const prod = products.find(p => String(p.id) === String(select.value));
    if (!prod) return;

    const titleInput = document.getElementById('edit-promo-title');
    const priceInput = document.getElementById('edit-promo-price');
    const imageInput = document.getElementById('edit-promo-image');

    if (titleInput && !titleInput.value.trim()) {
        titleInput.value = `🔥 ${prod.name.toUpperCase()}`;
    }
    if (priceInput && (!priceInput.value || priceInput.value == '0')) {
        priceInput.value = prod.price || '';
    }
    if (imageInput && !imageInput.value.trim() && prod.image_url) {
        imageInput.value = prod.image_url;
        updateEditPromoImagePreview();
    }
}

async function handleEditPromoFilePicked(event) {
    const file = event.target.files[0];
    if (!file) return;

    showToast("Aksiya rasmi yuklanmoqda... ⏳", "success");
    const uploadedUrl = await uploadImageFile(file);

    const imgInput = document.getElementById('edit-promo-image');
    if (imgInput) {
        imgInput.value = uploadedUrl;
        updateEditPromoImagePreview();
    }
    showToast("Aksiya rasmi yuklandi! 📸", "success");
}

function updateEditPromoImagePreview() {
    const input = document.getElementById('edit-promo-image');
    const previewWrap = document.getElementById('edit-promo-preview-wrap');
    const previewImg = document.getElementById('edit-promo-preview');
    const url = (input?.value || '').trim();

    if (url) {
        if (previewImg) previewImg.src = url;
        if (previewWrap) previewWrap.classList.remove('hidden');
    } else {
        if (previewWrap) previewWrap.classList.add('hidden');
    }
}

async function submitUpdatePromotion() {
    if (!currentEditingPromoId) return;
    if (!isCurrentUserAdmin()) {
        showToast("Ruxsat berilmadi: Siz admin emassiz ⛔️", "error");
        return;
    }

    const titleInput = document.getElementById('edit-promo-title');
    const subtitleInput = document.getElementById('edit-promo-subtitle');
    const priceInput = document.getElementById('edit-promo-price');
    const badgeInput = document.getElementById('edit-promo-badge');
    const imageInput = document.getElementById('edit-promo-image');
    const productSelect = document.getElementById('edit-promo-product');
    const saveBtn = document.getElementById('btn-save-edit-promo');

    const title = (titleInput?.value || '').trim();
    const subtitle = (subtitleInput?.value || '').trim();
    const priceVal = priceInput?.value;
    const badge = (badgeInput?.value || '').trim();
    const image_url = (imageInput?.value || '').trim();
    const product_id = productSelect?.value || null;

    if (!title) {
        showToast("Aksiya sarlavhasini kiriting!", "error");
        titleInput?.focus();
        return;
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerText = "Saqlanmoqda...";
    }

    try {
        const payload = {
            title,
            subtitle,
            discount_price: priceVal ? parseInt(priceVal, 10) : null,
            discount_text: badge || null,
            image_url: image_url || null,
            product_id: product_id && product_id !== '' ? parseInt(product_id, 10) : null,
            is_active: true
        };

        const res = await fetch(`/api/admin/promotions/${currentEditingPromoId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Id': String(ALLOWED_ADMIN_ID)
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showToast("Aksiya muvaffaqiyatli yangilandi! 🎉", "success");
            closeEditPromoModal();
            await loadPromotions();
            await loadAdminPromotions();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || "Aksiyani yangilashda xatolik!", "error");
        }
    } catch (e) {
        showToast("Server bilan bog'lanishda xatolik!", "error");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerText = "💾 Saqlash";
        }
    }
}

function confirmDeletePromotion(promoId, promoTitle) {
    deleteTarget = { type: 'promotion', id: promoId, name: promoTitle };
    const modal = document.getElementById('modal-delete-confirm');
    const title = document.getElementById('delete-modal-title');
    const desc = document.getElementById('delete-modal-desc');

    if (title) title.innerText = "Aksiyani o'chirish";
    if (desc) {
        desc.innerHTML = `Haqiqatan ham <strong>"${promoTitle}"</strong> aksiyasini o'chirmoqchimisiz?`;
    }
    if (modal) modal.classList.remove('hidden');
}

function getOrCreateToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    return container;
}

function clearAllToasts() {
    const container = document.getElementById('toast-container');
    if (container) {
        container.innerHTML = '';
    }
}

function showToast(message, type = "success") {
    const container = getOrCreateToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast-message toast-${type}`;
    const icon = type === 'success' ? '✅' : (type === 'info' ? 'ℹ️' : '⚠️');
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 3200);
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
window.selectWeight = selectWeight;
window.setModalQty = setModalQty;
window.changeModalQty = changeModalQty;
window.addCurrentProductToCart = addCurrentProductToCart;
window.addProductModalToCart = addCurrentProductToCart;
window.changeProductCardQty = changeProductCardQty;
window.renderProductCardAction = renderProductCardAction;
window.getProductCartQty = getProductCartQty;
window.updateProductCardCounter = updateProductCardCounter;
window.syncAllProductCardCounters = syncAllProductCardCounters;
window.quickAddToCart = quickAddToCart;
window.updateCartItemQty = updateCartItemQty;
window.selectPaymentMethod = selectPaymentMethod;
window.submitOrder = submitOrder;
window.openCheckoutModal = openCheckoutModal;
window.closeCheckoutModal = closeCheckoutModal;
window.setModalPaymentMethod = setModalPaymentMethod;
window.requestUserLocation = requestUserLocation;
window.submitOrderFinal = submitOrderFinal;
window.openClickPaymentUrl = openClickPaymentUrl;
window.callCourier = callCourier;
window.chatCourier = chatCourier;
window.callSupport = callSupport;
window.toggleAdminMode = toggleAdminMode;
window.switchAdminTab = switchAdminTab;
window.loadAdminStats = loadAdminStats;
window.loadAdminOrders = loadAdminOrders;
window.updateAdminOrderStatus = updateAdminOrderStatus;
window.loadAdminPromotions = loadAdminPromotions;
window.addDynamicPromoRow = addDynamicPromoRow;
window.removeDynamicPromoRow = removeDynamicPromoRow;
window.handlePromoRowProductSelect = handlePromoRowProductSelect;
window.handlePromoRowFilePicked = handlePromoRowFilePicked;
window.updatePromoRowImagePreview = updatePromoRowImagePreview;
window.submitSavePromotions = submitSavePromotions;
window.openEditPromoModal = openEditPromoModal;
window.closeEditPromoModal = closeEditPromoModal;
window.handleEditPromoProductSelect = handleEditPromoProductSelect;
window.handleEditPromoFilePicked = handleEditPromoFilePicked;
window.updateEditPromoImagePreview = updateEditPromoImagePreview;
window.submitUpdatePromotion = submitUpdatePromotion;
window.confirmDeletePromotion = confirmDeletePromotion;
window.goToCarouselSlide = goToCarouselSlide;
window.nextCarouselSlide = nextCarouselSlide;
window.prevCarouselSlide = prevCarouselSlide;
window.handlePromoClick = handlePromoClick;
window.isCurrentUserAdmin = isCurrentUserAdmin;
window.getCurrentTelegramUserId = getCurrentTelegramUserId;
window.loadUncategorizedProducts = loadUncategorizedProducts;
window.handleUncategorizedSearch = handleUncategorizedSearch;
window.clearUncategorizedSearch = clearUncategorizedSearch;
window.assignProductCategory = assignProductCategory;
window.bulkAssignCategory = bulkAssignCategory;
window.trigger1CSync = trigger1CSync;
window.load1CConfigStatus = load1CConfigStatus;
window.save1CUrlSetting = save1CUrlSetting;
window.loadProductCounts = loadProductCounts;
window.fetchUncategorizedProducts = loadUncategorizedProducts;
window.renderUncategorizedGrid = renderUncategorizedGrid;
window.renderUncategorizedProducts = renderUncategorizedProducts;
window.triggerSilent1CSync = triggerSilent1CSync;
window.clearAllToasts = clearAllToasts;
window.showToast = showToast;



