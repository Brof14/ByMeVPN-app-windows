/**
 * ByMeVPN Desktop Client - Production Frontend Engine
 * Parity: ByMeVPN Android V2 & Windows Architecture
 */

// Safe Tauri IPC Bridge
const invoke = async (cmd, args = {}) => {
  const invoker =
    window.__TAURI__?.core?.invoke ||
    window.__TAURI__?.invoke ||
    window.__TAURI_INTERNALS__?.invoke;
  if (invoker) {
    return await invoker(cmd, args);
  }
  // Production must never silently simulate auth, settings or VPN connection.
  // The dedicated qa-preview/ build has its own fixtures and does not ship.
  throw new Error('Приложение ByMeVPN должно быть открыто через Windows-клиент.');
};

// State Store
const state = {
  user: null,
  subscription: null,
  devices: [],
  servers: [],
  selectedServer: {
    code: 'auto',
    name: 'Автоматически',
    country: '',
    flag: '🌐',
    ping: 0
  },
  selectedDevicesCount: 2,
  selectedPlanCode: 'year',
  vpnConnected: false,
  connectedSeconds: 0,
  metrics: {
    download_mbps: 0,
    upload_mbps: 0,
    ping_ms: 0
  },
  connectionBusy: false,
  authBusy: false,
  sessionEpoch: 0,
  vpnVerified: false,
  vpnPhase: "idle",
  pollBusy: false,
  pollFailures: 0,
  catalogReady: false,
  devicesSupported: false,
  availableDeviceCounts: [],
  paymentBusy: false,
  trialBusy: false,
  pendingCheckout: null,
  preferredServerCode: 'auto',
  settings: {
    autoStart: false,
    autoConnect: false,
    stayConnectedInBackground: false,
    bypassRu: true,
    adBlock: 'none',
    dnsMode: 'cloudflare',
    killSwitch: false,
    language: 'ru'
  },
  currentTab: 'tab-home',
  timerInterval: null,
  pollInterval: null
};

// Prices are strictly hydrated from the authenticated API. No local fake offers.
const PRICING_MATRIX = { 2: {}, 5: {}, 10: {} };

// Translations Dictionary (RU / EN)
const I18N = {
  ru: {
    terms_prefix: "Нажимая «Оплатить», вы соглашаетесь с ",
    terms_link: "Условиями использования",
    terms_and: " и ",
    privacy_link: "Политикой конфиденциальности",
    email_placeholder: "Адрес эл. почты",
    password_placeholder: "Пароль",
    new_password_placeholder: "Придумайте пароль",
    repeat_password_placeholder: "Повторите пароль",
    name_placeholder: "Имя пользователя",
    server_search_placeholder: "Поиск сервера или страны...",
    dns_title: 'DNS-провайдер',
    dns_desc: 'Изменения применятся при следующем подключении VPN',
    autoconnect_title: 'Подключаться при запуске',
    autoconnect_desc: 'Автоматически запускать VPN после входа при активной подписке',
    account_settings_title: 'Настройки аккаунта',
    account_refresh: 'Обновить данные',
    account_copy_id: 'Скопировать ID',
    account_app_settings: 'Настройки приложения',
    account_advanced: 'Дополнительные настройки',
    slogan: 'Скорость. Анонимность. Честность.',
    perk_fast: 'Быстрое подключение',
    perk_easy: 'Простое управление',
    login_title: 'Вход',
    login_subtitle: 'Войдите в свой аккаунт ByMeVPN',
    continue_google: 'Продолжить с Google',
    or_email: 'или по почте',
    sign_in: 'Войти',
    tg_prompt: 'Уже пользовались через Telegram-бота?',
    tg_login_btn: 'Войти через Telegram',
    no_account: 'Нет аккаунта?',
    register_link: 'Зарегистрироваться ›',
    register_title: 'Регистрация',
    register_subtitle: 'Создайте аккаунт ByMeVPN',
    create_account: 'Создать аккаунт',
    have_account: 'Есть аккаунт?',
    login_link: 'Войти ›',
    nav_connection: 'Подключение',
    nav_account: 'Аккаунт',
    nav_settings: 'Настройки',
    protection_active: 'Защита активна',
    vpn_connected: 'VPN подключён',
    conn_secured: 'Соединение защищено',
    download: 'Скачивание',
    upload: 'Отправка',
    latency: 'Задержка',
    card_server: 'Сервер',
    card_sub: 'Подписка',
    change_server: 'Сменить сервер',
    active: 'Активна',
    manage_sub: 'Управлять',
    ru_bypass_label: 'Российские сервисы работают напрямую',
    vpn_off: 'VPN выключен',
    vpn_off_desc: 'Нажмите, чтобы подключиться',
    connect: 'Подключиться',
    disconnect: 'Отключить',
    try_bymevpn: 'Попробовать ByMeVPN',
    trial_perks: '3 дня полного доступа ко всем серверам без ограничений скорости. Без привязки карты.',
    activate_1rub: 'Попробовать бесплатно',
    view_all_plans: 'Посмотреть все тарифы ›',
    trial_access_headline: 'Бесплатный пробный доступ',
    trial_for_new: '3 дня полного доступа для новых пользователей',
    trial_then_price: '0 ₽ к списанию • Без привязки банковской карты',
    select_device_count: 'Выберите количество устройств',
    devices_2: '2 устройства',
    devices_5: '5 устройств',
    devices_10: '10 устройств',
    plan_1m: '1 месяц',
    plan_3m: '3 месяца',
    plan_6m: '6 месяцев',
    plan_12m: '12 месяцев',
    plus_1_gift: '+ 1 в подарок',
    plus_2_gift: '+ 2 в подарок',
    plus_3_gift: '+ 3 в подарок',
    best_price: 'Лучшая цена',
    pay_via_yookassa: 'Оплатить через ЮKassa',
    payment_methods_text: 'СБП, карты, SberPay, T-Pay',
    auto_renew_note: 'Проверьте условия продления перед оплатой. Управление автопродлением доступно через поддержку.',
    terms_agreement: 'Нажимая «Оплатить», вы соглашаетесь с Условиями использования и Политикой конфиденциальности.',
    back: 'Назад',
    server_auto: 'Автоматически',
    server_auto_desc: 'Выберем лучшее доступное соединение',
    available_servers: 'ДОСТУПНЫЕ СЕРВЕРЫ',
    autorenew_on: 'Статус автопродления',
    renew: 'Продлить',
    manage_subscription: 'Управлять подпиской',
    devices: 'Устройства',
    this_pc: 'Windows • Этот компьютер',
    online: 'Онлайн',
    current_device: 'Текущее устройство',
    seen_hours: 'Был(а) 2 часа назад',
    seen_days: 'Был(а) 3 дня назад',
    support_title: 'Поддержка',
    support_desc: 'Если у вас возникли вопросы или нужна помощь — мы всегда рядом.',
    write_support: 'Написать в поддержку',
    logout: 'Выйти из аккаунта',
    delete_account: 'Запросить удаление аккаунта',
    set_general_title: 'Основное',
    set_general_desc: 'Удобная работа с ByMeVPN',
    autostart_title: 'Запускать вместе с системой',
    autostart_desc: 'ByMeVPN будет включаться автоматически при запуске компьютера',
    background_title: 'Оставаться подключённым в фоне',
    background_desc: 'Фоновая работа пока в разработке. Закрытие окна отключает VPN.',
    bypass_title: 'Умный обход российских сервисов',
    bypass_desc: 'Российские сайты и сервисы будут открываться без VPN',
    set_security_title: 'Комфорт и защита',
    set_security_desc: 'Больше свободы и безопасности в интернете',
    adblock_title: 'Блокировка рекламы',
    adblock_desc: 'Убирает рекламу на сайтах и в приложениях',
    adblock_off: 'Выкл.',
    adblock_basic: 'Базовая',
    adblock_recommended: 'Рекомендуется',
    killswitch_title: 'Аварийная защита',
    killswitch_desc: 'Полная аварийная блокировка пока не реализована.',
    support_info_title: 'Поддержка и информация',
    support_info_desc: 'Мы всегда рядом',
    tile_telegram: 'Поддержка в Telegram',
    tile_privacy: 'Политика конфиденциальности',
    tile_faq: 'Частые вопросы',
    tile_terms: 'Условия использования',
    app_language: 'Язык приложения',
    tg_modal_title: 'Вход через Telegram',
    google_modal_title: 'Вход через Google',
    faq_title: 'Частые вопросы',
    faq_q1: 'Как работает VLESS + Reality?',
    faq_a1: 'VLESS + Reality шифрует трафик и использует TLS-маскировку. Доступность зависит от сети и сервера.',
    faq_q2: 'Как работает обход российских сервисов?',
    faq_a2: 'При включённом обходе поддерживаемые российские домены и адреса направляются напрямую. Фактические маршруты проверяются на устройстве.',
    faq_q3: 'Как отключить автопродление?',
    faq_a3: 'Управление списаниями через приложение пока не реализовано. Обратитесь в поддержку для проверки и изменения автопродления.',
    cancel: 'Отмена',
    confirm: 'Подтвердить'
  },
  en: {
    terms_prefix: "By selecting Pay, you accept the ",
    terms_link: "Terms of Service",
    terms_and: " and ",
    privacy_link: "Privacy Policy",
    email_placeholder: "Email address",
    password_placeholder: "Password",
    new_password_placeholder: "Create password",
    repeat_password_placeholder: "Confirm password",
    name_placeholder: "Display name",
    server_search_placeholder: "Search servers or countries...",
    dns_title: 'DNS provider',
    dns_desc: 'Changes take effect the next time you connect to VPN',
    autoconnect_title: 'Connect when app opens',
    autoconnect_desc: 'Connect automatically after sign-in when the subscription is active',
    account_settings_title: 'Account settings',
    account_refresh: 'Refresh account',
    account_copy_id: 'Copy account ID',
    account_app_settings: 'App settings',
    account_advanced: 'Advanced settings',
    slogan: 'Speed. Anonymity. Honesty.',
    perk_fast: 'Fast connection',
    perk_easy: 'Simple controls',
    login_title: 'Sign In',
    login_subtitle: 'Sign in to your ByMeVPN account',
    continue_google: 'Continue with Google',
    or_email: 'or with email',
    sign_in: 'Sign In',
    tg_prompt: 'Already used our Telegram bot?',
    tg_login_btn: 'Sign In with Telegram',
    no_account: "Don't have an account?",
    register_link: 'Sign Up ›',
    register_title: 'Create Account',
    register_subtitle: 'Register your ByMeVPN account',
    create_account: 'Create Account',
    have_account: 'Already have an account?',
    login_link: 'Sign In ›',
    nav_connection: 'Connection',
    nav_account: 'Account',
    nav_settings: 'Settings',
    protection_active: 'Protection active',
    vpn_connected: 'VPN Connected',
    conn_secured: 'Connection secured',
    download: 'Download',
    upload: 'Upload',
    latency: 'Latency',
    card_server: 'Server',
    card_sub: 'Subscription',
    change_server: 'Change server',
    active: 'Active',
    manage_sub: 'Manage',
    ru_bypass_label: 'Direct routing for local services',
    vpn_off: 'VPN is Off',
    vpn_off_desc: 'Click to establish secure connection',
    connect: 'Connect',
    disconnect: 'Disconnect',
    try_bymevpn: 'Try ByMeVPN Free',
    trial_perks: '3 days of full access to all servers with no speed limits. No credit card required.',
    activate_1rub: 'Start 3-Day Free Trial',
    view_all_plans: 'View all plans ›',
    trial_access_headline: 'Free Trial Access',
    trial_for_new: '3 days of unlimited access for new users',
    trial_then_price: '0 ₽ charged • No card required',
    select_device_count: 'Select number of devices',
    devices_2: '2 devices',
    devices_5: '5 devices',
    devices_10: '10 devices',
    plan_1m: '1 month',
    plan_3m: '3 months',
    plan_6m: '6 months',
    plan_12m: '12 months',
    plus_1_gift: '+ 1 free month',
    plus_2_gift: '+ 2 free months',
    plus_3_gift: '+ 3 free months',
    best_price: 'Best Value',
    pay_via_yookassa: 'Pay with YooKassa',
    payment_methods_text: 'SBP, Cards, SberPay, T-Pay',
    auto_renew_note: 'Review recurring payment terms before checkout. Contact support to manage renewal until account controls are available.',
    terms_agreement: 'By clicking "Pay", you agree to Terms of Service and Privacy Policy.',
    back: 'Back',
    server_auto: 'Automatic',
    server_auto_desc: 'We will select the lowest latency server',
    available_servers: 'AVAILABLE SERVERS',
    autorenew_on: 'Auto-renewal status',
    renew: 'Extend',
    manage_subscription: 'Manage subscription',
    devices: 'Devices',
    this_pc: 'Windows • This PC',
    online: 'Online',
    current_device: 'Current device',
    seen_hours: 'Seen 2 hours ago',
    seen_days: 'Seen 3 days ago',
    support_title: 'Support',
    support_desc: 'Need help or have questions? Our support team is always ready.',
    write_support: 'Contact Support',
    logout: 'Log Out',
    delete_account: 'Request Account Deletion',
    set_general_title: 'General',
    set_general_desc: 'Comfortable experience with ByMeVPN',
    autostart_title: 'Launch on Windows startup',
    autostart_desc: 'ByMeVPN starts automatically with your system',
    background_title: 'Stay connected in background',
    background_desc: 'Background VPN mode is not available yet. Closing the app disconnects.',
    bypass_title: 'Smart local services bypass',
    bypass_desc: 'Direct routes for local government, banking and local domain services',
    set_security_title: 'Comfort & Protection',
    set_security_desc: 'Greater freedom and security on the Internet',
    adblock_title: 'Ad Blocker',
    adblock_desc: 'Filters out banners and trackers',
    adblock_off: 'Off',
    adblock_basic: 'Basic',
    adblock_recommended: 'Recommended',
    killswitch_title: 'Kill Switch',
    killswitch_desc: 'Full kill switch protection is not available yet.',
    support_info_title: 'Help & Legal',
    support_info_desc: 'Always by your side',
    tile_telegram: 'Telegram Support',
    tile_privacy: 'Privacy Policy',
    tile_faq: 'FAQ',
    tile_terms: 'Terms of Use',
    app_language: 'App Language',
    tg_modal_title: 'Telegram Sign-in',
    google_modal_title: 'Google Sign-in',
    faq_title: 'Frequently asked questions',
    faq_q1: 'How does VLESS + Reality work?',
    faq_a1: 'VLESS + Reality encrypts traffic and uses TLS camouflage. Availability depends on the network and server.',
    faq_q2: 'How does local site bypass work?',
    faq_a2: 'When enabled, supported local domains and IPs are routed directly. Actual routing depends on your computer.',
    faq_q3: 'How can I cancel auto-renewal?',
    faq_a3: 'In-app auto-renewal management is not ready. Contact support to verify or change recurring payments.',
    cancel: 'Cancel',
    confirm: 'Confirm'
  }
};

