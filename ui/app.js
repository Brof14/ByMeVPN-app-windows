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
  catalogReady: false,
  devicesSupported: false,
  preferredServerCode: 'auto',
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
    auto_renew_note: 'Подписка продлевается автоматически. Вы можете отменить продление в любой момент в настройках аккаунта.',
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
    delete_account: 'Удалить аккаунт',
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
    auto_renew_note: 'Subscription auto-renews. You can cancel at any time in account settings.',
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
    delete_account: 'Delete Account',
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
  const savedSettings = await invoke('get_settings').catch(() => null);
  if (savedSettings) {
    state.settings = { ...state.settings, ...savedSettings };
    state.preferredServerCode = savedSettings.selectedServerCode || 'auto';
  }
  applySettingsToUi();

  // Plans can be requested without an authenticated user. Never show stale
  // local price constants as a live checkout option.
  await loadPricingCatalog();
  let session = null;
  let restoreFailed = false;
  try {
    session = await invoke('restore_session');
  } catch (err) {
    restoreFailed = true;
  }
  if (session?.user) {
    state.user = session.user;
    state.subscription = session.subscription;
    showAppShell();
  } else {
    showAuthScreen('login');
    if (restoreFailed) showToast('Не удалось проверить сеанс: сеть или API недоступны. Повторите попытку.', true);
  }
  await checkVpnStatus();
}

async function loadAvailableServers() {
  try {
    const servers = await invoke('get_servers');
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
    state.servers = [];
    renderServersList();
    showToast('Не удалось загрузить реальные серверы. Проверьте соединение.', true);
  }
}

