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
  latencyRefreshing: false,
  measurementsAt: 0,
  selectedServer: {
    code: 'auto',
    name: 'Автоматически',
    country: '',
    flag: '🌐',
    ping: 0
  },
  autoSelectedServer: null,
  selectedDevicesCount: 2,
  selectedPlanCode: 'month',
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
  reconnectPending: false,
  pollBusy: false,
  pollFailures: 0,
  catalogReady: false,
  pricingLoading: false,
  pricingLoadError: '',
  serversStale: false,
  devicesSupported: false,
  devicesLoaded: false,
  devicesUnavailable: false,
  devicesRefreshing: false,
  devicesRefreshGeneration: 0,
  availableDeviceCounts: [],
  paymentBusy: false,
  renewalBusy: false,
  renewalRefreshing: false,
  renewalChecked: false,
  renewalGeneration: null,
  renewalCanEnable: false,
  trialBusy: false,
  trialPreparing: false,
  trialError: '',
  trialPageChecking: false,
  trialReturnTab: 'tab-account',
  pricingReturnTab: 'tab-home',
  supportReturnTab: 'tab-account',
  subscriptionRefreshCount: 0,
  pendingCheckout: null,
  preferredServerCode: 'auto',
  settings: {
    autoStart: false,
    autoConnect: false,
    autoReconnect: true,
    stayConnectedInBackground: true,
    bypassRu: true,
    adBlock: 'none',
    dnsMode: 'cloudflare',
    killSwitch: false,
    language: 'system'
  },
  currentTab: 'tab-home',
  serverSearchQuery: '',
  activeAccountId: null,
  timerInterval: null,
  pollInterval: null
};

const SERVER_CATALOG_RETRY_DELAYS_MS = [8_000, 30_000];
let serverCatalogInFlight = null;
let serverCatalogRetryTimer = null;
let serverCatalogRetryAttempt = 0;
let serverCatalogRetryOwner = null;
let serverLatencyAutoAttemptAt = 0;
// Measurements held in state can outlive the native ten-minute cache when the
// window stays open. Treat them as stale so automatic selection does not pick
// a node that is no longer the fastest.
const AUTOMATIC_MEASUREMENT_TTL_MS = 10 * 60 * 1000;

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
    trial_page_title: "Пробный период",
    trial_page_heading: "Пробный период",
    trial_page_description: "Доступность пробного периода зависит от аккаунта.",
    trial_page_used_heading: "Пробный период использован",
    trial_page_used_note: "Пробный период уже использован.",
    trial_page_activate: "Активировать бесплатно",
    trial_page_activating: "Подключаем…",
    trial_page_plans: "Посмотреть тарифы",
    back_to_account: "Назад к аккаунту",
    settings_headline: "Приложение работает за вас.",
    settings_intro: "Основные настройки уже подобраны. При желании их можно изменить.",
    settings_connection_label: "Подключение",
    auto_reconnect_title: "Переподключаться после обрыва",
    auto_reconnect_desc: "Повторять подключение с увеличением паузы между попытками",
    settings_language_section: "Язык приложения",
    settings_default_tip: "Не уверены, что выбрать? Оставьте настройки по умолчанию.",
    settings_more_title: "Дополнительные настройки",
    advanced_desktop_title: "Настройки Windows",
    advanced_desktop_intro: "Дополнительные параметры для компьютера.",
    window_minimize: "Свернуть",
    window_maximize: "Развернуть",
    window_close: "Закрыть",
    window_hide_tray: "Свернуть в область уведомлений",
    help_tooltip: "Помощь",
    vpn_toggle_label: "Переключить VPN",
    routing_settings_tooltip: "Настройки маршрутизации",
    trial_badge_simple: "3 ДНЯ БЕСПЛАТНО",
    trial_try_byme: "Попробуйте ByMeVPN бесплатно",
    trial_no_card: "БЕЗ ПРИВЯЗКИ КАРТЫ",
    trial_try_three: "Попробуйте 3 дня бесплатно",
    trial_all_locations: "Полный доступ ко всем локациям для новых пользователей",
    trial_no_cancel: "Все серверы сразу • Без оплаты и карты",
    background_unavailable_tip: "Открыть ByMeVPN можно из области уведомлений Windows",
    killswitch_unavailable_tip: "Полная аварийная защита пока не реализована",
    renewal_intro: "Отключение автопродления не отменяет уже оплаченную подписку. Подключить его можно через Telegram-бота.",
    renewal_billing_unavailable: "Дата следующего списания, сумма и привязанная карта не предоставляются текущим API приложения. Мы не показываем неподтверждённые данные.",
    renewal_status_prefix: "Статус:",
    renewal_checking: "Проверяем…",
    renewal_status_on: "Включено",
    renewal_status_off: "Отключено",
    renewal_unavailable: "Не удалось проверить",
    renewal_enable: "Включить автопродление",
    renewal_setup_telegram: "Настроить способ оплаты в Telegram",
    renewal_saved_method_hint: "Для автопродления нужен ранее сохранённый способ оплаты с вашим согласием.",
    renewal_refreshing: "Обновляем…",
    support_contact_desc: "Напишите нам о проблеме или задайте вопрос по работе ByMeVPN.",
    support_contact_telegram: "Написать в поддержку",
    support_contact_email: "Написать по email",
    support_telegram_unavailable: "Не удалось открыть Telegram. Напишите на support@bymevpn.com.",
    support_email_copied: "Адрес поддержки скопирован: support@bymevpn.com",
    support_mail_unavailable: "Не удалось открыть почту. Адрес поддержки: support@bymevpn.com.",
    devices_upgrade_title: "Нужно больше устройств?",
    devices_upgrade_action: "Увеличить лимит в Telegram",
    devices_other_label: "ДРУГИЕ УСТРОЙСТВА",
    devices_unavailable_title: "Список устройств временно недоступен",
    devices_unavailable_desc: "Мы не меняли лимит и не удаляли устройства. Повторите загрузку.",
    devices_retry: "Повторить",
    devices_retry_loading: "Загружаем…",
    devices_current_name: "Компьютер с Windows",
    devices_current_details: "Windows · это устройство",
    devices_current_confirmed: "Это устройство",
    devices_current_pending: "Ещё не подтверждено сервером",
    devices_progress_label: "Использование лимита устройств",
    devices_loading_hint: "Загружаем список устройств с сервера.",
    devices_no_registered: "Зарегистрированных устройств пока нет.",
    devices_only_current: "Пока отображается только это устройство.",
    devices_hint_unavailable: "Не удалось получить подтверждённый список с сервера.",
    devices_upgrade_limit_title: "ЛИМИТ УСТРОЙСТВ ДОСТИГНУТ",
    devices_upgrade_needed_title: "НУЖНО БОЛЬШЕ УСТРОЙСТВ?",
    devices_upgrade_help: "Доплата за 5 или 10 устройств рассчитывается за оставшийся срок вашей подписки. Выберите лимит и проверьте сумму в Telegram-боте перед оплатой.",
    devices_upgrade_bot_hint: "В боте откройте подписку → Мои устройства → Увеличить лимит.",
    devices_add_title: "ДОБАВИТЬ УСТРОЙСТВО",
    devices_add_desc: "Войдите в ByMeVPN на другом устройстве с тем же аккаунтом. Оно появится здесь после регистрации на сервере.",
    support_info: "Информация",
    support_about: "О приложении",
    support_about_desc: "Версия и контакты",
    support_legal: "Документы и приватность",
    support_legal_desc: "Условия использования",
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
    devices_stat_hint: "Количество подключённых устройств ограничено вашим тарифом.",
    renewal_title: "Автопродление",
    renewal_cancel: "Отключить автопродление",
    renewal_refresh: "Обновить статус",
    renewal_enable_confirm_title: "Включить автопродление?",
    renewal_enable_confirm_desc: "Будут использованы только ранее сохранённый способ оплаты и данное вами согласие. Списание произойдёт при продлении подписки. Отключить можно в любой момент.",
    renewal_enable_confirm_action: "Включить",
    renewal_cancel_confirm_title: "Отключить автопродление?",
    renewal_cancel_confirm_desc: "Следующего автоматического списания не будет. Оплаченный доступ сохранится до конца срока.",
    renewal_cancel_confirm_action: "Отключить",
    support_page_title: "Помощь",
    support_hero_title: "Мы рядом, если\nнужна помощь",
    support_resources: "Полезное",
    support_footer: "Поддержка ByMeVPN",
    support_faq_title: "Ответы на вопросы",
    support_faq_desc: "Оплата, подключение и устройства",
    error_support_title: "Не получается подключиться?",
    error_support_desc: "Напишите нам — поможем разобраться",
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
    account_manage_plans: "Тарифы и оплата",
    account_manage_plans_desc: "Выбрать или продлить тариф",
    account_settings_subtitle: "Данные профиля, выход и удаление",
    account_manage_renewal: "Автопродление",
    account_manage_renewal_desc: "Посмотреть статус и управлять",
    account_settings_overline: "ВАШ ПРОФИЛЬ",
    account_settings_intro: "Данные профиля и управление аккаунтом",
    account_settings_identity: "Профиль",
    account_settings_billing: "Подписка",
    account_field_name: "Имя",
    account_field_email: "Email",
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
    account_password_reset: "Сменить пароль",
    account_password_reset_desc: "Получить ссылку на почту",
    account_settings_delete_desc: "Удалить аккаунт и доступ к VPN",
    language_short_title: "Язык",
    language_dialog_title: "Язык приложения",
    language_dialog_desc: "Выберите язык приложения.",
    pricing_choose_plan: "Выберите тариф",
    pricing_one_plan: "Одна подписка для всех ваших устройств",
    pricing_devices_kicker: "СКОЛЬКО УСТРОЙСТВ?",
    pricing_term_kicker: "СРОК ПОДПИСКИ",
    pricing_payment_kicker: "СПОСОБ ОПЛАТЫ",
    pricing_payment_method: "Карта или СБП через ЮKassa",
    pricing_retry: "Повторить загрузку",
    pricing_total: "К оплате сейчас",
    pricing_price_unconfirmed: "Цена не подтверждена",
    pricing_pay_action: "Оплатить",
    pricing_secure: "Безопасная оплата через ЮKassa",
    server_sheet_title: "Серверы",
    server_sheet_desc: "Выберите страну или доверьтесь автоматике.",
    server_sheet_footnote: "Отображаются только серверы, доступные по вашей подписке.",
    server_measure_latency: "Проверить задержку",
    server_latency_checking: "Проверяем…",
    server_latency_help: "Измеряется задержка через каждый сервер до интернета. VPN включать не нужно.",
    home_connection_kicker: "ВАШЕ ПОДКЛЮЧЕНИЕ",
    vpn_unverified_help: "Туннель работает, но проверка защиты не завершена. Пока статус не подтверждён, не считайте соединение защищённым.",
    vpn_health_action: "Диагностика соединения",
    vpn_health_title: "Проверка подключения",
    vpn_health_desc: "Проверка выполняется локально. Пароли и ключи не отображаются.",
    vpn_health_refresh: "Проверить повторно",
    home_location_title: "МЕСТОПОЛОЖЕНИЕ",
    home_server_connected: "Подключено",
    no_plan_title_line2: "Одно касание.",
    no_plan_desc: "Подключайтесь, когда вам нужен VPN.",
    no_plan_perk_connection: "VPN-подключение",
    no_plan_perk_simple: "Простое управление",
    no_plan_trial_badge: "3 ДНЯ БЕСПЛАТНО",
    no_plan_trial_heading: "3 дня бесплатно",
    no_plan_trial_desc: "Попробуйте сервис перед покупкой.",
    no_plan_trial_button: "Активировать бесплатно",
    no_plan_pricing_button: "Посмотреть все тарифы",
    no_plan_telegram_restore: "Подписка оформлена в Telegram? Войти через Telegram",
    trial_success_title: "Пробный период активирован!",
    trial_success_desc: "Вам доступны 3 дня ByMeVPN. Приятного пользования!",
    trial_success_servers_pending: "Список серверов обновляется — он появится на главном экране.",
    trial_success_continue: "К подключению",
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
    autoconnect_title: 'Подключаться автоматически',
    autoconnect_desc: 'Автоматически включать VPN после входа в приложение, если подписка активна',
    account_settings_title: 'Аккаунт и безопасность',
    account_refresh: 'Обновить данные',
    account_copy_id: 'Скопировать ID',
    account_id_label: 'ID аккаунта',
    account_id_copied: 'ID аккаунта скопирован',
    account_id_copy_failed: 'Не удалось скопировать ID аккаунта',
    account_app_settings: 'Настройки приложения',
    account_advanced: 'Дополнительные настройки',
    slogan: 'Скорость. Анонимность. Честность.',
    perk_fast: 'Быстрое подключение',
    perk_easy: 'Простое управление',
    auth_login_slogan: 'VPN для ваших устройств',
    auth_register_slogan: 'Создайте защищенный аккаунт',
    auth_telegram_title: 'Войти через Telegram',
    auth_telegram_desc: 'Подтвердите вход в боте. Для восстановления подписки используйте прежний Telegram-аккаунт.',
    auth_telegram_continue: 'Продолжить через Telegram',
    auth_retry_session: 'Повторить проверку аккаунта',
    auth_register_divider: 'ИЛИ ПО ПОЧТЕ',
    auth_already_registered: 'Уже есть аккаунт?',
    auth_reset_title: 'Восстановление пароля',
    auth_reset_success: 'Если аккаунт с этим email существует, мы отправим ссылку для смены пароля.',
    auth_reset_intro: 'Введите email аккаунта. Ссылка придёт на почту.',
    auth_reset_send: 'Отправить',
    login_title: 'Вход',
    reset_password: 'Забыли пароль?',
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
    auto_renew_note: 'Проверьте условия продления перед оплатой. Управляйте автопродлением в разделе «Аккаунт».',
    terms_agreement: 'Нажимая «Оплатить», вы соглашаетесь с Условиями использования и Политикой конфиденциальности.',
    back: 'Назад',
    server_auto: 'Автоматически',
    server_auto_desc: 'Подберём сервер',
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
    background_desc: 'Закрытие окна скроет приложение в область уведомлений и оставит VPN включённым.',
    bypass_title: 'Российские сайты напрямую',
    bypass_desc: 'Банки и местные сервисы без VPN',
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
    faq_subtitle: 'Короткие ответы по делу',
    faq_close_label: 'Закрыть частые вопросы',
    faq_q1: 'Не удаётся подключиться',
    faq_a1: 'Выберите другой доступный сервер и попробуйте ещё раз. Если ошибка повторяется, проверьте подключение к интернету и отправьте в поддержку код ошибки из приложения.',
    faq_q2: 'VPN отключается при блокировке Windows',
    faq_a2: 'Если VPN нужен после закрытия окна, включите «Оставаться подключённым в фоне» в дополнительных настройках. При переходе компьютера в режим сна Windows приостанавливает сетевую активность.',
    faq_q3: 'Достигнут лимит устройств',
    faq_a3: 'Отключите старое устройство в разделе «Мои устройства» или откройте Telegram-бота и проверьте стоимость увеличения лимита.',
    faq_q4: 'Как включить пробный период?',
    faq_a4: 'Нажмите «Активировать бесплатно» на главном экране. Пробный период доступен один раз на аккаунт. Если статус не обновился, откройте аккаунт и повторите проверку.',
    faq_q5: 'Не получается войти',
    faq_a5: 'Войдите тем же способом, которым регистрировались. Для аккаунта из Telegram-бота используйте кнопку входа через Telegram.',
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
    trial_page_title: "Free trial",
    trial_page_heading: "Free trial",
    trial_page_description: "Trial availability depends on your account.",
    trial_page_used_heading: "Free trial already used",
    trial_page_used_note: "The free trial has already been used.",
    trial_page_activate: "Activate free trial",
    trial_page_activating: "Activating…",
    trial_page_plans: "View plans",
    back_to_account: "Back to account",
    settings_headline: "The app works for you.",
    settings_intro: "The defaults are ready to use. You can change them here.",
    settings_connection_label: "Connection",
    auto_reconnect_title: "Reconnect after a drop",
    auto_reconnect_desc: "Retry with a longer pause between attempts",
    settings_language_section: "App language",
    settings_default_tip: "Not sure? Keep the default settings.",
    settings_more_title: "Advanced settings",
    advanced_desktop_title: "Windows settings",
    advanced_desktop_intro: "More options for your computer.",
    window_minimize: "Minimize",
    window_maximize: "Maximize",
    window_close: "Close",
    window_hide_tray: "Hide to notification area",
    help_tooltip: "Help",
    vpn_toggle_label: "Toggle VPN",
    routing_settings_tooltip: "Routing settings",
    trial_badge_simple: "3 DAYS FREE",
    trial_try_byme: "Try ByMeVPN for free",
    trial_no_card: "NO CREDIT CARD",
    trial_try_three: "Try 3 days free",
    trial_all_locations: "Access all available locations for new users",
    trial_no_cancel: "All servers • No payment or card",
    background_unavailable_tip: "Open ByMeVPN from the Windows notification area",
    killswitch_unavailable_tip: "A full kill switch is not implemented yet",
    renewal_intro: "Turning off auto-renewal does not cancel paid access. To enable it, use the Telegram bot.",
    renewal_billing_unavailable: "The current app API does not supply the next charge date, amount, or linked card. Unverified billing details are not displayed.",
    renewal_status_prefix: "Status:",
    renewal_checking: "Checking…",
    renewal_status_on: "On",
    renewal_status_off: "Off",
    renewal_unavailable: "Could not check",
    renewal_enable: "Enable auto-renewal",
    renewal_setup_telegram: "Set up a payment method in Telegram",
    renewal_saved_method_hint: "Auto-renewal requires a previously saved payment method with your consent.",
    renewal_refreshing: "Refreshing…",
    support_contact_desc: "Contact us with a question or a problem using ByMeVPN.",
    support_contact_telegram: "Contact support",
    support_contact_email: "Contact by email",
    support_telegram_unavailable: "Could not open Telegram. Email support@bymevpn.com.",
    support_email_copied: "Support address copied: support@bymevpn.com",
    support_mail_unavailable: "Could not open an email app. Contact support@bymevpn.com.",
    devices_upgrade_title: "Need more devices?",
    devices_upgrade_action: "Upgrade devices in Telegram",
    devices_other_label: "OTHER DEVICES",
    devices_unavailable_title: "Device list is temporarily unavailable",
    devices_unavailable_desc: "Your device limit and registered devices were not changed. Try loading again.",
    devices_retry: "Retry",
    devices_retry_loading: "Loading…",
    devices_current_name: "Windows PC",
    devices_current_details: "Windows · this device",
    devices_current_confirmed: "This device",
    devices_current_pending: "Not yet confirmed by the server",
    devices_progress_label: "Device limit usage",
    devices_loading_hint: "Loading the device list from the server.",
    devices_no_registered: "No registered devices yet.",
    devices_only_current: "Only this device is shown for now.",
    devices_hint_unavailable: "Could not retrieve the confirmed device list.",
    devices_upgrade_limit_title: "DEVICE LIMIT REACHED",
    devices_upgrade_needed_title: "NEED MORE DEVICES?",
    devices_upgrade_help: "Upgrades to 5 or 10 devices are prorated over your remaining subscription period. Choose a limit and review the final price in the Telegram bot.",
    devices_upgrade_bot_hint: "In the bot: Subscription → My devices → Upgrade device limit.",
    devices_add_title: "ADD A DEVICE",
    devices_add_desc: "Sign in to ByMeVPN on another device with the same account. It will appear here once registered with the server.",
    support_info: "Information",
    support_about: "About the app",
    support_about_desc: "Version and contact",
    support_legal: "Privacy and documents",
    support_legal_desc: "Terms of service",
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
    devices_stat_hint: "Your plan limits the number of connected devices.",
    renewal_title: "Auto-renewal",
    renewal_cancel: "Turn off auto-renewal",
    renewal_refresh: "Refresh status",
    renewal_enable_confirm_title: "Enable auto-renewal?",
    renewal_enable_confirm_desc: "Only your previously saved payment method and consent will be used. The charge is scheduled for subscription renewal. You can turn it off at any time.",
    renewal_enable_confirm_action: "Enable",
    renewal_cancel_confirm_title: "Turn off auto-renewal?",
    renewal_cancel_confirm_desc: "There will be no next automatic charge. Your paid access remains until expiry.",
    renewal_cancel_confirm_action: "Turn off",
    support_page_title: "Support",
    support_hero_title: "We're here\nto help",
    support_resources: "Useful links",
    support_footer: "ByMeVPN support",
    support_faq_title: "FAQ",
    support_faq_desc: "Payments, connection and devices",
    error_support_title: "Having trouble connecting?",
    error_support_desc: "Contact us and we will help",
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
    account_manage_plans: "Plans and payment",
    account_manage_plans_desc: "Choose or renew a plan",
    account_settings_subtitle: "Profile details, sign out and deletion",
    account_manage_renewal: "Auto-renewal",
    account_manage_renewal_desc: "View and manage renewal",
    account_settings_overline: "YOUR PROFILE",
    account_settings_intro: "Profile details and account management",
    account_settings_identity: "Profile",
    account_settings_billing: "Subscription",
    account_field_name: "Name",
    account_field_email: "Email",
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
    account_password_reset: "Change password",
    account_password_reset_desc: "Receive a reset link by email",
    account_settings_delete_desc: "Delete your account and VPN access",
    language_short_title: "Language",
    language_dialog_title: "App language",
    language_dialog_desc: "Choose the app language.",
    pricing_choose_plan: "Choose a plan",
    pricing_one_plan: "One plan for all your devices",
    pricing_devices_kicker: "HOW MANY DEVICES?",
    pricing_term_kicker: "SUBSCRIPTION LENGTH",
    pricing_payment_kicker: "PAYMENT METHOD",
    pricing_payment_method: "Card or SBP via YooKassa",
    pricing_retry: "Retry loading",
    pricing_total: "Amount due",
    pricing_price_unconfirmed: "Price not confirmed",
    pricing_pay_action: "Pay",
    pricing_secure: "Secure checkout via YooKassa",
    server_sheet_title: "Servers",
    server_sheet_desc: "Choose a country or use automatic selection.",
    server_sheet_footnote: "Only servers in your subscription are shown.",
    server_measure_latency: "Measure latency",
    server_latency_checking: "Checking…",
    server_latency_help: "Measures internet latency through each server. VPN does not need to be connected.",
    home_connection_kicker: "YOUR CONNECTION",
    vpn_unverified_help: "The tunnel is running, but protection checks are incomplete. Do not treat the connection as protected until its status is verified.",
    vpn_health_action: "Connection diagnostics",
    vpn_health_title: "Connection diagnostics",
    vpn_health_desc: "Local checks only. Passwords and keys are not displayed.",
    vpn_health_refresh: "Check again",
    home_location_title: "LOCATION",
    home_server_connected: "Connected",
    no_plan_title_line2: "One tap away.",
    no_plan_desc: "Connect whenever you need a VPN.",
    no_plan_perk_connection: "VPN connection",
    no_plan_perk_simple: "Simple controls",
    no_plan_trial_badge: "3 DAYS FREE",
    no_plan_trial_heading: "3 days free",
    no_plan_trial_desc: "Try the service before buying.",
    no_plan_trial_button: "Activate free trial",
    no_plan_pricing_button: "See all plans",
    no_plan_telegram_restore: "Subscribed in Telegram? Sign in with Telegram",
    trial_success_title: "Your free trial is active!",
    trial_success_desc: "You have 3 days of ByMeVPN. Enjoy!",
    trial_success_servers_pending: "Your server list is refreshing and will appear on Home.",
    trial_success_continue: "Go to VPN",
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
    autoconnect_title: 'Connect automatically',
    autoconnect_desc: 'Automatically start VPN after opening the app when the subscription is active',
    account_settings_title: 'Account and security',
    account_refresh: 'Refresh account',
    account_copy_id: 'Copy account ID',
    account_id_label: 'Account ID',
    account_id_copied: 'Account ID copied',
    account_id_copy_failed: 'Could not copy account ID',
    account_app_settings: 'App settings',
    account_advanced: 'Advanced settings',
    slogan: 'Speed. Anonymity. Honesty.',
    perk_fast: 'Fast connection',
    perk_easy: 'Simple controls',
    auth_login_slogan: 'VPN for your devices',
    auth_register_slogan: 'Create a secure account',
    auth_telegram_title: 'Sign in with Telegram',
    auth_telegram_desc: 'Confirm the sign-in in the bot. Use your original Telegram account to restore a subscription.',
    auth_telegram_continue: 'Continue with Telegram',
    auth_retry_session: 'Retry account verification',
    auth_register_divider: 'OR USE EMAIL',
    auth_already_registered: 'Already have an account?',
    auth_reset_title: 'Password recovery',
    auth_reset_success: 'If an account with this email exists, we will send a password reset link.',
    auth_reset_intro: 'Enter your account email. The link will arrive by email.',
    auth_reset_send: 'Send',
    login_title: 'Sign In',
    reset_password: 'Forgot password?',
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
    auto_renew_note: 'Review renewal terms before checkout. Manage auto-renewal from Account.',
    terms_agreement: 'By clicking "Pay", you agree to Terms of Service and Privacy Policy.',
    back: 'Back',
    server_auto: 'Automatic',
    server_auto_desc: 'We will choose a server',
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
    delete_account: 'Delete account',
    set_general_title: 'General',
    set_general_desc: 'Comfortable experience with ByMeVPN',
    autostart_title: 'Launch on Windows startup',
    autostart_desc: 'ByMeVPN starts automatically with your system',
    background_title: 'Stay connected in background',
    background_desc: 'Closing the window hides the app in the system tray and keeps VPN connected.',
    bypass_title: 'Russian sites directly',
    bypass_desc: 'Banks and local services without VPN',
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
    faq_title: 'FAQ',
    faq_subtitle: 'Quick answers',
    faq_close_label: 'Close FAQ',
    faq_q1: "I can't connect",
    faq_a1: 'Choose another available server and try again. If the error persists, check your internet connection and send the error code shown by the app to support.',
    faq_q2: 'VPN disconnects when Windows is locked',
    faq_a2: 'To keep the VPN after closing the window, enable “Stay connected in background” in Advanced settings. Windows pauses network activity when the PC sleeps.',
    faq_q3: "I've reached the device limit",
    faq_a3: 'Remove an old device in My devices, or open the Telegram bot to review the device limit upgrade price.',
    faq_q4: 'How do I start the free trial?',
    faq_a4: 'Choose “Activate for free” on Home. The trial is available once per account. If the status does not update, open Account and refresh it.',
    faq_q5: "I can't sign in",
    faq_a5: 'Use the same method you registered with. For an account created through the Telegram bot, use the Telegram sign-in button.',
    cancel: 'Cancel',
    confirm: 'Confirm'
  }
};

