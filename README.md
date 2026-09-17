# NavBook

跑在 Cloudflare Workers 上的书签导航站 + AI 管理助手。单用户自部署:一个 D1 数据库、一个 Worker、一个 Durable Object,免费额度内即可运行。数据兼容 OneNav(PHP 版)——导入导出互通、浏览器插件直接可用。

![首页](docs/screenshots/home.png)

## 本应用特色

与通用导航站/书签服务相比,NavBook 的差异点:

1. **AI 助手直接操作站内数据,而非只会聊天**——13 个内置工具直连业务层(搜索/分类/链接增删改/点击统计/网页抓取),你说"帮我把 GitHub 改成私密,再抓一下它首页简介补到描述里",它查、改、抓、填一气呵成;所有写操作出人工确认卡,后端生成操作摘要,点确认才执行
2. **统一的批量工具协议**——`batch_read`(≤10 项并发)/`batch_write`(≤20 项共享一张确认卡),action 枚举按当前工具集动态生成,以后加任何工具零代码自动可嵌;每个工具的"直接执行/需确认"行为可在配置页单独覆盖
3. **后台回合不断线**——聊天回合跑在会话专属 Durable Object 里:关闭页面继续生成,重开自动重挂续流(事件流重放,无轮询),渐进落库 + alarm 崩溃自愈,多会话物理隔离;空闲零计费
4. **外部能力即插即用**——远程 MCP(Streamable HTTP)后台可配,工具自动发现并入 agent,联网搜索/读网页配个 URL 就有
5. **长期记忆**——单文档(≤4000 字符)每轮注入,模型自己增删改压缩;跨会话记得你的偏好
6. **主题即插件**——主题是独立 SPA,复制目录改改就是新主题,后台一键切换;聊天核心(状态机/SSE 协议)在 shared 包,管理端与主题气泡共用一份逻辑
7. **单用户自部署,成本为零**——无注册体系、无多租户复杂度;Cloudflare 免费额度(D1/Workers/DO)覆盖个人用量绰绰有余,数据主权完全在自己手里

![AI 助手](docs/screenshots/assistant.png)

## 为什么部署在 Cloudflare

- **零运维**:不用买服务器、不用装数据库、不用管 TLS 续期和进程守护。`pnpm deploy` 一条命令,应用、静态资源、数据库、后台任务全部上线;更新 = 再跑一次 deploy
- **免费额度真实够用**:Workers 10 万请求/天、D1 5GB 存储、Durable Objects 13,000 GB-s/天(本项目用量约为额度的 1%,实测)——个人导航站 + 日常 AI 对话基本 $0
- **全栈一体**:D1(SQLite,单库即真相源)+ Durable Object(后台回合的物理载体)+ Workers(边缘 API/静态伺服)在一个平台闭环,不需要额外拼 Redis/队列/向量库
- **全球边缘网络**:自定义域名走 Cloudflare 节点,国内外访问延迟都可接受(workers.dev 域名在国内不可达,所以要用自定义域名,见部署第 4 步)
- **架构上限高**:SSE 流式、Durable Object 单写者、cron/queue 生态——本项目"断连续跑 + 重挂"的架构只有 DO 这类原语能干净地做出来,而它就在免费额度里

## 部署到 Cloudflare(完整步骤)

前提:一个 Cloudflare 账号(免费即可);本机装有 Node 20+ 与 pnpm;域名一个(可选但推荐,见第 4 步)。

### 1. 登录 wrangler

```bash
pnpm install
npx wrangler login      # 浏览器跳转授权
```

### 2. 建数据库并应用迁移

```bash
npx wrangler d1 create navbook
# 输出的 database_id 填到下一步 wrangler.toml

pnpm -C workers db:migrate:remote     # 应用全部迁移(表结构 + DO 所需列)
```

### 3. 配置 wrangler.toml

