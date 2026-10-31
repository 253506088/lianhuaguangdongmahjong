import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, lstatSync, realpathSync, rmSync } from 'node:fs'
import path from 'node:path'
const root = fileURLToPath(new URL('..', import.meta.url))
const release = process.argv.includes('--release')
const bundle = process.argv.includes('--bundle')
const signingFile = path.join(root, 'android', 'signing.properties')
if (release && existsSync(signingFile)) {
  const local = Object.fromEntries(readFileSync(signingFile, 'utf8').split(/\r?\n/)
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]))
  for (const [envKey, key] of Object.entries({ ANDROID_KEYSTORE_PATH: 'storeFile', ANDROID_KEYSTORE_PASSWORD: 'storePassword', ANDROID_KEY_ALIAS: 'keyAlias', ANDROID_KEY_PASSWORD: 'keyPassword' })) {
    if (!process.env[envKey] && local[key]) process.env[envKey] = key === 'storeFile' ? path.resolve(root, 'android', local[key]) : local[key]
  }
}
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
// A native package must contain only the current build. Validate the absolute
// generated directory before removing it; never follow an output symlink.
const output = path.resolve(root, 'dist-android')
if (existsSync(output)) {
  const expected = path.join(realpathSync(root), 'dist-android')
  if (lstatSync(output).isSymbolicLink() || !lstatSync(output).isDirectory() || realpathSync(output) !== expected) {
    throw new Error('Refusing to clean an Android output outside the repository')
  }
  rmSync(output, { recursive: true, force: true })
}
run('node', ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.android.config.ts'])
run(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', [bundle ? 'bundleRelease' : release ? 'assembleRelease' : 'assembleDebug', '--console=plain'], fileURLToPath(new URL('../android', import.meta.url)))