// Application Initialization
document.addEventListener('DOMContentLoaded', async () => {
  setupWindowControls();
  setupEventListeners();
  await loadInitialData();
});

// Window Controls (Minimize, Maximize, Close)
function setupWindowControls() {
  document.getElementById('btn-minimize')?.addEventListener('click', () => invoke('window_minimize'));
  document.getElementById('btn-maximize')?.addEventListener('click', () => invoke('window_toggle_maximize'));
  document.getElementById('btn-close')?.addEventListener('click', () => invoke('window_close'));
}

// Initial Data Loader
async function loadInitialData() {
  const epoch = state.sessionEpoch;
  const savedSettings = await invoke('get_settings').catch(() => null);
  if (savedSettings) {
    state.settings = { ...state.settings, ...savedSettings };
    state.preferredServerCode = savedSettings.selectedServerCode || 'auto';
  }
  applySettingsToUi();

  // Plans can be requested without an authenticated user. Never show stale
  // local price constants as a live checkout option.
  // Pricing is nonessential for login: never delay startup on /plans timeout.
  let session = null;
  let restoreFailed = false;
  try {
    session = await invoke('restore_session');
  } catch (err) {
    restoreFailed = true;
  }
  if (epoch !== state.sessionEpoch) return;
  if (session?.user) {
    state.user = session.user;
    state.subscription = session.subscription;
    showAppShell();
  } else {
    showAuthScreen('login');
    const retry = document.getElementById('btn-retry-session');
    retry?.classList.toggle('hidden', !restoreFailed);
    if (restoreFailed) showToast('Сервер недоступен. Вы можете повторить проверку сеанса.', true);
  }
  await checkVpnStatus();
  if (state.user && state.settings.autoConnect && !state.vpnConnected) {
    await loadAvailableServers();
    if (state.servers.some(s => s.supported !== false) &&
        ['active', 'trial', 'grace'].includes(state.subscription?.status)) {
      await toggleVpn();
    }
  }
}

async function loadAvailableServers() {
  const epoch = state.sessionEpoch;
  try {
    const servers = await invoke('get_servers');
    if (epoch !== state.sessionEpoch) return;
    state.servers = Array.isArray(servers) ? servers : [];
    const preferred = state.servers.find(s => s.code === state.preferredServerCode && s.supported !== false);
    state.selectedServer = preferred || {
      code: 'auto', name: 'Автоматически', country: '', flag: '🌐', ping: 0
    };
    const autoButton = document.getElementById('recommended-server-auto');
    autoButton?.classList.toggle('selected', state.selectedServer.code === 'auto');
    autoButton?.setAttribute('aria-pressed', String(state.selectedServer.code === 'auto'));
    renderServersList();
    updateVpnUi();
  } catch (err) {
    if (epoch !== state.sessionEpoch) return;
    state.servers = [];
    renderServersList();
    showToast('Не удалось загрузить реальные серверы. Проверьте соединение.', true);
  }
}

// Android V2 offers exact device-scoped SKUs; prices are never extrapolated.
const VERIFIED_PLAN_TYPES = Object.freeze({
  month: { sku: '1m', days: 30, months: 1 },
  quarter: { sku: '3m', days: 120, months: 4 },
  half_year: { sku: '6m', days: 240, months: 8 },
  year: { sku: '12m', days: 450, months: 15 }
});

async function loadPricingCatalog() {
  const epoch = state.sessionEpoch;
  state.catalogReady = false;
  state.availableDeviceCounts = [];
  updatePricingMatrixUi();
  try {
    // The native broker aggregates authenticated Android V2 catalog tiers.
    const plans = await invoke('get_plans');
    if (epoch !== state.sessionEpoch) return;
    if (!Array.isArray(plans)) throw new Error('Invalid Android V2 catalog');
    const catalog = { 2: {}, 5: {}, 10: {} };
    for (const devices of [2, 5, 10]) {
      for (const [key, meta] of Object.entries(VERIFIED_PLAN_TYPES)) {
        const planCode = meta.sku + '_d' + devices;
        const offer = plans.find(p => p.code === planCode &&
          p.devices === devices && p.days === meta.days &&
          Number.isSafeInteger(p.price_rub) && p.price_rub > 0);
        if (!offer) continue;
        catalog[devices][key] = {
          price: offer.price_rub, days: offer.days, planCode,
          purchaseEnabled: offer.purchase_enabled === true
        };
      }
    }
    state.availableDeviceCounts = [2, 5, 10].filter(devices =>
      Object.keys(catalog[devices]).length > 0);
    if (!state.availableDeviceCounts.length) throw new Error('No verified mobile V2 plans');
    for (const devices of [2, 5, 10]) PRICING_MATRIX[devices] = catalog[devices];
    if (!state.availableDeviceCounts.includes(state.selectedDevicesCount)) {
      state.selectedDevicesCount = state.availableDeviceCounts[0];
    }
    if (!catalog[state.selectedDevicesCount][state.selectedPlanCode]) {
      state.selectedPlanCode = ['year', 'half_year', 'quarter', 'month']
        .find(code => catalog[state.selectedDevicesCount][code]) || 'month';
    }
    state.catalogReady = true;
  } catch (err) {
    if (epoch !== state.sessionEpoch) return;
    state.catalogReady = false;
    state.availableDeviceCounts = [];
    for (const devices of [2, 5, 10]) PRICING_MATRIX[devices] = {};
    showToast('Тарифы сейчас недоступны: оплата временно заблокирована.', true);
  }
  updatePricingMatrixUi();
}

// UI State Toggles: Auth vs App Shell
function showAuthScreen(box = 'login') {
  document.getElementById('view-auth')?.classList.remove('hidden');
  document.getElementById('view-app-shell')?.classList.add('hidden');
  
  if (box === 'login') {
    document.getElementById('auth-box-login')?.classList.remove('hidden');
    document.getElementById('auth-box-register')?.classList.add('hidden');
  } else {
    document.getElementById('auth-box-login')?.classList.add('hidden');
    document.getElementById('auth-box-register')?.classList.remove('hidden');
  }
}

