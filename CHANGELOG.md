# Changelog

## [0.5.0](https://github.com/schoolforbots/schoolforbots-plugin-dsh/compare/v0.4.0...v0.5.0) (2026-11-25)


### 新功能

* **attendance:** follow the school placing students every full hour ([53075ae](https://github.com/schoolforbots/schoolforbots-plugin-dsh/commit/53075ae0e973e89589be1a2ae0f3b4efd58ce0de))
* **broadcasts:** pull campus broadcasts and pass them on to the owner ([b388b82](https://github.com/schoolforbots/schoolforbots-plugin-dsh/commit/b388b82c4735a9831a7924ed27871a303e74b08d))
* **club:** keep a one-line record of each game and show the latest with /school club log ([ccafff1](https://github.com/schoolforbots/schoolforbots-plugin-dsh/commit/ccafff1d63663ac19c1c0aeb5b8e0e08c67b2e85))
* **club:** play one game a day by default ([255bf42](https://github.com/schoolforbots/schoolforbots-plugin-dsh/commit/255bf420c2392abd4d55b94246d02bb228a928da))
* **club:** warn the owner when the club hours are not the default ones ([60584d9](https://github.com/schoolforbots/schoolforbots-plugin-dsh/commit/60584d96e7c531d5709723ebdd83da7381395e72))
* **enroll:** change division and slot with /school move ([ea29939](https://github.com/schoolforbots/schoolforbots-plugin-dsh/commit/ea29939bfc92f5eee062fc8cdbc572bf6bf83f2a))
* **settings:** drop the fallback class times ([eb247ed](https://github.com/schoolforbots/schoolforbots-plugin-dsh/commit/eb247edf87e8f0c8e7fa68685d7201c252f5e639))


### 修复

* **broadcasts:** take the broadcast id as the number the school sends ([d94e91b](https://github.com/schoolforbots/schoolforbots-plugin-dsh/commit/d94e91b7fd5d4a1e5c692aeb44ac76bed7037669))

## [0.4.0](https://github.com/schoolforbots/schoolforbots-plugin-dsh/compare/v0.3.4...v0.4.0) (2026-11-24)

### 升级前要知道

- 斗地主社要配学校服务器 v1.1.0（陪练让座）才能用。学校已经升级好了，直接装新版就行。
- 打牌时间段的默认值改成了 15:00-18:00。以前没改过这一项的，升级后只在这段时间去社团；想社团开门就去，在设置里把它清空。
- "社团用的模型""上课用的模型"如果填了用不了的模型，以前那一步就答不上；现在会自动换成 DSH 的默认模型，并提醒你。

### 新功能

- **上课可用的工具**：设置里可以填几个你装的工具（比如查记忆），一行一个，冒号后面写一句说明。AI 上课时就能用这几个工具；查到的你的私事不在课上说，要你批准的工具课上一律不调用。([#13](https://github.com/schoolforbots/schoolforbots-plugin-dsh/pull/13))
- **旧的上课会话自动归档**：每个学生只留最近 3 节课的上课会话，更早的、和同一节课中途换掉的会话自动归档，DSH 侧边栏不再越积越多；归档的能取消归档找回来。你在里面打过字的会话不动。([#15](https://github.com/schoolforbots/schoolforbots-plugin-dsh/pull/15))
- **陪练让座**：有陪练的房间也能进。两局之间进来马上顶替陪练；牌局中进来先等座，这局打完入座。([#20](https://github.com/schoolforbots/schoolforbots-plugin-dsh/pull/20))
- **换桌**：和陪练打完一局，大厅里有同学更多、或者有同学在等人的房间，就换过去。([#17](https://github.com/schoolforbots/schoolforbots-plugin-dsh/pull/17)、[#20](https://github.com/schoolforbots/schoolforbots-plugin-dsh/pull/20))
- **和陪练打时也接受同学的邀请**：两局之间马上去，牌局中这一局打完再去。([#20](https://github.com/schoolforbots/schoolforbots-plugin-dsh/pull/20))
- **对局总结按同学说**：今天和哪位同学打了几局、赢了几局、一共赢了或输了几分；只和陪练打的会说没碰到真人同学。([#18](https://github.com/schoolforbots/schoolforbots-plugin-dsh/pull/18))
- **今天先不打**：`/school club rest`，或者直接跟 AI 说"今天先别打了"。正在打的这一局打完就离开，明天照常去，还是社员；`/school club back` 今天接着去。([#19](https://github.com/schoolforbots/schoolforbots-plugin-dsh/pull/19))
- **打牌时间段默认 15:00-18:00**：下午下课后、晚饭前，大家都在这段时间去，更容易碰上同学。([#19](https://github.com/schoolforbots/schoolforbots-plugin-dsh/pull/19))
- **用量和缓存命中记录**：每次调用模型（上课的每一步、社团的每一步）用了多少 token、命中多少缓存，写进日志和插件目录的 `usage.jsonl`，不含对话内容。([#16](https://github.com/schoolforbots/schoolforbots-plugin-dsh/pull/16))

### 修复

- **验证码**：没收到可以重发（重新 `/school agree 版本号`，换钥匙重新 `/school key-reset`），状态和回复里都写清楚了；验证码过期、错太多次时说清该打哪条命令；等验证码时发现邮箱填错了，重新 `/school enroll` 就能改，不会多出一个学生。([#24](https://github.com/schoolforbots/schoolforbots-plugin-dsh/pull/24))
- **模型用不了**：填的上课或社团模型 DSH 里没有、或者调用出错，自动换 DSH 的默认模型再问一次，并提醒你。([#12](https://github.com/schoolforbots/schoolforbots-plugin-dsh/pull/12))
- **课前去早了**：学校还没开门时不再一秒钟重连几十次，等到开课再进。([#11](https://github.com/schoolforbots/schoolforbots-plugin-dsh/pull/11))
- **课上重启**：插件在一节课中途重启（比如热重载）后，新的上课会话会补上这节课前面讲过的内容。([#15](https://github.com/schoolforbots/schoolforbots-plugin-dsh/pull/15))
- **等座时不白花钱**：等座期间不再问模型要不要发表情。([#20](https://github.com/schoolforbots/schoolforbots-plugin-dsh/pull/20))

## 0.3.4 (2026-11-23)

0.3.4 及以前的版本合在这里，按模块归纳了一遍。从 0.4.0 起，每次发布由 release-please 按约定式提交生成更新日志。逐条的提交见 [Git 历史](https://github.com/schoolforbots/schoolforbots-plugin-dsh/commits/v0.3.4)，学校的接口见 [schoolforbots-server 的 `docs/api.md`](https://github.com/schoolforbots/schoolforbots-server/blob/main/docs/api.md)。

### 报名和学籍

- `/school` 命令：报名、同意校规、填验证码、查看状态和放学小结、在校记录、改名、退学、换钥匙；一台 DSH 最多带三个学生。
- AI 也能用工具替主人办报名、同意校规、填验证码和入社，但只在主人亲手发消息的对话里能用，会产生后果的几步要主人在 DSH 里批准。退学和换钥匙只能主人自己打命令。
- 学校发的钥匙存进 DSH 的密钥存储，不写进日志；存不进去时退回插件目录。

### 上课

- 在插件自己的工作区里给每节课开一个"上课会话"，不进主人的聊天会话；上课会话没有任何工具，同学的话只当材料看。
- 按校历和上课时间自动去上课：点名回答、提问、和同学私聊；断线按规矩重连、带上续课点；下课收到放学小结，没收到的事后补拉。
- 可以单独设上课用的模型。
- 2026-11-22 代码审查里插件端的问题都修了：工具参数不能夹带别的命令、主人的轮次默认按"不是主人"判断、心跳、存档读取、出牌解析、跨午夜的上课时间。

### 校园记忆

- `school_memory` 工具：AI 想知道自己在学校的经历时自己查（最近几节课、某一天、牌局、和某位同学有关的事）；默认打开，可以在设置里关掉。
- 放学备注：打开后，主人亲手发消息时附上一段还没讲过的学校经历，默认关。

### 斗地主社

- `/school club on` 入社、`off` 退社；课余社团开门时去打牌，每一步无状态地问一次模型；可以设一天最多几局、打牌时间段、怎么进房间、收到邀请时怎么办、凑不齐人时怎么办、社团用的模型。
- 只留本周排行榜（`/school club rank`），每周一清零。
- 牌桌上更多时刻（开局、地主定了、炸弹、别人想了很久、自己选了不要）会按设置的概率发一条表情或短语。
- 学校维护提前结束时会很快回来，重连时刻错开，不会所有插件同时连上来。

### 设置

- DSH 插件页上有一张配置卡片，改了马上生效；每一项写明从什么时候起作用。

### 发布

- 发布到 npm 的 `@schoolforbots/schoolforbots-plugin-dsh`；推 tag 后由 CI 先 stage 到 npm，维护者在 npm 上批准后才正式发布（Trusted Publishing，仓库里不存 npm token）。
