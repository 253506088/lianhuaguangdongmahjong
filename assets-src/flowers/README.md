# 八花牌面

采用 Cangjie6 发布在 Wikimedia Commons 的传统八花 SVG，授权为 **CC BY-SA 4.0**。每张原图 URL、作者、SHA-256 与修改说明见 [sources.json](sources.json)。完整许可证随网页和 APK 一起打包到 [public/licenses](../../public/licenses/index.html)。

`public/tiles/f1.svg` 至 `f8.svg` 和 `public/themes/llm-anime/v1/tiles/f1.svg` 至 `f8.svg` 是修改后的牌面，继续按 CC BY-SA 4.0 提供。修改：移除斜视牌体与编辑器数据，保留花卉、汉字和序号的矢量路径，统一裁切为 3:4。牌体使用项目原有 Three.js 圆角模型和主题材质，未复制其他游戏截图。

编号按游戏既有模型：春、夏、秋、冬、梅、兰、竹、菊。原图植物顺序为梅兰菊竹，因此 f7 来自 MJh8，f8 来自 MJh7，不能直接按数字拷贝。

重新导入（需要网络和 Playwright Chromium，通常无需运行）：

```sh
pnpm exec playwright install chromium
pnpm assets:flowers
```

可用 `E2E_CHANNEL=chrome` 选择已安装的 Chrome。临时下载缓存位于被忽略的 `tmp/flowers`；遇到 Wikimedia 限流可稍后重试，已有原图不会重复下载。日常构建直接使用已提交的 SVG，不访问 Wikimedia。
