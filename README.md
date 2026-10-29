# v2rust

Небольшой экспериментальный Windows-клиент на Tauri 2 и Rust для запуска локального Xray-прокси и управления системным HTTP-прокси Windows.

## Состояние проекта

Это ранний прототип, а не готовый VPN-клиент. Здесь пока нет входа через Google, email или Telegram, подписок, оплаты и списка серверов. Клиент включает системный HTTP-прокси Windows; он не создаёт полноценный VPN-туннель для всего трафика компьютера.

Для подключения требуются собственные `xray.exe`, `xui.exe` и локальный `config1.json`. Их нет в репозитории: конфигурация может содержать адрес сервера и данные доступа, а происхождение внешних исполняемых файлов нужно проверять отдельно. Не публикуйте конфигурацию, ключи или учётные данные.

## Сборка в Windows

Нужны Windows, Rust с MSVC toolchain, Visual Studio Build Tools с компонентом «Средства сборки MSVC для x64/x86», Windows SDK и WebView2 Runtime. Установите Tauri CLI:

```powershell
cargo install tauri-cli
```

Затем из корня проекта:

```powershell
Set-Location .\src-tauri
cargo tauri dev
```

Сборка установщика запускается из той же папки:

```powershell
cargo tauri build
```

Настройки пакета ожидают локальные Xray-файлы в `src-tauri/target/debug/xray/` и `src-tauri/target/debug/xui.exe`. Эти каталоги сборки исключены из Git. Перед запуском подготовьте собственные проверенные файлы и конфигурацию.

## Структура

- `src/` — HTML, CSS и JavaScript интерфейса.
- `src-tauri/` — код Rust, настройки Tauri и управление Windows proxy.
- `src-tauri/Cargo.toml` и `src-tauri/Cargo.lock` — зависимости Rust.

Кэш Cargo, результаты сборки, локальные VPN-конфиги и настройки IDE исключены из Git.