// Application Initialization
document.addEventListener('DOMContentLoaded', async () => {
  setupWindowControls();
  setupEventListeners();
  await setupServerLatencyListener();
  await loadInitialData();
});

async function setupServerLatencyListener() {
  const events = window.__TAURI__?.event;
  if (typeof events?.listen !== 'function') return;
  try {
    await events.listen('server-latency-update', event => {
      const result = event?.payload;
      if (!state.user || Number(result?.epoch) !== state.sessionEpoch ||
          typeof result?.code !== 'string' || !Number.isInteger(result?.ping)) return;
      const index = state.servers.findIndex(server => server.code === result.code);
      if (index < 0) return;
      const updated = { ...state.servers[index], ping: result.ping };
      state.servers = state.servers.map((server, i) => i === index ? updated : server);
      if (state.selectedServer.code === result.code) {
        state.selectedServer = { ...state.selectedServer, ping: result.ping };
      }
      if (state.autoSelectedServer?.code === result.code) {
        state.autoSelectedServer = { ...state.autoSelectedServer, ping: result.ping };
      }
      // Patch only the affected card. Rebuilding the full list for every
      // server probe stalled the WebView on PCs with long catalogs.
      updateServerLatencyCard(updated);
      if (!state.vpnConnected && !state.connectionBusy && state.selectedServer.code === 'auto') {
        state.autoSelectedServer = chooseAutomaticServer(state.servers);
      }
      if (state.latencyRefreshing && !state.servers.some(server => [-3, -4].includes(Number(server.ping)))) {
        clearTimeout(state.latencyWatchdog);
        state.latencyRefreshing = false;
      }
      scheduleVpnUiUpdate();
    });
  } catch (_) { /* A missing event bridge must not block app startup. */ }
}

// Window Controls (Minimize, Maximize, Close)
function setupWindowControls() {
  document.getElementById('btn-minimize')?.addEventListener('click', () => invoke('window_minimize'));
  document.getElementById('btn-maximize')?.addEventListener('click', () => invoke('window_toggle_maximize'));
  document.getElementById('btn-close')?.addEventListener('click', () => invoke('window_close'));
}

// Initial Data Loader
function isTransientSessionRestoreError(error) {
  const message = String(typeof error === 'string' ? error : error?.message || '');
  return /HTTP (?:429|5\d\d)|timeout|истекло время ожидания|не удалось установить защищённое TLS-соединение|ошибка сетевого обмена|не удалось связаться с ByMeVPN API/i.test(message);
}

function sessionRestoreErrorMessage(error) {
  const message = String(typeof error === 'string' ? error : error?.message || '');
  const status = message.match(/HTTP (\d{3})/i)?.[1];
  if (/timeout|истекло время ожидания|TLS|ошибка сетевого обмена|не удалось связаться с ByMeVPN API/i.test(message)) {
    return uiText(
      'Не удалось связаться с сервером авторизации. Проверьте интернет и повторите проверку аккаунта.',
      'Could not reach the sign-in server. Check your internet connection and retry account verification.'
    );
  }
  if (status && (status === '429' || Number(status) >= 500)) {
    return uiText(
      `Сервер авторизации временно не ответил (HTTP ${status}). Повторите проверку аккаунта.`,
      `The sign-in server did not respond (HTTP ${status}). Retry account verification.`
    );
  }
  return uiText(
    'Не удалось проверить сохранённый сеанс. Повторите проверку аккаунта.',
    'Could not verify the saved session. Retry account verification.'
  );
}

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
  let restoreError = null;
  try {
    session = await invoke('restore_session');
  } catch (error) {
    restoreFailed = true;
    restoreError = error;
    if (isTransientSessionRestoreError(error)) {
      await new Promise(resolve => setTimeout(resolve, 450));
      if (epoch !== state.sessionEpoch) return;
      try {
        session = await invoke('restore_session');
        restoreFailed = false;
        restoreError = null;
      } catch (retryError) {
        restoreError = retryError;
      }
    }
  }
  if (epoch !== state.sessionEpoch) return;
  if (session?.user) {
    state.user = session.user;
    setSubscription(session.subscription);
    showAppShell();
  } else {
    showAuthScreen('login');
    // The retry control lives inside a recovery panel; toggling only the
    // button left it invisible whenever a saved session could not be checked.
    const recovery = document.getElementById('auth-session-recovery');
    recovery?.classList.toggle('hidden', !restoreFailed);
    document.getElementById('btn-retry-session')?.classList.remove('hidden');
    const recoveryMessage = document.getElementById('auth-session-message');
    if (recoveryMessage) recoveryMessage.textContent = restoreFailed
      ? sessionRestoreErrorMessage(restoreError) : '';
    if (restoreFailed) showToast(sessionRestoreErrorMessage(restoreError), true);
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

async function loadAvailableServers(options = {}) {
  const epoch = state.sessionEpoch;
  if (!options.automaticRetry) clearServerCatalogRetry();

  const inFlight = serverCatalogInFlight;
  if (inFlight?.epoch === epoch) {
    if (!options.forceProbe || inFlight.forceProbe) return inFlight.promise;
    return inFlight.promise.catch(() => false).then(() => {
      if (epoch !== state.sessionEpoch) return false;
      return loadAvailableServers(options);
    });
  }

  const entry = { epoch, forceProbe: options.forceProbe === true, promise: null };
  entry.promise = loadAvailableServersOnce(options, epoch).finally(() => {
    if (serverCatalogInFlight === entry) serverCatalogInFlight = null;
  });
  serverCatalogInFlight = entry;
  return entry.promise;
}

async function loadAvailableServersOnce(options, epoch) {
  try {
    const servers = await fetchServerCatalog(epoch, options);
    if (epoch !== state.sessionEpoch) return false;
    if (!Array.isArray(servers)) throw new Error('Invalid server catalog');
    state.servers = servers;
    if (servers.some(server => server?.ping_method === 'vpn_https' && Number(server.ping) > 0)) {
      state.measurementsAt = Date.now();
    }
    state.serversStale = false;
    saveServerCatalogCache(state.servers);
    const preferred = state.servers.find(s => s.code === state.preferredServerCode && s.supported !== false);
    // Never relabel a live tunnel when the server catalog refreshes.
    // The selected endpoint changes only after a successful stop/switch flow.
    if (!state.vpnConnected && !state.connectionBusy) {
      state.selectedServer = preferred || {
        code: 'auto', name: 'Автоматически', country: '', flag: '🌐', ping: 0
      };
      state.autoSelectedServer = state.selectedServer.code === 'auto'
        ? chooseAutomaticServer(state.servers) : null;
    }
    const autoButton = document.getElementById('recommended-server-auto');
    autoButton?.classList.toggle('selected', state.selectedServer.code === 'auto');
    autoButton?.setAttribute('aria-pressed', String(state.selectedServer.code === 'auto'));
    renderServersList();
    updateVpnUi();
    const hasSupportedServer = state.servers.some(server => server.supported !== false);
    if (hasSupportedServer) clearServerCatalogRetry();
    else if (!options.automaticRetry) scheduleServerCatalogRetry(epoch, String(state.user?.id ?? ''));
    return hasSupportedServer;
  } catch (err) {
    if (epoch !== state.sessionEpoch) return false;
    if (!state.servers.length) state.servers = readServerCatalogCache();
    state.serversStale = state.servers.length > 0;
    if (!state.vpnConnected && !state.connectionBusy) {
      const preferred = state.servers.find(s => s.code === state.preferredServerCode && s.supported !== false);
      state.selectedServer = preferred || {
        code: 'auto', name: 'Автоматически', country: '', flag: '🌐', ping: 0
      };
      state.autoSelectedServer = state.selectedServer.code === 'auto'
        ? chooseAutomaticServer(state.servers) : null;
    }
    renderServersList();
    if (!options.automaticRetry) {
      showToast(state.serversStale
        ? uiText('Не удалось обновить серверы. Показаны последние сохранённые локации; для подключения нужна сеть.',
          'Could not refresh servers. Showing the last saved locations; a network connection is required to connect.')
        : serverCatalogErrorMessage(err), true);
      scheduleServerCatalogRetry(epoch, String(state.user?.id ?? ''));
    }
    return false;
  }
}

function clearServerCatalogRetry() {
  if (serverCatalogRetryTimer !== null) clearTimeout(serverCatalogRetryTimer);
  serverCatalogRetryTimer = null;
  serverCatalogRetryAttempt = 0;
  serverCatalogRetryOwner = null;
}

function canRetryServerCatalog(epoch, accountId) {
  const subscription = state.subscription;
  return Boolean(state.user?.id) && epoch === state.sessionEpoch &&
    String(state.user.id) === accountId &&
    ['active', 'trial', 'grace'].includes(subscription?.status) &&
    !subscriptionExpired(subscription) && !state.vpnConnected &&
    !state.connectionBusy && (state.servers.length === 0 || state.serversStale);
}

function scheduleServerCatalogRetry(epoch, accountId) {
  if (!canRetryServerCatalog(epoch, accountId)) {
    clearServerCatalogRetry();
    return;
  }
  if (serverCatalogRetryOwner &&
      (serverCatalogRetryOwner.epoch !== epoch || serverCatalogRetryOwner.accountId !== accountId)) {
    clearServerCatalogRetry();
  }
  serverCatalogRetryOwner = { epoch, accountId };
  if (serverCatalogRetryTimer !== null) return;
  const delay = SERVER_CATALOG_RETRY_DELAYS_MS[serverCatalogRetryAttempt];
  if (delay === undefined) return;
  serverCatalogRetryAttempt += 1;
  serverCatalogRetryTimer = setTimeout(async () => {
    serverCatalogRetryTimer = null;
    if (!canRetryServerCatalog(epoch, accountId)) {
      clearServerCatalogRetry();
      return;
    }
    const loaded = await loadAvailableServers({ automaticRetry: true });
    if (loaded || !canRetryServerCatalog(epoch, accountId)) {
      clearServerCatalogRetry();
      return;
    }
    scheduleServerCatalogRetry(epoch, accountId);
  }, delay);
  serverCatalogRetryTimer?.unref?.();
}

const SERVER_CATALOG_CACHE_KEY = 'bymevpn.server-catalog.v1';
const SERVER_CATALOG_FIELDS = [
  'name', 'name_en', 'country', 'country_en', 'country_code', 'city', 'city_en', 'flag',
  'protocol', 'security'
];

function sanitizeCachedServerCatalog(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).flatMap(server => {
    if (!server || typeof server !== 'object' ||
        typeof server.code !== 'string' || !/^[a-z0-9._-]{1,64}$/i.test(server.code) ||
        typeof server.supported !== 'boolean') return [];
    const safe = { code: server.code, supported: server.supported };
    for (const field of SERVER_CATALOG_FIELDS) {
      if (typeof server[field] === 'string') safe[field] = server[field].slice(0, 100);
    }
    if (server.ping_method === 'vpn_https' || server.ping_method === 'tcp_connect') {
      safe.ping_method = server.ping_method;
    }
    // Cached catalog entries can outlive the network and server settings.
    // Never show an old measurement as current latency.
    safe.ping = 0;
    return [safe];
  });
}

