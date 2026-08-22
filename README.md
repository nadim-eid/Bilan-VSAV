# Bilan VSAV - Android

Projet préparé pour convertir le composant React `bilan-vsav.jsx` en application Android.

## Modification importante
Le stockage `window.storage` d'origine a été remplacé par `localStorage`, afin que l'historique soit conservé localement dans l'application Android/WebView.

## Compilation avec Android Studio / Capacitor
1. Installer Node.js et Android Studio.
2. Dans ce dossier: `npm install`
3. `npm run build`
4. `npx cap add android` (une seule fois)
5. `npx cap sync android`
6. `npx cap open android`
7. Dans Android Studio: Build > Build APK(s)

Nom application: Bilan VSAV
Identifiant: fr.bilanvsav.app
