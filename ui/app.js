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
  // Standalone browser / preview simulation fallback
  return mockIpc(cmd, args);
};

// State Store
const state = {
  user: null,
  subscription: null,
  devices: [],
  servers: [],
  selectedServer: {
    code: 'auto',
    name: 'Германия • Франкфурт',
    country: 'DE',
    flag: '🇩🇪',
    ping: 28
  },
  selectedDevicesCount: 2,
  selectedPlanCode: 'year',
  vpnConnected: false,
  connectedSeconds: 0,
  metrics: {
    download_mbps: 92.4,
    upload_mbps: 38.7,
    ping_ms: 28
  },
  settings: {
    autoStart: false,
    stayConnectedInBackground: true,
    bypassRu: true,
    adBlock: 'recommended',
    killSwitch: true,
    language: 'ru'
  },
  currentTab: 'tab-home',
  timerInterval: null,
  pollInterval: null
};

// Pricing Matrix strictly matching upstream constants (devices 2 / 5 / 10)
const PRICING_MATRIX = {
  2: {
    month: { price: 89, note: '30 дней' },
    quarter: { price: 316, note: '79 ₽ / месяц' },
    half_year: { price: 552, note: '69 ₽ / месяц' },
    year: { price: 885, note: '59 ₽ / месяц' }
  },
  5: {
    month: { price: 109, note: '30 дней' },
    quarter: { price: 396, note: '99 ₽ / месяц' },
    half_year: { price: 712, note: '89 ₽ / месяц' },
    year: { price: 1185, note: '79 ₽ / месяц' }
  },
  10: {
    month: { price: 129, note: '30 дней' },
    quarter: { price: 476, note: '119 ₽ / месяц' },
    half_year: { price: 872, note: '109 ₽ / месяц' },
    year: { price: 1485, note: '99 ₽ / месяц' }
  }
};

// Default Server List
const DEFAULT_SERVERS = [
  { code: 'de-1', name: 'Германия • Франкфурт', country: 'DE', flag: '🇩🇪', ping: 28 },
  { code: 'nl-1', name: 'Нидерланды • Амстердам', country: 'NL', flag: '🇳🇱', ping: 32 },
  { code: 'se-1', name: 'Швеция • Стокгольм', country: 'SE', flag: '🇸🇪', ping: 41 },
  { code: 'fi-1', name: 'Финляндия • Хельсинки', country: 'FI', flag: '🇫🇮', ping: 38 },
  { code: 'pl-1', name: 'Польша • Варшава', country: 'PL', flag: '🇵🇱', ping: 35 },
  { code: 'us-1', name: 'США • Нью-Йорк', country: 'US', flag: '🇺🇸', ping: 94 }
];