function readServerCatalogCache() {
  try {
    return sanitizeCachedServerCatalog(JSON.parse(localStorage.getItem(SERVER_CATALOG_CACHE_KEY) || 'null'));
  } catch (_) {
    return [];
  }
}

function saveServerCatalogCache(servers) {
  try {
    const safe = sanitizeCachedServerCatalog(servers);
    if (safe.length) localStorage.setItem(SERVER_CATALOG_CACHE_KEY, JSON.stringify(safe));
  } catch (_) {
    // Storage is only a convenience; the live API remains authoritative.
  }
}

async function fetchServerCatalog(epoch, { forceProbe = false } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await invoke('get_servers', forceProbe
        ? { forceProbe: true, clientEpoch: epoch }
        : { clientEpoch: epoch });
    } catch (error) {
      const raw = String(typeof error === 'string' ? error : error?.message || '');
      const retryable = /HTTP (?:429|5\d\d)|timeout|истекло время ожидания|не удалось установить защищённое TLS-соединение|ошибка сетевого обмена|не удалось связаться с ByMeVPN API/i.test(raw);
      if (attempt !== 0 || !retryable) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
      if (epoch !== state.sessionEpoch) return null;
    }
  }
  return null;
}

function serverCatalogErrorMessage(error) {
  const raw = String(typeof error === 'string' ? error : error?.message || '');
  if (/HTTP 401|UNAUTHORIZED|сначала войдите|сеанс истёк/i.test(raw)) {
    return uiText('Сеанс API истёк. Обновите аккаунт или войдите снова.',
      'The API session expired. Refresh your account or sign in again.');
  }
  if (/DEVICE_LIMIT/i.test(raw)) {
    return uiText('Достигнут лимит устройств. Удалите старое устройство или увеличьте лимит в Telegram-боте.',
      'Device limit reached. Remove an old device or upgrade the limit in the Telegram bot.');
  }
  if (/HTTP 403|SUBSCRIPTION_REQUIRED/i.test(raw)) {
    return uiText('Серверы недоступны для текущего статуса подписки. Обновите аккаунт.',
      'Servers are unavailable for the current subscription. Refresh your account.');
  }
  if (/HTTP 404|не вернул список доступных локаций/i.test(raw)) {
    return uiText('API не вернул список серверов. Обновите приложение или повторите позже.',
      'The API did not return a server list. Update the app or try again later.');
  }
  if (/HTTP (?:429|5\d\d)|timeout|истекло время ожидания/i.test(raw)) {
    return uiText('Сервис серверов временно недоступен. Список будет загружен при повторной попытке.',
      'The server service is temporarily unavailable. Retry to load the list.');
  }
  return uiText('Не удалось связаться с API серверов. Проверьте интернет и нажмите «Обновить».',
    'Could not reach the server API. Check your internet and press “Refresh”.');
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
  state.pricingLoading = true;
  state.pricingLoadError = '';
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
    state.catalogReady = true;
  } catch (err) {
    if (epoch !== state.sessionEpoch) return;
    state.catalogReady = false;
    state.availableDeviceCounts = [];
    state.pricingLoadError = pricingCatalogErrorMessage(err);
    for (const devices of [2, 5, 10]) PRICING_MATRIX[devices] = {};
  }
  if (epoch !== state.sessionEpoch) return;
  state.pricingLoading = false;
  updatePricingMatrixUi();
}

function pricingCatalogErrorMessage(error) {
  const raw = String(typeof error === 'string' ? error : error?.message || '');
  if (/HTTP 404|каталог недоступен|not deployed/i.test(raw)) {
    return uiText('Покупка пока недоступна. Попробуйте позже.', 'Purchases are temporarily unavailable. Please try again later.');
  }
  return uiText('Не удалось загрузить тарифы. Попробуйте ещё раз.', 'Could not load plans. Please try again.');
}

// UI State Toggles: Auth vs App Shell
let subscriptionExpiryTimer = null;

function subscriptionRemaining(sub) {
  const seconds = sub?.seconds_remaining;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const syncedAt = sub._receivedAt;
  if (!Number.isFinite(syncedAt)) return seconds;
  return Math.max(0, seconds - Math.floor(Math.max(0, Date.now() - syncedAt) / 1000));
}

function subscriptionExpired(sub) {
  return subscriptionRemaining(sub) === 0;
}

function setSubscription(value) {
  if (subscriptionExpiryTimer) clearTimeout(subscriptionExpiryTimer);
  subscriptionExpiryTimer = null;
  state.subscription = value && typeof value === 'object' ? { ...value, _receivedAt: Date.now() } : value;
  const current = state.subscription;
  const schedule = () => {
    if (state.subscription !== current) return;
    const remaining = subscriptionRemaining(current);
    if (remaining === null) return;
    if (remaining <= 0) {
      updateSubscriptionUi();
      updateVpnUi();
      updateDevicesUi();
      if (state.user) void refreshAccountSnapshot();
      return;
    }
    subscriptionExpiryTimer = setTimeout(schedule, Math.min(remaining * 1000, 2147483647));
    subscriptionExpiryTimer?.unref?.();
  };
  schedule();
  if (state.user && ['active', 'trial', 'grace'].includes(current?.status) &&
      !subscriptionExpired(current) && (state.servers.length === 0 || state.serversStale)) {
    scheduleServerCatalogRetry(state.sessionEpoch, String(state.user.id));
  } else {
    clearServerCatalogRetry();
  }
}

function showAuthScreen(box = 'login') {
  clearServerCatalogRetry();
  document.getElementById('view-auth')?.classList.remove('hidden');
  document.getElementById('view-auth')?.setAttribute('data-auth-mode', box);
  document.getElementById('view-app-shell')?.classList.add('hidden');
  // Do not carry a previous session-recovery warning into a fresh sign-in.
  document.getElementById('auth-session-recovery')?.classList.add('hidden');
  document.getElementById('btn-retry-session')?.classList.remove('hidden');
  const recoveryMessage = document.getElementById('auth-session-message');
  if (recoveryMessage) recoveryMessage.textContent = '';
  
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
  const accountId = String(state.user?.id ?? '');
  if (state.activeAccountId && accountId && state.activeAccountId !== accountId) {
    // A cached catalog belongs to the account that loaded it; never show it
    // to a different account during an in-session account switch.
    state.servers = [];
    state.serversStale = false;
    try { localStorage.removeItem(SERVER_CATALOG_CACHE_KEY); } catch (_) { /* optional cache */ }
  }
  state.activeAccountId = accountId || null;
  clearServerCatalogRetry();
  state.devicesRefreshGeneration += 1;
  state.devices = [];
  state.devicesSupported = false;
  state.devicesLoaded = false;
  state.devicesUnavailable = false;
  state.devicesRefreshing = false;
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
  document.getElementById('app-sidebar')?.classList?.toggle('hidden',
    ['tab-pricing', 'tab-trial'].includes(tabId));

  // Android keeps the originating bottom tab selected on secondary screens.
  const pricingOrigin = state.pricingReturnTab;
  const rootTab = tabId === 'tab-servers' ? 'tab-home'
    : tabId === 'tab-pricing'
      ? (['tab-account', 'tab-trial', 'tab-devices', 'tab-renewal'].includes(pricingOrigin) ? 'tab-account' : 'tab-home')
    : ['tab-devices', 'tab-renewal'].includes(tabId) ? 'tab-account'
    : tabId === 'tab-trial' ? 'tab-account'
    : tabId === 'tab-support'
      ? (state.supportReturnTab === 'tab-home' ? 'tab-home' : 'tab-account')
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
  const backTarget = getPageBackTarget(tabId);
  const pageBack = document.getElementById('btn-page-back');
  pageBack?.classList?.toggle('hidden', !backTarget || tabId === 'tab-pricing');
  if (pageBack) {
    pageBack.title = dict.back || (lang === 'ru' ? 'Назад' : 'Back');
    pageBack.setAttribute('aria-label', pageBack.title);
  }

  switch (tabId) {
    case 'tab-home':
      titleEl.textContent = dict.nav_connection;
      break;
    case 'tab-pricing':
      titleEl.textContent = lang === 'ru' ? 'Подключение доступа' : 'Subscribe';
      break;
    case 'tab-trial':
      titleEl.textContent = dict.trial_page_title;
      break;
    case 'tab-servers':
      titleEl.textContent = lang === 'ru' ? 'Серверы' : 'Servers';
      void autoMeasureServerLatencyIfNeeded();
      break;
    case 'tab-account':
      titleEl.textContent = dict.nav_account;
      break;
    case 'tab-settings':
      titleEl.textContent = dict.nav_settings;
      break;
    case 'tab-devices':
      titleEl.textContent = lang === 'ru' ? 'Мои устройства' : 'My devices';
      break;
    case 'tab-renewal':
      titleEl.textContent = lang === 'ru' ? 'Автопродление' : 'Auto-renewal';
      break;
    case 'tab-support':
      titleEl.textContent = lang === 'ru' ? 'Помощь' : 'Help';
      break;
    case 'tab-advanced':
      titleEl.textContent = lang === 'ru' ? 'Дополнительно' : 'More settings';
      break;
  }

  // Android keeps the Home brand behind the server sheet and titles each page
  // beside its back control. Pricing owns a separate full-screen top bar.
  const homeHeader = tabId === 'tab-home' || tabId === 'tab-servers';
  document.getElementById('mobile-header-brand')?.classList?.toggle('hidden', !homeHeader);
  document.getElementById('btn-top-help')?.classList?.toggle('hidden', !homeHeader);
  titleEl?.classList?.toggle('hidden', homeHeader || tabId === 'tab-pricing');
  if (tabId === 'tab-trial') updateTrialScreen();
}

function getPageBackTarget(tabId) {
  if (tabId === 'tab-trial') return state.trialReturnTab || 'tab-account';
  if (tabId === 'tab-pricing') return state.pricingReturnTab || 'tab-home';
  if (tabId === 'tab-support') return state.supportReturnTab || 'tab-account';
  return {
    'tab-settings': 'tab-home',
    'tab-account': 'tab-home',
    'tab-advanced': 'tab-settings',
    'tab-devices': 'tab-account',
    'tab-renewal': 'tab-account'
  }[tabId] || null;
}

function handlePageBack() {
  const target = getPageBackTarget(state.currentTab);
  if (target) switchTab(target);
}

function openTrialScreen() {
  state.trialReturnTab = state.currentTab === 'tab-trial'
    ? 'tab-account' : state.currentTab;
  state.trialPageChecking = Boolean(state.user?.id);
  switchTab('tab-trial');
  updateTrialScreen();
  if (state.user?.id) void refreshTrialScreen();
}

async function refreshTrialScreen() {
  const epoch = state.sessionEpoch;
  const accountId = String(state.user?.id ?? '');
  if (!accountId) {
    state.trialPageChecking = false;
    updateTrialScreen();
    return;
  }
  state.trialPageChecking = true;
  updateTrialScreen();
  try {
    await refreshAccountSnapshot();
  } finally {
    if (state.sessionEpoch === epoch && String(state.user?.id ?? '') === accountId) {
      state.trialPageChecking = false;
      updateTrialScreen();
    }
  }
}

function openPricingScreen() {
  state.pricingReturnTab = state.currentTab;
  switchTab('tab-pricing');
}

function openSupportScreen() {
  state.supportReturnTab = ['tab-home', 'tab-servers'].includes(state.currentTab)
    ? 'tab-home' : 'tab-account';
  switchTab('tab-support');
}

function nextFaqExpandedIndex(expandedIndex, selectedIndex) {
  return expandedIndex === selectedIndex ? null : selectedIndex;
}