function showAppShell() {
  state.sessionEpoch += 1;
  document.getElementById('view-auth')?.classList.add('hidden');
  document.getElementById('view-app-shell')?.classList.remove('hidden');
  updateUserUi();
  updateSubscriptionUi();
  updatePricingMatrixUi();
  updateVpnUi();
  void refreshAccountSnapshot();
  void loadAvailableServers();
  void loadPricingCatalog();
}

// Tab Switching
function switchTab(tabId) {
  state.currentTab = tabId;

  // Update sidebar active buttons
  document.querySelectorAll('.sidebar-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Update tab content visibility
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.toggle('active', tab.id === tabId);
  });

  // Update top header title
  const titleEl = document.getElementById('page-title');
  const lang = state.settings.language || 'ru';
  const dict = I18N[lang] || I18N.ru;

  switch (tabId) {
    case 'tab-home':
      titleEl.textContent = dict.nav_connection;
      break;
    case 'tab-pricing':
      titleEl.textContent = lang === 'ru' ? 'Подключение доступа' : 'Subscribe';
      break;
    case 'tab-servers':
      titleEl.textContent = lang === 'ru' ? 'Серверы' : 'Servers';
      break;
    case 'tab-account':
      titleEl.textContent = dict.nav_account;
      break;
    case 'tab-settings':
      titleEl.textContent = dict.nav_settings;
      break;
    case 'tab-devices':
      titleEl.textContent = lang === 'ru' ? 'Мои устройства' : 'My Devices';
      break;
    case 'tab-renewal':
      titleEl.textContent = lang === 'ru' ? 'Автопродление' : 'Auto-Renewal';
      break;
    case 'tab-support':
      titleEl.textContent = lang === 'ru' ? 'Помощь' : 'Support & Help';
      break;
    case 'tab-advanced':
      titleEl.textContent = lang === 'ru' ? 'Расширенные настройки' : 'Advanced Settings';
      break;
  }
}

// Event Listeners Binding
function setupEventListeners() {
  // Auth navigation links
  document.getElementById('link-goto-register')?.addEventListener('click', (e) => {
    e.preventDefault();
    showAuthScreen('register');
  });

  document.getElementById('link-goto-login')?.addEventListener('click', (e) => {
    e.preventDefault();
    showAuthScreen('login');
  });

  // Password visibility toggles
  document.querySelectorAll('.btn-password-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const box = btn.closest('.input-field-box');
      const input = box?.querySelector('input');
      if (input) {
        if (input.type === 'password') {
          input.type = 'text';
          btn.textContent = '🙈';
        } else {
          input.type = 'password';
          btn.textContent = '👁';
        }
      }
    });
  });

  // Forms submission
  document.getElementById('form-login')?.addEventListener('submit', handleLogin);
  document.getElementById('form-register')?.addEventListener('submit', handleRegister);
  document.getElementById('btn-retry-session')?.addEventListener('click', async () => {
    document.getElementById('btn-retry-session')?.classList.add('hidden');
    await loadInitialData();
  });

  // Google sign in buttons
  document.getElementById('btn-google-login')?.addEventListener('click', handleGoogleAuth);
  document.getElementById('btn-google-register')?.addEventListener('click', handleGoogleAuth);

  // Telegram login buttons
  document.getElementById('btn-tg-login-modal')?.addEventListener('click', startTelegramAuthFlow);
  document.getElementById('btn-tg-register-modal')?.addEventListener('click', startTelegramAuthFlow);
  // Manual subscription links are not authentication credentials. The
  // deprecated native telegram_login command was deliberately unregistered
  // because it fabricated an active account without server verification.
  // Authenticated bot sessions are the only supported Telegram sign-in flow.

  // Sidebar navigation
  document.querySelectorAll('.sidebar-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Subpage Back Buttons
  document.getElementById('btn-back-from-devices')?.addEventListener('click', () => switchTab('tab-account'));
  document.getElementById('btn-back-from-renewal')?.addEventListener('click', () => switchTab('tab-account'));
  document.getElementById('btn-back-from-support')?.addEventListener('click', () => switchTab('tab-account'));
  document.getElementById('btn-back-from-advanced')?.addEventListener('click', () => switchTab('tab-settings'));

  // Account Subpages Triggers
  document.getElementById('btn-acc-open-devices')?.addEventListener('click', () => switchTab('tab-devices'));
  document.getElementById('btn-acc-manage')?.addEventListener('click', () => switchTab('tab-renewal'));
  document.getElementById('btn-acc-open-support')?.addEventListener('click', () => switchTab('tab-support'));
  document.getElementById('btn-account-refresh')?.addEventListener('click', async () => {
    await refreshAccountSnapshot(true);
    await loadAvailableServers();
  });
  document.getElementById('btn-account-copy-id')?.addEventListener('click', () => {
    const value = String(state.user?.id || '');
    if (!value) return showToast('ID аккаунта пока не загружен', true);
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(value).then(
        () => showToast('ID аккаунта скопирован'),
        () => showToast('Не удалось скопировать ID', true)
      );
    } else {
      showToast('Копирование недоступно на этом устройстве', true);
    }
  });
  document.getElementById('btn-account-app-settings')?.addEventListener('click', () => switchTab('tab-settings'));
  document.getElementById('btn-account-advanced')?.addEventListener('click', () => switchTab('tab-advanced'));
  document.getElementById('btn-renewal-switch-pricing')?.addEventListener('click', () => switchTab('tab-pricing'));
  document.getElementById('row-open-advanced-settings')?.addEventListener('click', () => switchTab('tab-advanced'));

  // VPN connection toggle
  document.getElementById('vpn-power-ring')?.addEventListener('click', toggleVpn);
  document.getElementById('vpn-power-ring-off')?.addEventListener('click', toggleVpn);
  for (const id of ['vpn-power-ring', 'vpn-power-ring-off']) {
    document.getElementById(id)?.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void toggleVpn();
      }
    });
  }
  document.getElementById('btn-toggle-vpn')?.addEventListener('click', toggleVpn);

  // Server selection triggers
  document.getElementById('btn-open-server-picker')?.addEventListener('click', () => switchTab('tab-servers'));
  document.getElementById('btn-active-location-pill')?.addEventListener('click', () => switchTab('tab-servers'));
  document.getElementById('row-server-info')?.addEventListener('click', () => switchTab('tab-servers'));
  document.getElementById('btn-back-from-servers')?.addEventListener('click', () => switchTab('tab-home'));
  document.getElementById('recommended-server-auto')?.addEventListener('click', () => {
    state.preferredServerCode = 'auto';
    state.selectedServer = { code: 'auto', name: 'Автоматически', country: '', flag: '🌐', ping: 0 };
    void invoke('save_setting', { key: 'selectedServerCode', value: 'auto' }).catch(() =>
      showToast('Не удалось сохранить выбор сервера', true));
    renderServersList();
    updateVpnUi();
    switchTab('tab-home');
  });

  // Pricing / Subscription triggers
  document.getElementById('btn-home-activate-trial')?.addEventListener('click', handleActivateTrial);
  document.getElementById('btn-no-plan-trial')?.addEventListener('click', handleActivateTrial);
  document.getElementById('btn-pricing-activate-trial')?.addEventListener('click', handleActivateTrial);
  document.getElementById('btn-home-all-tariffs')?.addEventListener('click', () => switchTab('tab-pricing'));
  document.getElementById('btn-no-plan-pricing')?.addEventListener('click', () => switchTab('tab-pricing'));
  document.getElementById('btn-open-manage-pricing')?.addEventListener('click', () => switchTab('tab-pricing'));
  document.getElementById('btn-acc-renew')?.addEventListener('click', () => switchTab('tab-pricing'));

  // Support subpage actions
  document.getElementById('btn-open-telegram-support')?.addEventListener('click', handleOpenTelegramSupport);
  document.getElementById('card-support-channel')?.addEventListener('click', () => {
    const url = 'https://t.me/ByMeVPN';
    invoke('open_external_url', { url }).catch(() => showToast(uiText('Не удалось открыть ссылку.', 'Could not open the link.'), true));
  });
  document.getElementById('card-support-faq')?.addEventListener('click', () => openModal('modal-faq'));

  // Telegram bot payment button
  document.getElementById('btn-pay-telegram-bot')?.addEventListener('click', () => {
    const url = 'https://t.me/ByMeVPNbot';
    invoke('open_external_url', { url }).catch(() => showToast(uiText('Не удалось открыть ссылку.', 'Could not open the link.'), true));
  });

  // Paywall modal actions
  document.getElementById('btn-paywall-trial')?.addEventListener('click', handleActivateTrial);
  document.getElementById('btn-paywall-yookassa-action')?.addEventListener('click', () => {
    closeModal('modal-paywall');
    handlePayYooKassa();
  });
  document.getElementById('btn-paywall-tg-action')?.addEventListener('click', () => {
    closeModal('modal-paywall');
    const url = 'https://t.me/ByMeVPNbot';
    invoke('open_external_url', { url }).catch(() => showToast(uiText('Не удалось открыть ссылку.', 'Could not open the link.'), true));
  });

  document.querySelectorAll('.paywall-mini-tariffs .tariff-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.paywall-mini-tariffs .tariff-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.selectedPlanCode = card.dataset.pwPlan || 'year';
      updatePricingMatrixUi();
    });
  });

  // Device tabs on pricing screen
  document.querySelectorAll('.dev-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dev-seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.selectedDevicesCount = parseInt(btn.dataset.devices, 10);
      updatePricingMatrixUi();
    });
  });

  // Tariff cards selection
  document.querySelectorAll('.tariff-card[data-plan]').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.tariff-card[data-plan]').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.selectedPlanCode = card.dataset.plan;
      updatePricingMatrixUi();
    });
  });

  // Payment button
  document.getElementById('btn-pay-yookassa')?.addEventListener('click', handlePayYooKassa);

  // Support & FAQ triggers
  document.getElementById('btn-top-help')?.addEventListener('click', () => openModal('modal-faq'));
  document.getElementById('tile-faq-modal')?.addEventListener('click', () => openModal('modal-faq'));
  document.getElementById('tile-support-telegram')?.addEventListener('click', handleOpenTelegramSupport);

  // Legal docs triggers
  document.getElementById('tile-privacy-policy')?.addEventListener('click', () => openLegalModal('privacy'));
  document.getElementById('tile-terms-of-use')?.addEventListener('click', () => openLegalModal('terms'));
  document.getElementById('link-pricing-privacy')?.addEventListener('click', (e) => { e.preventDefault(); openLegalModal('privacy'); });
  document.getElementById('link-pricing-terms')?.addEventListener('click', (e) => { e.preventDefault(); openLegalModal('terms'); });

  // Account actions (Logout / Delete)
  document.getElementById('btn-acc-logout')?.addEventListener('click', handleLogout);
  document.getElementById('btn-acc-delete')?.addEventListener('click', handleDeleteAccount);

  // Settings switches
  document.getElementById('set-autostart')?.addEventListener('change', (e) => handleSettingChange('autoStart', e.target.checked));
  document.getElementById('set-autoconnect')?.addEventListener('change', e => handleSettingChange('autoConnect', e.target.checked));
  document.getElementById('set-background')?.addEventListener('change', (e) => handleSettingChange('stayConnectedInBackground', e.target.checked));
  document.getElementById('set-bypass')?.addEventListener('change', (e) => handleSettingChange('bypassRu', e.target.checked));
  document.getElementById('set-dns-mode')?.addEventListener('change', e => handleSettingChange('dnsMode', e.target.value));
  document.getElementById('set-killswitch')?.addEventListener('change', (e) => handleSettingChange('killSwitch', e.target.checked));

  document.querySelectorAll('input[name="adblock"]').forEach(radio => {
    radio.addEventListener('change', (e) => handleSettingChange('adBlock', e.target.value));
  });

  // Language buttons
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.dataset.lang;
      handleSettingChange('language', lang);
    });
  });

  // Server search filter
  document.getElementById('server-search-input')?.addEventListener('input', (e) => {
    filterServers(e.target.value);
  });

  // Modal close buttons
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });

  // FAQ accordion toggles
  document.querySelectorAll('.faq-item-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-accordion-item');
      item.classList.toggle('expanded');
    });
  });
}