// Translations Dictionary (RU / EN)
const I18N = {
  ru: {
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
    try_bymevpn: 'Попробовать ByMeVPN за',
    trial_perks: '3 дня полного доступа ко всем серверам без ограничений скорости. Затем — 89 ₽ за 30 дней.',
    activate_1rub: 'Активировать за 1 ₽',
    view_all_plans: 'Посмотреть все тарифы ›',
    trial_access_headline: 'Пробный доступ за',
    trial_for_new: '3 дня доступа для новых пользователей',
    trial_then_price: 'Затем — 89 ₽ за 30 дней при сохранённом способе оплаты',
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
    auto_renew_note: 'Подписка продлевается автоматически. Вы можете отменить продление в любой момент в настройках аккаунта.',
    terms_agreement: 'Нажимая «Оплатить», вы соглашаетесь с Условиями использования и Политикой конфиденциальности.',
    back: 'Назад',
    server_auto: 'Автоматически',
    server_auto_desc: 'Выберем лучшее доступное соединение',
    available_servers: 'ДОСТУПНЫЕ СЕРВЕРЫ',
    autorenew_on: 'Автопродление включено',
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
    delete_account: 'Удалить аккаунт',
    set_general_title: 'Основное',
    set_general_desc: 'Удобная работа с ByMeVPN',
    autostart_title: 'Запускать вместе с системой',
    autostart_desc: 'ByMeVPN будет включаться автоматически при запуске компьютера',
    background_title: 'Оставаться подключённым в фоне',
    background_desc: 'VPN продолжит работать, даже если вы закроете приложение',
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
    killswitch_desc: 'Если VPN неожиданно отключится, интернет будет временно заблокирован, чтобы сохранить вашу приватность.',
    support_info_title: 'Поддержка и информация',
    support_info_desc: 'Мы всегда рядом',
    tile_telegram: 'Поддержка в Telegram',
    tile_privacy: 'Политика конфиденциальности',
    tile_faq: 'Частые вопросы',
    tile_terms: 'Условия использования',
    app_language: 'Язык приложения',
    cancel: 'Отмена',
    confirm: 'Подтвердить'
  },
  en: {
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
    try_bymevpn: 'Try ByMeVPN for',
    trial_perks: '3 days of full access to all servers with no speed limits. Then 89 ₽ for 30 days.',
    activate_1rub: 'Activate for 1 ₽',
    view_all_plans: 'View all plans ›',
    trial_access_headline: 'Trial access for',
    trial_for_new: '3 days access for new users',
    trial_then_price: 'Then 89 ₽ for 30 days with saved payment method',
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
    auto_renew_note: 'Subscription auto-renews. You can cancel at any time in account settings.',
    terms_agreement: 'By clicking "Pay", you agree to Terms of Service and Privacy Policy.',
    back: 'Back',
    server_auto: 'Automatic',
    server_auto_desc: 'We will select the lowest latency server',
    available_servers: 'AVAILABLE SERVERS',
    autorenew_on: 'Auto-renewal active',
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
    delete_account: 'Delete Account',
    set_general_title: 'General',
    set_general_desc: 'Comfortable experience with ByMeVPN',
    autostart_title: 'Launch on Windows startup',
    autostart_desc: 'ByMeVPN starts automatically with your system',
    background_title: 'Stay connected in background',
    background_desc: 'VPN stays connected even when app window is closed',
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
    killswitch_desc: 'Blocks internet if VPN disconnects unexpectedly to prevent data leaks.',
    support_info_title: 'Help & Legal',
    support_info_desc: 'Always by your side',
    tile_telegram: 'Telegram Support',
    tile_privacy: 'Privacy Policy',
    tile_faq: 'FAQ',
    tile_terms: 'Terms of Use',
    app_language: 'App Language',
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
  try {
    // 1. Load Settings
    const savedSettings = await invoke('get_settings').catch(() => null);
    if (savedSettings) {
      state.settings = { ...state.settings, ...savedSettings };
    }
    applySettingsToUi();

    // 2. Load Servers
    const servers = await invoke('get_servers').catch(() => DEFAULT_SERVERS);
    state.servers = Array.isArray(servers) && servers.length ? servers : DEFAULT_SERVERS;
    renderServersList();

    // 3. Check Session
    const session = await invoke('restore_session').catch(() => null);
    if (session && session.user) {
      state.user = session.user;
      state.subscription = session.subscription;
      showAppShell();
      await refreshAccountSnapshot();
    } else {
      showAuthScreen('login');
    }

    // 4. Check VPN Status
    await checkVpnStatus();
  } catch (err) {
    console.warn('Initialization notice:', err);
    showAuthScreen('login');
  }
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
  document.getElementById('view-auth')?.classList.add('hidden');
  document.getElementById('view-app-shell')?.classList.remove('hidden');
  updateUserUi();
  updateSubscriptionUi();
  updatePricingMatrixUi();
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

  // Google sign in buttons
  document.getElementById('btn-google-login')?.addEventListener('click', handleGoogleAuth);
  document.getElementById('btn-google-register')?.addEventListener('click', handleGoogleAuth);
  document.getElementById('form-google')?.addEventListener('submit', handleGoogleSubmit);

  // Telegram login buttons
  document.getElementById('btn-tg-login-modal')?.addEventListener('click', startTelegramAuthFlow);
  document.getElementById('btn-tg-register-modal')?.addEventListener('click', startTelegramAuthFlow);
  document.getElementById('btn-submit-tg-login')?.addEventListener('click', handleTelegramLogin);
  document.getElementById('btn-toggle-manual-tg')?.addEventListener('click', () => {
    document.getElementById('tg-manual-box')?.classList.toggle('hidden');
  });

  // Sidebar navigation
  document.querySelectorAll('.sidebar-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // VPN connection toggle
  document.getElementById('vpn-power-ring')?.addEventListener('click', toggleVpn);
  document.getElementById('vpn-power-ring-off')?.addEventListener('click', toggleVpn);
  document.getElementById('btn-toggle-vpn')?.addEventListener('click', toggleVpn);

  // Server selection triggers
  document.getElementById('btn-open-server-picker')?.addEventListener('click', () => switchTab('tab-servers'));
  document.getElementById('btn-active-location-pill')?.addEventListener('click', () => switchTab('tab-servers'));
  document.getElementById('row-server-info')?.addEventListener('click', () => switchTab('tab-servers'));
  document.getElementById('btn-back-from-servers')?.addEventListener('click', () => switchTab('tab-home'));

  // Pricing / Subscription triggers
  document.getElementById('btn-home-activate-trial')?.addEventListener('click', handleActivateTrial);
  document.getElementById('btn-pricing-activate-trial')?.addEventListener('click', handleActivateTrial);
  document.getElementById('btn-home-all-tariffs')?.addEventListener('click', () => switchTab('tab-pricing'));
  document.getElementById('btn-open-manage-pricing')?.addEventListener('click', () => switchTab('tab-pricing'));
  document.getElementById('btn-acc-renew')?.addEventListener('click', () => switchTab('tab-pricing'));
  document.getElementById('btn-acc-manage')?.addEventListener('click', () => switchTab('tab-pricing'));

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
  document.querySelectorAll('.tariff-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.tariff-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.selectedPlanCode = card.dataset.plan;
    });
  });

  // Payment button
  document.getElementById('btn-pay-yookassa')?.addEventListener('click', handlePayYooKassa);

  // Support & FAQ triggers
  document.getElementById('btn-top-help')?.addEventListener('click', () => openModal('modal-faq'));
  document.getElementById('tile-faq-modal')?.addEventListener('click', () => openModal('modal-faq'));
  document.getElementById('btn-acc-open-support')?.addEventListener('click', handleOpenTelegramSupport);
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
  document.getElementById('set-background')?.addEventListener('change', (e) => handleSettingChange('stayConnectedInBackground', e.target.checked));
  document.getElementById('set-bypass')?.addEventListener('change', (e) => handleSettingChange('bypassRu', e.target.checked));
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
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    showToast('Введите email и пароль', true);
    return;
  }

  showToast('Вход в аккаунт...');
  try {
    const res = await invoke('auth_login', { email, password });
    state.user = res.user;
    state.subscription = res.subscription;
    showAppShell();
    showToast('Добро пожаловать в ByMeVPN!');
  } catch (err) {
    showToast(typeof err === 'string' ? err : 'Ошибка входа', true);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('register-name').value.trim() || 'Пользователь';
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const confirm = document.getElementById('register-password-confirm').value;

  if (!email || !password) {
    showToast('Заполните обязательные поля', true);
    return;
  }

  if (password !== confirm) {
    showToast('Пароли не совпадают', true);
    return;
  }

  showToast('Создание аккаунта...');
  try {
    const res = await invoke('auth_register', { email, password, name });
    state.user = res.user;
    state.subscription = res.subscription;
    showAppShell();
    showToast('Аккаунт успешно создан!');
  } catch (err) {
    showToast(typeof err === 'string' ? err : 'Ошибка регистрации', true);
  }
}

