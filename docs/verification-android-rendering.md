# Android 旧 WebView 提示与动作字修复（2026-11-01）

## 原因与处理

- Android 11 / WebView 83 不支持 `color-mix()`。手牌剩余张数的背景、边框、阴影与箭头颜色失效，导致文字直接落在桌布上、箭头变成色块。基础样式改用主题实色，现代浏览器在 `@supports` 内保留原混色效果；耗尽时仍显示红色气泡。
- 该 WebView 的 `CSS.supports('paint-order', 'stroke fill')` 返回 true，但只对 SVG 生效，HTML 动作字仍被粗描边覆盖。二次元动作字增加独立的无描边字面层，保留内外双描边；伪元素与光效使用明确的四边定位，避免依赖旧内核不支持的 `inset`。
- 动作光效同样提供无需混色函数的基础背景。牌数逻辑、动作触发时机和角色素材不变。

## 验证

- 全量 Vitest：2317 通过、2 个已有跳过项。
- 离线 Playwright：21 通过；动作与立绘预加载回归：11 通过。
- Web 构建、Android 网页资源与 debug APK 构建通过。
- Android 11 / API 30，实际 WebView 83.0.4103.120：断网开局、触屏出牌、后台恢复通过，无 JS 异常。
- 在 APK 内实际点选手牌，确认剩余张数气泡有不透明底色、主题边框和三边透明的三角箭头。
- 将真实 Vue 动作组件的 DOM 重放到 APK 的已编译样式中，固定展示吃、碰、杠、自摸、抢杠胡，逐项检查原生截图。关闭新字面层可复现原有黑块，恢复后字面清晰。测试 DOM 只在调试会话中注入，不打入安装包。

本地取证：`tmp/app-render-android11/`（原生截图、`report.json` 与 `render-report.json`）；H5 对照：`tmp/app-render-review/`。完整回归日志为 `tmp/app-render-*.log`。这些生成文件不提交 Git。