// Authentication Handlers
function setAuthPending(pending) {
  state.authBusy = pending;
  for (const id of ['btn-submit-login', 'btn-submit-register', 'btn-tg-login-modal', 'btn-tg-register-modal']) {
    const el = document.getElementById(id);
    if (el) el.disabled = pending;
  }
}

async function handleLogin(e) {
  e.preventDefault();
  if (state.authBusy) return;
  const email = document.getElementById('login-email')?.value?.trim();
  const password = document.getElementById('login-password')?.value;
  if (!email || !password) {
    showToast('Введите email и пароль', true);
    return;
  }
  setAuthPending(true);
  try {
    const res = await invoke('auth_login', { email, password });
    if (!res?.user?.id) throw new Error('Сервер не подтвердил вход в аккаунт');
    state.sessionEpoch += 1;
    state.user = res.user;
    state.subscription = res.subscription;
    showAppShell();
    showToast('Вход выполнен');
    document.getElementById('login-password').value = '';
  } catch (err) {
    showToast(typeof err === 'string' ? err : err?.message || 'Не удалось войти', true);
  } finally {
    setAuthPending(false);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  if (state.authBusy) return;
  const name = document.getElementById('register-name')?.value?.trim() || 'Пользователь';
  const email = document.getElementById('register-email')?.value?.trim();
  const password = document.getElementById('register-password')?.value;
  const confirm = document.getElementById('register-password-confirm')?.value;
  if (!email || !password) return showToast('Заполните обязательные поля', true);
  if (password.length < 6) return showToast('Минимальная длина пароля — 6 символов', true);
  if (password !== confirm) return showToast('Пароли не совпадают', true);
  setAuthPending(true);
  try {
    const res = await invoke('auth_register', { email, password, name });
    if (!res?.user?.id) throw new Error('Сервер не подтвердил регистрацию');
    state.sessionEpoch += 1;
    state.user = res.user;
    state.subscription = res.subscription;
    showAppShell();
    showToast('Аккаунт создан');
    document.getElementById('register-password').value = '';
    document.getElementById('register-password-confirm').value = '';
  } catch (err) {
    showToast(typeof err === 'string' ? err : err?.message || 'Не удалось зарегистрироваться', true);
  } finally {
    setAuthPending(false);
  }
}

let tgPollingInterval = null;
let tgActiveToken = null;
let tgPollingGeneration = 0;
let tgPollingBusy = false;
let tgStarting = false;
let tgPollingFailures = 0;
const TG_SESSION_TIMEOUT_MS = 5 * 60 * 1000;
let tgPollingStartedAt = 0;

function cancelTelegramPolling() {
  const previousToken = tgActiveToken;
  tgActiveToken = null;
  tgPollingStartedAt = 0;
  if (previousToken) {
    void invoke('telegram_cancel_session', { sessionToken: previousToken }).catch(() => {});
  }
  tgPollingGeneration += 1;
  if (tgPollingInterval) clearInterval(tgPollingInterval);
  tgPollingInterval = null;
  tgPollingBusy = false;
}

function handleGoogleAuth() {
  // Google OIDC is unavailable until the backend verifies signed ID tokens.
  showToast('Google-вход пока недоступен. Используйте Telegram или Email.', true);
}

async function startTelegramAuthFlow() {
  if (tgStarting || state.authBusy) return;
  cancelTelegramPolling();
  tgStarting = true;
  const generation = tgPollingGeneration;
  try {
    const res = await invoke('telegram_create_session');
    if (generation !== tgPollingGeneration) return;
    if (!res?.session_token || !res?.bot_url) {
      throw new Error('Сервер не вернул сеанс Telegram');
    }
    tgActiveToken = res.session_token;
    tgPollingStartedAt = Date.now();
    openModal('modal-telegram');
    const statusEl = document.getElementById('tg-polling-status');
    if (statusEl) statusEl.textContent = uiText('Ожидаем подтверждение в Telegram...', 'Waiting for Telegram confirmation...');
    // All external URLs must pass the Rust allowlist. WebView window.open
    // must never bypass native link validation.
    const openTelegram = () => invoke('open_external_url', { url: res.bot_url });
    const reopenButton = document.getElementById('btn-tg-reopen');
    if (reopenButton) reopenButton.onclick = openTelegram;
    await openTelegram();
    if (generation !== tgPollingGeneration) return;

    tgPollingFailures = 0;
    tgPollingInterval = setInterval(async () => {
      if (tgPollingBusy || generation !== tgPollingGeneration) return;
      if (Date.now() - tgPollingStartedAt >= TG_SESSION_TIMEOUT_MS) {
        cancelTelegramPolling();
        if (statusEl) statusEl.textContent = uiText(
          'Время ожидания истекло. Начните вход заново.',
          'Sign-in timed out. Start again.');
        return;
      }
      tgPollingBusy = true;
      try {
        const check = await invoke('telegram_check_session', { sessionToken: res.session_token });
        if (generation !== tgPollingGeneration) return;
        tgPollingFailures = 0;
        if (check && ['authenticated', 'approved', 'success'].includes(check.status)) {
          if (!check.auth?.user?.id) throw new Error('Telegram не вернул профиль пользователя');
          cancelTelegramPolling();
          state.sessionEpoch += 1;
          state.user = check.auth.user;
          state.subscription = check.auth.subscription;
          closeModal('modal-telegram');
          showAppShell();
          showToast('Вход через Telegram подтверждён');
          void refreshAccountSnapshot();
        } else if (check?.status === 'expired') {
          cancelTelegramPolling();
          if (statusEl) statusEl.textContent = uiText('Срок ссылки истёк. Начните вход снова.', 'The login link expired. Start again.');
        }
      } catch (err) {
        if (generation !== tgPollingGeneration) return;
        tgPollingFailures += 1;
        if (tgPollingFailures >= 3 && statusEl) {
          statusEl.textContent = uiText('Нет ответа сервера. Продолжаем проверку...', 'Server unavailable. Retrying...');
        }
      } finally {
        tgPollingBusy = false;
      }
    }, 1500);
  } catch (err) {
    if (generation === tgPollingGeneration) {
      showToast(typeof err === 'string' ? err : err?.message || 'Не удалось начать вход через Telegram', true);
    }
  } finally {
    tgStarting = false;
  }
}

async function handleLogout() {
  showConfirm(
    uiText('Выход из аккаунта', 'Sign out'),
    uiText('Вы уверены, что хотите выйти из ByMeVPN?', 'Sign out of ByMeVPN?'),
    async () => {
      if (state.connectionBusy) {
        showToast(uiText('Дождитесь завершения работы VPN', 'Wait for the VPN operation to finish.'), true);
        return;
      }
      try {
        // The Rust command also stops any tunnel the UI may have missed.
        await invoke('auth_logout');
      } catch (err) {
        showToast(uiText('Не удалось выйти. Проверьте, остановлен ли VPN.', 'Sign-out failed. Check whether VPN has stopped.'), true);
        return;
      }
      state.sessionEpoch += 1;
      cancelTelegramPolling();
      for (const interval of ['pollInterval', 'timerInterval']) {
        if (state[interval]) clearInterval(state[interval]);
        state[interval] = null;
      }
      state.vpnConnected = false;
      state.vpnVerified = false;
      state.vpnPhase = 'idle';
      state.metrics = { download_mbps: 0, upload_mbps: 0, ping_ms: 0 };
      state.servers = [];
      state.devices = [];
      state.user = null;
      state.subscription = null;
      state.pendingCheckout = null;
      showAuthScreen('login');
      showToast('Вы вышли из системы');
    }
  );
}

async function handleDeleteAccount() {
  // DELETE /me currently returns 501. Never imply that the account is gone.
  showConfirm(
    uiText('Запросить удаление аккаунта', 'Request account deletion'),
    uiText('Автоматическое удаление пока недоступно. Открыть поддержку для подачи запроса?',
      'Automatic account deletion is not available yet. Open support to request deletion?'),
    async () => {
      try {
        await handleOpenTelegramSupport();
      } catch (err) {
        showToast(uiText('Не удалось открыть поддержку.', 'Could not open support.'), true);
      }
    }
  );
}

// VPN Lifecycle & Real-time Metrics
async function toggleVpn() {
  if (state.connectionBusy) return;
  state.connectionBusy = true;
  state.vpnPhase = state.vpnConnected ? 'disconnecting' : 'connecting';
  updateVpnUi();
  try {
  if (state.vpnConnected) {
    showToast('Отключение VPN...');
    try {
      await invoke('vpn_stop');
      state.vpnConnected = false;
      state.vpnVerified = false;
      if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
      }
      if (state.pollInterval) {
        clearInterval(state.pollInterval);
        state.pollInterval = null;
      }
      updateVpnUi();
      showToast('VPN отключён');
    } catch (err) {
      showToast(typeof err === 'string' ? err : 'Ошибка отключения', true);
    }
  } else {
    // Strict check: active or trial subscription required!
    const sub = state.subscription;
    const hasActiveSub = sub && ['active', 'trial', 'grace'].includes(sub.status);
    if (sub?.status === 'unknown') {
      showToast('Не удалось проверить подписку. Обновите аккаунт и повторите попытку.', true);
      await refreshAccountSnapshot();
      return;
    }
    if (!hasActiveSub) {
      showToast('Для подключения требуется активный доступ (3 дня бесплатно или тариф).');
      openModal('modal-paywall');
      return;
    }

    if (!state.servers.length) await loadAvailableServers();
    if (!state.servers.some(server => server.supported !== false)) {
      showToast('Не удалось получить совместимые серверы. Проверьте сеть и обновите список.', true);
      return;
    }

    showToast('Запуск туннеля Xray + Wintun...');
    try {
      const code = state.selectedServer.code === 'auto' ? null : state.selectedServer.code;
      const metrics = await invoke('vpn_start', { nodeCode: code });
      state.vpnConnected = metrics?.connected === true;
      if (!state.vpnConnected) throw new Error('Движок не подтвердил соединение');
      state.vpnVerified = true;
      state.connectedSeconds = 0;
      if (metrics) {
        state.metrics = metrics;
      }
      startLiveTimer();
      startStatusPolling();
      updateVpnUi();
      showToast('Подключение проверено и установлено');
    } catch (err) {
      state.vpnConnected = false;
      state.vpnVerified = false;
      const errMsg = typeof err === 'string' ? err : (err?.message || 'Не удалось подключиться');
      showToast(errMsg, true);
      // HTTP 403 may be caused by HWID or unavailable 3x-ui; never erase
      // entitlement or advertise a new purchase solely because VPN failed.
      updateVpnUi();
      if (errMsg.includes('подписки')) void refreshAccountSnapshot();
    }
  }
  } finally {
    state.connectionBusy = false;
    state.vpnPhase = state.vpnConnected ? 'connected' : 'idle';
    updateVpnUi();
  }
}