function setFaqExpandedIndex(selectedIndex) {
  const items = Array.from(document.querySelectorAll('#modal-faq .faq-accordion-item'));
  const current = items.findIndex(item => item.classList.contains('expanded'));
  const nextIndex = nextFaqExpandedIndex(current < 0 ? null : current, selectedIndex);
  items.forEach((item, index) => {
    const expanded = index === nextIndex;
    item.classList.toggle('expanded', expanded);
    item.querySelector('.faq-item-toggle')?.setAttribute('aria-expanded', String(expanded));
    item.querySelector('.faq-item-body')?.setAttribute('aria-hidden', String(!expanded));
  });
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
  document.querySelectorAll('[role="button"][tabindex="0"]').forEach(element => {
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        element.click();
      }
    });
  });

  // Password visibility toggles. Keep the SVG intact and express the state
  // with aria-pressed so the icon cannot degrade to a platform emoji.
  document.querySelectorAll('.btn-password-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const box = btn.closest('.input-field-box');
      const input = box?.querySelector('input');
      if (input) {
        const visible = input.type === 'password';
        input.type = visible ? 'text' : 'password';
        btn.setAttribute('aria-pressed', String(visible));
        btn.setAttribute('aria-label', visible
          ? uiText('Скрыть пароль', 'Hide password')
          : uiText('Показать пароль', 'Show password'));
        input.focus({ preventScroll: true });
      }
    });
  });

  // Clear a field error as soon as the user corrects that field.
  for (const [inputId, errorId] of [
    ['login-email', 'login-email-error'],
    ['login-password', 'login-password-error'],
    ['register-email', 'register-email-error'],
    ['register-password', 'register-password-error'],
    ['register-password-confirm', 'register-password-confirm-error']
  ]) {
    document.getElementById(inputId)?.addEventListener('input', () => {
      setFieldError(errorId, '', inputId);
    });
  }

  // Forms submission
  document.getElementById('form-login')?.addEventListener('submit', handleLogin);
  document.getElementById('btn-reset-password')?.addEventListener('click', handlePasswordReset);
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

  document.getElementById('btn-page-back')?.addEventListener('click', () => {
    handlePageBack();
  });

  // Subpage Back Buttons
  document.getElementById('btn-back-from-devices')?.addEventListener('click', () => switchTab('tab-account'));
  document.getElementById('btn-back-from-renewal')?.addEventListener('click', () => switchTab('tab-account'));
  document.getElementById('btn-back-from-support')?.addEventListener('click', handlePageBack);
  document.getElementById('btn-back-from-advanced')?.addEventListener('click', () => switchTab('tab-settings'));

  // Account Subpages Triggers
  document.getElementById('btn-acc-open-devices')?.addEventListener('click', () => switchTab('tab-devices'));
  document.getElementById('btn-account-open-pricing')?.addEventListener('click', openPricingScreen);
  document.getElementById('btn-account-open-renewal')?.addEventListener('click', () => {
    switchTab('tab-renewal');
    void refreshRenewal();
  });
  document.getElementById('btn-account-trial')?.addEventListener('click', openTrialScreen);
  document.getElementById('btn-account-pricing')?.addEventListener('click', openPricingScreen);
  document.getElementById('btn-renewal-refresh')?.addEventListener('click', refreshRenewal);
  document.getElementById('btn-renewal-cancel')?.addEventListener('click', confirmCancelRenewal);
  document.getElementById('btn-renewal-enable')?.addEventListener('click', confirmEnableRenewal);
  document.getElementById('btn-renewal-telegram')?.addEventListener('click', openRenewalTelegram);
  document.getElementById('btn-acc-open-support')?.addEventListener('click', openSupportScreen);
  document.getElementById('btn-account-refresh')?.addEventListener('click', async () => {
    await refreshAccountSnapshot(true);
    await loadAvailableServers();
  });
  document.getElementById('btn-account-password-reset')?.addEventListener('click', handleAccountPasswordReset);
  document.getElementById('btn-account-copy-id')?.addEventListener('click', handleCopyAccountId);
  document.getElementById('btn-account-settings-open')?.addEventListener('click', () => openModal('modal-account-settings'));
  document.getElementById('btn-language-dialog')?.addEventListener('click', () => openModal('modal-language'));
  document.getElementById('btn-trial-activate')?.addEventListener('click', handleActivateTrial);
  document.getElementById('btn-trial-plans')?.addEventListener('click', openPricingScreen);
  document.getElementById('btn-pricing-back')?.addEventListener('click', handlePageBack);
  document.getElementById('btn-pricing-retry')?.addEventListener('click', () => { void loadPricingCatalog(); });
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
  document.getElementById('btn-measure-server-latency')?.addEventListener('click', async () => {
    const button = document.getElementById('btn-measure-server-latency');
    if (!button || state.latencyRefreshing || state.vpnConnected || state.connectionBusy) return;
    state.latencyRefreshing = true;
    // Never leave the control disabled if a native probe task dies without
    // emitting its final event. The watchdog only clears the busy flag; it
    // never invents a latency value.
    clearTimeout(state.latencyWatchdog);
    state.latencyWatchdog = setTimeout(() => {
      state.latencyRefreshing = false;
      updateVpnUi();
    }, 30000);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const label = button.querySelector('[data-latency-label]');
    if (label) label.textContent = uiText(I18N.ru.server_latency_checking, I18N.en.server_latency_checking);
    try {
      const loaded = await loadAvailableServers({ forceProbe: true });
      if (!loaded || !state.servers.some(server => [-3, -4].includes(Number(server.ping)))) {
        clearTimeout(state.latencyWatchdog);
        state.latencyRefreshing = false;
      }
      updateVpnUi();
    } catch {
      clearTimeout(state.latencyWatchdog);
      state.latencyRefreshing = false;
      updateVpnUi();
    }
  });
  document.getElementById('recommended-server-auto')?.addEventListener('click', () => {
    state.autoSelectedServer = chooseAutomaticServer(state.servers);
    void selectServer({ code: 'auto', name: 'Автоматически', country: '', flag: '🌐', ping: 0 });
  });
  // The quick bypass strip must not be a dead end: Android exposes the
  // corresponding switch under Settings > Connection.
  document.getElementById('btn-toggle-bypass-quick')?.addEventListener('click', () =>
    switchTab('tab-settings'));

  // Pricing / Subscription triggers
  document.getElementById('btn-home-activate-trial')?.addEventListener('click', handleActivateTrial);
  document.getElementById('btn-no-plan-trial')?.addEventListener('click', handleHomeNoPlanAction);
  document.getElementById('btn-no-plan-telegram')?.addEventListener('click', startTelegramAuthFlow);
  document.getElementById('btn-pricing-activate-trial')?.addEventListener('click', handleActivateTrial);
  document.getElementById('btn-home-all-tariffs')?.addEventListener('click', openPricingScreen);
  document.getElementById('btn-no-plan-pricing')?.addEventListener('click', openPricingScreen);
  document.getElementById('btn-open-manage-pricing')?.addEventListener('click', openPricingScreen);
  document.getElementById('btn-acc-renew')?.addEventListener('click', openPricingScreen);

  // Support subpage actions
  document.getElementById('btn-open-support-telegram')?.addEventListener('click', handleOpenTelegramSupport);
  document.getElementById('card-support-email')?.addEventListener('click', handleOpenSupportEmail);
  document.getElementById('btn-devices-upgrade')?.addEventListener('click', () => {
    invoke('open_external_url', { url: 'https://t.me/ByMeVPNbot' })
      .catch(() => showToast(uiText('Не удалось открыть Telegram. Найдите @ByMeVPNbot.', 'Could not open Telegram. Search for @ByMeVPNbot.'), true));
  });
  document.getElementById('btn-devices-retry')?.addEventListener('click', () => {
    if (!state.devicesRefreshing) void refreshAccountSnapshot();
  });
  document.getElementById('card-support-faq')?.addEventListener('click', () => openModal('modal-faq'));
  document.getElementById('card-support-legal')?.addEventListener('click', () => openLegalModal('terms'));
  document.getElementById('card-support-about')?.addEventListener('click', () => openLegalModal('about'));

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
  document.getElementById('home-error-support')?.addEventListener('click', openSupportScreen);
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
  document.getElementById('set-autoreconnect')?.addEventListener('change', e => handleSettingChange('autoReconnect', e.target.checked));
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
      const selectedIndex = Number(btn.dataset.faqIndex);
      if (Number.isSafeInteger(selectedIndex) && selectedIndex >= 0) {
        setFaqExpandedIndex(selectedIndex);
      }
    });
  });
}

// Authentication Handlers
function setAuthPending(pending) {
  state.authBusy = pending;
  for (const id of ['btn-submit-login', 'btn-submit-register', 'btn-tg-login-modal', 'btn-tg-register-modal', 'btn-google-login', 'btn-google-register', 'btn-reset-password']) {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = pending;
      el.setAttribute('aria-busy', String(pending));
    }
  }
}

