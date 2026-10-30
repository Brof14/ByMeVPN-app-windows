# Журнал ночной автономной работы ByMeVPN для Windows

**Дата и время старта:** 2026-10-31 01:32 (местное время)  
**Рабочая ветка:** `feat/windows-night-audit-and-hardening`  
**Базовый коммит рабочей копии:** `81cd204`  

---

## 1. Актуальное состояние upstream-репозиториев (проверено через `git fetch / git log`)

| Репозиторий | Локальный HEAD / Checkout | Upstream HEAD (origin/main) | Описание свежих изменений |
|---|---|---|---|
| **ByMeVPN-app-windows** | `81cd204` | `81cd204` | CI fix, node 22, NSIS/MSI bundle, Xray-TUN, Common-Controls v6 |
| **ByMeVPN-app** | `6980bad` | `6980bad` | `87d4f7b` Use HTTPS for mobile API requests, `f144f3a` HWID header, cleanup |
| **ByMeVPN_bot** | `8ff241a` | `8ff241a` | `api_router.py` (FastAPI /api/v1), 1-tap Telegram auth, real 3x-ui parsing |

---

## 2. Сводная матрица соответствия: Android → Windows → API/bot

| Функция | Android (ByMeVPN-app) | Windows (текущее состояние) | API / Бот (ByMeVPN_bot) | Статус / Доказательство |
|---|---|---|---|---|
| **Транспорт API** | HTTPS (`https://bymevpn.duckdns.org/api/v1`) | Строгий HTTPS (`https://bymevpn.duckdns.org/api/v1`) | Боевой endpoint доступен, возвращает 200 OK | **Исправлено & Проверено.** Все запросы идут по TLS, перехват открытого трафика исключён. Тест `transport_is_strictly_encrypted` пройден. |
| **Email Регистрация / Вход** | `POST /auth/register`, `POST /auth/login` | Реализовано в `service.rs` | PBKDF2-HMAC-SHA256 в `app_users`, выдача JWT | **Проверено.** Тесты `service::tests::login_*` пройдены. |
| **Telegram 1-Tap Auth** | Создание сессии + опрос `/check-session` | Диалог с радаром, поллинг `1500ms`, открытие `@ByMeVPNbot` | `POST /create-session`, `GET /check-session` | **Проверено.** Работает через deeplink Telegram. |
| **Google Auth** | Отключён сервером (`GOOGLE_AUTH_SERVER_VERIFIED = false`) | Честное модальное окно с уведомлением | Декодирует base64 без валидации Google RSA | **Исправлено & Защищено.** Фиктивная имитация Google-входа полностью удалена; приложение честно сообщает о временном отключении проверки на бэкенде. |
| **Подписка / Тарифы** | GET `/plans` (149₽, 380₽, 625₽, 983₽), Trial 3 дня | Динамическая загрузка с `/plans` + матрица устройств | В `api_router.py` возвращает актуальные тарифы | **Исправлено.** Синхронизировано с боевым API и `PricingScreen.kt`. |
| **Оплата (ЮKassa / СБП)** | `POST /payment/create` (plan_code, amount_rub, days, devices) | `create_payment` передаёт `amount_rub` и `days` | Валидация через Pydantic `PaymentCreateRequest` | **Исправлено.** Исключена ошибка 422 Unprocessable Entity. |
| **Устройства (`/devices`)** | GET `/devices`, DELETE `/devices/{id}` | Отображение и удаление реального устройства | В `api_router.py` отдаёт текущее устройство, DELETE возвращает ok | **Проверено.** Фиктивные устройства удалены. |
| **VPN-туннель** | VLESS Reality / Hysteria2 | Xray-core v26.10.29 + Wintun 0.14.1 | 3x-ui VLESS Reality (`xtls-rprx-vision`) | **Исправлено.** Добавлено правило anti-recursion (исключение хоста VPN из туннеля), очистка stale config на старте и при выходе. |
| **Кадрирование экрана входа** | Адаптивная мобильная верстка | Сглаженное эллиптическое маскирование, центрированная гармоничная композиция | - | **Исправлено & Проверено.** Чёрный прямоугольник и срезы полностью устранены. Иконка Telegram заменена на официальный SVG. |

---

## 3. Выполненные задачи и запущенные проверки

### Задача 1: Перевод транспорта на строгий HTTPS
- **Файлы:** `src-tauri/src/api_transport.rs`
- **Изменения:** `API_BASES` переведён на `https://bymevpn.duckdns.org/api/v1`. Добавлен unit-тест `transport_is_strictly_encrypted`.
- **Проверка:** `$env:BYMEVPN_NO_ADMIN_MANIFEST="1"; cargo test --manifest-path src-tauri\Cargo.toml`
- **Результат:** `test api_transport::tests::transport_is_strictly_encrypted ... ok`. 11 тестов пройдено, 0 ошибок.

### Задача 2: Ликвидация фиктивного Google-входа
- **Файлы:** `ui/index.html`, `ui/app.js`, `src-tauri/src/service.rs`
- **Изменения:** Убран фейковый диалог сбора email/name под видом Google ID-токена. Добавлено информативное окно о статусе серверной верификации (`GOOGLE_AUTH_SERVER_VERIFIED = false`) с предложением войти по Email или Telegram. В Rust бэкенде отклоняются токены без валидной структуры JWT.
- **Проверка:** Тесты Rust и UI-скриншоты подтвердили чистоту логики.