async function checkVpnStatus() {
  const epoch = state.sessionEpoch;
  try {
    const status = await invoke('vpn_status');
    if (epoch !== state.sessionEpoch) return;
    if (status && status.connected) {
      state.vpnVerified = true;
      state.vpnConnected = true;
      state.connectedSeconds = status.connected_seconds || 0;
      state.metrics = status;
      startLiveTimer();
      startStatusPolling();
    } else {
      state.vpnVerified = false;
      state.vpnConnected = false;
      if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
      }
      if (state.pollInterval) {
        clearInterval(state.pollInterval);
        state.pollInterval = null;
      }
    }
    updateVpnUi();
  } catch (err) {
    // Ignore offline error
  }
}

function startStatusPolling() {
  if (state.pollInterval) clearInterval(state.pollInterval);
  const epoch = state.sessionEpoch;
  state.pollInterval = setInterval(async () => {
    if (epoch !== state.sessionEpoch) {
      clearInterval(state.pollInterval);
      state.pollInterval = null;
      return;
    }
    if (state.vpnConnected && !document.hidden && !state.pollBusy) {
      state.pollBusy = true;
      try {
        const status = await invoke('vpn_status');
        if (epoch !== state.sessionEpoch) return;
        state.pollFailures = 0;
        state.vpnVerified = status?.connected === true;
        if (status) {
          const wasConnected = state.vpnConnected;
          state.vpnConnected = status.connected === true;
          state.metrics = status;
          state.connectedSeconds = status.connected_seconds || 0;
          if (wasConnected && !state.vpnConnected) {
            clearInterval(state.timerInterval);
            clearInterval(state.pollInterval);
            state.timerInterval = null;
            state.pollInterval = null;
            showToast('Соединение VPN прервано. Защита не подтверждена.', true);
          }
          updateVpnUi();
        }
      } catch (err) {
        state.pollFailures += 1;
        if (state.pollFailures >= 3) {
          state.vpnVerified = false;
          updateVpnUi();
        }
      } finally {
        state.pollBusy = false;
      }
    }
  }, 2500);
}

// Pause heavy polling when app window is hidden/minimized
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (state.pollInterval) {
      clearInterval(state.pollInterval);
      state.pollInterval = null;
    }
  } else {
    if (state.vpnConnected && !state.pollInterval) startStatusPolling();
    if (state.user) void refreshAccountSnapshot();
  }
});

function startLiveTimer() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    state.connectedSeconds++;
    const timerEl = document.getElementById('vpn-live-timer');
    if (timerEl) {
      timerEl.textContent = formatTime(state.connectedSeconds);
    }
  }, 1000);
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Runtime strings must use the same locale as the Android app.
function uiText(ru, en) {
  return state.settings.language === 'en' ? en : ru;
}

// Dynamic notifications use the same locale as static data-i18n labels.
// Backend-provided diagnostics are intentionally left intact until the API
// offers machine-readable error codes for reliable localization.
const TOAST_EN = Object.freeze({
  "Сервер недоступен. Вы можете повторить проверку сеанса.": "Server unavailable. You can retry session recovery.",
  "Не удалось загрузить реальные серверы. Проверьте соединение.": "Could not load VPN servers. Check your connection.",
  "Тарифы сейчас недоступны: оплата временно заблокирована.": "Plans are unavailable. Checkout is temporarily disabled.",
  "ID аккаунта пока не загружен": "Your account ID has not loaded yet.",
  "ID аккаунта скопирован": "Account ID copied.",
  "Не удалось скопировать ID": "Could not copy the account ID.",
  "Копирование недоступно на этом устройстве": "Copy is unavailable on this device.",
  "Введите email и пароль": "Enter your email and password.",
  "Вход выполнен": "Signed in successfully.",
  "Не удалось войти": "Sign-in failed.",
  "Заполните обязательные поля": "Complete the required fields.",
  "Минимальная длина пароля — 6 символов": "Use a password of at least 6 characters.",
  "Пароли не совпадают": "Passwords do not match.",
  "Аккаунт создан": "Account created.",
  "Не удалось зарегистрироваться": "Could not create your account.",
  "Google-вход пока недоступен. Используйте Telegram или Email.": "Google sign-in is unavailable. Use Telegram or email.",
  "Вход через Telegram подтверждён": "Telegram sign-in confirmed.",
  "Не удалось начать вход через Telegram": "Could not start Telegram sign-in.",
  "Дождитесь завершения подключения или отключения": "Wait for VPN connection or disconnection to finish.",
  "Не удалось остановить VPN перед выходом.": "Could not disconnect VPN before signing out.",
  "Вы вышли из системы": "Signed out.",
  "Дождитесь завершения работы VPN": "Wait for the VPN operation to finish.",
  "Аккаунт удалён": "Account deleted.",
  "Не удалось удалить аккаунт": "Could not delete your account.",
  "Отключение VPN...": "Disconnecting VPN...",
  "VPN отключён": "VPN disconnected.",
  "Ошибка отключения": "Could not disconnect VPN.",
  "Не удалось проверить подписку. Обновите аккаунт и повторите попытку.": "Could not verify your subscription. Refresh the account and retry.",
  "Для подключения требуется активный доступ (3 дня бесплатно или тариф).": "You need an active subscription or free trial to connect.",
  "Не удалось получить совместимые серверы. Проверьте сеть и обновите список.": "No compatible servers available. Check your network and refresh.",
  "Запуск туннеля Xray + Wintun...": "Starting Xray + Wintun tunnel...",
  "Подключение проверено и установлено": "VPN connection established and verified.",
  "Соединение VPN прервано. Защита не подтверждена.": "VPN disconnected. Protection is not verified.",
  "Устройство успешно отключено": "Device disconnected.",
  "Не удалось отключить устройство": "Could not disconnect device.",
  "Активация 3 дней бесплатного доступа...": "Activating 3 days of free access...",
  "Пробный период на 3 дня успешно активирован (0 ₽)!": "3-day free trial activated (0 RUB).",
  "Не удалось активировать пробный период": "Could not activate free trial.",
  "Тарифы сейчас недоступны. Повторите загрузку позже.": "Plans unavailable. Retry later.",
  "Выбранное число устройств недоступно. Обновите тарифы.": "Selected device count is unavailable. Refresh plans.",
  "Цена тарифа не подтверждена сервером.": "The plan price has not been verified by the server.",
  "Выбранный тариф недоступен для оплаты. Обновите список.": "The selected plan is unavailable for checkout. Refresh plans.",
  "Неожиданный платёжный провайдер.": "Unexpected payment provider.",
  "Сервер не вернул подтверждённые данные счёта": "The server did not return a valid invoice.",
  "Формирование счёта ЮKassa...": "Creating a YooKassa invoice...",
  "Ожидаем подтверждение конкретного счёта от сервера": "Waiting for confirmation of this invoice.",
  "Счёт отменён. Можно создать новый платёж.": "Invoice canceled. You can create a new payment.",
  "Оплата подтверждена, подписка обновлена.": "Payment confirmed. Subscription updated.",
  "Счёт ожидает подтверждения. Повторное открытие продолжит его проверку.": "Payment is pending. Reopening will resume verification.",
  "Не удалось проверить счёт.": "Could not verify invoice.",
  "Настройки сохранены": "Settings saved.",
  "Не удалось сохранить настройку. Изменение отменено.": "Could not save settings. Change reverted.",
  "Данные аккаунта обновлены": "Account refreshed.",
  "Не удалось обновить аккаунт": "Could not refresh account.",
  "Не удалось сохранить выбор сервера": "Could not save the selected server."
});
function localizedToast(text) {
  const original = String(text || '');
  if (state.settings.language !== 'en') return original;
  if (TOAST_EN[original]) return TOAST_EN[original];
  if (original.startsWith('Выбран сервер: ')) return 'Server selected: ' + original.slice('Выбран сервер: '.length);
  return original;
}

