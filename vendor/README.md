# Windows tunnel runtime provenance

Downloaded 2026-10-29 for development; these files are not yet integrated into the installer and no tunnel has been started.

| Artifact | Source | SHA-256 |
| --- | --- | --- |
| Xray-core v26.10.29 Windows x64 ZIP | https://github.com/XTLS/Xray-core/releases/tag/v26.10.29 | `fce33e81cccf50e7aab572b175519a50b5e0f9d2f5c8d1ed73012ea5c9ad4d58` |
| Wintun 0.14.1 ZIP | https://www.wintun.net/ | `07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51` |
| Extracted xray.exe | Xray archive above | `07a332b714a3c0eee047a22a9c0ea749b64df33e4e1ff6d28a8c7f9ef943ce10` |
| Extracted amd64 wintun.dll | Wintun archive above | `e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce` |

Both archive hashes matched the upstream published values. Windows Authenticode reports the Wintun DLL signature valid and identifies WireGuard LLC as signer. Licenses from both distributions are retained in `runtime/windows-x64/`.

This does not establish that routing, DNS, shutdown recovery, packaging, or system-wide traffic protection works. Runtime integrity checking, privilege separation, and end-to-end testing remain required.

`xray.exe run -test -config vendor/test-config.json` returned `Configuration OK` for a nonfunctional example using RFC 5737 documentation address `192.0.2.1` and a synthetic UUID. This command parsed the configuration only; it did not create a TUN adapter, connect, or verify routes or traffic. The example is not a user connection configuration.
