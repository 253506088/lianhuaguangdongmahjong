import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const release = process.argv.includes('--release')
const bundle = process.argv.includes('--bundle')
if (release && !['ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'].every(key => process.env[key])) {
  throw new Error('Signed release requires ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS and ANDROID_KEY_PASSWORD. See docs/android.md.')
}
function run(command, args, cwd = root) {
  const result = process.platform === 'win32' && command.endsWith('.bat')
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', [command, ...args].join(' ')], { cwd, stdio: 'inherit' })
    : spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run('node', ['node_modules/vue-tsc/bin/vue-tsc.js', '--noEmit'])
run('node', ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.android.config.ts'])
run(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', [bundle ? 'bundleRelease' : release ? 'assembleRelease' : 'assembleDebug', '--console=plain'], fileURLToPath(new URL('../android', import.meta.url)))
