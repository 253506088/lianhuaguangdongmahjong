import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  define: { 'import.meta.env.VITE_NATIVE_APP': JSON.stringify('android') },
  worker: { plugins: () => [{
    name: 'android-worker-compatibility',
    transform(code, id) {
      if (id.endsWith('/bloodFlow/engineWorker.ts') || id.endsWith('/patterns/worker.ts')) {
        return `import '../../../../platform/androidCompatibility';\n${code}`
      }
    },
  }] },
  plugins: [vue(), {
    name: 'android-local-entry',
    transformIndexHtml: {
      order: 'pre',
      handler: html => html
        // The native game starts without third-party SDK or analytics requests.
        .replace(/<script\b[^>]*src="https?:[^>]*>[\s\S]*?<\/script>/g, '')
        .replace(/<script>\s*window\.dataLayer[\s\S]*?<\/script>/g, '')
        .replace('/src/main.ts', '/src/main.android.ts')
        .replace('initial-scale=1.0', 'initial-scale=1.0, viewport-fit=cover')
        .replace(/href="\/(favicon\.svg|site\.webmanifest)"/g, 'href="./$1"'),
    },
  }],
  build: {
    outDir: 'dist-android',
    emptyOutDir: true,
    target: 'chrome83',
    cssTarget: 'chrome83',
    sourcemap: false,
  },
  // The native Activity has one full-screen game viewport. Android 11's
  // original WebView 83 predates container queries/units; lower those rules
  // to equivalent viewport queries in this build only.
  css: { postcss: { plugins: [{
    postcssPlugin: 'android-viewport-queries',
    Once(root) {
      root.walkAtRules('container', rule => {
        rule.name = 'media'
        rule.params = rule.params.replace(/\)\s+or\s+\(/g, '), (')
      })
      // Some Android 11 WebViews (and tablets with an attached mouse) report
      // a fine pointer. The installed app still uses the touch-friendly layout.
      root.walkAtRules('media', rule => {
        rule.params = rule.params.replace(/\(hover:\s*none\)|\(pointer:\s*coarse\)/g, '(min-width: 0px)')
      })
      root.walkDecls(decl => {
        decl.value = decl.value.replace(/cq(w|h|min|max)\b/g, 'v$1')
      })
    },
  }] } },
})