async function loadPricingCatalog() {
  state.catalogReady = false;
  try {
    const plans = await invoke('get_plans');
    const codes = ['month', 'quarter', 'half_year', 'year'];
    if (!Array.isArray(plans)) throw new Error('Missing plans');
    for (const code of codes) {
      const plan = plans.find(p => p.code === code);
      if (!Array.isArray(plan?.device_options)) throw new Error('No device-specific prices');
      for (const devices of [2, 5, 10]) {
        const choice = plan.device_options.find(o => o.devices === devices);
        if (!Number.isSafeInteger(choice?.price_rub) || choice.price_rub <= 0 ||
            !Number.isSafeInteger(choice?.days) || choice.days <= 0) {
          throw new Error('Incomplete price catalog');
        }
        PRICING_MATRIX[devices][code] = {
          price: choice.price_rub,
          days: choice.days,
          note: code === 'month' ? `${choice.days} дней` :
            `${Math.round(choice.price_rub / (choice.days / 30))} ₽ / месяц`
        };
      }
    }
    state.catalogReady = true;
  } catch (err) {
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
  document.getElementById('view-auth')?.classList.add('hidden');
  document.getElementById('view-app-shell')?.classList.remove('hidden');
  updateUserUi();
  updateSubscriptionUi();
  updatePricingMatrixUi();
  updateVpnUi();
  void refreshAccountSnapshot();
  void loadAvailableServers();
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

  // Google sign in buttons
  document.getElementById('btn-google-login')?.addEventListener('click', handleGoogleAuth);
  document.getElementById('btn-google-register')?.addEventListener('click', handleGoogleAuth);

  // Telegram login buttons
  document.getElementById('btn-tg-login-modal')?.addEventListener('click', startTelegramAuthFlow);
  document.getElementById('btn-tg-register-modal')?.addEventListener('click', startTelegramAuthFlow);
  document.getElementById('btn-submit-tg-login')?.addEventListener('click', handleTelegramLogin);
  document.getElementById('btn-toggle-manual-tg')?.addEventListener('click', () => {
    document.getElementById('tg-manual-box')?.classList.toggle('hidden');
  });

  // Manual key / subscription link entry (view-auth)
  document.getElementById('btn-toggle-manual-key')?.addEventListener('click', () => {
    const pane = document.getElementById('auth-manual-key-pane');
    const label = document.getElementById('manual-key-btn-text');
    if (pane) {
      pane.classList.toggle('hidden');
      const isHidden = pane.classList.contains('hidden');
      if (label) {
        label.textContent = isHidden ? 'Ввести ключ или ссылку вручную ▾' : 'Ввести ключ или ссылку вручную ▴';
      }
    }
  });

  document.getElementById('btn-submit-manual-key')?.addEventListener('click', async () => {
    const textarea = document.getElementById('input-manual-key-url');
    const keyUrl = textarea?.value?.trim();
    if (!keyUrl) {
      showToast('Вставьте HTTPS-ссылку подписки', true);
      return;
    }
    if (!keyUrl.startsWith('https://')) {
      showToast('Прямой импорт VLESS-ключей пока не поддерживается.', true);
      return;
    }
    showToast('Проверка ссылки подписки...');
    try {
      const res = await invoke('telegram_login', {
        subscriptionUrl: keyUrl,
        name: 'Пользователь ByMeVPN'
      });
      state.user = res.user;
      state.subscription = res.subscription;
      showAppShell();
      showToast('Ключ успешно активирован!');
      await refreshAccountSnapshot();
    } catch (err) {
      showToast(typeof err === 'string' ? err : 'Неверный формат ключа или ссылки', true);
    }
  });

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
  document.getElementById('btn-renewal-switch-pricing')?.addEventListener('click', () => switchTab('tab-pricing'));
  document.getElementById('row-open-advanced-settings')?.addEventListener('click', () => switchTab('tab-advanced'));

  // VPN connection toggle
  document.getElementById('vpn-power-ring')?.addEventListener('click', toggleVpn);
  document.getElementById('vpn-power-ring-off')?.addEventListener('click', toggleVpn);
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
    const url = 'https://t.me/bymevpn_channel';
    invoke('open_external_url', { url }).catch(() => window.open(url, '_blank'));
  });
  document.getElementById('card-support-faq')?.addEventListener('click', () => openModal('modal-faq'));

  // Telegram bot payment button
  document.getElementById('btn-pay-telegram-bot')?.addEventListener('click', () => {
    const url = 'https://t.me/ByMeVPNbot';
    invoke('open_external_url', { url }).catch(() => window.open(url, '_blank'));
  });

  // Paywall modal actions
  document.getElementById('btn-paywall-trial')?.addEventListener('click', () => {
    closeModal('modal-paywall');
    handleActivateTrial();
  });
  document.getElementById('btn-paywall-yookassa-action')?.addEventListener('click', () => {
    closeModal('modal-paywall');
    handlePayYooKassa();
  });
  document.getElementById('btn-paywall-tg-action')?.addEventListener('click', () => {
    closeModal('modal-paywall');
    const url = 'https://t.me/ByMeVPNbot';
    invoke('open_external_url', { url }).catch(() => window.open(url, '_blank'));
  });

  document.querySelectorAll('.paywall-mini-tariffs .tariff-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.paywall-mini-tariffs .tariff-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.selectedPlanCode = card.dataset.pwPlan || 'year';
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
        if (check && ['authenticated', 'approved', 'success'].includes(check.status) && check.auth) {
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
      if (state.vpnConnected) {
        try {
          await invoke('vpn_stop');
        } catch (err) {
          showToast('Не удалось остановить VPN перед выходом.', true);
          return;
        }
        state.vpnConnected = false;
      }
      await invoke('auth_logout');
      state.user = null;
      state.subscription = null;
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
        if (state.vpnConnected) await invoke('vpn_stop');
        await invoke('delete_account');
        state.vpnConnected = false;
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
  if (state.connectionBusy) return;
  state.connectionBusy = true;
  try {
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
    const hasActiveSub = sub && ['active', 'trial', 'grace'].includes(sub.status);
    if (!hasActiveSub) {
      showToast('Для подключения требуется активный доступ (3 дня бесплатно или тариф).');
      openModal('modal-paywall');
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
      showToast('Подключение проверено и установлено');
    } catch (err) {
      state.vpnConnected = false;
      showToast(typeof err === 'string' ? err : 'Не удалось подключиться', true);
      updateVpnUi();
    }
  }
  } finally {
    state.connectionBusy = false;
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
  const hasPlan = sub && ['active', 'trial', 'grace'].includes(sub.status);

  const noPlanBox = document.getElementById('home-state-no-plan');
  const connectedBox = document.getElementById('home-state-connected');
  const disconnectedBox = document.getElementById('home-state-disconnected');
  const activePill = document.getElementById('vpn-active-pill');

  if (isConn) {
    noPlanBox?.classList.add('hidden');
    connectedBox?.classList.remove('hidden');
    disconnectedBox?.classList.add('hidden');
    activePill?.classList.remove('hidden');
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

    if (desc) desc.textContent = 'Нажмите, чтобы подключиться';
    if (btn) btn.textContent = 'Подключиться';
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
  if (nameEl) nameEl.textContent = s.name;
  if (homeFlag) homeFlag.textContent = s.flag || '🌐';
  if (homeCountry) homeCountry.textContent = s.code === 'auto' ? 'Автоматически' : s.name.split('•')[0].trim();
  if (homeCity) homeCity.textContent = s.name.includes('•') ? s.name.split('•')[1].trim() : 'Автовыбор';

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

  if (downEl) downEl.textContent = m.download_mbps > 0 ? `${m.download_mbps.toFixed(1)} Мбит/с` : '—';
  if (upEl) upEl.textContent = m.upload_mbps > 0 ? `${m.upload_mbps.toFixed(1)} Мбит/с` : '—';
  if (pingEl) pingEl.textContent = m.ping_ms > 0 ? `${m.ping_ms} мс` : '—';
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
  const hasPlan = sub && ['active', 'trial', 'grace'].includes(sub.status);

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
  const accPlanBadge = document.getElementById('acc-autorenew-badge');
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
    accPlanBadge.textContent = sub?.auto_renew === true ? 'Автопродление включено' :
      sub?.auto_renew === false ? 'Автопродление выключено' : 'Статус автопродления неизвестен';
    accPlanBadge.className = sub?.auto_renew === true ? 'badge-auto-renew' : 'badge-inactive';
  }

  if (accRenewBtn) {
    const renewText = accRenewBtn.querySelector('[data-i18n="renew"]') || accRenewBtn;
    renewText.textContent = hasPlan ? 'Продлить' : 'Оформить подписку';
  }

  const renewalBadge = document.getElementById('renewal-current-status-badge');
  if (renewalBadge) {
    renewalBadge.textContent = sub?.auto_renew === true ? 'Включено' :
      sub?.auto_renew === false ? 'Отключено' : 'Неизвестно';
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
    ratioEl.textContent = state.devicesSupported ? `${devList.length} / ${maxDev ?? '—'}` : 'Недоступно';
  }
  if (heroCurrent) heroCurrent.textContent = state.devicesSupported ? String(devList.length) : '—';
  if (heroMax) heroMax.textContent = state.devicesSupported ? String(maxDev ?? '—') : '—';

  const createDeviceRow = (dev) => {
    const row = document.createElement('div');
    row.className = 'glass-card device-item-row';
    row.dataset.deviceId = dev.id || '';

    const isCurrent = dev.is_current === true;
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
      if (element) element.textContent = 'Управление устройствами пока недоступно на сервере.';
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
function updatePricingMatrixUi() {
  document.getElementById('btn-pay-yookassa')?.toggleAttribute('disabled', !state.catalogReady);
  document.getElementById('btn-paywall-yookassa-action')?.toggleAttribute('disabled', !state.catalogReady);
  const dev = state.selectedDevicesCount || 2;
  const matrix = PRICING_MATRIX[dev] || PRICING_MATRIX[2];
  if (!state.catalogReady) {
    for (const card of document.querySelectorAll('.paywall-mini-tariffs .tariff-card')) {
      const price = card.querySelector('.tariff-price-bold');
      if (price) price.textContent = '—';
    }
    for (const id of ['price-month', 'price-quarter', 'price-half_year', 'price-year']) {
      const element = document.getElementById(id);
      if (element) element.textContent = '—';
    }
    return;
  }

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
  document.querySelectorAll('.paywall-mini-tariffs .tariff-card').forEach(card => {
    const entry = matrix[card.dataset.pwPlan];
    if (!entry) return;
    const price = card.querySelector('.tariff-price-bold');
    const note = card.querySelector('.tariff-subnote');
    if (price) price.textContent = `${entry.price} ₽`;
    if (note) note.textContent = entry.note;
  });
}

// Render Servers
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
    empty.textContent = 'Доступных серверов нет. Проверьте подписку и соединение.';
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
    title.textContent = srv.name || srv.code;
    const subtitle = document.createElement('span');
    subtitle.textContent = srv.supported === false ? 'Этот протокол пока не поддерживается' : (srv.country || 'Доступная локация');
    details.append(title, subtitle);
    const ping = document.createElement('span');
    ping.className = 'server-ping-badge';
    ping.textContent = srv.ping > 0 ? `${srv.ping} мс` : '—';
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
      showToast(`Выбран сервер: ${srv.name || srv.code}`);
      switchTab('tab-home');
    });
    container.appendChild(card);
  });
}

