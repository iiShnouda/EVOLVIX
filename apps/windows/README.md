# SKB — Windows desktop app (C# / .NET 8 / WPF)

The native Windows client for SKB. It talks to the **same server** as the web/PWA and
Android apps — all business logic, security, and data live on the server; this is a fast,
native desktop **view** on top.

- **Language:** C# (.NET 8), **UI:** WPF, **pattern:** MVVM
- **Zero external NuGet packages** — plain .NET + WPF only, so it restores and builds with
  nothing to fetch beyond the .NET SDK.
- Bilingual **Arabic / English** with full **RTL/LTR**, **light/dark** themes, a
  **connection-required** offline gate (no data shown when the server is unreachable), and
  **in-memory-only** tokens (nothing sensitive written to disk).

## Requirements

- Windows 10/11
- **Visual Studio 2022** (17.8+) with the *.NET desktop development* workload, **or** the
  **.NET 8 SDK** for command-line builds.

## Open & run

**Visual Studio:** open `SKB.sln`, set `SKB.App` as the startup project, press **F5**.

**Command line:**
```powershell
cd apps\windows
dotnet restore
dotnet run --project src\SKB.App
```

## Point it at your server

Edit `src/SKB.App/appsettings.json` (copied next to the built `.exe`):
```json
{ "ApiUrl": "http://192.168.1.10:5080" }
```
Use `http://localhost:5080` for local development, or the company server's LAN address for
staff PCs. (Later, over the internet, use its `https://` address — no code change.)

Sign in with a seeded account, e.g. `owner@skb.local` / `ChangeMe!Owner123`.

## Project layout

```
apps/windows/
├─ SKB.sln
└─ src/
   ├─ SKB.Core/                 # Platform-agnostic core (also reusable elsewhere)
   │  ├─ Models/                #   DTOs mirroring the server JSON
   │  ├─ Api/                   #   ApiClient (HttpClient + token/refresh), SessionState
   │  ├─ Localization/          #   AR/EN dictionary
   │  └─ Formatting.cs          #   money (minor units) / date / number formatting
   └─ SKB.App/                  # WPF app
      ├─ App.xaml(.cs)          #   composition root, theme + connection bootstrap
      ├─ Themes/                #   Light.xaml, Dark.xaml, Styles.xaml
      ├─ Infrastructure/        #   ObservableObject, RelayCommand, converters
      ├─ Services/              #   Localizer (+RTL), ThemeManager, ConnectionMonitor
      ├─ ViewModels/            #   Login, Shell, Dashboard, Sales, Parties, Placeholder
      └─ Views/                 #   XAML windows/usercontrols
```

## Publish a single installer / .exe (later)

```powershell
dotnet publish src\SKB.App -c Release -r win-x64 --self-contained true ^
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```
Produces a self-contained `SKB.exe` staff can run without installing .NET. (A polished MSI
installer can be added with WiX or Velopack when we finalize distribution.)

## Status

Foundation + vertical slice: **sign-in → dashboard (KPIs, recent, low stock) → sales
(list + document preview) → customers/suppliers**, with the same adaptive, bilingual,
theming behavior as the web app. Remaining modules plug into the same server and MVVM
structure. This project is authored to open and build in Visual Studio; it was not compiled
in the cloud environment where it was generated (WPF builds only on Windows).