function setFieldError(errorId, message, inputId = '') {
  const el = document.getElementById(errorId);
  if (el) {
    el.textContent = message || '';
    el.classList.toggle('hidden', !message);
  }
  const input = inputId ? document.getElementById(inputId) : null;
  if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function clearAuthErrors(mode = 'login') {
  const prefix = mode === 'register' ? 'register' : 'login';
  for (const field of ['email', 'password', 'password-confirm']) {
    setFieldError(`${prefix}-${field}-error`, '', `${prefix}-${field}`);
  }
  setFieldError(`${prefix}-auth-error`, '');
}

function validEmailFormat(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

async function handlePasswordReset() {
  if (state.authBusy) return;
  const input = document.getElementById('login-email');
  const email = input?.value?.trim();
  if (!email || !input.checkValidity()) {
    showToast(uiText('Введите корректный email.', 'Enter a valid email address.'), true);
    input?.focus();
    return;
  }
  setAuthPending(true);
  try {
    await invoke('auth_request_password_reset', { email });
    showToast(uiText('Если аккаунт существует, письмо для восстановления отправлено.', 'If an account exists, a recovery email has been sent.'));
  } catch (err) {
    showToast(typeof err === 'string' ? err : err?.message || uiText('Не удалось запросить восстановление.', 'Could not request password recovery.'), true);
  } finally {
    setAuthPending(false);
  }
}

async function handleAccountPasswordReset() {
  const user = state.user;
  const email = typeof user?.email === 'string' ? user.email.trim() : '';
  if (state.accountPasswordResetBusy || user?.is_google === true || !email.includes('@') || email === 'user@bymevpn.app') return;
  const epoch = state.sessionEpoch;
  state.accountPasswordResetBusy = true;
  const button = document.getElementById('btn-account-password-reset');
  if (button) button.disabled = true;
  try {
    await invoke('auth_request_password_reset', { email });
    if (epoch === state.sessionEpoch) showToast(uiText('Если пароль доступен для этого аккаунта, ссылка придёт на почту.', 'If password reset is available, a link will be sent to your email.'));
  } catch (_) {
    if (epoch === state.sessionEpoch) showToast(uiText('Не удалось запросить восстановление. Повторите позже.', 'Could not request password recovery. Try again later.'), true);
  } finally {
    state.accountPasswordResetBusy = false;
    if (button) button.disabled = false;
  }
}

async function handleCopyAccountId() {
  const accountId = String(state.user?.id ?? '').trim();
  if (!accountId) return;
  const button = document.getElementById('btn-account-copy-id');
  if (button?.disabled) return;
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  try {
    await writeTextToClipboard(accountId);
    showToast(uiText(I18N.ru.account_id_copied, I18N.en.account_id_copied));
  } catch {
    showToast(uiText(I18N.ru.account_id_copy_failed, I18N.en.account_id_copy_failed), true);
  } finally {
    if (button) {
      button.disabled = !String(state.user?.id ?? '').trim();
      button.setAttribute('aria-busy', 'false');
    }
  }
}

async function handleLogin(e) {
  e.preventDefault();
  if (state.authBusy) return;
  clearAuthErrors('login');
  const email = document.getElementById('login-email')?.value?.trim();
  const password = document.getElementById('login-password')?.value;
  if (!email) {
    setFieldError('login-email-error', uiText('Введите email.', 'Enter your email.'), 'login-email');
    document.getElementById('login-email')?.focus();
    return;
  }
  if (!validEmailFormat(email)) {
    setFieldError('login-email-error', uiText('Введите корректный email.', 'Enter a valid email address.'), 'login-email');
    document.getElementById('login-email')?.focus();
    return;
  }
  if (!password) {
    setFieldError('login-password-error', uiText('Введите пароль.', 'Enter your password.'), 'login-password');
    document.getElementById('login-password')?.focus();
    return;
  }
  setAuthPending(true);
  try {
    const res = await invoke('auth_login', { email, password });
    if (!res?.user?.id) throw new Error(uiText('Сервер не подтвердил вход в аккаунт', 'The server did not confirm the sign-in.'));
    state.sessionEpoch += 1;
    state.user = res.user;
    setSubscription(res.subscription);
    showAppShell();
    showToast(uiText('Вход выполнен', 'Signed in successfully.'));
    const passwordInput = document.getElementById('login-password');
    if (passwordInput) passwordInput.value = '';
  } catch (err) {
    const message = typeof err === 'string' ? err : err?.message || uiText('Не удалось войти', 'Sign-in failed.');
    setFieldError('login-auth-error', message);
    showToast(message, true);
  } finally {
    setAuthPending(false);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  if (state.authBusy) return;
  clearAuthErrors('register');
  const name = document.getElementById('register-name')?.value?.trim() || uiText('Пользователь', 'User');
  const email = document.getElementById('register-email')?.value?.trim();
  const password = document.getElementById('register-password')?.value;
  const confirm = document.getElementById('register-password-confirm')?.value;
  if (!email) {
    setFieldError('register-email-error', uiText('Введите email.', 'Enter your email.'), 'register-email');
    document.getElementById('register-email')?.focus();
    return;
  }
  if (!validEmailFormat(email)) {
    setFieldError('register-email-error', uiText('Введите корректный email.', 'Enter a valid email address.'), 'register-email');
    document.getElementById('register-email')?.focus();
    return;
  }
  if (!password) {
    setFieldError('register-password-error', uiText('Введите пароль.', 'Enter a password.'), 'register-password');
    document.getElementById('register-password')?.focus();
    return;
  }
  if (password.length < 6) {
    setFieldError('register-password-error', uiText('Минимальная длина пароля — 6 символов', 'Use a password of at least 6 characters.'), 'register-password');
    document.getElementById('register-password')?.focus();
    return;
  }
  if (password !== confirm) {
    setFieldError('register-password-confirm-error', uiText('Пароли не совпадают', 'Passwords do not match.'), 'register-password-confirm');
    document.getElementById('register-password-confirm')?.focus();
    return;
  }
  setAuthPending(true);
  try {
    const res = await invoke('auth_register', { email, password, name });
    if (!res?.user?.id) throw new Error(uiText('Сервер не подтвердил регистрацию', 'The server did not confirm the registration.'));
    state.sessionEpoch += 1;
    state.user = res.user;
    setSubscription(res.subscription);
    showAppShell();
    showToast(uiText('Аккаунт создан', 'Account created.'));
    const passwordInput = document.getElementById('register-password');
    const confirmInput = document.getElementById('register-password-confirm');
    if (passwordInput) passwordInput.value = '';
    if (confirmInput) confirmInput.value = '';
  } catch (err) {
    const message = typeof err === 'string' ? err : err?.message || uiText('Не удалось зарегистрироваться', 'Could not create your account.');
    setFieldError('register-auth-error', message);
    showToast(message, true);
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
    setSubscription(result.subscription);
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
  updateNoPlanPresentation();
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
          setSubscription(check.auth.subscription);
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
    updateNoPlanPresentation();
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
      state.reconnectPending = false;
      state.connectionError = null;
      state.vpnSequence += 1;
      state.metrics = { download_mbps: 0, upload_mbps: 0, ping_ms: 0 };
      state.servers = [];
      state.serversStale = false;
      try { localStorage.removeItem(SERVER_CATALOG_CACHE_KEY); } catch (_) { /* optional cache */ }
      state.devices = [];
      state.devicesRefreshGeneration += 1;
      state.devicesSupported = false;
      state.devicesLoaded = false;
      state.devicesUnavailable = false;
      state.devicesRefreshing = false;
      state.user = null;
      setSubscription(null);
      state.pendingCheckout = null;
      showAuthScreen('login');
      showToast('Вы вышли из системы');
    }
  );
}

async function handleDeleteAccount() {
  if (state.accountDeleteBusy) return;
  const epoch = state.sessionEpoch;
  const accountId = String(state.user?.id ?? '');
  if (!accountId) return;
  let generation;
  try {
    generation = await invoke('auth_session_generation');
    if (!Number.isSafeInteger(generation) || generation < 0) throw new Error('Invalid session');
  } catch (_) {
    if (epoch === state.sessionEpoch) showToast(uiText('Не удалось проверить сеанс. Войдите снова.', 'Could not verify your session. Sign in again.'), true);
    return;
  }
  if (epoch !== state.sessionEpoch || String(state.user?.id ?? '') !== accountId) return;
  showConfirm(
    uiText('Удалить аккаунт без возможности восстановления?', 'Permanently delete your account?'),
    uiText('Аккаунт и доступ к VPN будут удалены. Оплаченный срок не сохраняется. Финансовые записи могут сохраняться для расчётов и споров. Это действие нельзя отменить.',
      'Your account and VPN access will be deleted. Remaining paid time will be lost. Financial records may be retained for payments and disputes. This cannot be undone.'),
    async () => {
      if (epoch !== state.sessionEpoch || String(state.user?.id ?? '') !== accountId) return;
      if (state.accountDeleteBusy) return;
      if (state.connectionBusy || state.serverSwitchBusy) {
        showToast(uiText('Дождитесь завершения работы VPN', 'Wait for the VPN operation to finish.'), true);
        return;
      }
      state.accountDeleteBusy = true;
      try {
        await invoke('auth_delete_account', { generation });
        if (epoch !== state.sessionEpoch || String(state.user?.id ?? '') !== accountId) return;
        state.sessionEpoch += 1;
        cancelTelegramPolling();
        for (const interval of ['pollInterval', 'timerInterval']) {
          if (state[interval]) clearInterval(state[interval]);
          state[interval] = null;
        }
        state.vpnConnected = false;
        state.vpnVerified = false;
        state.vpnPhase = 'idle';
        state.reconnectPending = false;
        state.connectionError = null;
        state.vpnSequence += 1;
        state.metrics = { download_mbps: 0, upload_mbps: 0, ping_ms: 0 };
        state.user = null;
        setSubscription(null);
        state.devices = [];
        state.devicesRefreshGeneration += 1;
        state.devicesSupported = false;
        state.devicesLoaded = false;
        state.devicesUnavailable = false;
        state.devicesRefreshing = false;
        state.servers = [];
        state.serversStale = false;
        try { localStorage.removeItem(SERVER_CATALOG_CACHE_KEY); } catch (_) { /* optional cache */ }
        state.pendingCheckout = null;
        closeModal('modal-account-settings');
        showAuthScreen('login');
        showToast(uiText('Аккаунт удалён.', 'Account deleted.'));
      } catch (err) {
        if (epoch === state.sessionEpoch) {
          await checkVpnStatus();
          showToast(uiText('Не удалось подтвердить удаление. Попробуйте войти снова или обратитесь в поддержку.',
            'Deletion could not be confirmed. Try signing in again or contact support.'), true);
        }
      } finally {
        state.accountDeleteBusy = false;
      }
    }
  );
}

// Local health report, explicitly distinct from verified internet egress.
async function refreshVpnHealth() {
  const details = document.getElementById('vpn-health-details');
  if (!details) return;
  const epoch = state.sessionEpoch;
  const sequence = state.vpnSequence;
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
      paths_match: uiText('HTTPS проходит через Xray и TUN; внешний IPv4 изменился относительно исходного.',
        'HTTPS works through Xray and TUN; the external IPv4 differs from the original.'),
      routing_bypass: uiText('Windows использует исходный IPv4: возможен обход VPN',
        'Windows uses the original IPv4: the VPN may be bypassed'),
      server_unreachable: uiText('Не прошёл защищённый тест через Xray (причина не установлена)',
        'Protected request through Xray failed (cause not confirmed)'),
      tun_no_traffic: uiText('Сервер Xray отвечает, но Windows TUN не передаёт проверочный HTTPS-запрос',
        'Xray server responds, but Windows TUN cannot pass the HTTPS probe'),
      baseline_unknown: uiText('HTTPS через Xray и TUN проходит, но исходный IPv4 неизвестен; проверка защиты не завершена',
        'HTTPS through Xray and TUN works, but the baseline IPv4 is unknown; protection is not fully verified'),
      traffic_observed_unverified: uiText('HTTPS через Xray и TUN проходит, но IP-проверка недоступна; защита не подтверждена',
        'HTTPS through Xray and TUN works, but IP verification is unavailable; protection is unverified'),
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
      uiText('Восстановление сети: ', 'Network recovery: ') +
        (report?.network_recovery_required === true
          ? uiText('нужно повторить; ByMeVPN не подтвердил очистку', 'retry required; ByMeVPN could not confirm cleanup')
          : uiText('последняя очистка подтверждена', 'last cleanup confirmed')),
      uiText('Маршрут IPv6: ', 'IPv6 route: ') +
        checked(report?.ipv6_default, uiText('установлен', 'installed'), uiText('отсутствует', 'missing')),
      uiText('Выбранный Windows маршрут IPv4: ', 'Windows-selected IPv4 route: ') +
        checked(report?.effective_ipv4, uiText('через ByMeVPN TUN', 'via ByMeVPN TUN'),
          uiText('мимо TUN — соединение не защищено', 'bypasses TUN — unprotected')),
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
    // The native report updates the active tunnel only when its identity and
    // process still match. Discard older status replies before updating Home.
    if (epoch === state.sessionEpoch && sequence === state.vpnSequence &&
        !state.connectionBusy && state.vpnConnected && report?.process_tracked) {
      state.vpnSequence += 1;
      state.vpnVerified = report?.runtime_healthy === true && report?.ip_verified === true;
      state.metrics = { ...state.metrics, proof: report?.egress_probe, verified: state.vpnVerified };
      updateVpnUi();
      void checkVpnStatus();
    }
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
  const disconnectRequested = state.vpnConnected || state.reconnectPending;
  if (!disconnectRequested && (!state.subscription || state.subscription.status === 'unknown' || subscriptionExpired(state.subscription))) {
    openTrialScreen();
    return;
  }
  state.connectionBusy = true;
  state.vpnSequence += 1;
  state.connectionError = null;
  state.vpnPhase = disconnectRequested ? 'disconnecting' : 'connecting';
  updateVpnUi();
  try {
  if (disconnectRequested) {
    showToast('Отключение VPN...');
    try {
      await invoke('vpn_stop');
      state.vpnConnected = false;
      state.vpnVerified = false;
      state.reconnectPending = false;
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
      // An OS route cleanup warning does not mean Xray is still running.
      // Recheck the native process rather than leaving a false green UI.
      try {
        const status = await invoke('vpn_status');
        if (status?.connected === false) {
          state.vpnConnected = false;
          state.vpnVerified = false;
        }
      } catch (_) { /* Keep the last known state if native status is unavailable. */ }
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
      openTrialScreen();
      return;
    }

    if (!state.servers.length) await loadAvailableServers();
    if (!state.servers.some(server => server.supported !== false)) {
      showToast('Не удалось получить совместимые серверы. Проверьте сеть и обновите список.', true);
      return;
    }

    showToast('Запуск туннеля Xray + Wintun...');
    try {
      // Match Android's automatic selection: use the fastest measured node,
      // otherwise pick a concrete catalog candidate instead of letting the
      // backend choose an uncontrolled server. The candidate is still a
      // guess, so the automatic fallback below remains in place.
      // A stale measurement is not a reason to connect blind: refresh it in
      // the background while this connect uses the protocol-ranked candidate.
      if (state.selectedServer.code === 'auto' && !state.servers.some(serverHasFreshMeasurement)) {
        autoMeasureServerLatencyIfNeeded();
      }
      const autoTarget = state.selectedServer.code === 'auto' && !state.serversStale
        ? (chooseAutomaticServer(state.servers) || automaticFallbackCandidates(state.servers)[0] || null)
        : null;
      state.autoSelectedServer = autoTarget || null;
      updateVpnUi();
      const code = state.selectedServer.code === 'auto'
        ? (autoTarget?.code || null)
        : state.selectedServer.code;
      const metrics = await startVpnWithAutomaticFallback(code);
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
      state.vpnPhase = 'connected';
      state.reconnectPending = false;
      state.connectedSeconds = status.connected_seconds || 0;
      state.metrics = status;
      startLiveTimer();
      startStatusPolling();
    } else {
      state.vpnVerified = false;
      state.vpnConnected = false;
      if (status?.proof === 'network_recovery_required') {
        state.connectionError = uiText(
          'Xray остановлен, но Windows не разрешила восстановить маршруты. Перезагрузите компьютер.',
          'Xray stopped, but Windows could not restore its routes. Restart the computer.');
        showToast(state.connectionError, true);
      }
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
    const shouldWatchReconnect = !!state.user && state.settings.autoReconnect &&
      (state.reconnectPending || state.vpnConnected);
    if ((state.vpnConnected || shouldWatchReconnect) && !state.connectionBusy && !document.hidden && !state.pollBusy) {
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
          if (state.vpnConnected) state.reconnectPending = false;
          else if (wasConnected && shouldWatchReconnect) state.reconnectPending = true;
          state.vpnPhase = state.vpnConnected ? 'connected' :
            (state.reconnectPending && shouldWatchReconnect ? 'reconnecting' : 'idle');
          state.metrics = status;
          state.connectedSeconds = status.connected_seconds || 0;
          if (!wasConnected && state.vpnConnected) {
            state.connectionError = null;
            startLiveTimer();
            showToast(uiText('VPN-соединение восстановлено.', 'VPN connection restored.'));
          }
          if (wasConnected && !state.vpnConnected) {
            clearInterval(state.timerInterval);
            state.timerInterval = null;
            state.connectionError = shouldWatchReconnect
              ? uiText('Связь прервалась. Восстанавливаем VPN…', 'Connection interrupted. Reconnecting VPN…')
              : status?.proof === 'network_recovery_required'
              ? uiText('Windows не восстановила маршруты ByMeVPN. Перезагрузите компьютер.',
                'Windows could not restore ByMeVPN routes. Restart the computer.')
              : uiText('Соединение VPN прервано. Сетевые маршруты восстановлены.',
                'VPN interrupted. Network routes restored.');
            showToast(state.connectionError, true);
            if (!shouldWatchReconnect) {
              clearInterval(interval);
              if (state.pollInterval === interval) state.pollInterval = null;
            }
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
    if ((state.vpnConnected || state.reconnectPending) && !state.pollInterval) startStatusPolling();
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

function homeNoPlanPresentation(sub, trialBusy = false, subscriptionBusy = false, trialPreparing = false) {
  const reason = String(sub?.trial_unavailable_reason ?? sub?.trialUnavailableReason ?? '');
  if (!sub || sub.status === 'unknown') {
    return {
      heading: subscriptionBusy
        ? uiText('Проверяем подписку…', 'Checking subscription…')
        : uiText('Не удалось проверить подписку', 'Could not check subscription'),
      description: subscriptionBusy
        ? uiText('Загружаем данные аккаунта.', 'Loading account details.')
        : uiText('Повторите проверку, чтобы обновить данные аккаунта.', 'Retry to refresh your account details.'),
      button: subscriptionBusy
        ? uiText('Проверяем…', 'Checking…')
        : uiText('Повторить проверку', 'Retry status check'),
      action: 'refresh', disabled: subscriptionBusy
    };
  }
  if (trialPreparing) {
    return {
      heading: uiText('3 дня бесплатно', '3 days free'),
      description: uiText('Попробуйте сервис перед покупкой.', 'Try the service before buying.'),
      button: uiText('Готовим серверы…', 'Preparing servers…'), action: 'trial', disabled: true
    };
  }
  if (trialBusy) {
    return {
      heading: uiText('3 дня бесплатно', '3 days free'),
      description: uiText('Попробуйте сервис перед покупкой.', 'Try the service before buying.'),
      button: uiText('Подключаем пробный период…', 'Activating your trial…'), action: 'trial', disabled: true
    };
  }
  if (reason === 'trial_already_used') {
    return {
      heading: uiText('Пробный период использован', 'Free trial already used'),
      description: uiText('Выберите тариф, чтобы продолжить пользоваться VPN.', 'Choose a plan to continue using VPN.'),
      button: uiText('Посмотреть тарифы', 'View plans'), action: 'plans', disabled: false
    };
  }
  if (reason === 'trial_activation_pending') {
    return {
      heading: uiText('Проверяем активацию', 'Checking activation'),
      description: uiText('Обновите статус через некоторое время.', 'Refresh your status in a little while.'),
      button: uiText('Обновить статус', 'Refresh status'), action: 'refresh', disabled: false
    };
  }
  if (['eligibility_check_unavailable', 'device_confirmation_required', 'subscription_check_unavailable'].includes(reason)) {
    return {
      heading: uiText('Подписка не активна', 'Subscription inactive'),
      description: uiText('Не удалось проверить доступность пробного периода. Попробуйте ещё раз.',
        'Could not check trial availability. Please try again.'),
      button: uiText('Обновить статус', 'Refresh status'), action: 'refresh', disabled: false
    };
  }
  if (sub.trial_available === true) {
    return {
      heading: uiText('3 дня бесплатно', '3 days free'),
      description: uiText('Попробуйте сервис перед покупкой.', 'Try the service before buying.'),
      button: uiText('Активировать бесплатно', 'Activate free trial'), action: 'trial', disabled: false
    };
  }
  return {
    heading: uiText('Подписка не активна', 'Subscription inactive'),
    description: uiText('Выберите подходящий тариф.', 'Choose a plan that works for you.'),
    button: uiText('Посмотреть тарифы', 'View plans'), action: 'plans', disabled: false
  };
}

function shouldOfferTelegramRecovery(user, subscription) {
  const email = typeof user?.email === 'string' ? user.email.trim() : '';
  return Boolean(user?.id) && subscription?.status === 'none' &&
    (user.is_google === true || email.length > 0);
}

function updateNoPlanPresentation() {
  const presentation = homeNoPlanPresentation(
    state.subscription,
    state.trialBusy,
    state.subscriptionRefreshCount > 0,
    state.trialPreparing
  );
  const heading = document.getElementById('no-plan-trial-heading');
  const description = document.getElementById('no-plan-trial-desc');
  const button = document.getElementById('btn-no-plan-trial');
  const label = button?.querySelector?.('[data-i18n="no_plan_trial_button"]');
  const error = document.getElementById('no-plan-trial-error');
  const pricing = document.getElementById('btn-no-plan-pricing');
  const telegramRecovery = document.getElementById('btn-no-plan-telegram');
  const accessUnknown = !state.subscription || state.subscription.status === 'unknown' ||
    subscriptionExpired(state.subscription);
  if (heading) heading.textContent = presentation.heading;
  if (description) description.textContent = presentation.description;
  if (label) label.textContent = presentation.button;
  if (button) {
    button.disabled = presentation.disabled;
    button.setAttribute('aria-busy', String(presentation.disabled));
  }
  if (error) {
    error.textContent = state.trialError || '';
    error.classList.toggle('hidden', !state.trialError);
  }
  pricing?.classList?.toggle('hidden', accessUnknown);
  if (telegramRecovery) {
    telegramRecovery.classList.toggle('hidden', !shouldOfferTelegramRecovery(state.user, state.subscription));
    telegramRecovery.disabled = state.authBusy || tgStarting;
    telegramRecovery.setAttribute('aria-busy', String(tgStarting));
  }
}

function handleHomeNoPlanAction() {
  const presentation = homeNoPlanPresentation(
    state.subscription,
    state.trialBusy,
    state.subscriptionRefreshCount > 0,
    state.trialPreparing
  );
  if (presentation.disabled) return;
  const { action } = presentation;
  if (action === 'trial') return handleActivateTrial();
  if (action === 'refresh') return void refreshAccountSnapshot(true);
  if (action === 'plans') return openPricingScreen();
}

function trialPagePresentation(sub, checking = false, activating = false, signedIn = true) {
  const reason = String(sub?.trial_unavailable_reason ?? sub?.trialUnavailableReason ?? '');
  const unknown = !sub || sub.status === 'unknown' || subscriptionExpired(sub);
  const hasAccess = ['active', 'trial', 'grace'].includes(sub?.status);
  const alreadyUsed = reason === 'trial_already_used';
  const canActivate = Boolean(signedIn && !unknown && !hasAccess && sub?.trial_available === true);
  return {
    heading: alreadyUsed ? uiText('Пробный период использован', 'Free trial already used')
      : uiText('Пробный период', 'Free trial'),
    description: uiText('Доступность пробного периода зависит от аккаунта.',
      'Trial availability depends on your account.'),
    usedNote: uiText('Пробный период уже использован.', 'The free trial has already been used.'),
    showUsedNote: alreadyUsed,
    canActivate,
    activateDisabled: !canActivate || checking || activating,
    activateLabel: activating ? uiText('Подключаем…', 'Activating…')
      : uiText('Активировать бесплатно', 'Activate free trial'),
    showPlans: true
  };
}

function updateTrialScreen() {
  const presentation = trialPagePresentation(
    state.subscription,
    state.trialPageChecking,
    state.trialBusy,
    Boolean(state.user?.id)
  );
  const heading = document.getElementById('trial-page-heading');
  const usedNote = document.getElementById('trial-page-used-note');
  const activate = document.getElementById('btn-trial-activate');
  const plans = document.getElementById('btn-trial-plans');
  if (heading) heading.textContent = presentation.heading;
  if (usedNote) {
    usedNote.textContent = presentation.usedNote;
    usedNote.classList.toggle('hidden', !presentation.showUsedNote);
  }
  if (activate) {
    activate.classList.toggle('hidden', !presentation.canActivate);
    activate.disabled = presentation.activateDisabled;
    activate.textContent = presentation.activateLabel;
    activate.setAttribute('aria-busy', String(state.trialBusy));
  }
  if (plans) plans.classList.toggle('hidden', !presentation.showPlans);
}

// UI Updaters
function updateVpnUi() {
  const isConn = state.vpnConnected;
  const latencyButton = document.getElementById('btn-measure-server-latency');
  if (latencyButton) {
    latencyButton.disabled = state.latencyRefreshing || isConn || state.connectionBusy || state.serverSwitchBusy;
    latencyButton.setAttribute('aria-busy', String(state.latencyRefreshing));
    const label = latencyButton.querySelector('[data-latency-label]');
    if (label) label.textContent = state.latencyRefreshing
      ? uiText(I18N.ru.server_latency_checking, I18N.en.server_latency_checking)
      : uiText(I18N.ru.server_measure_latency, I18N.en.server_measure_latency);
  }
  const sub = state.subscription;
  const accessUnknown = !sub || sub.status === 'unknown' || subscriptionExpired(sub);
  const hasPlan = sub && ['active', 'trial', 'grace'].includes(sub.status) && !accessUnknown;
  const showNoPlan = !hasPlan || state.trialBusy;

  const noPlanBox = document.getElementById('home-state-no-plan');
  const connectedBox = document.getElementById('home-state-connected');
  const disconnectedBox = document.getElementById('home-state-disconnected');
  const activePill = document.getElementById('vpn-active-pill');
  document.getElementById('home-verification-notice')?.classList?.toggle(
    'hidden', !isConn || state.vpnVerified
  );
  const sharedDock = document.getElementById('home-shared-dock');
  sharedDock?.classList?.toggle('hidden', showNoPlan || accessUnknown);
  const showConnectionRetry = !isConn && hasPlan && !accessUnknown && !!state.connectionError;
  document.getElementById('btn-toggle-vpn')?.classList?.toggle('hidden', !accessUnknown && !showConnectionRetry);
  updateNoPlanPresentation();

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
      : proof === 'server_unreachable' ? uiText('Не прошёл тест через VPN-сервер', 'VPN server test failed')
      : proof === 'tun_no_traffic' ? uiText('Нет трафика через Windows TUN', 'Windows TUN has no traffic')
      : uiText('Соединение не подтверждено', 'Connection unverified');
    const description = document.querySelector('#home-state-connected [data-i18n="conn_secured"]');
    if (description) description.textContent = state.vpnPhase === 'disconnecting'
      ? uiText('Завершаем соединение…', 'Closing the connection…')
      : state.vpnVerified
        ? uiText('Внешний IPv4 подтверждён', 'External IPv4 verified')
        : proof === 'baseline_unknown' || proof === 'traffic_observed_unverified' ?
          uiText('Трафик и маршрут через TUN обнаружены, но проверка внешнего IP недоступна. Защита от утечек не подтверждена.',
            'Traffic and the TUN route are detected, but external IP verification is unavailable. Leak protection is unverified.')
        : proof === 'server_unreachable' ?
          uiText('Проверьте диагностику подключения.', 'Review connection diagnostics.')
          : proof === 'tun_no_traffic' ?
            uiText('Xray отвечает, но системный трафик Windows не проходит.', 'Xray responds, but Windows system traffic does not pass.')
            : uiText('Реальный VPN-трафик пока не подтверждён.', 'Real VPN traffic is not yet verified.');
  } else if (showNoPlan) {
    // Android keeps missing, unknown, and expired access in the same recovery
    // card; the primary action changes to a status check when access is unknown.
    noPlanBox?.classList.remove('hidden');
    connectedBox?.classList.add('hidden');
    disconnectedBox?.classList.add('hidden');
    activePill?.classList.add('hidden');
  } else {
    // Has active plan, disconnected
    const heading = document.querySelector('#home-state-disconnected .status-title-text');
    if (heading) heading.textContent = state.vpnPhase === 'reconnecting'
      ? uiText('Восстанавливаем VPN', 'Reconnecting VPN')
      : state.vpnPhase === 'disconnecting'
        ? uiText('Отключаем VPN', 'Disconnecting VPN')
      : state.connectionError
        ? uiText('Не удалось подключиться', 'Could not connect')
      : uiText('VPN выключен', 'VPN off');
    noPlanBox?.classList.add('hidden');
    connectedBox?.classList.add('hidden');
    disconnectedBox?.classList.remove('hidden');
    activePill?.classList.add('hidden');

    const desc = document.getElementById('home-off-desc');
    const btn = document.getElementById('vpn-btn-text');
    const promoBox = document.querySelector('.promo-trial-box');
    const ringOff = document.getElementById('vpn-power-ring-off');

    if (desc) desc.textContent = state.vpnPhase === 'reconnecting' ?
      uiText('Пытаемся восстановить соединение…', 'Trying to restore the connection…') :
      state.vpnPhase === 'disconnecting' ?
        uiText('Останавливаем соединение и повторные попытки…', 'Stopping the connection and retry attempts…') :
      state.vpnPhase === 'connecting' ?
        uiText('Запуск и проверка VPN...', 'Starting and verifying VPN...') :
        uiText('Нажмите, чтобы подключиться', 'Click to connect');
    if (btn) btn.textContent = state.vpnPhase === 'reconnecting' ?
      uiText('Восстанавливаем...', 'Reconnecting...') : state.vpnPhase === 'connecting' ?
        uiText('Подключаемся...', 'Connecting...') : state.vpnPhase === 'disconnecting' ?
          uiText('Отключаем...', 'Disconnecting...') : state.connectionError ?
            uiText('Повторить', 'Try again') : uiText('Подключиться', 'Connect');
    ringOff?.classList.toggle('is-reconnecting', state.vpnPhase === 'reconnecting');
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
    connectionError.classList.toggle('reconnecting', showError && state.vpnPhase === 'reconnecting');
    connectionError.setAttribute('role', state.vpnPhase === 'reconnecting' ? 'status' : 'alert');
  }

  // Android's error state offers the same support entry as its Support tab.
  const errorSupport = document.getElementById('home-error-support');
  if (errorSupport) {
    errorSupport.classList.toggle('hidden',
      !(!isConn && hasPlan && !accessUnknown && !!state.connectionError));
  }

  const latencyProgress = document.getElementById('server-latency-progress');
  if (latencyProgress) {
    const checking = state.servers.filter(server => Number(server.ping) === -3).length;
    const queued = state.servers.filter(server => Number(server.ping) === -4).length;
    latencyProgress.textContent = checking + queued > 0
      ? uiText(`Проверяем серверы: ${checking} сейчас, ${queued} в очереди`,
        `Checking servers: ${checking} active, ${queued} queued`)
      : '';
    latencyProgress.classList.toggle('hidden', checking + queued === 0);
  }

  // Update Server info in card
  const s = state.selectedServer;
  const flagEl = document.getElementById('conn-flag-chip');
  const nameEl = document.getElementById('conn-location-name');
  const homeFlag = document.getElementById('home-server-flag');
  const homeCountry = document.getElementById('home-server-country');
  const homeCity = document.getElementById('home-server-city');
  const automaticConnected = isConn && s.code === 'auto' && !!state.metrics?.server_name;
  const automaticSubtitle = document.querySelector('#recommended-server-auto .rec-server-info span');
  if (automaticSubtitle) automaticSubtitle.textContent = automaticServerSubtitle();

  if (flagEl) flagEl.textContent = s.flag || '🌐';
  const friendlyAutoServer = friendlyServerLabel(state.metrics?.server_name);
  if (nameEl) nameEl.textContent = isConn && s.code === 'auto' && friendlyAutoServer ?
    friendlyAutoServer : (isConn && s.code === 'auto' && state.metrics?.country ? state.metrics.country : serverDisplayName(s));
  for (const id of ['vpn-power-ring', 'vpn-power-ring-off']) {
    const ring = document.getElementById(id);
    ring?.setAttribute('aria-busy', String(state.connectionBusy));
    ring?.setAttribute('aria-disabled', String(accessUnknown && !isConn));
    if (ring) {
      ring.setAttribute('aria-pressed', String(isConn));
      ring.disabled = state.connectionBusy || (accessUnknown && !isConn);
      ring.setAttribute('aria-label', id === 'vpn-power-ring'
        ? uiText('Отключить VPN', 'Disconnect VPN')
        : uiText('Включить VPN', 'Connect VPN'));
    }
  }
  document.getElementById('btn-toggle-vpn')?.toggleAttribute('disabled', state.connectionBusy || state.serverSwitchBusy);
  if (homeFlag) homeFlag.textContent = s.flag || '🌐';
  if (homeCountry) homeCountry.textContent = s.code === 'auto' ?
    (automaticConnected && state.metrics?.country ? state.metrics.country : uiText('Автоматически', 'Automatic')) :
    (effectiveLanguage() === 'en' ? s.country_en : s.country) || serverDisplayName(s);
  if (homeCity) homeCity.textContent = s.code === 'auto' ?
    (automaticConnected ? (friendlyServerLabel(state.metrics.server_name) || state.metrics.country || '') : uiText('Автовыбор', 'Auto select')) :
    ((effectiveLanguage() === 'en' ? s.city_en : s.city) || '');

  // Android shows the outbound protocol and a connected marker under the
  // location name, so the card explains how the tunnel actually runs.
  const cardServer = s.code === 'auto' ? (state.autoSelectedServer || null) : s;
  const cardProtocol = cardServer && cardServer.code !== 'auto' ? serverProtocolLabel(cardServer) : '';
  const protocolBadge = document.getElementById('home-server-protocol');
  const statusRow = document.getElementById('home-server-status');
  const connectedLabel = document.getElementById('home-server-connected');
  if (protocolBadge) {
    protocolBadge.textContent = cardProtocol;
    const protocol = String(cardServer?.protocol || '').toLowerCase();
    const security = String(cardServer?.security || '').toLowerCase();
    const tone = protocol === 'hysteria2' || protocol === 'hy2' ? 'hysteria'
      : protocol === 'vless' && security === 'reality' ? 'reality' : 'other';
    protocolBadge.classList.remove('reality', 'hysteria', 'other');
    protocolBadge.classList.add(tone);
  }
  if (statusRow) statusRow.classList.toggle('hidden', !cardProtocol && !isConn);
  if (connectedLabel) connectedLabel.classList.toggle('hidden', !isConn);
  const cardTitle = document.getElementById('home-server-card-title');
  if (cardTitle) cardTitle.textContent = state.connectionError && !isConn
    ? uiText('ВЫБРАННЫЙ СЕРВЕР', 'SELECTED SERVER')
    : uiText('МЕСТОПОЛОЖЕНИЕ', 'LOCATION');

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
  const copyId = document.getElementById('btn-account-copy-id');
  if (copyId) copyId.disabled = !String(state.user.id ?? '').trim();
  const reset = document.getElementById('btn-account-password-reset');
  const email = typeof state.user.email === 'string' ? state.user.email.trim() : '';
  reset?.classList?.toggle('hidden', state.user.is_google === true || !email.includes('@') || email === 'user@bymevpn.app');
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

function renewalPagePresentation(checked, refreshing, enabled, canEnable) {
  const status = refreshing ? uiText('Проверяем…', 'Checking…')
    : !checked ? uiText('Не удалось проверить', 'Could not check')
      : enabled === true ? uiText('Включено', 'On')
        : enabled === false ? uiText('Отключено', 'Off')
          : uiText('Не удалось проверить', 'Could not check');
  return {
    statusLine: `${uiText('Статус:', 'Status:')} ${status}`,
    showCancel: checked && enabled === true,
    showEnable: checked && enabled === false && canEnable === true,
    showTelegram: checked && enabled === false && canEnable === false,
    showSavedMethodHint: checked && enabled === false && canEnable === false,
    refreshLabel: refreshing ? uiText('Обновляем…', 'Refreshing…')
      : uiText('Обновить статус', 'Refresh status')
  };
}

function updateRenewalUi() {
  const enabled = state.renewalChecked ? state.subscription?.auto_renew : null;
  const presentation = renewalPagePresentation(
    state.renewalChecked,
    state.renewalRefreshing,
    enabled,
    state.renewalCanEnable
  );
  const status = document.getElementById('renewal-status-line');
  const cancel = document.getElementById('btn-renewal-cancel');
  const enable = document.getElementById('btn-renewal-enable');
  const telegram = document.getElementById('btn-renewal-telegram');
  const savedMethodHint = document.getElementById('renewal-saved-method-hint');
  const refresh = document.getElementById('btn-renewal-refresh');
  if (status) status.textContent = presentation.statusLine;
  if (cancel) {
    cancel.classList.toggle('hidden', !presentation.showCancel);
    cancel.disabled = state.renewalBusy;
  }
  if (enable) {
    enable.classList.toggle('hidden', !presentation.showEnable);
    enable.disabled = state.renewalBusy;
  }
  if (telegram) {
    telegram.classList.toggle('hidden', !presentation.showTelegram);
    telegram.disabled = state.renewalBusy;
  }
  savedMethodHint?.classList?.toggle('hidden', !presentation.showSavedMethodHint);
  if (refresh) {
    refresh.textContent = presentation.refreshLabel;
    refresh.disabled = state.renewalBusy;
  }
}

async function refreshRenewal() {
  if (state.renewalBusy || !state.user) return;
  const epoch = state.sessionEpoch;
  state.renewalBusy = true;
  state.renewalRefreshing = true;
  state.renewalChecked = false;
  state.renewalGeneration = null;
  state.renewalCanEnable = false;
  updateSubscriptionUi();
  try {
    const result = await invoke('get_auto_renewal');
    if (epoch !== state.sessionEpoch) return;
    if (typeof result?.enabled !== 'boolean' || typeof result?.can_enable !== 'boolean' ||
        !Number.isSafeInteger(result?.generation)) throw new Error('Invalid renewal status');
    if (state.subscription) state.subscription.auto_renew = result.enabled;
    state.renewalCanEnable = result.can_enable && !result.enabled;
    state.renewalGeneration = result.generation;
    state.renewalChecked = true;
  } catch {
    if (epoch === state.sessionEpoch) {
      if (state.subscription) state.subscription.auto_renew = null;
      state.renewalCanEnable = false;
      state.renewalChecked = false;
    }
  } finally {
    state.renewalBusy = false;
    state.renewalRefreshing = false;
    updateSubscriptionUi();
  }
}

function confirmCancelRenewal() {
  if (state.renewalBusy || !state.renewalChecked || state.subscription?.auto_renew !== true) return;
  const epoch = state.sessionEpoch;
  const accountId = String(state.user?.id ?? '');
  const sameAccount = () => epoch === state.sessionEpoch &&
    String(state.user?.id ?? '') === accountId;
  const generation = state.renewalGeneration;
  showConfirm(
    uiText('Отключить автопродление?', 'Turn off auto-renewal?'),
    uiText('Следующего автоматического списания не будет. Оплаченный доступ сохранится до конца срока.', 'There will be no next automatic charge. Your paid access remains until expiry.'),
    async () => {
      if (!sameAccount() || state.renewalBusy) return;
      state.renewalBusy = true;
      updateSubscriptionUi();
      try {
        await invoke('cancel_auto_renewal', { generation });
        if (!sameAccount()) return;
        if (state.subscription) state.subscription.auto_renew = false;
        state.renewalCanEnable = false;
        state.renewalChecked = true;
        showToast(uiText('Автопродление отключено.', 'Auto-renewal is off.'));
      } catch {
        if (sameAccount()) {
          if (state.subscription) state.subscription.auto_renew = null;
          state.renewalCanEnable = false;
          state.renewalChecked = false;
        }
        showToast(uiText('Не удалось подтвердить отключение. Обновите статус.', 'Cancellation could not be confirmed. Refresh the status.'), true);
      } finally {
        state.renewalBusy = false;
        updateSubscriptionUi();
      }
    },
    uiText('Отключить', 'Turn off'),
    { keepOpenWhileBusy: true, busyLabel: '…' }
  );
}

function confirmEnableRenewal() {
  if (state.renewalBusy || !state.renewalChecked ||
      state.subscription?.auto_renew !== false || !state.renewalCanEnable) return;
  const epoch = state.sessionEpoch;
  const accountId = String(state.user?.id ?? '');
  const generation = state.renewalGeneration;
  const sameAccount = () => epoch === state.sessionEpoch &&
    String(state.user?.id ?? '') === accountId;
  showConfirm(
    uiText('Включить автопродление?', 'Enable auto-renewal?'),
    uiText(
      'Будут использованы только ранее сохранённый способ оплаты и данное вами согласие. Списание произойдёт при продлении подписки. Отключить можно в любой момент.',
      'Only your previously saved payment method and consent will be used. The charge is scheduled for subscription renewal. You can turn it off at any time.'
    ),
    async () => {
      if (!sameAccount() || state.renewalBusy || !state.renewalCanEnable) return;
      state.renewalBusy = true;
      let refreshAfterFailure = false;
      updateSubscriptionUi();
      try {
        await invoke('enable_auto_renewal', { generation });
        if (!sameAccount()) return;
        if (state.subscription) state.subscription.auto_renew = true;
        state.renewalCanEnable = false;
        state.renewalChecked = true;
        showToast(uiText('Автопродление включено.', 'Auto-renewal is on.'));
      } catch {
        if (sameAccount()) {
          if (state.subscription) state.subscription.auto_renew = null;
          state.renewalCanEnable = false;
          state.renewalChecked = false;
          refreshAfterFailure = true;
        }
        showToast(uiText('Не удалось подтвердить включение. Обновите статус.', 'Activation could not be confirmed. Refresh the status.'), true);
      } finally {
        state.renewalBusy = false;
        updateSubscriptionUi();
      }
      if (refreshAfterFailure && sameAccount()) void refreshRenewal();
    },
    uiText('Включить', 'Enable'),
    { keepOpenWhileBusy: true, busyLabel: '…' }
  );
}

async function openRenewalTelegram() {
  try {
    await invoke('open_external_url', { url: 'https://t.me/ByMeVPNbot' });
  } catch {
    showToast(uiText('Найдите @ByMeVPNbot в Telegram.', 'Find @ByMeVPNbot in Telegram.'), true);
  }
}

function updateSubscriptionUi() {
  const sub = state.subscription;
  const isUnknown = !sub || sub.status === 'unknown' || subscriptionExpired(sub);
  const hasPlan = sub && ['active', 'trial', 'grace'].includes(sub.status) && !isUnknown;

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
    const remaining = subscriptionRemaining(sub);
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
  const remainingSeconds = subscriptionRemaining(sub);
  const remainingDays = remainingSeconds > 0 ? Math.ceil(remainingSeconds / 86400) : null;
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

  updateRenewalUi();
  updateTrialScreen();
}

function updateDevicesUi() {
  const container = document.getElementById('acc-devices-list');
  const fullContainer = document.getElementById('devices-full-cards-list');
  const heroCurrent = document.getElementById('devices-hero-current');
  const heroMax = document.getElementById('devices-hero-max');
  const heroSlash = document.getElementById('devices-hero-slash');
  const progress = document.getElementById('devices-limit-progress');
  const progressFill = document.getElementById('devices-limit-progress-fill');
  const unavailableCard = document.getElementById('devices-unavailable-card');
  const retryButton = document.getElementById('btn-devices-retry');
  const retryLabel = document.getElementById('devices-retry-label');
  const currentStatus = document.getElementById('devices-current-status');
  const otherLabel = document.getElementById('devices-other-label');
  const emptyOther = document.getElementById('devices-empty-other');
  const ratioEl = document.getElementById('acc-devices-ratio');
  const sub = state.subscription;
  const maxDev = Number.isInteger(sub?.max_devices) && sub.max_devices > 0 ? sub.max_devices : null;
  const upgrade = document.getElementById('devices-upgrade-card');
  const devList = Array.isArray(state.devices) ? state.devices : [];
  const otherDevices = devList.filter(dev => dev?.is_current !== true);
  const loadingInitial = !state.devicesLoaded;
  const unavailable = state.devicesUnavailable || (state.devicesLoaded && !state.devicesSupported);
  const currentConfirmed = devList.some(dev => dev?.is_current === true);
  if (upgrade) upgrade.classList.toggle('hidden', !(sub && ['active', 'trial', 'grace'].includes(sub.status) && !subscriptionExpired(sub) && [2, 5].includes(maxDev)));
  const upgradeTitle = document.getElementById('devices-upgrade-title');
  const upgradeAtLimit = !unavailable && !loadingInitial && maxDev !== null && devList.length >= maxDev;
  if (upgradeTitle) upgradeTitle.textContent = upgradeAtLimit
    ? uiText(I18N.ru.devices_upgrade_limit_title, I18N.en.devices_upgrade_limit_title)
    : uiText(I18N.ru.devices_upgrade_needed_title, I18N.en.devices_upgrade_needed_title);

  if (ratioEl) {
    ratioEl.textContent = loadingInitial
      ? '…'
      : unavailable
        ? '—'
        : `${devList.length}${maxDev === null ? '' : ` / ${maxDev}`}`;
  }
  if (heroCurrent) heroCurrent.textContent = loadingInitial || unavailable ? '—' : String(devList.length);
  if (heroMax) {
    heroMax.textContent = maxDev === null ? '' : String(maxDev);
    heroMax.classList.toggle('hidden', maxDev === null);
  }
  heroSlash?.classList?.toggle('hidden', maxDev === null);

  const statHint = document.getElementById('devices-stat-hint');
  if (statHint) {
    statHint.textContent = loadingInitial
      ? uiText(I18N.ru.devices_loading_hint, I18N.en.devices_loading_hint)
      : unavailable
        ? uiText(I18N.ru.devices_hint_unavailable, I18N.en.devices_hint_unavailable)
        : maxDev === null
          ? devList.length === 0
            ? uiText(I18N.ru.devices_no_registered, I18N.en.devices_no_registered)
            : uiText(`Сейчас отображается ${devList.length} устройств.`, `${devList.length} devices are shown now.`)
          : uiText(`Подключено устройств · максимум ${maxDev}`, `Devices connected · up to ${maxDev}`);
  }

  const progressVisible = maxDev !== null && !loadingInitial && !unavailable;
  progress?.classList?.toggle('hidden', !progressVisible);
  if (progressVisible) {
    const percentage = Math.min(100, Math.round((devList.length / maxDev) * 100));
    if (progressFill?.style) progressFill.style.width = `${percentage}%`;
    progress?.setAttribute?.('aria-valuenow', String(percentage));
  }
  progress?.setAttribute?.('aria-label', uiText(I18N.ru.devices_progress_label, I18N.en.devices_progress_label));
  unavailableCard?.classList?.toggle('hidden', !unavailable);
  if (retryButton) retryButton.disabled = state.devicesRefreshing;
  if (retryLabel) retryLabel.textContent = state.devicesRefreshing
    ? uiText(I18N.ru.devices_retry_loading, I18N.en.devices_retry_loading)
    : uiText(I18N.ru.devices_retry, I18N.en.devices_retry);
  if (currentStatus) currentStatus.textContent = currentConfirmed
    ? uiText(I18N.ru.devices_current_confirmed, I18N.en.devices_current_confirmed)
    : uiText(I18N.ru.devices_current_pending, I18N.en.devices_current_pending);
  currentStatus?.setAttribute?.('data-confirmed', String(currentConfirmed));
  otherLabel?.classList?.toggle('hidden', otherDevices.length === 0);
  emptyOther?.classList?.toggle('hidden', unavailable || loadingInitial || otherDevices.length > 0);

  const createDeviceRow = (dev) => {
    const row = document.createElement('div');
    row.className = 'glass-card device-item-row';
    row.dataset.deviceId = dev.id || '';

    const model = dev.device_model || dev.platform || uiText('Устройство', 'Device');
    const deviceId = String(dev.id ?? '');
    const platform = (dev.platform || '').toLowerCase();
    const icon = platform.includes('android') || platform.includes('phone') || platform.includes('ios')
      ? '<svg class="byme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2.8" width="12" height="18.4" rx="2.2"/><path d="M10 5.8h4M11 18h2"/></svg>'
      : platform.includes('tv')
      ? '<svg class="byme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="13" rx="2"/><path d="m8 2 4 3 4-3m-4 16v3m-4 0h8"/></svg>'
      : '<svg class="byme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="17" height="12" rx="1.8"/><path d="M2.5 20h19M9 16v2m6-2v2"/></svg>';

    row.innerHTML = `
      <div class="device-icon-box">${icon}</div>
      <div class="device-info-col">
        <strong>${escapeHtml(model)}</strong>
        <span class="device-last-seen">
          ${escapeHtml(dev.platform || uiText('Устройство', 'Device'))} · ${escapeHtml(dev.last_active || uiText('Недавно', 'Recently'))}
        </span>
      </div>
      ${deviceId ? `<button type="button" class="btn-remove-device" data-dev-id="${escapeHtml(deviceId)}">${uiText('Удалить', 'Remove')}</button>` : ''}
    `;

    const removeButton = row.querySelector('.btn-remove-device');
    if (removeButton) {
      removeButton.addEventListener('click', () => handleDeleteDevice(deviceId));
    }
    return row;
  };

  if (container) {
    container.innerHTML = '';
    otherDevices.forEach(dev => container.appendChild(createDeviceRow(dev)));
  }

  if (fullContainer) {
    fullContainer.innerHTML = '';
    otherDevices.forEach(dev => fullContainer.appendChild(createDeviceRow(dev)));
  }
}

async function handleDeleteDevice(deviceId) {
  if (!deviceId || state.deviceRemovalBusy) return;
  const epoch = state.sessionEpoch;
  const accountId = String(state.user?.id ?? '');
  if (!accountId) return;
  let generation;
  try {
    generation = await invoke('auth_session_generation');
    if (!Number.isSafeInteger(generation) || generation < 0) throw new Error('Invalid session');
  } catch {
    if (epoch === state.sessionEpoch && String(state.user?.id ?? '') === accountId) {
      showToast(uiText('Не удалось проверить сеанс. Повторите вход.', 'Could not verify your session. Sign in again.'), true);
    }
    return;
  }
  const sameAccount = () => epoch === state.sessionEpoch &&
    String(state.user?.id ?? '') === accountId;
  if (!sameAccount()) return;
  showConfirm(
    uiText('Удалить устройство?', 'Remove device?'),
    uiText('Устройство потеряет доступ к VPN. Продолжить?', 'This device will lose VPN access. Continue?'),
    async () => {
      if (!sameAccount() || state.deviceRemovalBusy) return;
      state.deviceRemovalBusy = true;
      try {
        await invoke('delete_device', { deviceId, generation });
        if (!sameAccount()) return;
        showToast(uiText('Устройство удалено', 'Device removed'));
        await refreshAccountSnapshot();
      } catch (err) {
        if (sameAccount()) showToast(typeof err === 'string' ? err : uiText('Не удалось удалить устройство', 'Could not remove device'), true);
      } finally {
        state.deviceRemovalBusy = false;
      }
    },
    uiText('Удалить', 'Remove'),
    { keepOpenWhileBusy: true, busyLabel: uiText('Удаляем…', 'Removing…') }
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
  if (!offer || !Number.isFinite(offer.price) || offer.price <= 0 || !Number.isFinite(offer.days) || offer.days <= 0) return uiText('Тариф пока недоступен', 'Plan unavailable');
  // Android displays the server-confirmed price per 30 days, rounded up.
  const monthly = Math.ceil(offer.price * 30 / offer.days);
  const price = uiText(`${monthly} ₽`, `${monthly} RUB`);
  if (code === 'month') return uiText(`${price} за месяц`, `${price} per month`);
  const bonus = {quarter: 1, half_year: 2, year: 3}[code] || 0;
  return uiText(`${price} / месяц · 🎁 ${bonus} мес. в подарок`,
    `${price}/month · 🎁 ${bonus} bonus month(s)`);
}

function androidBestValuePlan(offers) {
  const codes = Object.keys(VERIFIED_PLAN_TYPES);
  const confirmed = codes.map(code => ({ code, offer: offers?.[code], terms: VERIFIED_PLAN_TYPES[code] }));
  if (confirmed.some(({ offer, terms }) => !offer || !Number.isSafeInteger(offer.price) || offer.price <= 0 || offer.days !== terms.days)) return null;
  return confirmed.reduce((best, current) =>
    current.offer.price / current.terms.days < best.offer.price / best.terms.days ? current : best
  ).code;
}

function pricingCatalogPresentation(appState, offers) {
  if (appState.pricingLoading) {
    return {
      message: appState.catalogReady
        ? uiText('Обновляем цены…', 'Updating prices…')
        : uiText('Загружаем тарифы…', 'Loading plans…'),
      retry: false
    };
  }
  if (appState.pricingLoadError) return { message: appState.pricingLoadError, retry: true };
  if (!appState.catalogReady || !Object.keys(offers || {}).length) {
    return {
      message: uiText('Тарифы для выбранного числа устройств пока недоступны.', 'Plans for the selected number of devices are not available yet.'),
      retry: true
    };
  }
  return { message: '', retry: false };
}

function updatePricingMatrixUi() {
  const dev = state.selectedDevicesCount || 2;
  const matrix = PRICING_MATRIX[dev] || {};
  const bestValue = state.catalogReady ? androidBestValuePlan(matrix) : null;
  const chosen = matrix[state.selectedPlanCode];
  const canPay = state.catalogReady && chosen?.purchaseEnabled === true && !state.paymentBusy;
  for (const id of ['btn-pay-yookassa', 'btn-paywall-yookassa-action']) {
    document.getElementById(id)?.toggleAttribute('disabled', !canPay);
  }
  document.querySelectorAll('.dev-seg-btn').forEach(btn => {
    const count = Number(btn.dataset.devices);
    btn.disabled = false;
    btn.classList.toggle('active', count === dev);
    btn.setAttribute('aria-pressed', String(count === dev));
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
    const selected = card.dataset.plan === state.selectedPlanCode;
    const isBestValue = card.dataset.plan === bestValue;
    card.classList.toggle('selected', selected);
    card.classList.toggle('unavailable', !offer);
    card.classList.toggle('best-value', isBestValue);
    card.querySelector('.best-badge-crown')?.classList?.toggle('hidden', !isBestValue);
    card.setAttribute('aria-disabled', 'false');
    card.setAttribute('aria-pressed', String(selected));
    card.tabIndex = 0;
  });
  const priceLabel = document.getElementById('pricing-selected-plan-price');
  const titleLabel = document.getElementById('pricing-selected-plan-title');
  const planNote = document.getElementById('pricing-selected-plan-note');
  const payButton = document.getElementById('btn-pay-yookassa');
  const catalogStatus = pricingCatalogPresentation(state, matrix);
  const catalogStatusNode = document.getElementById('pricing-catalog-status');
  const catalogMessageNode = document.getElementById('pricing-catalog-message');
  const catalogRetryNode = document.getElementById('btn-pricing-retry');
  if (catalogStatusNode) catalogStatusNode.classList.toggle('hidden', !catalogStatus.message);
  if (catalogMessageNode) catalogMessageNode.textContent = catalogStatus.message;
  if (catalogRetryNode) catalogRetryNode.classList.toggle('hidden', !catalogStatus.retry);
  const confirmedChosen = state.catalogReady ? chosen : null;
  if (priceLabel) priceLabel.textContent = confirmedChosen
    ? `${confirmedChosen.price} ₽`
    : uiText('Цена не подтверждена', 'Price not confirmed');
  if (titleLabel) titleLabel.textContent = uiText('К оплате сейчас', 'Amount due');
  if (planNote) {
    const months = VERIFIED_PLAN_TYPES[state.selectedPlanCode]?.months || 1;
    planNote.textContent = confirmedChosen
      ? uiText(`Доступ на ${months} мес. · до ${dev} устройств`,
        `Access for ${months} months · up to ${dev} devices`)
      : uiText('Не удалось подтвердить стоимость тарифа', 'Plan price not confirmed');
  }
  if (payButton) payButton.textContent = state.paymentBusy
    ? uiText('Открываем оплату…', 'Opening checkout…')
    : state.pricingLoading ? uiText('Проверяем цену…', 'Checking price…')
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

function serverProtocolLabel(server) {
  const protocol = String(server?.protocol || 'vless').toLowerCase();
  const security = String(server?.security || '').toLowerCase();
  if (protocol === 'hysteria2' || protocol === 'hy2') return 'Hysteria 2';
  if (protocol === 'vless' && security === 'reality') return 'VLESS Reality';
  if (protocol === 'vless' && security === 'tls') return 'VLESS TLS';
  return protocol.toUpperCase();
}

function friendlyServerLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // Hide technical hostnames, domains, IPs and ports from the client-facing UI.
  if (/[.:\/]/.test(raw)) return '';
  return raw;
}

function automaticServerSubtitle() {
  const rawName = state.vpnConnected && state.selectedServer.code === 'auto'
    ? String(state.metrics?.server_name || '').trim()
    : String(state.autoSelectedServer?.name || '').trim();
  const selectedName = friendlyServerLabel(rawName) || (state.vpnConnected && state.selectedServer.code === 'auto' ? String(state.metrics?.country || '').trim() : '');
  if (!selectedName) return uiText('Подберём сервер', 'We will choose a server');
  const ping = Number(state.autoSelectedServer?.ping);
  const suffix = Number.isFinite(ping) && ping > 0 ? ` · ${ping} ms` : '';
  return uiText(`Выбран сервер: ${selectedName}${suffix}`, `Selected server: ${selectedName}${suffix}`);
}

function serverLatencyPresentation(server) {
  const latency = Number(server?.ping) || 0;
  const tone = latency > 0 ? (latency <= 200 ? 'measured' : latency <= 350 ? 'medium' : 'slow')
    : latency === -2 ? 'failed'
      : latency === -3 ? 'checking'
        : latency === -4 ? 'queued' : 'unknown';
  const label = latency > 0 ? `${latency} ms`
    : latency === -2 ? uiText('Не удалось измерить', 'Could not measure')
      : latency === -3 ? uiText('Проверяем…', 'Checking…')
        : latency === -4 ? uiText('В очереди', 'Queued')
          : uiText('Не проверен', 'Not tested');
  const title = latency > 0
    ? uiText('Время HTTPS-запроса через выбранный VPN-сервер', 'HTTPS request time through the selected VPN server')
    : label;
  return { latency, tone, label, title, aria: latency > 0 ? `${title}: ${latency} ms` : label };
}

// Update a single rendered server row in place without touching the rest of
// the list, the search field or keyboard focus.
function updateServerLatencyCard(server) {
  const container = document.getElementById('servers-dynamic-list');
  if (!container || !Array.isArray(container.children)) return;
  const card = Array.from(container.children)
    .find(child => child?.dataset?.code === server.code);
  if (!card?.querySelector) return;
  const info = serverLatencyPresentation(server);
  const ping = card.querySelector('.server-latency-label');
  const dot = card.querySelector('.server-latency-dot');
  if (ping) {
    ping.className = `server-latency-label ${info.tone}`;
    ping.textContent = info.label;
    ping.title = info.title;
    ping.setAttribute('aria-label', info.aria);
  }
  if (dot) dot.className = `server-latency-dot ${info.tone}`;
  const protocol = card.querySelector('.server-protocol-badge');
  card.setAttribute('aria-label',
    `${serverDisplayName(server)}, ${protocol?.textContent || serverProtocolLabel(server)}, ${info.label}`);
}

// Several probes can finish inside one display frame. Collapse their UI work
// into a single update so latency checks do not block interaction.
let vpnUiFrame = null;
function scheduleVpnUiUpdate() {
  if (vpnUiFrame !== null) return;
  const run = () => {
    vpnUiFrame = null;
    updateVpnUi();
  };
  vpnUiFrame = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(run)
    : setTimeout(run, 16);
}

function renderServersList(filter = state.serverSearchQuery) {
  const autoSubtitle = document.querySelector('#recommended-server-auto .rec-server-info span');
  if (autoSubtitle) autoSubtitle.textContent = automaticServerSubtitle();
  const container = document.getElementById('servers-dynamic-list');
  if (!container) return;
  container.replaceChildren();
  const q = String(filter ?? '').toLocaleLowerCase().trim();
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
    const latencyInfo = serverLatencyPresentation(srv);
    ping.className = `server-latency-label ${latencyInfo.tone}`;
    ping.textContent = latencyInfo.label;
    ping.title = latencyInfo.title;
    ping.setAttribute('aria-label', latencyInfo.aria);
    const latencyDot = document.createElement('span');
    latencyDot.className = `server-latency-dot ${latencyInfo.tone}`;
    latencyDot.setAttribute('aria-hidden', 'true');
    const protocol = document.createElement('span');
    const security = String(srv.security || '').toLowerCase();
    const isHysteria = String(srv.protocol || '').toLowerCase() === 'hysteria2' || String(srv.protocol || '').toLowerCase() === 'hy2';
    protocol.className = `server-protocol-badge ${isHysteria ? 'hysteria' : security === 'reality' ? 'reality' : 'other'}`;
    protocol.textContent = serverProtocolLabel(srv);
    const meta = document.createElement('span');
    meta.className = 'server-item-meta';
    meta.append(protocol, latencyDot, ping);
    const dot = document.createElement('span');
    dot.className = 'radio-selection-dot';
    details.append(meta);
    card.append(flag, details, dot);
    card.setAttribute('aria-label', `${serverDisplayName(srv)}, ${protocol.textContent}, ${latencyInfo.label}`);
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
  const wasReconnecting = state.reconnectPending;
  const shouldRestoreConnection = wasConnected || wasReconnecting;
  const epoch = state.sessionEpoch;
  state.serverSwitchBusy = true;
  try {
    if (shouldRestoreConnection) {
      await toggleVpn(true);
      if (state.vpnConnected) return; // Native stop failed; keep the old endpoint.
    }
    await invoke('save_setting', { key: 'selectedServerCode', value: server.code });
    if (epoch !== state.sessionEpoch) return;
    state.preferredServerCode = server.code;
    state.selectedServer = server;
    state.autoSelectedServer = null;
    const autoButton = document.getElementById('recommended-server-auto');
    autoButton?.classList.toggle('selected', server.code === 'auto');
    autoButton?.setAttribute('aria-pressed', String(server.code === 'auto'));
    renderServersList();
    updateVpnUi();
    switchTab('tab-home');
    if (shouldRestoreConnection && epoch === state.sessionEpoch) await toggleVpn(true);
    if (state.vpnConnected || !shouldRestoreConnection) {
      showToast(uiText('Выбран сервер: ', 'Server selected: ') + serverDisplayName(server));
    }
  } catch (error) {
    showToast(uiText('Не удалось сменить сервер. Настройка не сохранена.',
      'Could not switch servers. Selection was not saved.'), true);
    if (epoch === state.sessionEpoch && shouldRestoreConnection && !state.vpnConnected &&
        state.selectedServer === previous) {
      await toggleVpn(true); // Restore the previous active endpoint when possible.
    }
  } finally {
    state.serverSwitchBusy = false;
    // Re-enable the main connect control after a completed or failed switch.
    updateVpnUi();
  }
}

function automaticServerProtocolRank(server) {
  const protocol = String(server?.protocol || '').toLowerCase();
  const security = String(server?.security || '').toLowerCase();
  // When no latency result exists yet, prefer Windows' best-supported
  // transport instead of an arbitrary catalog entry. Measured latency still
  // dominates this tie-break.
  if (protocol === 'vless' && security === 'reality') return 0;
  if (protocol === 'vless') return 1;
  if (protocol === 'hysteria2' || protocol === 'hy2') return 2;
  return 3;
}

function automaticServerCandidates(servers) {
  const supported = (Array.isArray(servers) ? servers : [])
    .filter(server => server && server.supported !== false && Number(server.ping) !== -2);
  const latency = server => server.ping_method === 'vpn_https' && Number(server.ping) > 0
    ? Number(server.ping) : Number.POSITIVE_INFINITY;
  return supported.sort((a, b) =>
    latency(a) - latency(b) || automaticServerProtocolRank(a) - automaticServerProtocolRank(b));
}

// Connection fallback must still work when every latency probe failed. The
// measured-success list is tried first, then nodes whose probe failed, so an
// all-“could not measure” catalog no longer disables automatic failover.
function automaticFallbackCandidates(servers) {
  const usable = (Array.isArray(servers) ? servers : [])
    .filter(server => server && server.supported !== false && ![-3, -4].includes(Number(server.ping)));
  const measured = usable
    .filter(serverHasFreshMeasurement)
    .sort((a, b) => Number(a.ping) - Number(b.ping) ||
      automaticServerProtocolRank(a) - automaticServerProtocolRank(b));
  const unverified = usable
    .filter(server => !measured.includes(server))
    .sort((a, b) => automaticServerProtocolRank(a) - automaticServerProtocolRank(b));
  return [...measured, ...unverified];
}

// Rank only measurements made through the selected outbound protocol. This
// keeps automatic selection comparable across VLESS and Hysteria 2. When no
// completed measurement exists the caller falls back to the protocol-ranked
// catalog candidate instead of sending an unqualified backend auto request.
function chooseAutomaticServer(servers) {
  return automaticServerCandidates(servers)
    .find(serverHasFreshMeasurement) || null;
}

// Only a measurement taken inside the native cache window may rank automatic
// selection; anything older is treated like an unmeasured candidate.
function serverHasFreshMeasurement(server) {
  if (!server || server.ping_method !== 'vpn_https' || !(Number(server.ping) > 0)) return false;
  const measuredAt = Number(state.measurementsAt || 0);
  // Zero means the age is unknown (for example a catalog restored without a
  // load timestamp); do not discard a usable measurement in that case.
  return measuredAt === 0 || Date.now() - measuredAt < AUTOMATIC_MEASUREMENT_TTL_MS;
}

function isRetryableAutomaticServerFailure(error) {
  const message = String(typeof error === 'string' ? error : error?.message || '');
  return /Выбранный сервер не передал проверочный HTTPS-запрос|VPN не передаёт трафик \(server_unreachable\)|Xray завершился во время локальной проверки|Xray не открыл локальный порт проверки|Ошибка конфигурации Xray|Сервер вернул|Сервер не вернул|Сервер использует|Некорректные параметры Hysteria/i.test(message);
}

// Automatic selection must also fail over when no latency result pinned a
// node. Before this guard, an unmeasured "auto" attempt got exactly one try
// and an auto-assigned dead server surfaced as a dead end.
async function startVpnWithAutomaticFallback(code) {
  try {
    return await invoke('vpn_start', { nodeCode: code });
  } catch (firstError) {
    if (state.selectedServer.code !== 'auto' || !isRetryableAutomaticServerFailure(firstError)) {
      throw firstError;
    }
    const attempted = new Set(code ? [code] : []);
    const fallbacks = automaticFallbackCandidates(state.servers)
      .filter(server => !attempted.has(server.code))
      .slice(0, 2);
    let lastError = firstError;
    for (const fallback of fallbacks) {
      state.autoSelectedServer = fallback;
      updateVpnUi();
      showToast(uiText(`Сервер не ответил. Проверяем ${serverDisplayName(fallback)}…`,
        `The server did not respond. Trying ${serverDisplayName(fallback)}…`));
      try {
        return await invoke('vpn_start', { nodeCode: fallback.code });
      } catch (error) {
        lastError = error;
        // A probe/route failure is not fixed by another catalog entry.
        if (!isRetryableAutomaticServerFailure(error)) break;
      }
    }
    throw lastError;
  }
}

function autoMeasureServerLatencyIfNeeded() {
  if (state.vpnConnected || state.connectionBusy || state.serverSwitchBusy || state.latencyRefreshing) return;
  if (!state.servers.length) return;
  if (state.servers.some(server => serverHasFreshMeasurement(server) || [-3, -4].includes(Number(server.ping)))) return;
  const now = Date.now();
  if (now - serverLatencyAutoAttemptAt < 120000) return;
  serverLatencyAutoAttemptAt = now;
  void loadAvailableServers({ forceProbe: true });
}

function filterServers(query) {
  state.serverSearchQuery = String(query ?? '');
  renderServersList();
}

// Payment & Trial
const TRIAL_ACTION_IDS = [
  'btn-home-activate-trial',
  'btn-no-plan-trial',
  'btn-account-trial',
  'btn-trial-activate',
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
  updateNoPlanPresentation();
  updateTrialScreen();
  updateVpnUi();
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
  state.trialError = '';
  setTrialPending(true);
  try {
    // Eligibility can change after login or another device's activation.
    // Match Android: refresh the account first and fail closed on unknown state.
    const snapshot = await invoke('account_snapshot');
    if (!sameAccount()) return;
    if (!snapshot?.subscription) {
      throw new Error(uiText(
        'Не удалось проверить право на пробный период.',
        'Could not verify free-trial eligibility.'
      ));
    }
    setSubscription(snapshot.subscription);
    updateSubscriptionUi();
    updateVpnUi();
    const freshSub = state.subscription;
    const hasActiveAccess = ['active', 'trial', 'grace'].includes(freshSub.status);
    if (freshSub.status === 'unknown' || hasActiveAccess || freshSub.trial_available !== true) {
      showToast(freshSub.status === 'unknown'
        ? uiText('Не удалось проверить пробный доступ. Повторите позже.',
          'Could not verify free-trial eligibility. Try again later.')
        : uiText('Пробный период сейчас недоступен для аккаунта.',
          'A free trial is not currently available for this account.'), true);
      return;
    }
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
    setSubscription(res);
    updateSubscriptionUi();
    updateVpnUi();
    closeModal('modal-paywall');
    switchTab('tab-home');
    state.trialPreparing = true;
    updateVpnUi();
    let serversReady = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!sameAccount()) return;
      serversReady = await loadAvailableServers();
      if (serversReady || attempt === 1) break;
      await new Promise(resolve => setTimeout(resolve, 750));
    }
    if (!sameAccount()) return;
    state.trialPreparing = false;
    document.getElementById('trial-success-servers-pending')?.classList.toggle('hidden', serversReady);
    openModal('modal-trial-success');
  } catch (err) {
    if (!sameAccount()) return;
    state.trialError = trialActivationMessage(err);
    updateNoPlanPresentation();
    if (state.currentTab !== 'tab-home') showToast(state.trialError, true);
  } finally {
    state.trialPreparing = false;
    setTrialPending(false);
  }
}

async function handlePayYooKassa() {
  if (state.paymentBusy) return;
  if (!state.catalogReady) {
    showToast('Тарифы сейчас недоступны. Повторите загрузку позже.', true);
    return;
  }
  const plan = state.selectedPlanCode || 'month';
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
    if (key === 'autoReconnect') {
      if (value && state.user && !state.vpnConnected && !state.pollInterval) startStatusPolling();
      if (!value && !state.vpnConnected && state.pollInterval) {
        clearInterval(state.pollInterval);
        state.pollInterval = null;
      }
      if (!value && state.vpnPhase === 'reconnecting') {
        state.reconnectPending = false;
        state.vpnPhase = 'idle';
        state.connectionError = null;
        updateVpnUi();
      }
    }
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
  const setAutoReconnect = document.getElementById('set-autoreconnect');
  const setBg = document.getElementById('set-background');
  const setBypass = document.getElementById('set-bypass');
  const setDnsMode = document.getElementById('set-dns-mode');
  const setKill = document.getElementById('set-killswitch');

  if (setAuto) setAuto.checked = !!s.autoStart;
  if (setAutoConnect) setAutoConnect.checked = !!s.autoConnect;
  if (setAutoReconnect) setAutoReconnect.checked = s.autoReconnect !== false;
  if (setBg) setBg.checked = !!s.stayConnectedInBackground;
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
let accountSnapshotInFlight = null;

async function refreshAccountSnapshot(notify = false) {
  if (!state.user) return;
  const epoch = state.sessionEpoch;
  const pending = accountSnapshotInFlight;
  if (pending?.epoch === epoch) {
    // Startup, window focus, subscription expiry and the retry button can all
    // request a snapshot at once. Coalesce them into one request instead of
    // racing device generations and discarding each other's result.
    if (notify) pending.notify = true;
    return pending.promise;
  }
  const entry = { epoch, notify, promise: null };
  entry.promise = performAccountSnapshot(entry);
  accountSnapshotInFlight = entry;
  try {
    return await entry.promise;
  } finally {
    if (accountSnapshotInFlight === entry) accountSnapshotInFlight = null;
  }
}

async function performAccountSnapshot(entry) {
  const { epoch } = entry;
  const devicesGeneration = ++state.devicesRefreshGeneration;
  state.devicesRefreshing = true;
  updateDevicesUi();
  state.subscriptionRefreshCount += 1;
  if (!state.subscription || state.subscription.status === 'unknown' || subscriptionExpired(state.subscription)) {
    updateVpnUi();
  }
  try {
    const data = await invoke('account_snapshot');
    if (epoch !== state.sessionEpoch) return;
    if (data) {
      if (data.user) state.user = data.user;
      if (data.subscription) setSubscription(data.subscription);
      if (devicesGeneration === state.devicesRefreshGeneration) {
        const devicesAvailable = data.devices_supported !== false && Array.isArray(data.devices);
        state.devices = devicesAvailable ? data.devices : [];
        state.devicesSupported = devicesAvailable;
        state.devicesUnavailable = !devicesAvailable;
        state.devicesLoaded = true;
      }
      updateUserUi();
      updateSubscriptionUi();
      updateDevicesUi();
      updateVpnUi();
      if (entry.notify) showToast('Данные аккаунта обновлены');
    } else if (devicesGeneration === state.devicesRefreshGeneration) {
      state.devices = [];
      state.devicesSupported = false;
      state.devicesUnavailable = true;
      state.devicesLoaded = true;
      updateDevicesUi();
    }
  } catch (err) {
    if (epoch === state.sessionEpoch && devicesGeneration === state.devicesRefreshGeneration) {
      state.devices = [];
      state.devicesSupported = false;
      state.devicesUnavailable = true;
      state.devicesLoaded = true;
      updateDevicesUi();
    }
    if (entry.notify && epoch === state.sessionEpoch) {
      showToast(typeof err === 'string' ? err : 'Не удалось обновить аккаунт', true);
    }
  } finally {
    state.subscriptionRefreshCount = Math.max(0, state.subscriptionRefreshCount - 1);
    if (epoch === state.sessionEpoch) {
      if (devicesGeneration === state.devicesRefreshGeneration) {
        state.devicesRefreshing = false;
        updateDevicesUi();
      }
      updateVpnUi();
    }
  }
}

// External Links
async function handleOpenTelegramSupport() {
  const url = 'https://t.me/ByMeVPNSupportBot';
  await invoke('open_external_url', { url }).catch(() => showToast(uiText(
    'Не удалось открыть Telegram. Напишите на support@bymevpn.com.',
    'Could not open Telegram. Email support@bymevpn.com.'
  ), true));
}

async function writeTextToClipboard(text) {
  if (typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_) {
      // Fall through to the WebView-compatible copy command.
    }
  }
  if (typeof document.execCommand !== 'function' || !document.body) {
    throw new Error('Clipboard unavailable');
  }
  const previousFocus = document.activeElement;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  area.style.pointerEvents = 'none';
  document.body.appendChild(area);
  try {
    area.focus();
    area.select();
    if (!document.execCommand('copy')) throw new Error('Clipboard copy failed');
  } finally {
    area.remove();
    previousFocus?.focus?.({ preventScroll: true });
  }
}

async function handleOpenSupportEmail() {
  try {
    await invoke('open_support_email', { isRussian: effectiveLanguage() === 'ru' });
  } catch {
    try {
      await writeTextToClipboard('support@bymevpn.com');
      showToast(uiText(
        'Адрес поддержки скопирован: support@bymevpn.com',
        'Support address copied: support@bymevpn.com'
      ));
    } catch {
      showToast(uiText(
        'Не удалось открыть почту. Адрес поддержки: support@bymevpn.com.',
        'Could not open an email app. Contact support@bymevpn.com.'
      ), true);
    }
  }
}

// Modal Helpers
let activeModalId = null;
let focusBeforeModal = null;
const modalFocusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]';

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  if (id === 'modal-faq') setFaqExpandedIndex(null);
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

let confirmActionLocked = false;

function closeModal(id) {
  if (id === 'modal-confirm' && confirmActionLocked) return;
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

function showConfirm(title, desc, onConfirm, acceptLabel = uiText('Подтвердить', 'Confirm'), options = {}) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-desc').textContent = desc;
  const modal = document.getElementById('modal-confirm');
  const acceptBtn = document.getElementById('btn-confirm-accept');
  const dismissButtons = modal?.querySelectorAll?.('[data-close-modal="modal-confirm"]') || [];
  acceptBtn.disabled = false;
  acceptBtn.textContent = acceptLabel;
  
  acceptBtn.onclick = async () => {
    if (acceptBtn.disabled) return;
    if (!options.keepOpenWhileBusy) {
      closeModal('modal-confirm');
      await onConfirm();
      return;
    }

    confirmActionLocked = true;
    acceptBtn.disabled = true;
    acceptBtn.setAttribute('aria-busy', 'true');
    acceptBtn.textContent = options.busyLabel || '…';
    dismissButtons.forEach(button => { button.disabled = true; });
    try {
      await onConfirm();
    } finally {
      confirmActionLocked = false;
      acceptBtn.disabled = false;
      acceptBtn.removeAttribute('aria-busy');
      dismissButtons.forEach(button => { button.disabled = false; });
      closeModal('modal-confirm');
    }
  };
  openModal('modal-confirm');
}

function openLegalModal(type) {
  const modal = document.getElementById('modal-legal');
  const title = document.getElementById('legal-modal-title');
  const body = document.getElementById('legal-modal-body');
  if (!modal || !title || !body) return;
  const en = effectiveLanguage() === 'en';

  if (type === 'about') {
    const version = document.querySelector?.('.version-num')?.dataset?.appVersion;
    title.textContent = 'ByMeVPN';
    body.textContent = `${version ? uiText('Версия ', 'Version ') + version + '. ' : ''}${uiText('Для связи: ', 'Contact: ')}support@bymevpn.com`;
    openModal('modal-legal');
    return;
  }

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