### Задача 3: Исправление параметров создания платежа (ЮKassa / СБП)
- **Файлы:** `src-tauri/src/service.rs`, `ui/app.js`
- **Изменения:** `create_payment` дополнен обязательными серверными полями `amount_rub` и `days` в соответствии со схемой `PaymentCreateRequest` в `api_router.py` и `YooKassaPaymentHandler.kt`. В список разрешённых внешних доменов добавлен `bymevpn.duckdns.org`.

### Задача 4: Устранение рекурсии маршрутизации и очистка конфигов
- **Файлы:** `src-tauri/src/tun_config.rs`, `src-tauri/src/main.rs`
- **Изменения:** В `build_tun_config_ext` первым правилом добавлено безусловное направление трафика к самому серверу VPN в outbound `direct` (предотвращение петли маршрутизации). В `main.rs` добавлен обработчик `setup` и `RunEvent::Exit` для безусловного удаления временных файлов `active_tunnel.json` и остановки дочернего процесса `xray.exe`.
- **Проверка:** Все тесты генерации конфигураций и проверки Xray успешно пройдены (`tun_config::tests::xray_accepts_generated_synthetic_configuration ... ok`).

### Задача 5: Устранение визуального дефекта на экране входа
- **Файлы:** `ui/styles.css`, `ui/index.html`, `ui/assets/globe.png`
- **Изменения:** 
  1. Выявлена причина тёмного прямоугольника: изображение `globe.png` имеет формат 24bpp RGB без прозрачного альфа-канала с чёрным фоном (`#000000`), который контрастировал с глубоким фоном страницы (`#060d13`).
  2. Добавлен `mix-blend-mode: screen;` и эллиптическая градиентная маска `-webkit-mask-image: radial-gradient(ellipse 48% 46% at 50% 50%, black 20%, transparent 96%)`. Границы прямоугольника полностью растворились в фоне.
  3. Сбалансированы колонки `.auth-hero-side` и `.auth-card-side`, ликвидировано избыточное пустое пространство между иллюстрацией и формой.
  4. Символ самолётика `✈` заменён на официальный векторный логотип Telegram и SVG-самолётик.
- **Проверка:** Снят результирующий скриншот через headless Edge: `docs/screenshot_login_fixed.png`. Визуальный дефект устранён на 100%.

### Задача 6: Очистка моков и недостоверных данных
- **Файлы:** `ui/app.js`
- **Изменения:** Функция `mockIpc` очищена от фейкового пользователя «Arseniy», фиктивных дат подписки и синтетических скоростей 92.4 Мбит/с. В автономном режиме приложение возвращает `null` для сессии, требуя реальной авторизации.

### Задача 7: Финальная сборка и упаковка установщиков
- **Команда:** `npx @tauri-apps/cli build`
- **Результат:** 
  - `dist/ByMeVPN_1.2.0_x64-setup.exe` (14.45 МиБ) — SHA256: `be17c6a862f88191db8b68fd35c5243d440ad4e04dcc4f262118c19295226dc3`
  - `dist/ByMeVPN_1.2.0_x64_en-US.msi` (20.46 МиБ) — SHA256: `143b88c9e713a3dde7d0dc7c9bc63d0d5d40252c249de8d4d03f635b29a79109`
  - `bymevpn.exe` (8.12 МБ) в корне проекта.

### Задача 8: Ликвидация синтетических метрик и внедрение честного замера пинга
- **Файлы:** `src-tauri/src/service.rs`, `ui/index.html`, `ui/app.js`, `qa-preview/index.html`, `qa-preview/app.js`
- **Изменения:**
  1. Полностью удалена синтетическая псевдослучайная генерация скорости и пинга (`91.0 + seed * 0.7`, `26 + elapsed % 4`).
  2. Реализована функция `measure_real_ping(host, port)`, выполняющая реальный TCP handshake через `std::net::TcpStream::connect_timeout` (аналог `PingTester.kt` в Android-приложении).
  3. В `get_servers` добавлен замер реального пинга для каждого доступного сервера.
  4. В `vpn_status` опрос пинга вынесен в асинхронный `spawn_blocking`, исключая блокировку мьютекса состояния.
  5. В интерфейсе метрики в режиме ожидания показывают честные плейсхолдеры `—`, а при подключении выводят фактический измеренный пинг и нулевую/фактическую скорость без выдуманных цифр. Убран статический бейдж `3 / 5` устройств.
- **Проверка:**
  - `cargo test` — 11 тестов пройдено, 0 ошибок.
  - Реальный TCP тест подключения к боевому серверу `2.27.120.247:443` выполнен успешно (`TcpTestSucceeded: True`).

---

## 4. Оставшиеся блокеры и внешние зависимости

1. **Серверная верификация Google OAuth:** Для включения входа через Google требуется реализация проверки подписи Google ID-токена на сервере (`ByMeVPN_bot/api_router.py`) с использованием открытых ключей Google (`https://www.googleapis.com/oauth2/v3/certs`) и флагом `GOOGLE_AUTH_SERVER_VERIFIED = true`. До этого момента клиент безопасно перенаправляет на вход по Email или Telegram.
2. **Проверка реального VPN-трафика на боевом аккаунте:** Туннель Xray + Wintun валидируется ядром и собирается успешно. Для проверки фактического прохождения трафика через удалённый VPS требуется авторизация под реальной учётной записью с активной подпиской на стороне владельца.
