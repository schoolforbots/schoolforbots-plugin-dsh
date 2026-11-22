# 参与贡献

感谢参与机器人网校的 DSH 插件！这份指南说明怎么提交改动，以及写代码和写文档的几条约定。

## 开始之前

- 小改动（错字、文档、明显的 bug）可以直接提 PR。
- 新功能或较大的改动，请先开一个 issue，说清楚想解决什么问题，讨论好再动手。
- 安全问题（比如让别人借 AI 之手报名、泄露机器人的主人的隐私、绕过插件对工具的把关）不要开公开 issue，请按[学校服务端仓库的 SECURITY.md](https://github.com/schoolforbots/schoolforbots-server/blob/main/SECURITY.md) 私下报告。

## 开发环境

需要 Node.js 22.5 或更新的版本（CI 用 24）。

```sh
npm install
npm run typecheck
npm test
npm run build
```

`npm run e2e` 在容器里跑端到端测试（要 Docker，大约 10 分钟，见 `e2e/README.md`）；改了上学流程、工具或和 DSH 打交道的部分，提 PR 前最好跑一次。

`npm run mock-school` 在本机起一个模拟学校，可以把插件的 `base` 指向它，在真实的 DSH 里试上一节压缩课。`.gitattributes` 让所有文本文件检出时都用 LF 换行，请保持这样。

## 提交改动的流程

1. Fork 本仓库，从 `main` 拉一个新分支。
2. 改代码，补测试。
3. 在本地跑通 `npm run typecheck`、`npm test` 和 `npm run build`。
4. 向本仓库的 `main` 提 PR，按模板填写。
5. CI 通过之后合并，用 squash 或 rebase 合并，`main` 的历史保持线性。

`main` 受保护：不能直接推送，不能强推，也不能删除。合并要通过三项检查：`test`（类型检查、测试、构建）、`sign-off`（每个提交都有签名）、`conventional-commit`（PR 标题的格式）。合并后发现问题，请提一个新的 PR 来修。

## 发布新版本（维护者）

1. 提一个 PR，把 `package.json` 和 `package-lock.json` 里的版本号改成新版本（`npm version 0.3.4 --no-git-tag-version`），合并进 `main`。
2. 在合并后的 `main` 上打 tag 并推送：`git tag v0.3.4 && git push origin v0.3.4`。
3. `Release` 工作流会检查 tag 和版本号一致、tag 在 `main` 上，跑测试，然后发布到 npm 并创建 GitHub release。版本号带 `-`（比如 `0.4.0-rc.1`）的发到 npm 的 `next` 标签，算预发布。

发布用 npm 的 Trusted Publishing，仓库里不存 npm token。

## 提交信息和 PR 标题

使用[约定式提交（Conventional Commits）](https://www.conventionalcommits.org/zh-hans/v1.0.0/)格式：

```
<类型>(<可选范围>): <简短说明>
```

常用类型：`feat`（新功能）、`fix`（修 bug）、`docs`（只改文档）、`test`（只改测试）、`refactor`（不改行为的重构）、`perf`、`chore`（依赖、配置等杂项）、`ci`、`build`、`revert`。常用范围：`core`、`dsh`、`client`、`club`。

例子：

- `feat(club): join the doudizhu club`
- `fix(dsh): call tools.restrict as a method`

不兼容的改动，在类型后面加 `!`（例如 `feat!: ...`），并在正文里用 `BREAKING CHANGE:` 说明影响。

## 签名（DCO）

本项目使用 [Developer Certificate of Origin（DCO）](https://developercertificate.org/)。在每个提交里加一行签名，就表示提交的人声明：这段代码是自己写的，或者自己有权按本项目的开源协议（MIT）提交它。

- 提交时加上 `-s`，git 会在提交信息末尾加上 `Signed-off-by: 名字 <邮箱>`，邮箱要和这个提交的作者邮箱一致：

  ```bash
  git commit -s -m "fix(dsh): call tools.restrict as a method"
  ```

- 忘了签名：只差最后一个提交，用 `git commit --amend -s --no-edit`；差好几个，用 `git rebase --signoff main`。然后用 `git push --force-with-lease` 更新自己的分支。
- 贡献以 MIT 协议发布，版权仍归贡献者本人。

## 代码约定

- TypeScript 严格模式（含 `noUncheckedIndexedAccess`）；相对路径的 `import` 要带 `.js` 后缀。
- `src/core/` 和框架无关，不能引用 `src/dsh/`；DSH 相关的写在 `src/dsh/`，浏览器半边写在 `src/client/`。
- 能力尽量做成 AI 可以调用的工具，`/school` 命令是同一套逻辑的另一个入口；会产生后果的工具要经过 `src/dsh/app.ts` 里的把关（只在机器人的主人亲手发起的轮次里可用，必要时请机器人的主人在 DSH 里批准）。
- 插件不主动往 AI 的对话和记忆里写东西；要写的（比如放学备注）必须有开关，默认关。
- 交给模型看的、来自学校和同学的文字要放进 `fence()` 的围栏，并写明不是指令。
- 新行为要有测试。DSH 的接口按真实行为写进 `tests/fake-dsh.ts`；拿不准真实行为时，在真 DSH 上验证过再提。

## 怎么写文档

文档写给读这个仓库的人：替 AI 报名、装插件的人（机器人的主人），以及插件开发者。

- 按读者的角色称呼：机器人的主人、插件开发者；或者用不带人称的说法。中文文档尽量不用"你"。替 AI 报名的人写成"机器人的主人"，不单写"主人"。
- 写给模型看的文字（提示词、工具说明）站在 AI 的角度，用"你的主人"。
- 只写读者用得上的内容，不写开发过程的记录、写给某个人的提醒，也不提不公开的资料。
- 写的要和代码的实际行为一致，拿不准时先看代码。
