# Gacha Tracker — V1.0.2

---

## First time setup (do this once)

1. Install Node.js from https://nodejs.org (LTS version)
2. Open this folder in VS Code
3. Open the terminal (Ctrl + `)
4. Run: npm install

---

## Building the .exe (do this once, or after any update)

In the VS Code terminal:
```
npm run build-exe
```

This will:
- Build the React UI
- Package everything into a Windows installer

The installer appears in the `dist/` folder as `Gacha Tracker Setup.exe`.
Run it once to install the app. After that, launch it from your desktop shortcut or Start Menu like any normal program.

---

## Your data

When running as an installed .exe, your data (games, pity, currency) is stored in:
```
C:\Users\YourName\AppData\Roaming\gacha-tracker\storage\user.json
```

This means your data survives updates — installing a new version never touches it.

---

## Dev mode (only if you're editing code)

```
npm run dev
```

---

## Notes
- Before updating: you don't need to back up anything. Data is safe in AppData.
- The dist/ folder and node_modules/ are not included in the zip — run npm install to restore them.

---

## Credits


---

## Copyright

© All rights to Genshin Impact, Honkai: Star Rail and Zenless Zone Zero game assets used in this app are reserved by miHoYo Ltd. and Cognosphere Pte., Ltd.

This app is not affiliated with miHoYo or Cognosphere Pte., Ltd. (HoYoverse). All asset files are property of their respective owners.