// UI Updaters
function updateVpnUi() {
  const isConn = state.vpnConnected;
  const sub = state.subscription;
  const hasPlan = sub && ['active', 'trial', 'grace', 'unknown'].includes(sub.status);

  const noPlanBox = document.getElementById('home-state-no-plan');
  const connectedBox = document.getElementById('home-state-connected');
  const disconnectedBox = document.getElementById('home-state-disconnected');
  const activePill = document.getElementById('vpn-active-pill');

  if (isConn) {
    noPlanBox?.classList.add('hidden');
    connectedBox?.classList.remove('hidden');
    disconnectedBox?.classList.add('hidden');
    activePill?.classList.toggle('hidden', !state.vpnVerified);
    const heading = document.querySelector('#home-state-connected .status-title-text');
    if (heading) heading.textContent = state.vpnVerified ?
      uiText('VPN подключён', 'VPN connected') :
      uiText('Проверяем состояние VPN', 'Checking VPN connection');
  } else if (!hasPlan) {
    // Parity with Android Mockup 03_home_no_plan
    noPlanBox?.classList.remove('hidden');
    connectedBox?.classList.add('hidden');
    disconnectedBox?.classList.add('hidden');
    activePill?.classList.add('hidden');
  } else {
    // Has active plan, disconnected
    noPlanBox?.classList.add('hidden');
    connectedBox?.classList.add('hidden');
    disconnectedBox?.classList.remove('hidden');
    activePill?.classList.add('hidden');

    const desc = document.getElementById('home-off-desc');
    const btn = document.getElementById('vpn-btn-text');
    const promoBox = document.querySelector('.promo-trial-box');
    const ringOff = document.getElementById('vpn-power-ring-off');

    if (desc) desc.textContent = state.vpnPhase === 'connecting' ?
      uiText('Запуск и проверка VPN...', 'Starting and verifying VPN...') :
      uiText('Нажмите, чтобы подключиться', 'Click to connect');
    if (btn) btn.textContent = state.vpnPhase === 'connecting' ?
      uiText('Подключаемся...', 'Connecting...') : uiText('Подключиться', 'Connect');
    ringOff?.classList.remove('ring-off');
    ringOff?.classList.add('ring-ready');
    promoBox?.classList.add('hidden');
  }

  // Update Server info in card
  const s = state.selectedServer;
  const flagEl = document.getElementById('conn-flag-chip');
  const nameEl = document.getElementById('conn-location-name');
  const homeFlag = document.getElementById('home-server-flag');
  const homeCountry = document.getElementById('home-server-country');
  const homeCity = document.getElementById('home-server-city');

  if (flagEl) flagEl.textContent = s.flag || '🌐';
  if (nameEl) nameEl.textContent = isConn && s.code === 'auto' && state.metrics?.server_name ?
    state.metrics.server_name : serverDisplayName(s);
  for (const id of ['vpn-power-ring', 'vpn-power-ring-off']) {
    document.getElementById(id)?.setAttribute('aria-busy', String(state.connectionBusy));
  }
  document.getElementById('btn-toggle-vpn')?.toggleAttribute('disabled', state.connectionBusy);
  if (homeFlag) homeFlag.textContent = s.flag || '🌐';
  if (homeCountry) homeCountry.textContent = s.code === 'auto' ?
    uiText('Автоматически', 'Automatic') :
    (state.settings.language === 'en' ? s.country_en : s.country) || serverDisplayName(s);
  if (homeCity) homeCity.textContent = s.code === 'auto' ?
    uiText('Автовыбор', 'Auto select') :
    ((state.settings.language === 'en' ? s.city_en : s.city) || '');

  updateMetricsUi();
}

function updateMetricsUi() {
  const m = state.metrics;
  const downEl = document.getElementById('metric-download');
  const upEl = document.getElementById('metric-upload');
  const pingEl = document.getElementById('metric-ping');

  if (!state.vpnConnected) {
    if (downEl) downEl.textContent = '—';
    if (upEl) upEl.textContent = '—';
    if (pingEl) pingEl.textContent = '—';
    return;
  }

  if (downEl) downEl.textContent = m.download_mbps > 0 ? `${m.download_mbps.toFixed(1)} Mbps` : '—';
  if (upEl) upEl.textContent = m.upload_mbps > 0 ? `${m.upload_mbps.toFixed(1)} Mbps` : '—';
  if (pingEl) pingEl.textContent = m.ping_ms > 0 ? `${m.ping_ms} ms` : '—';
}

function updateUserUi() {
  if (!state.user) return;
  const nameEl = document.getElementById('acc-user-name');
  const emailEl = document.getElementById('acc-user-email');

  if (nameEl) nameEl.textContent = state.user.name || uiText('Пользователь', 'User');
  if (emailEl) emailEl.textContent = state.user.email || 'ByMeVPN User';
}

function updateSubscriptionUi() {
  const sub = state.subscription;
  const hasPlan = sub && ['active', 'trial', 'grace'].includes(sub.status);
  const isUnknown = !sub || sub.status === 'unknown';

  const title = hasPlan
    ? (sub.plan_name || uiText('Подписка ByMeVPN', 'ByMeVPN subscription'))
    : isUnknown ? uiText('Проверяем подписку', 'Checking subscription')
      : uiText('Нет активной подписки', 'No active subscription');

  const expiry = hasPlan
    ? (sub.expires_at ? `${uiText('Действует до', 'Valid until')} ${sub.expires_at}` :
      uiText('Подписка активна', 'Subscription active'))
    : isUnknown ? uiText('Данные временно недоступны', 'Subscription status unavailable')
      : uiText('Подписка не оформлена', 'No subscription');

  const homeSubTitle = document.getElementById('home-sub-title');
  const homeSubExpiry = document.getElementById('home-sub-expiry');
  const homeSubBadge = document.getElementById('home-sub-badge');
  const accPlanName = document.getElementById('acc-plan-name');
  const accPlanValidity = document.getElementById('acc-plan-validity');
  const accPlanBadge = document.getElementById('acc-autorenew-badge');
  const accRenewBtn = document.getElementById('btn-acc-renew');

  if (homeSubTitle) homeSubTitle.textContent = title;
  if (homeSubExpiry) homeSubExpiry.textContent = expiry;
  if (homeSubBadge) {
    homeSubBadge.textContent = hasPlan ? uiText('Активна', 'Active') :
      isUnknown ? uiText('Неизвестно', 'Unknown') : uiText('Не активна', 'Inactive');
    homeSubBadge.className = hasPlan ? 'badge-active-mini' : 'badge-inactive';
  }

  if (accPlanName) accPlanName.textContent = title;
  if (accPlanValidity) accPlanValidity.textContent = expiry;
  if (accPlanBadge) {
    accPlanBadge.textContent = sub?.auto_renew === true ?
      uiText('Автопродление включено', 'Auto-renewal on') :
      sub?.auto_renew === false ? uiText('Автопродление выключено', 'Auto-renewal off') :
      uiText('Статус автопродления неизвестен', 'Auto-renewal status unknown');
    accPlanBadge.className = sub?.auto_renew === true ? 'badge-auto-renew' : 'badge-inactive';
  }

  if (accRenewBtn) {
    const renewText = accRenewBtn.querySelector('[data-i18n="renew"]') || accRenewBtn;
    renewText.textContent = hasPlan ? uiText('Продлить', 'Renew') :
      uiText('Оформить подписку', 'Subscribe');
  }

  const renewalBadge = document.getElementById('renewal-current-status-badge');
  if (renewalBadge) {
    renewalBadge.textContent = sub?.auto_renew === true ? uiText('Включено', 'Enabled') :
      sub?.auto_renew === false ? uiText('Отключено', 'Disabled') :
      uiText('Неизвестно', 'Unknown');
    renewalBadge.className = sub?.auto_renew === true ? 'badge-active-mini' : 'badge-inactive';
  }
}

function updateDevicesUi() {
  const container = document.getElementById('acc-devices-list');
  const fullContainer = document.getElementById('devices-full-cards-list');
  const heroCurrent = document.getElementById('devices-hero-current');
  const heroMax = document.getElementById('devices-hero-max');

  const ratioEl = document.getElementById('acc-devices-ratio');
  const sub = state.subscription;
  const maxDev = Number.isInteger(sub?.max_devices) ? sub.max_devices : null;
  const devList = Array.isArray(state.devices) ? state.devices : [];

  if (ratioEl) {
    ratioEl.textContent = state.devicesSupported ? `${devList.length} / ${maxDev ?? '—'}` :
      uiText('Недоступно', 'Unavailable');
  }
  if (heroCurrent) heroCurrent.textContent = state.devicesSupported ? String(devList.length) : '—';
  if (heroMax) heroMax.textContent = state.devicesSupported ? String(maxDev ?? '—') : '—';

  const createDeviceRow = (dev) => {
    const row = document.createElement('div');
    row.className = 'glass-card device-item-row';
    row.dataset.deviceId = dev.id || '';

    const isCurrent = dev.is_current === true;
    const model = dev.device_model || dev.platform || uiText('Устройство', 'Device');
    const platform = (dev.platform || '').toLowerCase();
    const icon = platform.includes('android') || platform.includes('phone') || platform.includes('ios')
      ? '📱'
      : platform.includes('tv')
      ? '📺'
      : '💻';

    row.innerHTML = `
      <div class="device-icon-box">${icon}</div>
      <div class="device-info-col">
        <strong>${escapeHtml(model)}</strong>
        <span class="${isCurrent ? 'device-status-online' : 'device-last-seen'}">
          ${isCurrent ? `<span class="dot-green">●</span> ${uiText('Онлайн', 'Online')}` : escapeHtml(dev.last_active || uiText('Недавно', 'Recently'))}
        </span>
      </div>
      ${isCurrent
        ? `<span class="badge-current-device">${uiText('Текущее устройство', 'Current device')}</span>`
        : `<button type="button" class="btn-disconnect-device" data-dev-id="${escapeHtml(dev.id)}"><span>⊘</span> ${uiText('Отключить', 'Disconnect')}</button>`
      }
    `;

    const disconnectBtn = row.querySelector('.btn-disconnect-device');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', () => handleDeleteDevice(dev.id, model));
    }
    return row;
  };

  if (container) {
    container.innerHTML = '';
    devList.forEach(dev => container.appendChild(createDeviceRow(dev)));
  }

  if (fullContainer) {
    fullContainer.innerHTML = '';
    devList.forEach(dev => fullContainer.appendChild(createDeviceRow(dev)));
  }
  if (!state.devicesSupported) {
    for (const element of [container, fullContainer]) {
      if (element) element.textContent = uiText('Управление устройствами пока недоступно на сервере.', 'Device management is currently unavailable.');
    }
  }
}

