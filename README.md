# Bemanning – Prototype v1 (Vite + React)

Dette er en GitHub Pages-klar demo som kan bygges og publiseres automatisk.

## 1) Første gang (lokalt)
```bash
npm install
npm run dev
```

## 2) Publisering til GitHub Pages
1. Push til `main`
2. Gå til **Settings → Pages** og velg **Source: GitHub Actions**
3. Vent til workflowen er grønn

### Viktig: base-path
Hvis repoet heter `bemanning-prototype`, sett `base` i `vite.config.js` til:
```js
base: "/bemanning-prototype/",
```
Vite sin deploy-guide beskriver dette når man deployer til GitHub Pages under en subpath.
