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
  serverSwitchBusy: false,
  vpnSequence: 0,
  connectionError: null,
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
    language: 'system'
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
    trial_description_short: "Три дня доступа к доступным серверам. Без оплаты и привязки карты.",
    paywall_premium: "ПРЕМИУМ",
    gift_three_months: "+ 3 в подарок",
    duration_30days: "30 дней",
    back_to_settings: "Назад к настройкам",
    back: "Назад",
    telegram_opened_bot: "Откройте Telegram-бота",
    telegram_finish_login: "Нажмите START или подтвердите вход в боте.",
    trial_activate_three: "Активировать 3 дня бесплатно",
    back_to_account: "Назад к аккаунту",
    settings_headline: "Приложение работает за вас.",
    settings_intro: "Основные настройки уже подобраны. При желании их можно изменить.",
    settings_connection_label: "Подключение",
    settings_language_section: "Язык приложения",
    settings_default_tip: "Не уверены, что выбрать? Оставьте настройки по умолчанию.",
    settings_more_title: "Дополнительные настройки",
    advanced_desktop_title: "Настройки Windows",
    advanced_desktop_intro: "Дополнительные параметры для компьютера.",
    window_minimize: "Свернуть",
    window_maximize: "Развернуть",
    window_close: "Закрыть",
    help_tooltip: "Помощь",
    vpn_toggle_label: "Переключить VPN",
    routing_settings_tooltip: "Настройки маршрутизации",
    trial_badge_simple: "3 ДНЯ БЕСПЛАТНО",
    trial_try_byme: "Попробуйте ByMeVPN бесплатно",
    trial_no_card: "БЕЗ ПРИВЯЗКИ КАРТЫ",
    trial_try_three: "Попробуйте 3 дня бесплатно",
    trial_all_locations: "Полный доступ ко всем локациям для новых пользователей",
    trial_no_cancel: "Все серверы сразу • Без оплаты и карты",
    background_unavailable_tip: "Фоновый режим требует Windows Service",
    killswitch_unavailable_tip: "Полная аварийная защита пока не реализована",
    renewal_disclaimer: "Условия продления определяются при оплате. Если управление недоступно в приложении, обратитесь в поддержку.",
    renewal_select_plan: "Выбрать или продлить тариф",
    support_bonus_explained: "Нашли ошибку или придумали улучшение? Напишите нам в поддержку.",
    support_open_telegram: "Написать в поддержку",
    paywall_activate_title: "Активируйте ByMeVPN",
    paywall_trial_desc: "Без привязки карты • Все серверы сразу",
    paywall_choose_plan: "Или выберите тариф:",
    paywall_pay_yookassa: "Оплатить через ЮKassa",
    paywall_pay_telegram: "Оплатить через Telegram-бота",
    telegram_auth_confirm: "Подтвердите вход в Telegram-боте",
    telegram_auth_open: "Открыть бота в Telegram",
    paywall_12months: "12 месяцев",
    paywall_1month: "1 месяц",
    system_language: 'Системный',
    subpage_devices_title: "Мои устройства",
    devices_of: "из",
    devices_stat_label: "Устройства этого аккаунта",
    devices_stat_hint: "Количество подключённых устройств ограничено вашим тарифом.",
    devices_connected_label: "ПОДКЛЮЧЁННЫЕ УСТРОЙСТВА",
    renewal_title: "Автопродление",
    renewal_heading: "Автопродление подписки",
    renewal_unavailable: "Статус уточняется",
    support_page_title: "Помощь",
    support_hero_title: "Мы рядом, если нужна помощь",
    support_resources: "ПОЛЕЗНОЕ",
    support_faq_title: "Ответы на вопросы",
    support_faq_desc: "Оплата, подключение и устройства",
    support_news_title: "Новости ByMeVPN",
    support_news_desc: "Обновления и новые локации",
    advanced_page_title: "Дополнительные настройки",
    advanced_engine_title: "Параметры Xray и Wintun",
    advanced_engine_desc: "Сведения о системном VPN-туннеле",
    advanced_driver_title: "Сетевой драйвер Wintun",
    advanced_driver_desc: "Драйвер TUN для Windows x64",
    advanced_dns_wfp_title: "Защита DNS (WFP)",
    advanced_dns_wfp_desc: "Работа DNS зависит от маршрутов Windows; требуется проверка",
    advanced_unverified: "Не проверено",
    advanced_route_title: "Маршрут к VPN-серверу",
    advanced_route_desc: "Прямое соединение с VPN-сервером, чтобы избежать зацикливания",
    advanced_configured: "Настроено в Xray",
    advanced_lan_title: "Локальные сети напрямую",
    advanced_lan_desc: "Частные IP-адреса открываются напрямую",
    paywall_speed_claim: "Скорость зависит от сети и сервера",
    paywall_dns_claim: "DNS-фильтрация зависит от выбранного режима",
    paywall_subtitle_safe: "Доступ к совместимым VPN-серверам без сложной настройки",

    no_plan_title_line1: "VPN для ваших устройств",
    account_subscription_eyebrow: "ПОДПИСКА BYMEVPN",
    account_days_suffix: " дн.",
    account_days_caption: "до окончания доступа",
    account_your_plan: "Ваш тариф",
    account_renew_subscription: "Продлить подписку",
    account_access_eyebrow: "ВАШ ДОСТУП",
    account_inactive_title: "Подписка не активна",
    account_inactive_desc: "Оформите подписку, чтобы подключаться к серверам ByMeVPN.",
    account_free_trial: "3 дня бесплатно",
    account_view_plans: "Посмотреть тарифы",
    account_management_section: "Управление",
    account_settings_subtitle: "Профиль, устройства, подписка",
    account_manage_renewal: "Автопродление",
    account_settings_overline: "ВАШ ПРОФИЛЬ",
    account_settings_intro: "Управляйте подпиской и безопасностью аккаунта.",
    account_settings_identity: "Профиль",
    account_settings_billing: "Подписка",
    account_settings_app: "Приложение",
    account_settings_help: "Помощь",
    account_settings_security: "Безопасность",
    account_settings_refresh_desc: "Получить актуальные данные аккаунта",
    account_settings_copy_desc: "Идентификатор для поддержки",
    account_settings_billing_desc: "Статус и условия продления",
    account_settings_app_desc: "Подключение, язык и параметры",
    account_settings_advanced_desc: "Сеть, маршруты и диагностика",
    account_settings_help_desc: "Связаться со службой поддержки",
    account_settings_logout_desc: "Завершить текущий сеанс",
    account_settings_delete_desc: "Запросить удаление через поддержку",
    language_short_title: "Язык",
    language_dialog_title: "Язык приложения",
    language_dialog_desc: "Выберите язык приложения.",
    pricing_choose_plan: "Выберите тариф",
    pricing_one_plan: "Одна подписка для всех ваших устройств",
    pricing_devices_kicker: "СКОЛЬКО УСТРОЙСТВ?",
    pricing_term_kicker: "СРОК ПОДПИСКИ",
    pricing_payment_kicker: "СПОСОБ ОПЛАТЫ",
    pricing_payment_method: "Карта или СБП через ЮKassa",
    pricing_total: "Итого",
    pricing_pay_action: "Оплатить",
    pricing_secure: "Безопасная оплата через ЮKassa",
    server_sheet_title: "Серверы",
    server_sheet_desc: "Выберите страну или доверьтесь автоматике.",
    server_sheet_footnote: "Отображаются только серверы, доступные по вашей подписке.",
    home_connection_kicker: "ВАШЕ ПОДКЛЮЧЕНИЕ",
    vpn_unverified_help: "Xray работает, но маршрут и внешний IP не подтверждены. Проверьте соединение перед передачей важных данных.",
    vpn_health_action: "Диагностика соединения",
    vpn_health_title: "Проверка подключения",
    vpn_health_desc: "Проверка выполняется локально. Пароли и ключи не отображаются.",
    vpn_health_refresh: "Проверить повторно",
    home_location_title: "МЕСТОПОЛОЖЕНИЕ",
    no_plan_title_line2: "Одно касание.",
    no_plan_desc: "Подключайтесь, когда вам нужен VPN.",
    no_plan_perk_connection: "VPN-подключение",
    no_plan_perk_simple: "Простое управление",
    no_plan_trial_badge: "3 ДНЯ БЕСПЛАТНО",
    no_plan_trial_heading: "3 дня бесплатно",
    no_plan_trial_desc: "Попробуйте сервис перед покупкой.",
    no_plan_trial_button: "Активировать бесплатно",
    no_plan_pricing_button: "Посмотреть все тарифы",
    pay_telegram_bot: "Оплатить через Telegram-бота",
    feature_speed_title: "Скорость зависит от сервера и сети",
    feature_speed_desc: "Реальная скорость зависит от вашего подключения",
    feature_protocol_title: "VLESS + Reality",
    feature_protocol_desc: "Доступен на совместимых серверах Windows",
    feature_adblock_title: "Блокировка рекламы",
    feature_adblock_desc: "Выберите режим фильтрации в настройках",
    feature_devices_title: "Тарифы на 2, 5 и 10 устройств",
    feature_devices_desc: "Лимит зависит от выбранного тарифа",
    refresh_servers: "Обновить серверы",
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
    nav_connection: 'Главная',
    nav_account: 'Аккаунт',
    nav_settings: 'Настройки',
    protection_active: 'Внешний IP подтверждён',
    vpn_connected: 'VPN запущен',
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
    plan_3m: '3 + 1 месяц',
    plan_6m: '6 + 2 месяца',
    plan_12m: '12 + 3 месяца',
    plus_1_gift: '+ 1 в подарок',
    plus_2_gift: '+ 2 в подарок',
    plus_3_gift: '+ 3 в подарок',
    best_price: 'ЛУЧШАЯ ЦЕНА',
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
    faq_a3: 'Откройте «Аккаунт» → «Управлять подпиской». Пока отключение в приложении недоступно, обратитесь в поддержку. Условия платежей зависят от вашего заказа.',
    cancel: 'Отмена',
    confirm: 'Подтвердить'
  },
  en: {
    trial_description_short: "Three days of access to available servers. No payment or card required.",
    paywall_premium: "PREMIUM",
    gift_three_months: "+ 3 bonus months",
    duration_30days: "30 days",
    back_to_settings: "Back to settings",
    back: "Back",
    telegram_opened_bot: "Open Telegram bot",
    telegram_finish_login: "Press START or confirm the sign-in in the bot.",
    trial_activate_three: "Activate 3 free days",
    back_to_account: "Back to account",
    settings_headline: "The app works for you.",
    settings_intro: "The defaults are ready to use. You can change them here.",
    settings_connection_label: "Connection",
    settings_language_section: "App language",
    settings_default_tip: "Not sure? Keep the default settings.",
    settings_more_title: "Advanced settings",
    advanced_desktop_title: "Windows settings",
    advanced_desktop_intro: "More options for your computer.",
    window_minimize: "Minimize",
    window_maximize: "Maximize",
    window_close: "Close",
    help_tooltip: "Help",
    vpn_toggle_label: "Toggle VPN",
    routing_settings_tooltip: "Routing settings",
    trial_badge_simple: "3 DAYS FREE",
    trial_try_byme: "Try ByMeVPN for free",
    trial_no_card: "NO CREDIT CARD",
    trial_try_three: "Try 3 days free",
    trial_all_locations: "Access all available locations for new users",
    trial_no_cancel: "All servers • No payment or card",
    background_unavailable_tip: "Background mode requires Windows Service",
    killswitch_unavailable_tip: "A full kill switch is not implemented yet",
    renewal_disclaimer: "Renewal terms depend on your checkout. Contact support if in-app management is unavailable.",
    renewal_select_plan: "Choose or renew a plan",
    support_bonus_explained: "Found a bug or have an improvement idea? Contact support.",
    support_open_telegram: "Contact support",
    paywall_activate_title: "Activate ByMeVPN",
    paywall_trial_desc: "No card required • All servers",
    paywall_choose_plan: "Or choose a plan:",
    paywall_pay_yookassa: "Pay with YooKassa",
    paywall_pay_telegram: "Pay via Telegram bot",
    telegram_auth_confirm: "Confirm sign-in in Telegram",
    telegram_auth_open: "Open Telegram bot",
    paywall_12months: "12 months",
    paywall_1month: "1 month",
    system_language: 'System',
    subpage_devices_title: "My devices",
    devices_of: "of",
    devices_stat_label: "Devices on this account",
    devices_stat_hint: "Your plan limits the number of connected devices.",
    devices_connected_label: "CONNECTED DEVICES",
    renewal_title: "Auto-renewal",
    renewal_heading: "Subscription auto-renewal",
    renewal_unavailable: "Status unavailable",
    support_page_title: "Support",
    support_hero_title: "We are here to help",
    support_resources: "USEFUL LINKS",
    support_faq_title: "Frequently asked questions",
    support_faq_desc: "Payments, connection and devices",
    support_news_title: "ByMeVPN news",
    support_news_desc: "Updates and new locations",
    advanced_page_title: "Advanced settings",
    advanced_engine_title: "Xray and Wintun settings",
    advanced_engine_desc: "System VPN tunnel details",
    advanced_driver_title: "Wintun network driver",
    advanced_driver_desc: "TUN driver for Windows x64",
    advanced_dns_wfp_title: "DNS protection (WFP)",
    advanced_dns_wfp_desc: "DNS routing depends on Windows and requires testing",
    advanced_unverified: "Not verified",
    advanced_route_title: "VPN server route",
    advanced_route_desc: "Direct VPN server route to avoid tunneling loops",
    advanced_configured: "Configured in Xray",
    advanced_lan_title: "Direct local networks",
    advanced_lan_desc: "Private IP addresses use direct routes",
    paywall_speed_claim: "Speed depends on your network and server",
    paywall_dns_claim: "DNS filtering depends on the selected mode",
    paywall_subtitle_safe: "Compatible VPN servers without complex setup",

    no_plan_title_line1: "VPN for your devices",
    account_subscription_eyebrow: "BYMEVPN SUBSCRIPTION",
    account_days_suffix: " days",
    account_days_caption: "until access expires",
    account_your_plan: "Your plan",
    account_renew_subscription: "Renew subscription",
    account_access_eyebrow: "YOUR ACCESS",
    account_inactive_title: "Subscription inactive",
    account_inactive_desc: "Choose a plan to connect to ByMeVPN servers.",
    account_free_trial: "3 days free",
    account_view_plans: "View plans",
    account_management_section: "Management",
    account_settings_subtitle: "Profile, devices, subscription",
    account_manage_renewal: "Auto-renewal",
    account_settings_overline: "YOUR PROFILE",
    account_settings_intro: "Manage your subscription and account security.",
    account_settings_identity: "Profile",
    account_settings_billing: "Subscription",
    account_settings_app: "Application",
    account_settings_help: "Help",
    account_settings_security: "Security",
    account_settings_refresh_desc: "Fetch the latest account details",
    account_settings_copy_desc: "Identifier for contacting support",
    account_settings_billing_desc: "Renewal status and terms",
    account_settings_app_desc: "Connection, language and preferences",
    account_settings_advanced_desc: "Network, routing and diagnostics",
    account_settings_help_desc: "Contact support",
    account_settings_logout_desc: "End the current session",
    account_settings_delete_desc: "Request account removal through support",
    language_short_title: "Language",
    language_dialog_title: "App language",
    language_dialog_desc: "Choose the app language.",
    pricing_choose_plan: "Choose a plan",
    pricing_one_plan: "One plan for all your devices",
    pricing_devices_kicker: "HOW MANY DEVICES?",
    pricing_term_kicker: "SUBSCRIPTION LENGTH",
    pricing_payment_kicker: "PAYMENT METHOD",
    pricing_payment_method: "Card or SBP via YooKassa",
    pricing_total: "Total",
    pricing_pay_action: "Pay",
    pricing_secure: "Secure checkout via YooKassa",
    server_sheet_title: "Servers",
    server_sheet_desc: "Choose a country or use automatic selection.",
    server_sheet_footnote: "Only servers in your subscription are shown.",
    home_connection_kicker: "YOUR CONNECTION",
    vpn_unverified_help: "Xray is running, but routing and the external IP are unverified. Check connectivity before transferring sensitive data.",
    vpn_health_action: "Connection diagnostics",
    vpn_health_title: "Connection diagnostics",
    vpn_health_desc: "Local checks only. Passwords and keys are not displayed.",
    vpn_health_refresh: "Check again",
    home_location_title: "LOCATION",
    no_plan_title_line2: "One tap away.",
    no_plan_desc: "Connect whenever you need a VPN.",
    no_plan_perk_connection: "VPN connection",
    no_plan_perk_simple: "Simple controls",
    no_plan_trial_badge: "3 DAYS FREE",
    no_plan_trial_heading: "3 days free",
    no_plan_trial_desc: "Try the service before buying.",
    no_plan_trial_button: "Activate free trial",
    no_plan_pricing_button: "Explore all plans",
    pay_telegram_bot: "Pay via Telegram bot",
    feature_speed_title: "Speed depends on your server and network",
    feature_speed_desc: "Actual speeds depend on your connection",
    feature_protocol_title: "VLESS + Reality",
    feature_protocol_desc: "Available on compatible Windows servers",
    feature_adblock_title: "Ad blocking",
    feature_adblock_desc: "Choose a filtering mode in Settings",
    feature_devices_title: "Plans for 2, 5 or 10 devices",
    feature_devices_desc: "The limit depends on your plan",
    refresh_servers: "Refresh servers",
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
    nav_connection: 'Home',
    nav_account: 'Account',
    nav_settings: 'Settings',
    protection_active: 'Exit IP verified',
    vpn_connected: 'VPN started',
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
    plan_3m: '3 + 1 months',
    plan_6m: '6 + 2 months',
    plan_12m: '12 + 3 months',
    plus_1_gift: '+ 1 free month',
    plus_2_gift: '+ 2 free months',
    plus_3_gift: '+ 3 free months',
    best_price: 'BEST VALUE',
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
  // Autostart is owned by the Windows Run registry key, not by settings.json.
  // Read both without delaying startup with sequential calls; never report a
  // stale enabled switch when Windows has disabled that executable.
  const [savedSettings, nativeStartupEnabled] = await Promise.all([
    invoke('get_settings').catch(() => null),
    invoke('startup_enabled').catch(() => null)
  ]);
  if (savedSettings) {
    state.settings = { ...state.settings, ...savedSettings };
    state.preferredServerCode = savedSettings.selectedServerCode || 'auto';
  }
  if (typeof nativeStartupEnabled === 'boolean') {
    state.settings.autoStart = nativeStartupEnabled;
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
    // Never relabel a live tunnel when the server catalog refreshes.
    // The selected endpoint changes only after a successful stop/switch flow.
    if (!state.vpnConnected && !state.connectionBusy) {
      state.selectedServer = preferred || {
        code: 'auto', name: 'Автоматически', country: '', flag: '🌐', ping: 0
      };
    }
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

  // Android keeps the originating bottom tab selected on secondary screens.
  const rootTab = ['tab-servers', 'tab-pricing'].includes(tabId) ? 'tab-home'
    : ['tab-devices', 'tab-renewal', 'tab-support'].includes(tabId) ? 'tab-account'
    : tabId === 'tab-advanced' ? 'tab-settings' : tabId;
  document.querySelectorAll('.sidebar-tab').forEach(btn => {
    const selected = btn.dataset.tab === rootTab;
    btn.classList.toggle('active', selected);
    if (selected) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  // Update tab content visibility
  document.querySelectorAll('.tab-content').forEach(tab => {
    // Android's server picker is a bottom sheet over the existing Home.
    tab.classList.toggle('active', tab.id === tabId || (tabId === 'tab-servers' && tab.id === 'tab-home'));
  });

  // Update top header title
  const titleEl = document.getElementById('page-title');
  const lang = effectiveLanguage();
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

  // Android uses the shield brand instead of a duplicate "Home" headline.
  document.getElementById('mobile-header-brand')?.classList?.toggle('hidden', tabId !== 'tab-home');
  titleEl?.classList?.toggle('hidden', tabId === 'tab-home');
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

  // Match Android's tappable cards with accessible desktop keyboard actions.
  // VPN rings already have dedicated keyboard handling further below.
  document.querySelectorAll('[role="button"][tabindex="0"]').forEach(element => {
    if (element.id === 'vpn-power-ring' || element.id === 'vpn-power-ring-off') return;
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        element.click();
      }
    });
  });

  // Password visibility toggles
  document.querySelectorAll('.btn-password-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const box = btn.closest('.input-field-box');
      const input = box?.querySelector('input');
      if (input) {
        const visible = input.type === 'password';
        input.type = visible ? 'text' : 'password';
        btn.textContent = visible ? '🙈' : '👁';
        btn.setAttribute('aria-pressed', String(visible));
        btn.setAttribute('aria-label', visible
          ? uiText('Скрыть пароль', 'Hide password')
          : uiText('Показать пароль', 'Show password'));
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
  document.getElementById('btn-account-settings-open')?.addEventListener('click', () => openModal('modal-account-settings'));
  document.getElementById('btn-language-dialog')?.addEventListener('click', () => openModal('modal-language'));
  document.getElementById('btn-account-trial')?.addEventListener('click', handleActivateTrial);
  document.getElementById('btn-account-pricing')?.addEventListener('click', () => switchTab('tab-pricing'));
  document.getElementById('btn-pricing-back')?.addEventListener('click', () => switchTab('tab-home'));
  document.getElementById('btn-renewal-switch-pricing')?.addEventListener('click', () => switchTab('tab-pricing'));
  document.getElementById('row-open-advanced-settings')?.addEventListener('click', () => switchTab('tab-advanced'));

  // Android's exact drawable is primary. Keep the built-in vector shield
  // available if an installation unexpectedly cannot load its bundled PNG.
  document.querySelectorAll('.vpn-shield-image').forEach(img => {
    const showVectorFallback = () => {
      img.style.display = 'none';
      img.nextElementSibling?.classList?.add('is-fallback-visible');
    };
    img.addEventListener('error', showVectorFallback, { once: true });
    if (img.complete && img.naturalWidth === 0) showVectorFallback();
  });

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
  document.getElementById('btn-toggle-vpn')?.addEventListener('click', () => {
    if (!state.vpnConnected && (!state.subscription || state.subscription.status === 'unknown')) {
      void refreshAccountSnapshot(true);
    } else {
      void toggleVpn();
    }
  });

  // Server selection triggers
  document.getElementById('btn-open-server-picker')?.addEventListener('click', () => switchTab('tab-servers'));
  document.getElementById('btn-active-location-pill')?.addEventListener('click', () => switchTab('tab-servers'));
  document.getElementById('row-server-info')?.addEventListener('click', () => switchTab('tab-servers'));
  document.getElementById('btn-back-from-servers')?.addEventListener('click', () => switchTab('tab-home'));
  document.getElementById('tab-servers')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) switchTab('tab-home');
  });
  document.getElementById('btn-refresh-servers')?.addEventListener('click', async () => {
    const button = document.getElementById('btn-refresh-servers');
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
      await loadAvailableServers();
    } finally {
      if (button) button.disabled = false;
    }
  });
  document.getElementById('recommended-server-auto')?.addEventListener('click', () => {
    void selectServer({ code: 'auto', name: 'Автоматически', country: '', flag: '🌐', ping: 0 });
  });
  // The quick bypass strip must not be a dead end: Android exposes the
  // corresponding switch under Settings > Connection.
  document.getElementById('btn-toggle-bypass-quick')?.addEventListener('click', () =>
    switchTab('tab-settings'));

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
      if (card.getAttribute('aria-disabled') === 'true') return;
      state.selectedPlanCode = card.dataset.plan;
      updatePricingMatrixUi();
    });
  });

  // Payment button
  document.getElementById('btn-pay-yookassa')?.addEventListener('click', handlePayYooKassa);

  // Support & FAQ triggers
  document.getElementById('btn-top-help')?.addEventListener('click', () => openModal('modal-faq'));
  document.getElementById('btn-vpn-health-check')?.addEventListener('click', () => {
    openModal('modal-vpn-health');
    void refreshVpnHealth();
  });
  document.getElementById('btn-vpn-health-refresh')?.addEventListener('click', () => {
    void refreshVpnHealth();
  });
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

  document.addEventListener('keydown', handleModalKeyboard);
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
  for (const id of ['btn-submit-login', 'btn-submit-register', 'btn-tg-login-modal', 'btn-tg-register-modal', 'btn-google-login', 'btn-google-register']) {
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

async function handleGoogleAuth() {
  if (state.authBusy) return;
  setAuthPending(true);
  showToast(uiText('Откройте браузер для входа через Google.', 'Complete Google sign-in in your browser.'));
  try {
    // Rust receives OAuth code and ID token directly; only backend-verified
    // ByMeVPN user data crosses into the WebView.
    const result = await invoke('auth_google_desktop');
    if (!result?.user?.id) throw new Error('Сервер не подтвердил вход через Google.');
    state.sessionEpoch += 1;
    state.user = result.user;
    state.subscription = result.subscription;
    showAppShell();
    showToast(uiText('Вход через Google подтверждён.', 'Google sign-in complete.'));
    void refreshAccountSnapshot();
  } catch (error) {
    const message = typeof error === 'string' ? error : (error?.message || uiText(
      'Не удалось войти через Google.', 'Google sign-in failed.'
    ));
    showToast(message, true);
  } finally {
    setAuthPending(false);
  }
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
    // A blocked browser launch must not strand the modal in a loading state.
    // Keep the session alive and allow the user to reopen the verified link.
    try {
      await openTelegram();
    } catch (_) {
      showToast(uiText('Браузер не открылся. Нажмите «Открыть Telegram» ещё раз.',
        'The browser did not open. Use Open Telegram to retry.'), true);
    }
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
      if (state.connectionBusy || state.serverSwitchBusy) {
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
      state.connectionError = null;
      state.vpnSequence += 1;
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

// Local health report, explicitly distinct from verified internet egress.
async function refreshVpnHealth() {
  const details = document.getElementById('vpn-health-details');
  if (!details) return;
  const refresh = document.getElementById('btn-vpn-health-refresh');
  if (refresh) refresh.disabled = true;
  details.textContent = uiText('Проверяем TUN, маршруты и Xray…', 'Checking TUN, routes and Xray…');
  try {
    const report = await invoke('vpn_health_report');
    const checked = (v, yes, no) => v === true ? yes : v === false ? no :
      uiText('проверка недоступна', 'check unavailable');
    const adapter = {
      up: uiText('активен', 'up'),
      down: uiText('неактивен', 'down'),
      missing: uiText('не обнаружен', 'missing'),
      unknown: uiText('неизвестно', 'unknown')
    }[report?.adapter] || uiText('неизвестно', 'unknown');
    const issues = {
      permissions: uiText('Возможна ошибка прав доступа Windows.', 'Possible Windows permission issue.'),
      adapter: uiText('Обнаружена ошибка сетевого адаптера Wintun.', 'Wintun adapter error detected.'),
      routes: uiText('Обнаружена ошибка таблицы маршрутов.', 'Routing table error detected.'),
      dns: uiText('В журнале Xray есть сообщение о сбое DNS.', 'Xray logged a DNS-related failure.'),
      xray: uiText('В журнале Xray есть сообщения об ошибках соединений.', 'Xray logged connection errors.'),
      unknown: uiText('Нет конкретной причины в локальном журнале.', 'No specific reason in local log.')
    };
    const freshEgress = {
      verified: uiText('Выход через Xray совпадает с выходом через Windows TUN (не проверка всех утечек)',
        'Xray and Windows TUN exits match (not a complete leak test)'),
      routing_bypass: uiText('Windows обходит VPN: выходы Xray и TUN различаются',
        'Windows bypasses VPN: Xray and TUN exits differ'),
      server_unreachable: uiText('VPN-сервер не отвечает на защищённый тестовый запрос',
        'VPN server did not answer the authenticated test request'),
      tun_no_traffic: uiText('Сервер Xray отвечает, но Windows TUN не передаёт проверочный HTTPS-запрос',
        'Xray server responds, but Windows TUN cannot pass the HTTPS probe'),
      baseline_unknown: uiText('Маршруты совпадают, но исходный IPv4 неизвестен',
        'Routes match, but the baseline IPv4 is unavailable'),
      exit_unchanged: uiText('Внешний IPv4 не изменился — защита не подтверждена',
        'External IPv4 unchanged — protection unverified'),
      probe_unavailable: uiText('Проверка реального VPN-пути временно недоступна',
        'End-to-end VPN verification temporarily unavailable'),
      not_running: uiText('Проверка не проводилась', 'Not checked')
    };
    const lines = [
      uiText('Процесс Xray: ', 'Xray process: ') +
        checked(report?.process_tracked, uiText('запущен приложением', 'managed by app'), uiText('не запущен', 'not running')),
      uiText('Адаптер TUN: ', 'TUN adapter: ') + adapter,
      uiText('Маршрут IPv4: ', 'IPv4 route: ') +
        checked(report?.ipv4_default, uiText('установлен', 'installed'), uiText('отсутствует', 'missing')),
      uiText('Маршрут IPv6: ', 'IPv6 route: ') +
        checked(report?.ipv6_default, uiText('установлен', 'installed'), uiText('отсутствует', 'missing')),
      uiText('Системный DNS: ', 'System DNS: ') +
        checked(report?.dns_resolution, uiText('тестовый домен разрешён', 'test hostname resolved'),
          uiText('тестовый запрос не прошёл', 'test lookup unsuccessful')),
      uiText('Свежий HTTPS-тест выхода: ', 'Live HTTPS egress test: ') +
        (freshEgress[report?.egress_probe] || freshEgress.unavailable),
      uiText('Проверка внешнего IP: ', 'Exit IP verification: ') +
        checked(report?.ip_verified, uiText('подтверждена', 'verified'), uiText('не подтверждена', 'unverified')),
      report?.runtime_healthy === true
        ? uiText('Текущие сетевые проверки пройдены.', 'Current connectivity checks passed.')
        : report?.xray_hint === 'dns' && report?.dns_resolution === true
          ? uiText('Ранее Xray сообщал о DNS-сбое; текущий DNS-тест успешен.',
            'Xray logged a DNS error; the current DNS test succeeded.')
          : (issues[report?.xray_hint] || issues.unknown)
    ];
    if (report?.baseline_known === false) {
      lines.push(uiText('Исходный IP не удалось определить до подключения.',
        'Pre-connection IP was not available.'));
    }
    details.textContent = lines.join('\n');
    // A fresh successful health check updates the native tunnel state.
    // Synchronize the Home warning immediately instead of waiting for the
    // 20-second watchdog cycle or displaying stale protection status.
    if (state.vpnConnected && report?.process_tracked) await checkVpnStatus();
  } catch (_) {
    details.textContent = uiText('Не удалось выполнить локальную проверку. Проверьте журнал Windows.',
      'Local diagnostics unavailable. Check the Windows logs.');
  } finally {
    if (refresh) refresh.disabled = false;
  }
}

// VPN Lifecycle & Real-time Metrics
async function toggleVpn(allowServerSwitch = false) {
  if (state.connectionBusy || (state.serverSwitchBusy && allowServerSwitch !== true)) return;
  if (!state.vpnConnected && (!state.subscription || state.subscription.status === 'unknown')) {
    showToast(uiText('Сначала проверьте подписку.', 'Verify your subscription first.'), true);
    return;
  }
  state.connectionBusy = true;
  state.vpnSequence += 1;
  state.connectionError = null;
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
      state.connectionError = typeof err === 'string' ? err : 'Ошибка отключения';
      showToast(state.connectionError, true);
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
      state.vpnVerified = metrics?.verified === true;
      state.connectedSeconds = 0;
      if (metrics) {
        state.metrics = metrics;
      }
      startLiveTimer();
      startStatusPolling();
      updateVpnUi();
      // A persistent transport-health state belongs beside the VPN control;
      // a transient toast would obscure navigation and hide the problem.
      if (state.vpnVerified) {
        showToast(uiText('Внешний IPv4 подтверждён.', 'External IPv4 verified.'));
      }
    } catch (err) {
      state.vpnConnected = false;
      state.vpnVerified = false;
      const errMsg = typeof err === 'string' ? err : (err?.message || 'Не удалось подключиться');
      state.connectionError = errMsg;
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
  if (state.connectionBusy) return;
  const epoch = state.sessionEpoch;
  const sequence = state.vpnSequence;
  try {
    const status = await invoke('vpn_status');
    if (epoch !== state.sessionEpoch || sequence !== state.vpnSequence || state.connectionBusy) return;
    if (status && status.connected) {
      state.vpnVerified = status.verified === true;
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
  const interval = setInterval(async () => {
    if (epoch !== state.sessionEpoch || state.pollInterval !== interval) {
      clearInterval(interval);
      if (state.pollInterval === interval) state.pollInterval = null;
      return;
    }
    if (state.vpnConnected && !state.connectionBusy && !document.hidden && !state.pollBusy) {
      const sequence = state.vpnSequence;
      state.pollBusy = true;
      try {
        const status = await invoke('vpn_status');
        if (epoch !== state.sessionEpoch || sequence !== state.vpnSequence ||
            state.connectionBusy || state.pollInterval !== interval) return;
        state.pollFailures = 0;
        state.vpnVerified = status?.connected === true && status?.verified === true;
        if (status) {
          const wasConnected = state.vpnConnected;
          state.vpnConnected = status.connected === true;
          state.metrics = status;
          state.connectedSeconds = status.connected_seconds || 0;
          if (wasConnected && !state.vpnConnected) {
            clearInterval(state.timerInterval);
            clearInterval(interval);
            state.timerInterval = null;
            if (state.pollInterval === interval) state.pollInterval = null;
            state.connectionError = uiText('Соединение VPN прервано. Проверьте сеть и повторите попытку.',
              'VPN connection interrupted. Check your network and retry.');
            showToast(state.connectionError, true);
          }
          updateVpnUi();
        }
      } catch (err) {
        if (epoch === state.sessionEpoch && sequence === state.vpnSequence &&
            state.pollInterval === interval && !state.connectionBusy) {
          state.pollFailures += 1;
          if (state.pollFailures >= 3) {
            state.vpnVerified = false;
            updateVpnUi();
          }
        }
      } finally {
        state.pollBusy = false;
      }
    }
  }, 5000);
  state.pollInterval = interval;
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

// Follow Android's System/RU/EN preference. Unsupported OS locales fall back to RU.
function effectiveLanguage() {
  const selected = state.settings.language;
  if (selected === 'ru' || selected === 'en') return selected;
  const locale = typeof navigator === 'undefined' ? '' :
    (navigator.languages?.[0] || navigator.language || '');
  return /^en(?:-|$)/i.test(locale) ? 'en' : 'ru';
}

// Runtime strings must use the same locale as the Android app.
function uiText(ru, en) {
  return effectiveLanguage() === 'en' ? en : ru;
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
  "Вход через Google отменён.": "Google sign-in canceled.",
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
  if (effectiveLanguage() !== 'en') return original;
  if (TOAST_EN[original]) return TOAST_EN[original];
  if (original.startsWith('Выбран сервер: ')) return 'Server selected: ' + original.slice('Выбран сервер: '.length);
  return original;
}

// UI Updaters
function updateVpnUi() {
  const isConn = state.vpnConnected;
  const sub = state.subscription;
  const accessUnknown = !sub || sub.status === 'unknown';
  const hasPlan = sub && ['active', 'trial', 'grace'].includes(sub.status);

  const noPlanBox = document.getElementById('home-state-no-plan');
  const connectedBox = document.getElementById('home-state-connected');
  const disconnectedBox = document.getElementById('home-state-disconnected');
  const activePill = document.getElementById('vpn-active-pill');
  document.getElementById('home-verification-notice')?.classList?.toggle(
    'hidden', !isConn || state.vpnVerified
  );
  const sharedDock = document.getElementById('home-shared-dock');
  sharedDock?.classList?.toggle('hidden', !hasPlan || accessUnknown);
  document.getElementById('btn-toggle-vpn')?.classList?.toggle('hidden', !accessUnknown);
  // Android hides free-trial activation once the API says it was consumed.
  const trialButton = document.getElementById('btn-no-plan-trial');
  if (trialButton) {
    const available = sub == null || (!hasPlan && sub.trial_available === true);
    trialButton.disabled = !available || state.trialBusy;
    const label = trialButton.querySelector?.('[data-i18n="no_plan_trial_button"]');
    if (label) label.textContent = available
      ? uiText('Активировать бесплатно', 'Activate free trial')
      : uiText('Пробный период недоступен', 'Free trial unavailable');
  }

  if (isConn) {
    noPlanBox?.classList.add('hidden');
    connectedBox?.classList.remove('hidden');
    disconnectedBox?.classList.add('hidden');
    activePill?.classList.toggle('hidden', !state.vpnVerified || state.connectionBusy);
    const verificationMark = document.querySelector('#home-state-connected .status-check-icon');
    if (verificationMark) {
      verificationMark.textContent = state.vpnVerified ? '✓' : '·';
      verificationMark.classList.toggle('verification-pending', !state.vpnVerified);
    }
    const heading = document.querySelector('#home-state-connected .status-title-text');
    const proof = state.metrics?.proof || 'probe_unavailable';
    if (heading) heading.textContent = state.vpnPhase === 'disconnecting'
      ? uiText('Отключаем VPN…', 'Disconnecting VPN…')
      : state.vpnVerified ? uiText('VPN подключён', 'VPN connected')
      : proof === 'server_unreachable' ? uiText('Нет ответа от VPN-сервера', 'VPN server not responding')
      : proof === 'tun_no_traffic' ? uiText('Нет трафика через Windows TUN', 'Windows TUN has no traffic')
      : uiText('Соединение не подтверждено', 'Connection unverified');
    const description = document.querySelector('#home-state-connected [data-i18n="conn_secured"]');
    if (description) description.textContent = state.vpnPhase === 'disconnecting'
      ? uiText('Завершаем соединение…', 'Closing the connection…')
      : state.vpnVerified
        ? uiText('Внешний IPv4 подтверждён', 'External IPv4 verified')
        : proof === 'server_unreachable' ?
          uiText('Проверьте протокол, подписку и доступность сервера.', 'Check protocol, subscription and server reachability.')
          : proof === 'tun_no_traffic' ?
            uiText('Xray отвечает, но системный трафик Windows не проходит.', 'Xray responds, but Windows system traffic does not pass.')
            : uiText('Реальный VPN-трафик пока не подтверждён.', 'Real VPN traffic is not yet verified.');
  } else if (accessUnknown) {
    // An offline/unknown entitlement is NOT an expired or active plan.
    // Keep the power control inert; the primary action retries the backend.
    noPlanBox?.classList.add('hidden');
    connectedBox?.classList.add('hidden');
    disconnectedBox?.classList.remove('hidden');
    activePill?.classList.add('hidden');
    const heading = document.querySelector('#home-state-disconnected .status-title-text');
    if (heading) heading.textContent = uiText('Проверяем подписку', 'Checking subscription');
    const desc = document.getElementById('home-off-desc');
    if (desc) desc.textContent = uiText('Не удалось подтвердить доступ. Проверьте сеть и повторите проверку.',
      'Access could not be confirmed. Check your network and retry.');
    const btn = document.getElementById('vpn-btn-text');
    if (btn) btn.textContent = uiText('Повторить проверку', 'Retry verification');
  } else if (!hasPlan) {
    // Parity with Android Mockup 03_home_no_plan
    noPlanBox?.classList.remove('hidden');
    connectedBox?.classList.add('hidden');
    disconnectedBox?.classList.add('hidden');
    activePill?.classList.add('hidden');
  } else {
    // Has active plan, disconnected
    const heading = document.querySelector('#home-state-disconnected .status-title-text');
    if (heading) heading.textContent = uiText('VPN выключен', 'VPN off');
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

  const bypassStrip = document.getElementById('btn-toggle-bypass-quick');
  const bypassLabel = bypassStrip?.querySelector('[data-i18n="ru_bypass_label"]');
  if (bypassLabel) bypassLabel.textContent = state.settings.bypassRu
    ? uiText('Российские сайты напрямую', 'Russian sites routed directly')
    : uiText('Обход российских сайтов выключен', 'Direct Russian routing is off');
  bypassStrip?.setAttribute('aria-label', uiText('Настройки маршрутизации', 'Routing settings'));

  const connectionError = document.getElementById('home-connection-error');
  if (connectionError) {
    const showError = !isConn && hasPlan && !accessUnknown && !!state.connectionError;
    connectionError.textContent = showError ? state.connectionError : '';
    connectionError.classList.toggle('hidden', !showError);
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
    const ring = document.getElementById(id);
    ring?.setAttribute('aria-busy', String(state.connectionBusy));
    ring?.setAttribute('aria-disabled', String(accessUnknown && !isConn));
    if (ring && id === 'vpn-power-ring-off') ring.tabIndex = accessUnknown ? -1 : 0;
  }
  document.getElementById('btn-toggle-vpn')?.toggleAttribute('disabled', state.connectionBusy || state.serverSwitchBusy);
  if (homeFlag) homeFlag.textContent = s.flag || '🌐';
  if (homeCountry) homeCountry.textContent = s.code === 'auto' ?
    uiText('Автоматически', 'Automatic') :
    (effectiveLanguage() === 'en' ? s.country_en : s.country) || serverDisplayName(s);
  if (homeCity) homeCity.textContent = s.code === 'auto' ?
    uiText('Автовыбор', 'Auto select') :
    ((effectiveLanguage() === 'en' ? s.city_en : s.city) || '');

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
  const profileName = document.getElementById('account-settings-profile-name');
  const profileEmail = document.getElementById('account-settings-profile-email');
  if (profileName) profileName.textContent = state.user.name || uiText('Пользователь', 'User');
  if (profileEmail) profileEmail.textContent = state.user.email || 'ByMeVPN';
}

function renewalStatusPresentation(value) {
  if (value === true) return {
    label: uiText('Автопродление включено', 'Auto-renewal enabled'),
    short: uiText('Включено', 'Enabled'),
    badgeClass: 'badge-auto-renew'
  };
  if (value === false) return {
    label: uiText('Автопродление отключено', 'Auto-renewal disabled'),
    short: uiText('Отключено', 'Disabled'),
    badgeClass: 'renewal-status-neutral'
  };
  // Unknown is not an error, a failed payment, or proof of disabled renewal.
  return {
    label: uiText('Информация об автопродлении недоступна',
      'Auto-renewal information unavailable'),
    short: uiText('Информация недоступна', 'Information unavailable'),
    badgeClass: 'renewal-status-neutral'
  };
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

  // Android Home displays a compact access strip, not the pricing-plan name.
  if (homeSubTitle) homeSubTitle.textContent = hasPlan
    ? uiText('Подписка активна', 'Subscription active') : title;
  if (homeSubExpiry) {
    const remaining = sub?.seconds_remaining;
    const days = Number.isFinite(remaining) && remaining > 0
      ? Math.ceil(remaining / 86400) : null;
    homeSubExpiry.textContent = hasPlan
      ? (days === null
        ? uiText('Срок подписки не подтверждён', 'Subscription duration not confirmed')
        : uiText(`Осталось ${days} дней`, `${days} days remaining`))
      : expiry;
  }
  if (homeSubBadge) {
    homeSubBadge.textContent = hasPlan ? uiText('Активна', 'Active') :
      isUnknown ? uiText('Неизвестно', 'Unknown') : uiText('Не активна', 'Inactive');
    homeSubBadge.className = hasPlan ? 'badge-active-mini' : 'badge-inactive';
  }

  // Android AccountScreen uses explicit active/inactive states, a large day count
  // and a lightweight profile chip; never claim a paid plan when status is unknown.
  document.getElementById('account-active-state')?.classList?.toggle('hidden', !hasPlan);
  document.getElementById('account-inactive-state')?.classList?.toggle('hidden', !!hasPlan);
  const statusPill = document.getElementById('acc-user-status-pill');
  if (statusPill) {
    statusPill.textContent = hasPlan ? uiText('Активен', 'Active')
      : isUnknown ? uiText('Проверяем', 'Checking') : uiText('Без подписки', 'No subscription');
    statusPill.className = hasPlan ? 'mobile-account-badge'
      : 'mobile-account-badge mobile-account-badge-inactive';
  }
  const remainingDays = Number.isFinite(sub?.seconds_remaining) && sub.seconds_remaining > 0
    ? Math.ceil(sub.seconds_remaining / 86400) : null;
  const remainingLabel = document.getElementById('acc-remaining-days');
  if (remainingLabel) remainingLabel.textContent = remainingDays == null ? '—' : String(remainingDays);
  document.getElementById('acc-days-suffix')?.classList?.toggle('hidden', remainingDays === null);
  const inactiveHeading = document.getElementById('acc-inactive-title');
  if (inactiveHeading) inactiveHeading.textContent = isUnknown
    ? uiText('Проверяем подписку', 'Checking subscription')
    : uiText('Подписка не активна', 'Subscription inactive');
  const inactiveTrial = document.getElementById('btn-account-trial');
  if (inactiveTrial) {
    inactiveTrial.disabled = sub?.trial_available !== true || state.trialBusy || isUnknown;
    inactiveTrial.classList?.toggle('hidden', sub?.trial_available !== true || isUnknown);
  }
  document.getElementById('btn-account-pricing')?.classList?.toggle('hidden', isUnknown);
  if (accPlanName) accPlanName.textContent = title;
  if (accPlanValidity) accPlanValidity.textContent = expiry;
  const renewal = renewalStatusPresentation(sub?.auto_renew);
  if (accPlanBadge) {
    accPlanBadge.textContent = renewal.label;
    // This badge was previously a hidden placeholder whose className
    // replacement accidentally exposed a red "unknown" warning on Account.
    accPlanBadge.className = hasPlan && typeof sub?.auto_renew === 'boolean'
      ? renewal.badgeClass : 'hidden';
  }

  if (accRenewBtn) {
    const renewText = accRenewBtn.querySelector?.('[data-i18n="renew"]') || accRenewBtn;
    renewText.textContent = hasPlan ? uiText('Продлить подписку', 'Renew subscription') :
      uiText('Оформить подписку', 'Subscribe');
  }

  const renewalBadge = document.getElementById('renewal-current-status-badge');
  if (renewalBadge) {
    renewalBadge.textContent = renewal.short;
    renewalBadge.className = sub?.auto_renew === true
      ? 'badge-active-mini' : 'renewal-status-neutral';
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
    uiText('Отключение устройства', 'Disconnect device'),
    uiText(`Отключить устройство «${name || 'Устройство'}» от аккаунта?`,
      `Disconnect "${name || 'Device'}" from your account?`),
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
  const months = VERIFIED_PLAN_TYPES[code]?.months || 1;
  const monthly = Math.round(offer.price / months);
  const price = uiText(`${monthly} ₽`, `${monthly} RUB`);
  if (code === 'month') return uiText(`${price} за месяц`, `${price} per month`);
  const bonus = {quarter: 1, half_year: 2, year: 3}[code] || 0;
  return uiText(`${price} / месяц · 🎁 ${bonus} мес. в подарок`,
    `${price}/month · 🎁 ${bonus} bonus month(s)`);
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
    const selected = !!offer && card.dataset.plan === state.selectedPlanCode;
    card.classList.toggle('selected', selected);
    card.classList.toggle('unavailable', !offer);
    card.setAttribute('aria-disabled', String(!offer));
    card.setAttribute('aria-pressed', String(selected));
    card.tabIndex = offer ? 0 : -1;
  });
  const priceLabel = document.getElementById('pricing-selected-plan-price');
  const titleLabel = document.getElementById('pricing-selected-plan-title');
  const planNote = document.getElementById('pricing-selected-plan-note');
  const payButton = document.getElementById('btn-pay-yookassa');
  if (priceLabel) priceLabel.textContent = chosen ? `${chosen.price} ₽` : '—';
  if (titleLabel) titleLabel.textContent = chosen
    ? uiText('Итого', 'Total') : uiText('Тариф недоступен', 'Plan unavailable');
  if (planNote) {
    const months = VERIFIED_PLAN_TYPES[state.selectedPlanCode]?.months || 1;
    planNote.textContent = chosen
      ? uiText(`Доступ на ${months} мес. · до ${dev} устройств`,
        `Access for ${months} months · up to ${dev} devices`)
      : uiText('Не удалось подтвердить стоимость тарифа', 'Plan price not confirmed');
  }
  if (payButton) payButton.textContent = !state.catalogReady
    ? uiText('Проверяем цену…', 'Checking price…')
    : canPay ? uiText(`Оплатить · ${chosen.price} ₽`, `Pay · ${chosen.price} RUB`)
      : uiText('Оплата временно недоступна', 'Checkout temporarily unavailable');
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
  if (effectiveLanguage() !== 'en') return server.name || server.code;
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
    !q || [s.name, s.name_en, s.country, s.country_en, s.city, s.city_en, s.code]
      .some(value => String(value || '').toLocaleLowerCase().includes(q))
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
      ((effectiveLanguage() === 'en' ? srv.country_en : srv.country) ||
        uiText('Доступная локация', 'Available location'));
    details.append(title, subtitle);
    const ping = document.createElement('span');
    ping.className = 'server-ping-badge';
    ping.textContent = srv.ping > 0 ? (srv.ping + ' ms') : '—';
    const dot = document.createElement('span');
    dot.className = 'radio-selection-dot';
    card.append(flag, details, ping, dot);
    card.addEventListener('click', () => void selectServer(srv));
    container.appendChild(card);
  });
}

// Android reconnects when a different server is selected during an active
// session. Keep the displayed endpoint tied to the actual tunnel: stop first,
// persist the selection, then establish and verify the new session.
async function selectServer(server) {
  if (state.connectionBusy || state.serverSwitchBusy) {
    showToast(uiText('Дождитесь завершения подключения.', 'Wait for the VPN operation to finish.'), true);
    return;
  }
  if (server.code !== 'auto' && server.supported === false) return;
  if (server.code === state.selectedServer.code) {
    switchTab('tab-home');
    return;
  }
  const previous = state.selectedServer;
  const wasConnected = state.vpnConnected;
  const epoch = state.sessionEpoch;
  state.serverSwitchBusy = true;
  try {
    if (wasConnected) {
      await toggleVpn(true);
      if (state.vpnConnected) return; // Native stop failed; keep the old endpoint.
    }
    await invoke('save_setting', { key: 'selectedServerCode', value: server.code });
    if (epoch !== state.sessionEpoch) return;
    state.preferredServerCode = server.code;
    state.selectedServer = server;
    const autoButton = document.getElementById('recommended-server-auto');
    autoButton?.classList.toggle('selected', server.code === 'auto');
    autoButton?.setAttribute('aria-pressed', String(server.code === 'auto'));
    renderServersList();
    updateVpnUi();
    switchTab('tab-home');
    if (wasConnected && epoch === state.sessionEpoch) await toggleVpn(true);
    if (state.vpnConnected || !wasConnected) {
      showToast(uiText('Выбран сервер: ', 'Server selected: ') + serverDisplayName(server));
    }
  } catch (error) {
    showToast(uiText('Не удалось сменить сервер. Настройка не сохранена.',
      'Could not switch servers. Selection was not saved.'), true);
    if (epoch === state.sessionEpoch && wasConnected && !state.vpnConnected &&
        state.selectedServer === previous) {
      await toggleVpn(true); // Restore the previous active endpoint when possible.
    }
  } finally {
    state.serverSwitchBusy = false;
    // Re-enable the main connect control after a completed or failed switch.
    updateVpnUi();
  }
}

function filterServers(query) {
  renderServersList(query);
}

// Payment & Trial
const TRIAL_ACTION_IDS = [
  'btn-home-activate-trial',
  'btn-no-plan-trial',
  'btn-account-trial',
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
  let startupChanged = false;
  try {
    if (key === 'autoStart') {
      await invoke('set_startup', { enabled: value });
      startupChanged = true;
    }
    await invoke('save_setting', { key, value });
    state.settings[key] = value;
    if (key === 'language') applyLanguage(value);
    showToast(key === 'bypassRu'
      ? uiText('Изменение маршрутизации применится при следующем подключении.',
        'Routing changes take effect on your next connection.')
      : uiText('Настройки сохранены', 'Settings saved.'));
  } catch (err) {
    // Persisting the preference can fail after changing the Windows registry.
    // Restore the previous startup state so the switch never lies.
    if (startupChanged) {
      await invoke('set_startup', { enabled: previous }).catch(() => {});
    }
    state.settings[key] = previous;
    applySettingsToUi();
    showToast(uiText('Не удалось сохранить настройку. Изменение отменено.',
      'Could not save this setting. The change was reverted.'), true);
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

  applyLanguage(s.language || 'system');
}

function applyLanguage(lang) {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    const selected = btn.dataset.lang === lang;
    btn.classList.toggle('active', selected);
    btn.setAttribute('aria-pressed', String(selected));
  });
  const currentLanguageLabel = document.getElementById('current-language-label');
  if (currentLanguageLabel) {
    currentLanguageLabel.textContent = lang === 'ru' ? 'Русский'
      : lang === 'en' ? 'English'
      : (effectiveLanguage() === 'en' ? 'System' : 'Системный');
  }

  const resolved = lang === 'system' ? effectiveLanguage() : lang;
  const dict = I18N[resolved] || I18N.ru;
  document.documentElement.lang = resolved === 'en' ? 'en' : 'ru';
  const version = document.querySelector?.('.version-num');
  if (version?.dataset.appVersion) {
    version.textContent = uiText('Версия ', 'Version ') + version.dataset.appVersion;
  }
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const value = dict[el.dataset.i18n];
    if (typeof value === 'string') el.textContent = value;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const value = dict[el.dataset.i18nPlaceholder];
    if (typeof value === 'string') el.placeholder = value;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const value = dict[el.dataset.i18nTitle];
    if (typeof value === 'string') {
      el.title = value;
      el.setAttribute('aria-label', value);
    }
  });

  document.querySelectorAll('.btn-password-toggle').forEach(btn => {
    const visible = btn.closest('.input-field-box')?.querySelector('input')?.type === 'text';
    btn.setAttribute('aria-label', visible
      ? uiText('Скрыть пароль', 'Hide password')
      : uiText('Показать пароль', 'Show password'));
  });

  // Recompute dynamic server/account/status labels as well as static titles.
  switchTab(state.currentTab);
  updateVpnUi();
  updateSubscriptionUi();
  updateDevicesUi();
  updatePricingMatrixUi();
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
let activeModalId = null;
let focusBeforeModal = null;
const modalFocusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]';

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  if (!activeModalId) focusBeforeModal = document.activeElement;
  activeModalId = id;
  modal.classList.remove('hidden');
  const dialog = modal.querySelector?.('.modal-window');
  if (dialog) {
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
  }
  const initial = modal.querySelector?.(modalFocusableSelector);
  initial?.focus();
}

function closeModal(id) {
  if (id === 'modal-telegram') cancelTelegramPolling();
  if (id === 'modal-confirm') {
    const btn = document.getElementById('btn-confirm-accept');
    if (btn) btn.onclick = null;
  }
  document.getElementById(id)?.classList.add('hidden');
  if (activeModalId === id) {
    activeModalId = null;
    const target = focusBeforeModal;
    focusBeforeModal = null;
    if (target?.isConnected) target.focus();
  }
}

function handleModalKeyboard(event) {
  if (!activeModalId) return;
  const modal = document.getElementById(activeModalId);
  if (!modal || modal.classList.contains('hidden')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeModal(activeModalId);
    return;
  }
  if (event.key !== 'Tab') return;
  const controls = Array.from(modal.querySelectorAll(modalFocusableSelector))
    .filter(el => el.getClientRects().length > 0);
  if (!controls.length) { event.preventDefault(); return; }
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
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
  const en = effectiveLanguage() === 'en';

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
  openModal('modal-legal');
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