let tgPollingInterval = null;

function handleGoogleAuth() {
  openModal('modal-google');
}

async function handleGoogleSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('google-email')?.value.trim();
  const name = document.getElementById('google-name')?.value.trim() || '';

  if (!email || !email.includes('@')) {
    showToast('Введите корректный email Google', true);
    return;
  }

  showToast('Авторизация через Google...');
  try {
    const res = await invoke('auth_google', {
      email,
      name: name || undefined,
      idToken: `${email}:${name || 'Google User'}`
    });
    if (res && res.user) {
      state.user = res.user;
      state.subscription = res.subscription;
      closeModal('modal-google');
      showAppShell();
      showToast(`Добро пожаловать, ${state.user.name || state.user.email}!`);
      await refreshAccountSnapshot();
    }
  } catch (err) {
    showToast(typeof err === 'string' ? err : 'Не удалось войти через Google', true);
  }
}

async function startTelegramAuthFlow() {
  showToast('Подготовка авторизации через Telegram...');
  try {
    const res = await invoke('telegram_create_session');
    if (!res || !res.session_token || !res.bot_url) {
      showToast('Не удалось получить сессию Telegram', true);
      return;
    }

    openModal('modal-telegram');

    // Automatically open the bot link
    await invoke('open_external_url', { url: res.bot_url }).catch(() => window.open(res.bot_url, '_blank'));

    const reopenBtn = document.getElementById('btn-tg-reopen');
    if (reopenBtn) {
      reopenBtn.onclick = () => {
        invoke('open_external_url', { url: res.bot_url }).catch(() => window.open(res.bot_url, '_blank'));
      };
    }

    const statusEl = document.getElementById('tg-polling-status');
    if (statusEl) statusEl.textContent = 'Ожидание подтверждения от Telegram...';

    if (tgPollingInterval) clearInterval(tgPollingInterval);
    tgPollingInterval = setInterval(async () => {
      try {
        const check = await invoke('telegram_check_session', { sessionToken: res.session_token });
        if (check && (check.status === 'approved' || check.status === 'success') && check.auth) {
          clearInterval(tgPollingInterval);
          tgPollingInterval = null;
          state.user = check.auth.user;
          state.subscription = check.auth.subscription;
          closeModal('modal-telegram');
          showAppShell();
          showToast(`Вход через Telegram выполнен: ${state.user.name || 'Пользователь'}!`);
          await refreshAccountSnapshot();
        } else if (check && check.status === 'expired') {
          clearInterval(tgPollingInterval);
          tgPollingInterval = null;
          if (statusEl) statusEl.textContent = 'Время сессии истекло. Откройте бота ещё раз.';
        }
      } catch (e) {}
    }, 1500);

  } catch (err) {
    showToast(typeof err === 'string' ? err : 'Не удалось запустить вход через Telegram', true);
  }
}

