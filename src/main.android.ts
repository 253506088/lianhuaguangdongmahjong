// Android 11 images can ship WebView 83. Transpilation handles syntax;
// these polyfills cover APIs used by the game (at, structuredClone, etc.).
import './platform/androidCompatibility'
import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import './platform/android.css'

// Dismiss an open panel before Android offers to put the game in the background.
// No Java object is exposed to JavaScript; native calls this narrow UI function.
Object.assign(window, {
  __mahjongHandleBack: () => {
    const panels = [...document.querySelectorAll<HTMLElement>('[role="dialog"], .rules-panel, .settings-panel')]
      .filter(panel => panel.getClientRects().length > 0)
    const panel = panels.at(-1)
    const close = panel?.querySelector<HTMLButtonElement>('button[aria-label*="关闭"], .close-button, .dialog-close, .rules-close')
    if (!close) return false
    close.click()
    return true
  },
})
createApp(App).mount('#app')
