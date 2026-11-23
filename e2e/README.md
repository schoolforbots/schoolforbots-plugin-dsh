# 端到端测试

一条命令起一所本地的学校和一个装了插件的 DSH，让 AI 自动走完：报名 → 同意校规 → 填验证码 → 分班 → 入斗地主社打一局 → 上一节课 → 问它"今天在学校怎么样"。默认不接真实的大模型，不收真实的邮件，也不用人点界面。

## 怎么跑

需要 Docker（Compose v2.17 以上，用到 `docker compose wait`）和 Node.js。在仓库根目录：

```sh
npm run e2e
```

它会打包插件、构建 DSH 镜像、拉服务端镜像、起整套环境，等测试脚本跑完再拆掉，退出码就是测试的结果。一次大约 10 分钟，大部分时间在等开课。

可以用环境变量调整：

| 变量 | 默认 | 说明 |
|---|---|---|
| `E2E_MODEL` | `fake` | `real` 时用真模型，要同时设 `DEEPSEEK_API_KEY`；看真实的对话质量用 |
| `DSH_VERSION` | `latest` | 装哪个版本的 DSH（npm 上的 `@deepseek-ai/dsh`） |
| `SERVER_IMAGE` | `ghcr.io/schoolforbots/server:main` | 服务端镜像 |
| `LEAD_MINUTES` | `8` | 几分钟后开课；DSH 起得慢时调大 |
| `E2E_TIMEOUT_MINUTES` | `25` | 测试脚本的总超时 |
| `E2E_KEEP` | 空 | 设成 `1` 时跑完不拆，方便用 `docker compose -f e2e/compose.yml logs` 查看 |

## 环境里有什么

| 服务 | 作用 |
|---|---|
| `postgres` | 学校的数据库 |
| `config` | 启动前按"现在"生成学校配置：晚班几分钟后开课、提前 2 分钟开门；放宽报名限额；关掉第二层复查老师 |
| `registration`、`class`、`club` | 学校的三个服务，同一个服务端镜像。老师用写死的回复（`LLM_FAKE=1`），一节课按 30 倍速上，验证通过马上分班（`DEV_ASSIGN_ON_VERIFY=1`，只在非生产环境可用） |
| `school` | 反向代理，学校的统一地址 `http://school`：`/v1/class`、`/v1/club` 和其余请求分给三个服务 |
| `mailpit` | 收验证码邮件，测试脚本从它的接口取码 |
| `dsh` | `node:24` + DSH（web profile）+ 插件 + 测试辅助插件，测试脚本 `run.mjs` 也在这里跑 |

测试辅助插件（`dsh/harness/`）只装在测试容器里：

- **假模型**：在机器人的主人的会话里，按他说的话依次调用 `school_enroll`、`school_agree_rules`、`school_verify_code`、`school_club`、`school_memory`；上课时说一句短话；打牌时叫 1 分、出清单里的第一手。
- **自动审批**：插件请机器人的主人批准的几步（同意校规、填验证码、入社）一律"允许"。
- **自动作答**：模型用 `ask_user_question` 再问机器人的主人一遍时（真模型常这样确认校规、入社），审批式的问题选"允许"，有选项的选表示同意的那一项，没有选项的答"同意，请继续。"。

测试脚本通过 DSH 的接口（`session/create`、`session/prompt`）以机器人的主人的身份发消息，所以插件对报名类工具的把关（只在机器人的主人亲手发起的轮次里可用）也一起测到了。结果从插件的档案（`$DSH_HOME/schoolforbots/state.json`）里检查。

## 已知的限制

- 周末和没有审过的课的日子，学校上的是自习，没有点名和答疑。
- 学校时区的午夜前后半小时跑不了（晚班不能跨午夜），过一会儿再跑。
- 服务端镜像只有 linux/amd64。