把 `database_id` 换成第 2 步输出的值。若暂不用自定义域名,先注释掉 `routes` 段(用 workers.dev 域名,国内不可达,仅测试用)。

### 4. 绑定自定义域名(推荐)

在你的域名 DNS( ideally 托管在 Cloudflare)加一条指向站点的记录,然后配置 routes:

```toml
routes = [
  { pattern = "nav.example.com", custom_domain = true }
]
```

deploy 时 Cloudflare 会自动为该域名签发证书。

### 5. 构建并部署

```bash
pnpm deploy     # 构建三端(compass/minima/web)→ 聚合 → wrangler deploy
```

首次部署会自动创建 Durable Object(SQLite-backed,免费计划支持,无需手动操作)。

### 6. 初始化

浏览器打开 `https://你的域名/admin`,按引导设置管理员密码,即进入后台。然后:

- **模型配置**(AI 助手用):选预设厂商(DeepSeek/通义/Kimi/智谱/OpenAI/Claude/Gemini…)填 API Key,设为当前;可选配 MCP 服务器(如 Tavily,Key 拼进 URL)、调整工具确认策略
- **导入旧数据**:从 OneNav(PHP)导出的 JSON 在「导入导出」页直接导入(格式 `onenav.bookmarks`,同名分类合并、重复 URL 跳过)

### 7. 日常更新

```bash
git pull && pnpm install && pnpm deploy
pnpm -C workers db:migrate:remote    # 有新迁移时执行(deploy 日志会提示)
```

> **计划建议**:免费计划即可跑通全部功能;AI 长对话回合在 Workers 免费版 10ms CPU 上限下偶尔紧张,**重度使用 AI 助手建议 Workers Paid($5/月)**,DO 用量折算约 $0.06/月,可忽略。

![主题页气泡](docs/screenshots/bubble.png)

## 浏览器插件

**本项目当前没有自带浏览器插件**,但**完全兼容 OneNav 的浏览器插件**(Chrome/Edge 商店搜索 OneNav 安装)。用法:

1. 后台「Token 管理」页生成 SecretKey,页面上会给出可直接复制的 **X-Token**(`md5(用户名 + SecretKey)`)
2. 插件设置里填站点地址(如 `https://nav.example.com`)和该 Token
3. 即可在浏览器里一键收藏网页到本站(走 `/index.php?c=api&method=...` 兼容入口与 X-Token 鉴权)

## 结构

```
workers/  API + DO(Hono + D1/Drizzle + AgentTurnDO),并把首页路由到当前主题
          └ src/ai/:agent(编排)/provider(厂商流式)/tools(注册表)/batch(批量+策略)
             /context(上下文组装)/mcp/conversations/memory/fetcher
web/      管理后台 SPA(/admin):分类/链接/导入导出/Token/主题/站点设置/模型配置/AI 助手
themes/   独立主题项目(compass/gazette),产物即分发单元;AI 气泡为统一组件(@navbook/shared/assistant,主题化注入)
shared/   契约包(@navbook/shared):API client + SSE 解析 + 聊天状态机(两端共用)
```

设计文档与实施计划在 `docs/superpowers/`(spec/plan 成对,含全部架构决策记录)。

## 开发

```bash
pnpm install
pnpm -C workers db:migrate:local    # 首次:建本地 D1
pnpm dev                            # workers(8787)+ web(5173)
pnpm --filter @navbook/theme-compass dev   # 单主题热更
pnpm test                           # workers 265 测试(真实 D1 + 真实 DO)
pnpm --filter @navbook/shared test  # 状态机/协议测试
```

本地首次访问 `http://localhost:8787/admin` 走初始化流程设置管理员密码。

## 兼容契约(勿动)

- 导入导出格式 `onenav.bookmarks`(PHP/ZMark 互通)
- 浏览器插件:`X-Token = md5(用户名 + SecretKey)`、`app_info` 的 `onenav_version`(插件判版本区间)
- 兼容错误文案与 `/index.php?c=api&method=` 转发
