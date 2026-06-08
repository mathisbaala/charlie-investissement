import '@testing-library/jest-dom'

// jsdom ne supporte pas scrollIntoView (absent en environnement node, ex. tests PDF)
if (typeof window !== "undefined") {
  window.HTMLElement.prototype.scrollIntoView = () => {}
}
