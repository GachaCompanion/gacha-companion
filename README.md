# Gacha Companion

A personal desktop companion for your gacha games. Track characters, resources, pull history, and more — all in one place.

This project is built with the help of Claude Code — anything you see here has been made via prompts, so if you're against AI-assisted projects, this may not be for you. Bugs are bound to exist.

---

## Installing

1. Download the installer from the [download page](https://gachacompanion.github.io/gacha-companion/) (or directly from the [latest Release](https://github.com/GachaCompanion/gacha-companion/releases/latest)).
2. Run `GachaCompanion-Setup.exe` — if Windows shows a warning, click **More info** then **Run anyway**.
3. Follow the installer steps and click **Install**.
4. Launch from the Desktop or Start Menu shortcut.

## Uninstalling

1. Open **Windows Settings → Apps** (or Control Panel → Add or Remove Programs).
2. Search for **Gacha Companion** and uninstall it.
3. Your personal data is stored separately and is **not** removed by the uninstaller. If you want a clean wipe, after uninstalling also delete this folder:
   ```
   %APPDATA%\gacha-companion
   ```
   (Win + R, paste that, Enter, then delete the folder.)

## Your data

While running, your data (games, pity, currency, pull history) is stored in:
```
C:\Users\YourName\AppData\Roaming\gacha-companion
```
This means your data survives updates — installing a newer version never touches it.

---

## Dev setup (only if you're editing code)

```bash
npm install
npm run dev
```

Building a local installer:
```bash
npm run build-exe
```
The installer appears in `dist/` as `GachaCompanion-Setup.exe`.

---

## Copyright

All rights to Genshin Impact, Honkai: Star Rail, Zenless Zone Zero, Wuthering Waves, and Neverness to Everness game assets used in this app are reserved by their respective owners.

This app is not affiliated with any of the game publishers. All asset files are the property of their respective owners.