async function handleTelegramLogin() {
  const url = document.getElementById('input-tg-sub-url').value.trim();
  if (!url) {
    showToast('Вставьте ссылку из Telegram-бота', true);
    return;
  }

  showToast('Проверка подписки Telegram...');
  try {
    const res = await invoke('telegram_login', {
      subscriptionUrl: url,
      name: 'Пользователь Telegram'
    });
    state.user = res.user;
    state.subscription = res.subscription;
    closeModal('modal-telegram');
    showAppShell();
    showToast('Подписка Telegram успешно активирована!');
    await refreshAccountSnapshot();
  } catch (err) {
    showToast(typeof err === 'string' ? err : 'Ошибка проверки ссылки', true);
  }
}

async function handleLogout() {
  showConfirm(
    'Выход из аккаунта',
    'Вы уверены, что хотите выйти из учётной записи ByMeVPN?',
    async () => {
      await invoke('auth_logout').catch(() => null);
      state.user = null;
      state.subscription = null;
      if (state.vpnConnected) {
        await invoke('vpn_stop').catch(() => null);
        state.vpnConnected = false;
      }
      showAuthScreen('login');
      showToast('Вы вышли из системы');
    }
  );
}

async function handleDeleteAccount() {
  showConfirm(
    'Удаление аккаунта',
    'Это действие необратимо. Все активные подписки и данные аккаунта будут удалены навсегда.',
    async () => {
      try {
        await invoke('delete_account');
        state.user = null;
        state.subscription = null;
        showAuthScreen('login');
        showToast('Аккаунт удалён');
      } catch (err) {
        showToast(typeof err === 'string' ? err : 'Не удалось удалить аккаунт', true);
      }
    }
  );
}

