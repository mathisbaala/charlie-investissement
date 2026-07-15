import '@testing-library/jest-dom'

// jsdom ne supporte pas scrollIntoView (absent en environnement node, ex. tests PDF)
if (typeof window !== "undefined") {
  window.HTMLElement.prototype.scrollIntoView = () => {}
}

// Sous Node 26, jsdom n'expose plus localStorage : tous les tests qui stockent
// (profil client, cabinet, historique de consultation…) plantaient sur
// « Cannot read properties of undefined ». Petit polyfill mémoire, remis à
// zéro par fichier de test (chaque worker a son propre environnement).
if (typeof window !== "undefined" && typeof window.localStorage === "undefined") {
  const store = new Map<string, string>()
  const localStoragePolyfill: Storage = {
    getItem: (k: string) => store.get(String(k)) ?? null,
    setItem: (k: string, v: string) => { store.set(String(k), String(v)) },
    removeItem: (k: string) => { store.delete(String(k)) },
    clear: () => { store.clear() },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  }
  Object.defineProperty(window, "localStorage", { value: localStoragePolyfill, configurable: true })
  Object.defineProperty(globalThis, "localStorage", { value: localStoragePolyfill, configurable: true })
}
