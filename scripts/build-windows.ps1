param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('android', 'web')]
    [string]$Target,
    [switch]$DebugApk
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$repoRoot = Split-Path -Parent $PSScriptRoot

function Invoke-BuildCommand {
    param([string]$Command, [string[]]$CommandArgs)
    & $Command @CommandArgs
    if ($LASTEXITCODE -ne 0) { throw "$Command 执行失败，退出码：$LASTEXITCODE" }
}

function Get-JavaMajor {
    param([string]$JavaHome)
    if (!$JavaHome -or !(Test-Path -LiteralPath (Join-Path $JavaHome 'bin/javac.exe'))) { return 0 }
    $releaseFile = Join-Path $JavaHome 'release'
    if (!(Test-Path -LiteralPath $releaseFile)) { return 0 }
    $releaseText = Get-Content -LiteralPath $releaseFile -Raw
    if ($releaseText -match 'JAVA_VERSION="(\d+)') { return [int]$Matches[1] }
    return 0
}

Push-Location $repoRoot
try {
    if ($DebugApk -and $Target -ne 'android') { throw '-DebugApk 仅用于构建 App。' }
    if (!(Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw '未找到 Node.js，请先安装 Node.js 24 LTS。'
    }
    $nodeVersion = [version]((& node.exe --version).TrimStart('v'))
    if (!(($nodeVersion.Major -eq 20 -and $nodeVersion.Minor -ge 19) -or
          ($nodeVersion.Major -eq 22 -and $nodeVersion.Minor -ge 12) -or $nodeVersion.Major -gt 22)) {
        throw 'Node.js 版本过低，需要 ^20.19.0 或 >=22.12.0，推荐 Node.js 24 LTS。'
    }
    Write-Host "[环境] Node.js $nodeVersion"

    if ($Target -eq 'android') {
        # Prefer JDK 17. A stale system JAVA_HOME must not select Java 8.
        $javaCandidates = @($env:JAVA_HOME, (Join-Path $env:ProgramFiles 'Java/jdk-17'))
        foreach ($parent in @('Java', 'Eclipse Adoptium', 'Microsoft')) {
            $directory = Join-Path $env:ProgramFiles $parent
            if (Test-Path -LiteralPath $directory) {
                $javaCandidates += @(Get-ChildItem -LiteralPath $directory -Directory | Select-Object -ExpandProperty FullName)
            }
        }
        $javaHome = $javaCandidates | Where-Object { (Get-JavaMajor $_) -eq 17 } | Select-Object -First 1
        if (!$javaHome) { throw '未找到 JDK 17，请安装 JDK 17 并设置 JAVA_HOME。' }
        $env:JAVA_HOME = $javaHome
        $env:PATH = "$javaHome\bin;$env:PATH"

        $sdkHome = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android/Sdk')) |
            Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'platforms/android-35/android.jar')) -and (Test-Path -LiteralPath (Join-Path $_ 'build-tools/35.0.0/apksigner.bat')) } |
            Select-Object -First 1
        if (!$sdkHome) { throw '未找到 Android SDK Platform 35 / Build Tools 35.0.0，请安装后设置 ANDROID_HOME。' }
        $env:ANDROID_HOME = $sdkHome
        $env:ANDROID_SDK_ROOT = $sdkHome
        Write-Host "[环境] JDK 17：$javaHome"
        Write-Host "[环境] Android SDK：$sdkHome"
    }

    if (!(Test-Path -LiteralPath 'node_modules/vue-tsc/bin/vue-tsc.js') -or !(Test-Path -LiteralPath 'node_modules/vite/bin/vite.js')) {
        if (!(Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) {
            throw '缺少前端依赖，请先安装 pnpm（npm install -g pnpm@10.32.1），然后重新运行脚本。'
        }
        Write-Host '[依赖] 正在按 pnpm-lock.yaml 安装依赖……'
        Invoke-BuildCommand 'pnpm.cmd' @('install', '--frozen-lockfile')
    }

    if ($Target -eq 'web') {
        Write-Host '[构建] 正在生成前端静态文件……'
        Invoke-BuildCommand 'npm.cmd' @('run', 'build')
        if (!(Test-Path -LiteralPath 'dist/index.html')) { throw '构建未生成 dist/index.html。' }
        Write-Host "[完成] 前端目录：$repoRoot\dist"
        Write-Host '使用启动.bat进行本地开发；部署网页时将 dist 整个目录交给静态网站服务。'
    } else {
        if ($DebugApk) {
            Write-Host '[构建] 正在生成 Android 调试 APK……'
            Invoke-BuildCommand 'node.exe' @('scripts/build-android.mjs')
        } else {
            Write-Host '[构建] 正在生成 Android 正式签名 APK……'
            Write-Host '签名读取 android/signing.properties 或 ANDROID_* 签名环境变量。'
            Invoke-BuildCommand 'node.exe' @('scripts/build-android.mjs', '--release')
        }
        $variant = if ($DebugApk) { 'debug' } else { 'release' }
        Invoke-BuildCommand (Join-Path $sdkHome 'build-tools/35.0.0/apksigner.bat') @('verify', '--verbose', "android/app/build/outputs/apk/$variant/app-$variant.apk")
        Write-Host "[完成] 安装包目录：$repoRoot\artifacts\android"
        Write-Host '安装后普通 AI 对局可离线使用，无需后端和启动.bat。'
    }
} catch {
    Write-Host "[失败] $($_.Exception.Message)" -ForegroundColor Red
    Write-Host '环境和签名配置说明：docs/android.md'
    exit 1
} finally {
    Pop-Location
}
