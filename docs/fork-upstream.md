# 向原项目贡献与同步更新

本 fork：`253506088/lianhuaguangdongmahjong`，默认分支 `master`。原项目：`BestGuo2020/lianhuaguangdongmahjong`，默认分支也是 `master`。`origin` 继续指向自己的 fork；不要改成原项目。

## 向原项目贡献

建议按功能拆 PR：山东麻将规则、花牌展示、Android 打包分别说明。先确认原项目接受新玩法和移动端范围；花牌 UI 使用的 `FlowerTile` / 山东麻将类型来自先前修改，单独移植花牌提交时需要带上依赖。

```sh
# 只做一次；如果 upstream 已存在，先 git remote -v 确认地址。
git remote add upstream https://github.com/BestGuo2020/lianhuaguangdongmahjong.git
git fetch upstream
git switch -c contribute/flower-tiles upstream/master
# 从自己的分支挑选与此 PR 有关的提交；有依赖的提交按先后顺序一起选。
git cherry-pick <commit-1> <commit-2>
pnpm install --frozen-lockfile
pnpm test --maxWorkers=2
pnpm build
git push -u origin contribute/flower-tiles
```

然后在 GitHub 点击 Compare & pull request：base 仓库选原项目，base 分支选 `master`，head 选自己 fork 的贡献分支。提交说明写清问题、效果、验证和素材许可证；是否合并由原作者决定。不要把自己的 P2P 分支整条合进原项目的 WebSocket `master`。

## 原项目更新后，保留自己的改动

先提交当前修改，确保 `git status` 干净，再在整合分支演练：

```sh
git fetch origin
git fetch upstream
git switch master
git pull --ff-only origin master
git switch -c integrate/upstream-2026-10
git merge upstream/master
# 如果有冲突，逐文件保留适用的双方逻辑，移除冲突标记，git add 后 git commit。
pnpm install --frozen-lockfile
pnpm test --maxWorkers=2
pnpm build
pnpm android:debug
# 验证通过后把整合结果快进回 master。
git switch master
git merge --ff-only integrate/upstream-2026-10
pnpm sync:vibehub
git push origin master vibehub
```

分支名里的日期只是示例，下一次用实际日期。长期已推送分支建议 `merge`，保留双方历史；个人短期贡献分支可以 `rebase upstream/master`。已共享分支不要随意 rebase 或 force push，避免让其他人历史失配。GitHub “Sync fork” 可以处理无冲突的更新，但不能替代本地的规则、界面和 Android 验证。

## 本仓库的两条长期分支

`master` 是共享 UI / 规则的提交源，`vibehub` 保留 P2P 装配。这次将先前只在 vibehub 上的山东麻将代码移植回 master，并保留未提交的可吃牌开关和报听限制，防止下一次同步把功能覆盖。

`pnpm sync:vibehub` 会保留 `App.vue`、部分大厅组件和 `package.json` 等分支专用文件。新增共享入口或依赖后，还需把相应接线同步到这些 keep 文件；不要把 WebSocket 文件覆盖到 P2P 分支。完整归属见 [双分支工作流](branch-sync-workflow.md)。

原项目是 MIT 许可：发布自己的修改时保留原版权和许可证。这次导入的花牌图案另用 CC BY-SA 4.0，需保留署名与相同素材许可；项目代码仍按 MIT 提供。