async function handleDeleteDevice(deviceId, name) {
  if (!deviceId) return;
  showConfirm(
    'Отключение устройства',
    `Вы действительно хотите отключить устройство "${name || 'Устройство'}" от аккаунта?`,
    async () => {
      try {
        await invoke('delete_device', { deviceId });
        showToast('Устройство успешно отключено');
        await refreshAccountSnapshot();
      } catch (err) {
        showToast(typeof err === 'string' ? err : 'Не удалось отключить устройство', true);
      }
    }
  );
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Pricing Matrix UI Calculation
function priceNoteForOffer(code, offer) {
  if (!offer) return uiText('Тариф недоступен', 'Plan unavailable');
  if (code === 'month') return uiText('30 дней', '30 days');
  const months = VERIFIED_PLAN_TYPES[code]?.months || 1;
  return Math.round(offer.price / months) + ' ' +
    uiText('₽ / месяц', 'RUB / month');
}

function updatePricingMatrixUi() {
  const dev = state.selectedDevicesCount || 2;
  const matrix = PRICING_MATRIX[dev] || {};
  const chosen = matrix[state.selectedPlanCode];
  const canPay = state.catalogReady && chosen?.purchaseEnabled === true && !state.paymentBusy;
  for (const id of ['btn-pay-yookassa', 'btn-paywall-yookassa-action']) {
    document.getElementById(id)?.toggleAttribute('disabled', !canPay);
  }
  document.querySelectorAll('.dev-seg-btn').forEach(btn => {
    const count = Number(btn.dataset.devices);
    btn.disabled = !state.availableDeviceCounts.includes(count);
    btn.classList.toggle('active', count === dev);
  });
  for (const [code, priceId, noteId] of [
    ['month', 'price-month', 'days-month'],
    ['quarter', 'price-quarter', 'rate-quarter'],
    ['half_year', 'price-half_year', 'rate-half_year'],
    ['year', 'price-year', 'rate-year']
  ]) {
    const offer = state.catalogReady ? matrix[code] : null;
    const price = document.getElementById(priceId);
    const note = document.getElementById(noteId);
    if (price) price.textContent = offer ? offer.price + ' ₽' : '—';
    if (note) note.textContent = priceNoteForOffer(code, offer);
  }
  document.querySelectorAll('.tariff-card[data-plan]').forEach(card => {
    const offer = state.catalogReady ? matrix[card.dataset.plan] : null;
    card.classList.toggle('selected', card.dataset.plan === state.selectedPlanCode);
    card.classList.toggle('unavailable', !offer);
    card.setAttribute('aria-disabled', String(!offer));
  });
  document.querySelectorAll('.paywall-mini-tariffs .tariff-card').forEach(card => {
    const offer = state.catalogReady ? matrix[card.dataset.pwPlan] : null;
    const price = card.querySelector('.tariff-price-bold');
    const note = card.querySelector('.tariff-subnote');
    if (price) price.textContent = offer ? offer.price + ' ₽' : '—';
    if (note) note.textContent = priceNoteForOffer(card.dataset.pwPlan, offer);
    card.classList.toggle('unavailable', !offer);
    card.classList.toggle('selected', card.dataset.pwPlan === state.selectedPlanCode);
  });
}

// Render Servers
function serverDisplayName(server) {
  if (!server || server.code === 'auto') return uiText('Автоматически', 'Automatic');
  if (state.settings.language !== 'en') return server.name || server.code;
  if (server.name_en && server.name_en !== server.country_en) return server.name_en;
  const country = server.country_en || server.name || server.code;
  return server.city_en ? country + ' • ' + server.city_en : country;
}

function renderServersList(filter = '') {
  const container = document.getElementById('servers-dynamic-list');
  if (!container) return;
  container.replaceChildren();
  const q = filter.toLocaleLowerCase().trim();
  const list = state.servers.filter(s =>
    !q || String(s.name || '').toLocaleLowerCase().includes(q) ||
    String(s.country || '').toLocaleLowerCase().includes(q)
  );
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'server-empty-message';
    empty.textContent = uiText('Доступных серверов нет. Проверьте подписку и соединение.',
      'No servers available. Check your subscription and connection.');
    container.appendChild(empty);
    return;
  }
  list.forEach(srv => {
    const isSel = state.selectedServer.code === srv.code;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `glass-card server-stack-item ${isSel ? 'selected' : ''}`;
    card.disabled = srv.supported === false;
    card.setAttribute('aria-pressed', String(isSel));
    card.dataset.code = srv.code;
    const flag = document.createElement('span');
    flag.className = 'server-item-flag';
    flag.textContent = srv.flag || '🌐';
    const details = document.createElement('div');
    details.className = 'server-item-text';
    const title = document.createElement('strong');
    title.textContent = serverDisplayName(srv);
    const subtitle = document.createElement('span');
    subtitle.textContent = srv.supported === false ?
      uiText('Этот протокол пока не поддерживается', 'This protocol is not yet supported') :
      ((state.settings.language === 'en' ? srv.country_en : srv.country) ||
        uiText('Доступная локация', 'Available location'));
    details.append(title, subtitle);
    const ping = document.createElement('span');
    ping.className = 'server-ping-badge';
    ping.textContent = srv.ping > 0 ? (srv.ping + ' ms') : '—';
    const dot = document.createElement('span');
    dot.className = 'radio-selection-dot';
    card.append(flag, details, ping, dot);
    card.addEventListener('click', () => {
      state.selectedServer = srv;
      state.preferredServerCode = srv.code;
      void invoke('save_setting', { key: 'selectedServerCode', value: srv.code }).catch(() =>
        showToast('Не удалось сохранить выбор сервера', true));
      document.getElementById('recommended-server-auto')?.classList.remove('selected');
      document.getElementById('recommended-server-auto')?.setAttribute('aria-pressed', 'false');
      renderServersList(filter);
      updateVpnUi();
      showToast(uiText('Выбран сервер: ', 'Server selected: ') + serverDisplayName(srv));
      switchTab('tab-home');
    });
    container.appendChild(card);
  });
}

function filterServers(query) {
  renderServersList(query);
}

// Payment & Trial
const TRIAL_ACTION_IDS = [
  'btn-home-activate-trial',
  'btn-no-plan-trial',
  'btn-pricing-activate-trial',
  'btn-paywall-trial'
];

function setTrialPending(pending) {
  state.trialBusy = pending;
  for (const id of TRIAL_ACTION_IDS) {
    const button = document.getElementById(id);
    if (button) {
      button.disabled = pending;
      button.setAttribute('aria-busy', String(pending));
    }
  }
}

function trialActivationMessage(error) {
  const raw = String(typeof error === 'string' ? error : error?.message || '');
  // Match Android's AccountActionErrorMessages: explain recoverable cases
  // without dumping raw backend payloads or untranslated internal errors.
  if (/\(HTTP 401\)|\[UNAUTHORIZED\]|Сначала войдите/i.test(raw)) {
    return uiText('Сеанс завершился. Войдите заново и повторите попытку.',
      'Your session expired. Sign in again and retry.');
  }
  if (/\(HTTP 409\)/.test(raw)) {
    return uiText('Пробный период уже использован или активирован. Обновите аккаунт.',
      'Your trial was already used or activated. Refresh your account status.');
  }
  if (/\(HTTP 422\)/.test(raw)) {
    return uiText('Не удалось подтвердить устройство. Перезапустите приложение.',
      'This device could not be verified. Restart the app.');
  }
  if (/\(HTTP 5\d\d\)/.test(raw)) {
    return uiText('Сервис пробного доступа временно недоступен. Повторите позже.',
      'The trial service is temporarily unavailable. Try again later.');
  }
  if (/связаться|подключени|NETWORK_ERROR|fetch|network|timeout/i.test(raw)) {
    return uiText('Не удалось связаться с сервером. Проверьте интернет.',
      'Could not reach the server. Check your internet connection.');
  }
  return uiText('Не удалось активировать пробный период. Повторите попытку.',
    'Could not activate your free trial. Please try again.');
}

async function handleActivateTrial() {
  // Android V2 parity: never issue multiple trial activations for one user.
  if (state.trialBusy) return;
  if (!state.user?.id) {
    showToast(uiText('Войдите в аккаунт для активации пробного периода.', 'Sign in to activate your free trial.'), true);
    return;
  }
  const epoch = state.sessionEpoch;
  const accountId = String(state.user.id);
  const sameAccount = () => state.sessionEpoch === epoch &&
    String(state.user?.id ?? '') === accountId;
  setTrialPending(true);
  showToast(uiText('Проверяем пробный доступ...', 'Checking your free trial...'));
  try {
    const res = await invoke('activate_trial');
    // A successful backend response for a previous signed-in identity must
    // never overwrite a newly signed-in account after an async race.
    if (!sameAccount()) return;
    if (!res || !['active', 'trial', 'grace'].includes(res.status)) {
      throw new Error(uiText(
        'Сервер не подтвердил активацию пробного периода.',
        'The server did not confirm free-trial activation.'
      ));
    }
    state.subscription = res;
    updateSubscriptionUi();
    updateVpnUi();
    closeModal('modal-paywall');
    switchTab('tab-home');
    showToast(uiText('Бесплатный доступ активирован!', 'Your free trial is active!'));
    // Server discovery may fail independently of successful activation.
    // Do not report a failed trial or restore paywall after confirmation.
    try {
      await loadAvailableServers();
    } catch (error) {
      if (sameAccount()) {
        showToast(uiText(
          'Доступ активирован, но серверы пока недоступны. Обновите список позже.',
          'Your trial is active, but servers are unavailable. Retry later.'
        ), true);
      }
    }
  } catch (err) {
    if (!sameAccount()) return;
    showToast(trialActivationMessage(err), true);
  } finally {
    setTrialPending(false);
  }
}

