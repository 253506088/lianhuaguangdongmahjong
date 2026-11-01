# Android 11+ 离线应用

Android 工程与网页共用 Vue / Three.js 源码，不建立会漂移的第二份游戏实现。原生 Java Activity 使用 AndroidX WebViewAssetLoader，从 APK 内置资源提供 HTTPS 页面。首次启动、普通 AI、麻将规则、牌面和声音无需网络。

- 最低 Android 11（API 30）；编译 / 目标 API 35；需要支持 OpenGL ES 3 的设备。
- 自动横屏，屏幕保持唤醒；避开挖孔与键盘；后台暂停 WebView 计时器和音频，回到前台继续。
- 返回键优先关闭支持的弹窗；再次返回可把游戏放到后台。系统杀进程后未完成的牌局不会恢复，偏好和已存回放仍保留。
- 当前 fork 的 P2P 联机已知不可用。Android 首版仅开放单机入口，不要求账号，不连接本机开发后端。自行配置的大模型 / TTS 仍然需要网络及相应服务，它们不是离线功能。
- 推荐保持 Android System WebView 更新。旧 WebView 的 JS API 通过 core-js 补齐，语法编译到 Chrome 83；原生版将全屏容器查询转换为对应的视口查询；图形驱动和 CSS 支持仍由设备 WebView 决定。

## 生成可安装 APK

Windows 可直接双击仓库根目录的 **`构建App.bat`**：自动定位项目、检查 Node.js / JDK 17 / SDK、在缺少前端依赖时按锁文件安装，然后生成正式签名 APK。签名沿用下面说明的 `android/signing.properties` 或环境变量；缺少签名时会明确报错。仅需调试包时运行 `构建App.bat -DebugApk`。

脚本会优先使用已安装的 JDK 17（检查 `JAVA_HOME` 及 Program Files 下的 Java / Eclipse Adoptium / Microsoft 目录），SDK 检查 `ANDROID_HOME`、`ANDROID_SDK_ROOT` 与 `%LOCALAPPDATA%\Android\Sdk`。这些设置只影响本次构建进程，不修改系统环境变量。首次安装依赖或下载 Gradle 需要网络；生成的 APK 普通 AI 单机运行无需网络、账号、电脑或后端服务。

**`构建前端.bat`** 生成普通 Web 版到 `dist`，用于静态网站部署；它与 Android APK 是两个独立产物。网页单机模式也无需游戏后端，联机功能需要配套服务。`启动.bat` 用于本地开发预览。两个构建脚本结束后都会显示结果并等待按键；自动化运行时设置 `MAHJONG_BUILD_NO_PAUSE=1` 可跳过等待，并以退出码判断成功或失败。

准备 Node.js 24、pnpm 10.32.1、JDK 17、Android SDK Platform 35 与 Build Tools 35.0.0。Gradle 8.14 由已提交的 wrapper 自动下载。

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
pnpm install --frozen-lockfile
pnpm android:debug
```

输出：`android/app/build/outputs/apk/debug/app-debug.apk`。调试包会自动使用本机 Android debug key 签名，可直接安装；包名为 `io.github.mahjong253506088.app.debug`。不同开发机器产生的 debug key 不相同，换机器构建时可能需要先卸载旧包（会清空其本地数据）。

`pnpm android:web` 只构建手机网页资源到 `dist-android`；Gradle 同步到自身 build 目录，源码区不会复制一份大体积网站。普通 `pnpm build` 仍输出 Web 版到 `dist`。

## 正式签名与更新

正式包名为 `io.github.mahjong253506088.app`。通过环境变量提供自己的长期签名证书：

```text
ANDROID_KEYSTORE_PATH
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

运行 `pnpm android:release` 生成签名 APK；`pnpm android:bundle` 生成商店使用的 AAB。脚本在缺少证书时明确失败，不会把 debug 签名冒充正式发布。请保管证书，后续升级必须沿用同一个证书，同时递增 `android/app/build.gradle` 的 `versionCode`。

本地也支持被 Git 忽略的 `android/signing.properties`，使用 `storeFile`、`storePassword`、`keyAlias`、`keyPassword` 四个属性（`storeFile` 相对 `android/`）。环境变量优先。签名证书和此配置应一同备份，不能放到公开仓库。

SDK 路径、Gradle 缓存、APK/AAB、签名文件、密码配置均在 `.gitignore` 中说明并排除。原生源码、wrapper JAR、资源 SVG、锁文件和 CI 必须提交。

构建脚本会自动把 APK 复制到 `artifacts/android/mahjong-<版本号>.apk`（当前正式版为 `mahjong-1.2.0.apk`，`versionCode=3`），并生成同名 `.apk.sha256` 与 `.apk.build-info.json`，记录校验值、版本、源码提交和工作区是否有未提交改动。调试包文件名包含 `-debug`，历史版本保留。该目录为生成产物，不提交 Git。将 APK 传到 Android 11+ 手机上打开，按系统提示允许文件管理器安装应用即可；无需运行本机开发服务器。沿用相同签名可从 1.1.0 / 1.1.1 覆盖升级；正式版与 debug 版包名不同，可同时安装。

## 验证

本次 Android 11（WebView 83）和 Android 16（WebView 133）的实际 APK 验收均通过，详情见 [验证记录](verification-android-flowers.md)。

```sh
pnpm test --maxWorkers=2
pnpm exec playwright test --config playwright.offline.config.ts --workers=1
pnpm android:debug
# 启动一个可清空的模拟器后运行；不要指定个人设备。
ANDROID_SERIAL=emulator-5554 node scripts/android-smoke.mjs
```

Windows 在上一行命令前用 `$env:ANDROID_SERIAL='emulator-5554'` 设置变量。脚本会重装并清空调试应用、断开模拟器 Wi-Fi/移动数据、验证横屏大厅、山东麻将开局、触屏出牌、花牌查看和返回键、后台恢复，并恢复网络设置。截图和 JSON 报告保存在被忽略的 `tmp/android-smoke`。

[Android APK workflow](../.github/workflows/android.yml) 在 API 30 / 35 模拟器上执行同一流程，上传安装包与取证文件，可从 GitHub Actions 的 Artifacts 下载。CI 的结果以实际运行状态为准。

API 30 模拟器需要启用 ES 3：确认 `adb shell getprop ro.opengles.version` 至少为 `196608`。部分旧镜像即使 GPU 支持 ES 3 仍默认报告 ES 2，可用 `-feature GLESDynamicVersion -prop qemu.opengles.version=196608` 启动；Windows Intel GPU 可使用 `-gpu angle_indirect`。测试截图从原生屏幕获取，因为旧 WebView 的 CDP 截图会遗漏 WebGL 图层。

## 素材和许可

“开源许可”入口可在应用离线查看项目 MIT 许可与八花 CC BY-SA 4.0 许可。素材来源与重建方式见 [花牌素材说明](../assets-src/flowers/README.md)。应用图标为新绘制的红中麻将牌，不使用从项目名称推导的花卉标志。