function filterServers(query) {
  renderServersList(query);
}

// Payment & Trial
async function handleActivateTrial() {
  showToast('Активация 3 дней бесплатного доступа...');
  try {
    const res = await invoke('activate_trial');
    if (!res || !['active', 'trial', 'grace'].includes(res.status)) {
      throw new Error('Сервер не подтвердил активацию пробного периода');
    }
    state.subscription = res;
    updateSubscriptionUi();
    updateVpnUi();
    void loadAvailableServers();
    showToast('Пробный период на 3 дня успешно активирован (0 ₽)!');
    switchTab('tab-home');
  } catch (err) {
    showToast(typeof err === 'string' ? err : 'Не удалось активировать пробный период', true);
  }
}

async function handlePayYooKassa() {
  if (!state.catalogReady) {
    showToast('Тарифы сейчас недоступны. Повторите загрузку позже.', true);
    return;
  }
  const plan = state.selectedPlanCode || 'year';
  const devices = state.selectedDevicesCount || 2;
  const selected = PRICING_MATRIX[devices]?.[plan];
  if (!selected || !selected.days) return;
  showToast('Формирование счёта ЮKassa...');
  const previousExpiry = state.subscription?.expires_at ?? null;
  const previousStatus = state.subscription?.status ?? 'none';
  try {
    const res = await invoke('create_payment', {
      planCode: plan, devices, amountRub: selected.price, days: selected.days
    });
    const url = res?.confirmation_url || res?.payment_url;
    if (!url || !url.startsWith('https://')) throw new Error('Сервер не вернул защищённую ссылку оплаты');
    await invoke('open_external_url', { url });
    showToast('Ожидаем подтверждение оплаты от сервера');
    // A browser opening is not a successful payment. The server is authoritative.
    for (let attempt = 0; attempt < 24; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const result = await invoke('check_payment');
      if (result?.subscription) {
        const updated = result.subscription;
        const changed = updated.expires_at !== previousExpiry ||
          (!['active', 'trial', 'grace'].includes(previousStatus) &&
           ['active', 'trial', 'grace'].includes(updated.status));
        if (changed) {
          await refreshAccountSnapshot();
          showToast('Статус подписки обновлён. Проверьте срок действия.');
          return;
        }
      }
    }
    showToast('Оплата пока не подтверждена. Проверить статус можно в аккаунте.');
  } catch (err) {
    showToast(typeof err === 'string' ? err : 'Не удалось проверить платёж.', true);
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
  const setBg = document.getElementById('set-background');
  const setBypass = document.getElementById('set-bypass');
  const setKill = document.getElementById('set-killswitch');

  if (setAuto) setAuto.checked = !!s.autoStart;
  if (setBg) setBg.checked = false;
  if (setBypass) setBypass.checked = !!s.bypassRu;
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
      state.devicesSupported = data.devices_supported !== false;
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

// Standalone Fallback: Safe offline/unauthenticated state (Zero fake accounts/subscriptions)
function mockIpc(cmd, _args) {
  switch (cmd) {
    case 'get_settings':
      return { autoStart: true, stayConnectedInBackground: true, bypassRu: true, adBlock: 'recommended', killSwitch: true, language: 'ru' };
    case 'get_servers':
      return [];
    case 'get_plans':
      return [];
    case 'restore_session':
      return null;
    case 'account_snapshot':
      return { user: null, subscription: null, devices: [] };
    case 'vpn_status':
      return {
        connected: false,
        connected_seconds: 0,
        download_mbps: null,
        upload_mbps: null,
        ping_ms: null,
        server_name: '',
        country: '',
        ip: ''
      };
    case 'vpn_stop':
      return true;
    default:
      return null;
  }
}