async function handlePayYooKassa() {
  if (state.paymentBusy) return;
  if (!state.catalogReady) {
    showToast('Тарифы сейчас недоступны. Повторите загрузку позже.', true);
    return;
  }
  const plan = state.selectedPlanCode || 'year';
  const devices = state.selectedDevicesCount || 2;
  const selected = PRICING_MATRIX[devices]?.[plan];
  if (!state.availableDeviceCounts.includes(devices) ||
      !selected?.planCode || selected.purchaseEnabled !== true ||
      !Number.isSafeInteger(selected.price) || !Number.isSafeInteger(selected.days)) {
    showToast('Выбранный тариф недоступен для оплаты. Обновите список.', true);
    return;
  }
  const epoch = state.sessionEpoch;
  state.paymentBusy = true;
  updatePricingMatrixUi();
  try {
    // Resume the exact server invoice after a Windows restart. Windows
    // Credential Manager stores the invoice under the signed-in user.
    const recovered = await invoke('get_pending_payment');
    if (epoch !== state.sessionEpoch) return;
    if (recovered?.plan_code === selected.planCode &&
        recovered?.devices === devices &&
        recovered?.invoice_id && recovered?.payment_url && recovered?.request_id) {
      state.pendingCheckout = {
        planCode: selected.planCode, devices,
        accountId: String(state.user?.id),
        requestId: recovered.request_id,
        invoiceId: recovered.invoice_id,
        paymentUrl: recovered.payment_url
      };
    }
    const matches = state.pendingCheckout?.planCode === selected.planCode &&
      state.pendingCheckout?.devices === devices &&
      state.pendingCheckout?.accountId === String(state.user?.id);
    if (!matches) {
      const random = window.crypto?.randomUUID?.() ||
        Date.now() + '_' + Math.random().toString(36).slice(2);
      state.pendingCheckout = {
        planCode: selected.planCode, devices,
        accountId: String(state.user?.id), requestId: 'checkout_' + random,
        invoiceId: null, paymentUrl: null
      };
    }
    // Reuse an existing invoice after closing checkout or timing out.
    if (!state.pendingCheckout.invoiceId) {
      showToast('Формирование счёта ЮKassa...');
      const response = await invoke('create_payment', {
        planCode: selected.planCode, devices,
        amountRub: selected.price, days: selected.days,
        requestId: state.pendingCheckout.requestId
      });
      if (epoch !== state.sessionEpoch) return;
      const invoiceId = response?.invoice_id;
      const url = response?.payment_url || response?.confirmation_url;
      if (response?.provider && response.provider !== 'yookassa') {
        throw new Error('Неожиданный платёжный провайдер.');
      }
      if (typeof invoiceId !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,128}$/.test(invoiceId) ||
          typeof url !== 'string' || !url.startsWith('https://')) {
        throw new Error('Сервер не вернул подтверждённые данные счёта');
      }
      state.pendingCheckout.invoiceId = invoiceId;
      state.pendingCheckout.paymentUrl = url;
    }
    await invoke('open_external_url', { url: state.pendingCheckout.paymentUrl });
    if (epoch !== state.sessionEpoch) return;
    showToast('Ожидаем подтверждение конкретного счёта от сервера');
    for (let attempt = 0; attempt < 24; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      if (epoch !== state.sessionEpoch) return;
      const status = await invoke('check_payment', { invoiceId: state.pendingCheckout.invoiceId });
      if (epoch !== state.sessionEpoch) return;
      const paymentStatus = String(status?.status || '').toLowerCase();
      if (['failed', 'canceled', 'cancelled', 'expired'].includes(paymentStatus)) {
        state.pendingCheckout = null;
        showToast('Счёт отменён. Можно создать новый платёж.', true);
        return;
      }
      if (['succeeded', 'paid', 'completed'].includes(paymentStatus) && status?.is_active === true) {
        state.pendingCheckout = null;
        await refreshAccountSnapshot();
        showToast('Оплата подтверждена, подписка обновлена.');
        return;
      }
    }
    showToast('Счёт ожидает подтверждения. Повторное открытие продолжит его проверку.');
  } catch (err) {
    if (epoch === state.sessionEpoch) {
      showToast(typeof err === 'string' ? err : err?.message || 'Не удалось проверить счёт.', true);
    }
  } finally {
    state.paymentBusy = false;
    updatePricingMatrixUi();
  }
}

// Settings Persistence
async function handleSettingChange(key, value) {
  const previous = state.settings[key];
  try {
    if (key === 'autoStart') await invoke('set_startup', { enabled: value });
    await invoke('save_setting', { key, value });
    state.settings[key] = value;
    if (key === 'language') applyLanguage(value);
    showToast('Настройки сохранены');
  } catch (err) {
    state.settings[key] = previous;
    applySettingsToUi();
    showToast('Не удалось сохранить настройку. Изменение отменено.', true);
  }
}

function applySettingsToUi() {
  const s = state.settings;
  const setAuto = document.getElementById('set-autostart');
  const setAutoConnect = document.getElementById('set-autoconnect');
  const setBg = document.getElementById('set-background');
  const setBypass = document.getElementById('set-bypass');
  const setDnsMode = document.getElementById('set-dns-mode');
  const setKill = document.getElementById('set-killswitch');

  if (setAuto) setAuto.checked = !!s.autoStart;
  if (setAutoConnect) setAutoConnect.checked = !!s.autoConnect;
  if (setBg) setBg.checked = false;
  if (setBypass) setBypass.checked = !!s.bypassRu;
  if (setDnsMode) setDnsMode.value = s.dnsMode || 'cloudflare';
  if (setKill) setKill.checked = false;

  const adRadio = document.querySelector(`input[name="adblock"][value="${s.adBlock || 'recommended'}"]`);
  if (adRadio) adRadio.checked = true;

  applyLanguage(s.language || 'ru');
}

function applyLanguage(lang) {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  const dict = I18N[lang] || I18N.ru;
  document.documentElement.lang = lang === 'en' ? 'en' : 'ru';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const value = dict[el.dataset.i18n];
    if (typeof value === 'string') el.textContent = value;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const value = dict[el.dataset.i18nPlaceholder];
    if (typeof value === 'string') el.placeholder = value;
  });

  // Recompute dynamic server/account/status labels as well as static titles.
  switchTab(state.currentTab);
  updateVpnUi();
  updateSubscriptionUi();
  updateDevicesUi();
  renderServersList();
}

// Refresh Account Snapshot
async function refreshAccountSnapshot(notify = false) {
  if (!state.user) return;
  const epoch = state.sessionEpoch;
  try {
    const data = await invoke('account_snapshot');
    if (epoch !== state.sessionEpoch) return;
    if (data) {
      if (data.user) state.user = data.user;
      if (data.subscription) state.subscription = data.subscription;
      if (Array.isArray(data.devices)) state.devices = data.devices;
      state.devicesSupported = data.devices_supported !== false;
      updateUserUi();
      updateSubscriptionUi();
      updateDevicesUi();
      updateVpnUi();
      if (notify) showToast('Данные аккаунта обновлены');
    }
  } catch (err) {
    if (notify && epoch === state.sessionEpoch) {
      showToast(typeof err === 'string' ? err : 'Не удалось обновить аккаунт', true);
    }
  }
}

// External Links
async function handleOpenTelegramSupport() {
  const url = 'https://t.me/ByMeVPNSupportBot';
  await invoke('open_external_url', { url }).catch(() => showToast(uiText('Не удалось открыть ссылку.', 'Could not open the link.'), true));
}

// Modal Helpers
function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  if (id === 'modal-telegram') cancelTelegramPolling();
  if (id === 'modal-confirm') {
    const btn = document.getElementById('btn-confirm-accept');
    if (btn) btn.onclick = null;
  }
  document.getElementById(id)?.classList.add('hidden');
}

function showConfirm(title, desc, onConfirm) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-desc').textContent = desc;
  const acceptBtn = document.getElementById('btn-confirm-accept');
  
  acceptBtn.onclick = async () => {
    closeModal('modal-confirm');
    await onConfirm();
  };
  openModal('modal-confirm');
}

function openLegalModal(type) {
  const modal = document.getElementById('modal-legal');
  const title = document.getElementById('legal-modal-title');
  const body = document.getElementById('legal-modal-body');
  if (!modal || !title || !body) return;
  const en = state.settings.language === 'en';

  // This is a concise in-app explanation, not a fabricated audited privacy
  // policy or a substitute for formally published terms.
  if (type === 'privacy') {
    title.textContent = uiText('Конфиденциальность и обработка данных', 'Privacy and data handling');
    body.innerHTML = en ? `
      <p><strong>About this notice</strong> This is an in-app summary, not a replacement for the full published privacy policy.</p>
      <p><strong>Account</strong> Login tokens are stored in Windows Credential Manager. Your account, subscription and device details are provided by the ByMeVPN backend.</p>
      <p><strong>VPN traffic</strong> Xray routes eligible traffic through the selected VPN endpoint. Local routing exceptions may send supported Russian services directly, if enabled.</p>
      <p><strong>Verification</strong> Comprehensive DNS, IPv6 and server logging claims have not been independently verified. No unqualified zero-logs or total anonymity guarantee is made.</p>
      <p><strong>Contact</strong> Use ByMeVPN Support in Telegram for privacy or data requests.</p>
    ` : `
      <p><strong>Об этом уведомлении</strong> Это краткое описание, не заменяющее полную опубликованную политику конфиденциальности.</p>
      <p><strong>Аккаунт</strong> Токены входа хранятся в Windows Credential Manager. Данные аккаунта, подписки и устройств поступают с сервера ByMeVPN.</p>
      <p><strong>VPN-трафик</strong> Xray направляет подходящий трафик через выбранный VPN-сервер. При включённом обходе поддерживаемые российские сервисы могут открываться напрямую.</p>
      <p><strong>Проверка</strong> Полная защита DNS/IPv6 и серверная политика логирования ещё не прошли независимую проверку. Гарантии абсолютной анонимности или Zero Logs не заявляются.</p>
      <p><strong>Обращения</strong> По вопросам персональных данных используйте поддержку ByMeVPN в Telegram.</p>
    `;
  } else {
    title.textContent = uiText('Условия использования — кратко', 'Terms of service — summary');
    body.innerHTML = en ? `
      <p><strong>About this notice</strong> This in-app summary is informational and does not replace the formally published service terms.</p>
      <p><strong>Service</strong> ByMeVPN provides encrypted VPN tunneling where supported by the selected network and server; availability and security depend on the real connection.</p>
      <p><strong>Plans and payment</strong> The backend sets the exact total price, access duration and number of devices before checkout. Payment is confirmed only by the provider and server.</p>
      <p><strong>Renewal and refunds</strong> Review the actual checkout conditions. Until account controls are implemented, contact support about renewal, cancellation or refund requests.</p>
      <p><strong>Acceptable use</strong> Do not use this service for illegal activities, spam, malware or network attacks.</p>
    ` : `
      <p><strong>Об этом уведомлении</strong> Информация носит справочный характер и не заменяет опубликованные условия использования сервиса.</p>
      <p><strong>Услуга</strong> ByMeVPN предоставляет шифрованное VPN-подключение при поддержке выбранной сети и сервера; доступность зависит от фактического соединения.</p>
      <p><strong>Тарифы и оплата</strong> Сервер сообщает полную цену, срок доступа и число устройств до оплаты. Оплата подтверждается платёжным провайдером и сервером.</p>
      <p><strong>Продление и возвраты</strong> Ознакомьтесь с условиями оплаты. Пока управление не реализовано, обратитесь в поддержку по вопросам продления, отмены и возвратов.</p>
      <p><strong>Использование</strong> Запрещены незаконная деятельность, спам, вредоносное ПО и сетевые атаки.</p>
    `;
  }
  modal.classList.remove('hidden');
}

function showToast(text, isError = false) {
  text = localizedToast(text);
  const toast = document.getElementById('toast-notify');
  if (!toast) return;
  toast.textContent = text;
  toast.className = `toast-popup show ${isError ? 'error' : ''}`;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.className = 'toast-popup';
  }, 3200);
}

