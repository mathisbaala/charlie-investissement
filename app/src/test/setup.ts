import '@testing-library/jest-dom'

// jsdom ne supporte pas scrollIntoView
window.HTMLElement.prototype.scrollIntoView = () => {}