// VPN Lifecycle & Real-time Metrics
async function toggleVpn() {
  if (state.vpnConnected) {
    showToast('Отключение VPN...');
    try {
      await invoke('vpn_stop');
      state.vpnConnected = false;
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
    const hasActiveSub = sub && (sub.status === 'active' || sub.status === 'trial');
    if (!hasActiveSub) {
      showToast('Для подключения требуется активная подписка. Активируйте 3 дня за 1 ₽ или выберите тариф.', true);
      switchTab('tab-pricing');
      return;
    }

    showToast('Запуск туннеля Xray + Wintun...');
    try {
      const code = state.selectedServer.code === 'auto' ? null : state.selectedServer.code;
      const metrics = await invoke('vpn_start', { nodeCode: code });
      state.vpnConnected = true;
      state.connectedSeconds = 0;
      if (metrics) {
        state.metrics = metrics;
      }
      startLiveTimer();
      startStatusPolling();
      updateVpnUi();
      showToast('Защищённое подключение установлено!');
    } catch (err) {
      showToast(typeof err === 'string' ? err : 'Не удалось подключиться', true);
      updateVpnUi();
    }
  }
}

async function checkVpnStatus() {
  try {
    const status = await invoke('vpn_status');
    if (status && status.connected) {
      state.vpnConnected = true;
      state.connectedSeconds = status.connected_seconds || 0;
      state.metrics = status;
      startLiveTimer();
      startStatusPolling();
    } else {
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
  state.pollInterval = setInterval(async () => {
    if (state.vpnConnected && !document.hidden) {
      try {
        const status = await invoke('vpn_status');
        if (status) {
          state.metrics = status;
          updateMetricsUi();
        }
      } catch (err) {}
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
  } else if (state.vpnConnected && !state.pollInterval) {
    startStatusPolling();
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

// UI Updaters
function updateVpnUi() {
  const isConn = state.vpnConnected;
  const sub = state.subscription;
  const hasPlan = sub && (sub.status === 'active' || sub.status === 'trial');

  const connectedBox = document.getElementById('home-state-connected');
  const disconnectedBox = document.getElementById('home-state-disconnected');
  const activePill = document.getElementById('vpn-active-pill');

  if (isConn) {
    connectedBox?.classList.remove('hidden');
    disconnectedBox?.classList.add('hidden');
    activePill?.classList.remove('hidden');
  } else {
    connectedBox?.classList.add('hidden');
    disconnectedBox?.classList.remove('hidden');
    activePill?.classList.add('hidden');

    const desc = document.getElementById('home-off-desc');
    const btn = document.getElementById('vpn-btn-text');
    const promoBox = document.querySelector('.promo-trial-box');
    const ringOff = document.getElementById('vpn-power-ring-off');

    if (!hasPlan) {
      if (desc) desc.textContent = 'Нет активной подписки';
      if (btn) btn.textContent = 'Попробовать за 1 ₽';
      ringOff?.classList.add('ring-off');
      ringOff?.classList.remove('ring-ready');
      promoBox?.classList.remove('hidden');
    } else {
      if (desc) desc.textContent = 'Нажмите, чтобы подключиться';
      if (btn) btn.textContent = 'Подключиться';
      ringOff?.classList.remove('ring-off');
      ringOff?.classList.add('ring-ready');
      promoBox?.classList.add('hidden');
    }
  }

  // Update Server info in card
  const s = state.selectedServer;
  const flagEl = document.getElementById('conn-flag-chip');
  const nameEl = document.getElementById('conn-location-name');
  const homeFlag = document.getElementById('home-server-flag');
  const homeCountry = document.getElementById('home-server-country');
  const homeCity = document.getElementById('home-server-city');

  if (flagEl) flagEl.textContent = s.flag || '🇩🇪';
  if (nameEl) nameEl.textContent = s.name;
  if (homeFlag) homeFlag.textContent = s.flag || '🇩🇪';
  if (homeCountry) homeCountry.textContent = s.country === 'DE' ? 'Германия' : s.name.split('•')[0].trim();
  if (homeCity) homeCity.textContent = s.name.includes('•') ? s.name.split('•')[1].trim() : 'Автовыбор';

  updateMetricsUi();
}

function updateMetricsUi() {
  const m = state.metrics;
  const downEl = document.getElementById('metric-download');
  const upEl = document.getElementById('metric-upload');
  const pingEl = document.getElementById('metric-ping');

  if (downEl) downEl.textContent = `${m.download_mbps ? m.download_mbps.toFixed(1) : '92.4'} Мбит/с`;
  if (upEl) upEl.textContent = `${m.upload_mbps ? m.upload_mbps.toFixed(1) : '38.7'} Мбит/с`;
  if (pingEl) pingEl.textContent = `${m.ping_ms || 28} мс`;
}

function updateUserUi() {
  if (!state.user) return;
  const nameEl = document.getElementById('acc-user-name');
  const emailEl = document.getElementById('acc-user-email');

  if (nameEl) nameEl.textContent = state.user.name || 'Пользователь';
  if (emailEl) emailEl.textContent = state.user.email || 'ByMeVPN User';
}

function updateSubscriptionUi() {
  const sub = state.subscription;
  const hasPlan = sub && (sub.status === 'active' || sub.status === 'trial');

  const title = hasPlan
    ? (sub.plan_name || 'Подписка ByMeVPN')
    : 'Нет активной подписки';

  const expiry = hasPlan
    ? (sub.expires_at ? `Действует до ${sub.expires_at}` : 'Подписка активна')
    : 'Подписка не оформлена';

  const homeSubTitle = document.getElementById('home-sub-title');
  const homeSubExpiry = document.getElementById('home-sub-expiry');
  const homeSubBadge = document.getElementById('home-sub-badge');
  const accPlanName = document.getElementById('acc-plan-name');
  const accPlanValidity = document.getElementById('acc-plan-validity');
  const accPlanBadge = document.getElementById('acc-auto-renew-badge');
  const accRenewBtn = document.getElementById('btn-acc-renew');

  if (homeSubTitle) homeSubTitle.textContent = title;
  if (homeSubExpiry) homeSubExpiry.textContent = expiry;
  if (homeSubBadge) {
    homeSubBadge.textContent = hasPlan ? 'Активна' : 'Не активна';
    homeSubBadge.className = hasPlan ? 'badge-active-mini' : 'badge-inactive';
  }

  if (accPlanName) accPlanName.textContent = title;
  if (accPlanValidity) accPlanValidity.textContent = expiry;
  if (accPlanBadge) {
    accPlanBadge.textContent = hasPlan ? 'Автопродление включено' : 'Не активна';
    accPlanBadge.className = hasPlan ? 'badge-auto-renew' : 'badge-inactive';
  }

  if (accRenewBtn) {
    const renewText = accRenewBtn.querySelector('[data-i18n="renew"]') || accRenewBtn;
    renewText.textContent = hasPlan ? 'Продлить' : 'Оформить подписку';
  }
}

function updateDevicesUi() {
  const container = document.getElementById('acc-devices-list');
  if (!container) return;

  const ratioEl = document.getElementById('acc-devices-ratio');
  const sub = state.subscription;
  const maxDev = sub?.max_devices || 2;
  const devList = Array.isArray(state.devices) && state.devices.length > 0
    ? state.devices
    : [{
        id: 'current_pc',
        device_model: 'Windows • Этот компьютер',
        platform: 'Windows',
        last_active: 'Сейчас онлайн',
        is_current: true
      }];

  if (ratioEl) {
    ratioEl.textContent = `${devList.length} / ${maxDev}`;
  }

  container.innerHTML = '';
  devList.forEach(dev => {
    const row = document.createElement('div');
    row.className = 'glass-card device-item-row';
    row.dataset.deviceId = dev.id || '';

    const isCurrent = dev.is_current === true || dev.id === 'current_pc';
    const model = dev.device_model || dev.platform || 'Устройство';
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
          ${isCurrent ? '<span class="dot-green">●</span> Онлайн' : escapeHtml(dev.last_active || 'Недавно')}
        </span>
      </div>
      ${isCurrent
        ? '<span class="badge-current-device">Текущее устройство</span>'
        : `<button type="button" class="btn-disconnect-device" data-dev-id="${escapeHtml(dev.id)}"><span>⊘</span> Отключить</button>`
      }
    `;

    const disconnectBtn = row.querySelector('.btn-disconnect-device');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', () => handleDeleteDevice(dev.id, model));
    }

    container.appendChild(row);
  });
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
function updatePricingMatrixUi() {
  const dev = state.selectedDevicesCount || 2;
  const matrix = PRICING_MATRIX[dev] || PRICING_MATRIX[2];

  const pMonth = document.getElementById('price-month');
  const dMonth = document.getElementById('days-month');
  const pQuarter = document.getElementById('price-quarter');
  const rQuarter = document.getElementById('rate-quarter');
  const pHalf = document.getElementById('price-half_year');
  const rHalf = document.getElementById('rate-half_year');
  const pYear = document.getElementById('price-year');
  const rYear = document.getElementById('rate-year');

  if (pMonth) pMonth.textContent = `${matrix.month.price} ₽`;
  if (dMonth) dMonth.textContent = matrix.month.note;

  if (pQuarter) pQuarter.textContent = `${matrix.quarter.price} ₽`;
  if (rQuarter) rQuarter.textContent = matrix.quarter.note;

  if (pHalf) pHalf.textContent = `${matrix.half_year.price} ₽`;
  if (rHalf) rHalf.textContent = matrix.half_year.note;

  if (pYear) pYear.textContent = `${matrix.year.price} ₽`;
  if (rYear) rYear.textContent = matrix.year.note;
}

// Render Servers
function renderServersList(filter = '') {
  const container = document.getElementById('servers-dynamic-list');
  if (!container) return;
  container.innerHTML = '';

  const q = filter.toLowerCase().trim();
  const list = state.servers.filter(s => 
    !q || s.name.toLowerCase().includes(q) || s.country.toLowerCase().includes(q)
  );

  list.forEach(srv => {
    const isSel = state.selectedServer.code === srv.code;
    const card = document.createElement('div');
    card.className = `glass-card server-stack-item ${isSel ? 'selected' : ''}`;
    card.dataset.code = srv.code;
    card.innerHTML = `
      <span class="server-item-flag">${srv.flag || '🌐'}</span>
      <div class="server-item-text">
        <strong>${srv.name}</strong>
        <span>Основной шлюз • ${srv.country}</span>
      </div>
      <div class="server-ping-badge">
        <div class="signal-bars">
          <span class="signal-bar" style="height: 4px;"></span>
          <span class="signal-bar" style="height: 8px;"></span>
          <span class="signal-bar" style="height: 12px;"></span>
        </div>
        <span>${srv.ping || 28} мс</span>
      </div>
      <div class="radio-selection-dot"></div>
    `;

    card.addEventListener('click', () => {
      state.selectedServer = srv;
      document.querySelectorAll('.server-stack-item, .recommended-server-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      updateVpnUi();
      showToast(`Выбран сервер: ${srv.name}`);
      setTimeout(() => switchTab('tab-home'), 200);
    });

    container.appendChild(card);
  });
}

function filterServers(query) {
  renderServersList(query);
}

// Payment & Trial
async function handleActivateTrial() {
  showToast('Активация пробного периода за 1 ₽...');
  try {
    const res = await invoke('activate_trial');
    if (res) {
      state.subscription = res;
      updateSubscriptionUi();
    }
    showToast('Пробный период на 3 дня успешно активирован!');
    switchTab('tab-home');
  } catch (err) {
    showToast(typeof err === 'string' ? err : 'Не удалось активировать пробный период', true);
  }
}

async function handlePayYooKassa() {
  const plan = state.selectedPlanCode || 'year';
  const devices = state.selectedDevicesCount || 2;
  showToast('Формирование счёта ЮKassa...');
  try {
    const res = await invoke('create_payment', { planCode: plan, devices });
    const url = res?.confirmation_url || res?.payment_url || 'https://yookassa.ru';
    await invoke('open_external_url', { url }).catch(() => window.open(url, '_blank'));
    showToast('Страница оплаты открыта в браузере');
  } catch (err) {
    showToast('Не удалось открыть оплату через ЮKassa', true);
  }
}

// Settings Persistence
async function handleSettingChange(key, value) {
  state.settings[key] = value;
  await invoke('save_setting', { key, value }).catch(() => null);

  if (key === 'language') {
    applyLanguage(value);
  }

  if (key === 'autoStart') {
    await invoke('set_startup', { enabled: value }).catch(() => null);
  }

  showToast('Настройки сохранены');
}

function applySettingsToUi() {
  const s = state.settings;
  const setAuto = document.getElementById('set-autostart');
  const setBg = document.getElementById('set-background');
  const setBypass = document.getElementById('set-bypass');
  const setKill = document.getElementById('set-killswitch');

  if (setAuto) setAuto.checked = !!s.autoStart;
  if (setBg) setBg.checked = !!s.stayConnectedInBackground;
  if (setBypass) setBypass.checked = !!s.bypassRu;
  if (setKill) setKill.checked = !!s.killSwitch;

  const adRadio = document.querySelector(`input[name="adblock"][value="${s.adBlock || 'recommended'}"]`);
  if (adRadio) adRadio.checked = true;

  applyLanguage(s.language || 'ru');
}

function applyLanguage(lang) {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  const dict = I18N[lang] || I18N.ru;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (dict[key]) {
      el.textContent = dict[key];
    }
  });

  // Re-run tab title update
  switchTab(state.currentTab);
}

// Refresh Account Snapshot
async function refreshAccountSnapshot() {
  try {
    const data = await invoke('account_snapshot');
    if (data) {
      if (data.user) state.user = data.user;
      if (data.subscription) state.subscription = data.subscription;
      if (Array.isArray(data.devices)) state.devices = data.devices;
      updateUserUi();
      updateSubscriptionUi();
      updateDevicesUi();
      updateVpnUi();
    }
  } catch (err) {}
}

// External Links
async function handleOpenTelegramSupport() {
  const url = 'https://t.me/ByMeVPN_Support_bot';
  await invoke('open_external_url', { url }).catch(() => window.open(url, '_blank'));
}

// Modal Helpers
function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  if (id === 'modal-telegram' && tgPollingInterval) {
    clearInterval(tgPollingInterval);
    tgPollingInterval = null;
  }
  document.getElementById(id)?.classList.add('hidden');
}

function showConfirm(title, desc, onConfirm) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-desc').textContent = desc;
  const acceptBtn = document.getElementById('btn-confirm-accept');
  
  const handler = async () => {
    acceptBtn.removeEventListener('click', handler);
    closeModal('modal-confirm');
    await onConfirm();
  };
  acceptBtn.addEventListener('click', handler);
  openModal('modal-confirm');
}

function openLegalModal(type) {
  const modal = document.getElementById('modal-legal');
  const title = document.getElementById('legal-modal-title');
  const body = document.getElementById('legal-modal-body');

  if (type === 'privacy') {
    title.textContent = 'Политика конфиденциальности';
    body.innerHTML = `
      <p><strong>1. Общие положения</strong><br>ByMeVPN обеспечивает защиту персональных данных пользователей в соответствии с законодательством. Мы придерживаемся строгой политики приватности и минимального сбора данных.</p>
      <br>
      <p><strong>2. Обработка сетевого трафика</strong><br>Мы не ведём журналы активности пользователей (Zero Logs): адреса посещаемых сайтов, передаваемый контент и DNS-запросы не сохраняются и не передаются третьим лицам.</p>
      <br>
      <p><strong>3. Безопасность данных</strong><br>Все сессионные токены и ключи шифруются системным хранилищем Windows Credential Manager.</p>
    `;
  } else {
    title.textContent = 'Условия использования';
    body.innerHTML = `
      <p><strong>1. Предмет соглашения</strong><br>ByMeVPN предоставляет услуги защищённого шифрованного туннелирования интернет-трафика на основе протокола VLESS + XTLS Reality.</p>
      <br>
      <p><strong>2. Подписка и оплата</strong><br>Тарифы активируются сразу после подтверждения платежа провайдером. Автопродление может быть отключено в любой момент в личном кабинете без ограничений.</p>
      <br>
      <p><strong>3. Правила использования</strong><br>Запрещается использовать сервис для распространения вредоносного ПО, спама и незаконной деятельности.</p>
    `;
  }
  modal.classList.remove('hidden');
}

function showToast(text, isError = false) {
  const toast = document.getElementById('toast-notify');
  if (!toast) return;
  toast.textContent = text;
  toast.className = `toast-popup show ${isError ? 'error' : ''}`;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.className = 'toast-popup';
  }, 3200);
}

// Standalone Mock Fallback
function mockIpc(cmd, args) {
  switch (cmd) {
    case 'get_settings':
      return { autoStart: true, stayConnectedInBackground: true, bypassRu: true, adBlock: 'recommended', killSwitch: true, language: 'ru' };
    case 'get_servers':
      return DEFAULT_SERVERS;
    case 'restore_session':
      return {
        user: { id: 'usr-1', name: 'Arseniy', email: 'arseniy@example.com', is_google: false },
        subscription: { status: 'active', plan_name: 'Годовой', expires_at: '24.11.2026', seconds_remaining: 31536000 }
      };
    case 'vpn_status':
      return {
        connected: state.vpnConnected,
        connected_seconds: state.connectedSeconds,
        download_mbps: 92.4,
        upload_mbps: 38.7,
        ping_ms: 28,
        server_name: state.selectedServer.name,
        country: state.selectedServer.country,
        ip: '2.27.120.247'
      };
    case 'vpn_start':
      return { connected: true, download_mbps: 92.4, upload_mbps: 38.7, ping_ms: 28 };
    case 'vpn_stop':
      return true;
    default:
      return true;
  }
}
