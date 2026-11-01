# Repeatable local comparison; historical baseline and raw results stay ignored.
param([string]$Baseline = '62a00d1')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$previousOutputEncoding = [Console]::OutputEncoding
Push-Location $root
try {
  # Windows PowerShell otherwise decodes Git's UTF-8 source as the local code page.
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  $baselineLines = git show ($Baseline + ':src/game/variants/shandong/shandongAi.ts')
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read baseline commit; fetch the repository history first.' }
  $source = $baselineLines -join "`n"
  $source = $source.Replace('../../core/', '../../src/game/core/').Replace('../../shared/', '../../src/game/shared/')
  $source = $source.Replace("'./shandong", "'../../src/game/variants/shandong/shandong")
  $output = Join-Path $root 'tmp/shandong-ai-bench'
  New-Item -ItemType Directory -Path $output -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $output 'baseline.ts'), $source, [Text.UTF8Encoding]::new($false))
  pnpm exec vitest run --dir tests/bench tests/bench/shandong-ai.bench.test.ts --reporter=verbose
  if ($LASTEXITCODE -ne 0) { throw 'Shandong AI benchmark failed' }
  Write-Host 'Raw results: tmp/shandong-ai-bench/report.json'
} finally { [Console]::OutputEncoding = $previousOutputEncoding; Pop-Location }
