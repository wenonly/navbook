# 后台管理迁移 shadcn/ui 设计

日期：2026-09-14
状态：已确认（用户批准）

## 背景与目标

后台管理 SPA（`web/` 包）目前没有组件库，`web/src/components/ui/` 下 8 个手写组件（Button/Input/Table/Badge/Pagination/Card/Feedback/PageHeader，共约 250 行）支撑全部页面。目标：迁移到 **shadcn/ui**，用现成组件替换全部手写组件，样式通过 token 映射保持现有视觉；同时补齐交互能力（Dialog 表单、确认对话框、Toast）。

## 已确认的决策

| 决策点 | 结论 | 备选（未采纳） |
|---|---|---|
| 组件库 | shadcn/ui | Ant Design（定制成本高、体积大）；daisyUI（无交互逻辑，半现成） |
| 范围 | 全后台 9 个页面 + Layout | 仅分类/链接两页（两套组件并存留债） |
| 功能深度 | 补齐交互：Dialog 表单/AlertDialog/Toast | 1:1 平移（链接无编辑的问题会保留） |
| 视觉 | 保持现有视觉，shadcn 语义变量别名映射到现有 `--color-*` | shadcn 默认观感（外观变化大） |
| 表格 | shadcn table 原语 + 单表 sticky 表头，**丢弃双 table + colgroup 方案** | TanStack Table（YAGNI，211 条数据无排序/筛选需求）；保留 TableCard 双表布局 |
| 表单 | Dialog 内受控表单 + 手动校验 | react-hook-form + zod（字段少，YAGNI；后端 zod 已兜底） |

## 1. 基础设施（shadcn init）

- `shadcn` CLI 初始化：项目为 Tailwind v3（存在 `tailwind.config.js`，CLI 检测走 v3 路径），React 19 / Vite 8 兼容
- 生成 `components.json`、`web/src/lib/utils.ts`（`cn()`），补 `tailwindcss-animate` 插件
- 添加组件：`button input select badge card table pagination dialog alert-dialog sonner skeleton label switch`
- 依赖新增：`class-variance-authority` `clsx` `tailwind-merge` `tailwindcss-animate` + 各 Radix 原语包（按 CLI 输出）
- lucide-react 已有（shadcn 默认图标库），不动

## 2. 视觉保持：token 映射

- 现有 `--color-*` CSS 变量（`index.css` `:root`，与 design.pen 同源）**不动**
- `index.css` 新增 shadcn 语义变量层做别名映射：
  `--background: var(--color-page)`、`--foreground: var(--color-ink)`、`--card: var(--color-surface)`、`--primary: var(--color-primary)`、`--primary-foreground: #fff`、`--border: var(--color-line)`、`--muted/--muted-foreground` 对应 ink-secondary/faint、`--destructive: var(--color-danger)`、`--ring: var(--color-primary)` 等（HSL 通道按 shadcn v3 模板要求提供）
- `tailwind.config.js` 按 shadcn v3 模板接入语义色（border/input/ring/accent 等），但**不套模板的 `hsl(var(--x))` 包装**（源变量是 hex 别名），直接 `var(--x)` 引用
- 改主题仍然只动 `--color-*` 一处

## 3. 组件映射（旧 8 个全部删除）

| 旧手写 | 新 | 备注 |
|---|---|---|
| Button | shadcn button | variant：default/outline/ghost/destructive；`size="sm"` 对应现 ghost 小按钮 |
| Input / Select | shadcn input / select | Select 换 Radix（样式统一、键盘可用），分类选择处 options → SelectItem |
| Table/Th/Td/TableCard | shadcn table 原语 + 新 `DataTableCard` | 见 §4 |
| Badge | shadcn badge | 私有/公开 → destructive/secondary |
| Pagination | shadcn pagination | 保留「第 x/y 页 · 共 n 条」文案 |
| Card | shadcn card | |
| ErrorNote / LoadingOverlay | sonner toast / skeleton | Feedback.tsx 删除 |
| confirm() | shadcn alert-dialog | 删除分类/链接均走确认框 |
| PageHeader | 保留 | 纯排版无交互，只微调内部 class |

## 4. 表格：单表 + sticky 表头

- shadcn `Table` 原语组成单张表格，`TableHead` 加 `sticky top-0 z-10`（背景色遮住滚动穿透）
- 外层 Card：工具栏（不动）→ `overflow-y-auto` 滚动区（内含 sticky 表头表格）→ footer（Pagination，滚动区外）
- 双 table + colgroup 对齐（为「滚动条只出现在内容区」定制）删除：sticky 方案下表头不随滚、无列错位，旧问题不存在
- `table-fixed` + 百分比/固定列宽按各页现有 cols 比例换算

## 5. 页面改造（9 页 + Layout）

**分类管理 / 链接管理**（重点，结构改为：工具栏 + 表格）：
- 顶部内联表单 → 工具栏：「新增」按钮打开 Dialog 表单
- Dialog 字段（分类）：名称*、描述、私有（Switch）、权重、图标（font_icon）、父分类（fid，默认 0）
- Dialog 字段（链接）：分类*（Select）、标题*、URL*、备用 URL、描述、图标、权重、私有（Switch）
- 行操作「编辑」打开同一 Dialog 回填整行（分类编辑必须携带整行数据，只传 name 会把 property 重置导致私有分类泄露——现有代码注释已记录此坑，迁移不得丢失该行为）
- **链接编辑为新增能力**：`useEditLink` hook 已存在未使用，Dialog 提交区分新增/编辑
- 删除走 AlertDialog；末页删除回退逻辑（`page > pageCount` 时 setPage）保留
- `useAllCategories` 供分类 Select 与链接表单共用

**其余页面**（设置/令牌/导入导出/主题/登录/初始化/布局）：控件 1:1 换 shadcn，交互与信息架构不变；Login/Init 的错误提示改 toast；Settings 保存成功提示改 toast

**数据流不动**：`api/client.ts`、`api/hooks.ts`、后端 API 零改动

## 6. 错误处理

- 所有 mutation 失败：内联 ErrorNote → `toast.error(msg)`（unwrap 抛的 Error.message）
- 成功操作：轻量 `toast.success`（新增/更新/删除/导入/保存主题等）
- Toaster 挂在 App 根（sonner，`richColors` 视觉对齐现有配色）

## 7. 验证

- `pnpm -F web build`（tsc + vite）与 `pnpm -F web lint`（oxlint）通过
- 浏览器逐页走查：登录 → 分类/链接 CRUD（Dialog 开关、回填、校验、删除确认）→ 分页/末页回退 → 设置/令牌/导入导出/主题切换
- 表格滚动：表头 sticky 不随滚、滚动条行为正常、列边界对齐
- 与迁移前截图对比，确认视觉无回退
