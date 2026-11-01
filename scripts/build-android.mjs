import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, lstatSync, realpathSync, rmSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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

// Keep a versioned, easy-to-find delivery copy alongside its checksum and
// provenance. Read the actual Gradle output so names cannot drift from the APK.
if (!bundle) {
  const apkDir = path.join(root, 'android/app/build/outputs/apk', release ? 'release' : 'debug')
  const metadata = JSON.parse(readFileSync(path.join(apkDir, 'output-metadata.json'), 'utf8'))
  const [apk] = metadata.elements
  if (metadata.elements.length !== 1 || !apk.outputFile.endsWith('.apk')) {
    throw new Error('Expected one universal APK in Gradle output')
  }
  const deliveryDir = path.join(root, 'artifacts/android')
  const filename = `mahjong-${apk.versionName}.apk`
  const contents = readFileSync(path.join(apkDir, apk.outputFile))
  const sha256 = createHash('sha256').update(contents).digest('hex')
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    return result.status === 0 ? result.stdout.trim() : null
  }
  const status = git(['status', '--porcelain'])
  const info = {
    applicationId: metadata.applicationId,
    versionName: apk.versionName,
    versionCode: apk.versionCode,
    buildType: release ? 'release' : 'debug',
    sourceCommit: git(['rev-parse', 'HEAD']),
    sourceBranch: git(['branch', '--show-current']),
    sourceDirty: status === null ? null : Boolean(status),
    createdAt: new Date().toISOString(),
    sha256,
    bytes: contents.length,
  }
  mkdirSync(deliveryDir, { recursive: true })
  copyFileSync(path.join(apkDir, apk.outputFile), path.join(deliveryDir, filename))
  writeFileSync(path.join(deliveryDir, `${filename}.sha256`), `${sha256}  ${filename}\n`)
  writeFileSync(path.join(deliveryDir, `${filename}.build-info.json`), JSON.stringify(info, null, 2) + '\n')
  console.log(`\nAPK: ${path.join(deliveryDir, filename)}\nSHA-256: ${sha256}`)
}
