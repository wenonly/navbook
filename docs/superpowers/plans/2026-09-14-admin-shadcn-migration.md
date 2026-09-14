# 后台管理 shadcn/ui 迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 shadcn/ui（CLI 2.10.0，Tailwind v3 路径）替换后台 SPA 全部 8 个手写 UI 组件，补齐 Dialog 表单/确认框/Toast 交互，视觉经 token 映射保持不变。

**Architecture:** shadcn 组件源码拷入 `web/src/components/ui/`（小写文件名，与旧手写组件并存过渡）；`index.css` 增加 shadcn 语义变量层别名映射到现有 `--color-*`；页面按依赖序逐个迁移，最后删除旧组件。表格改单表 + sticky 表头。数据层（api/client、api/hooks、workers）零改动。

**Tech Stack:** React 19 + Vite 8 + Tailwind v3 + shadcn@2.10.0（最后的 v3 兼容 CLI，4.x 已要求 Tailwind v4）+ Radix UI + sonner

**Spec:** `docs/superpowers/specs/2026-09-14-admin-shadcn-migration-design.md`

**测试策略说明:** `web/` 包无测试框架（无 vitest 配置，现有代码零测试），为纯 UI 迁移引入测试框架超出 spec 范围。每个 task 以 `pnpm -F web build`（含 tsc 类型检查）+ `pnpm -F web lint`（oxlint）作为门禁，Task 10 做浏览器端到端走查。

**关键契约（执行者必读）:**

- 分类提交字段：`{id?, name, property, weight, description, font_icon, fid}`；`category_list` 返回行 `{id, name, property, weight, description, fontIcon, fid}`（camelCase）
- 链接提交字段：`{id?, fid, title, url, description, weight, property, url_standby, font_icon}`；`link_list` 返回行 `{id, fid, title, url, description, addTime, upTime, weight, property, click, topping, urlStandby, fontIcon, categoryName}`（见 `workers/src/handlers/link.ts:19`）
- **分类编辑必须携带整行数据**（只传 name 会把 property 等硬编码重置，导致私有分类对游客泄露——现有代码注释记录过此坑）
- 后端业务错误统一 `{code:!=0, msg}`，client 层 `unwrap` 已抛 `Error(msg)`；mutation 捕获后 `toast.error(e.message)`
- monorepo：shadcn CLI 必须带 `-c`（如 `-c /Users/taowen/project/navbook/web`），根目录直接跑会报 `monorepo_root`
- pnpm workspace：依赖装到 `web/package.json`；若 CLI 生成 `web/package-lock.json`，删除它并在根目录跑 `pnpm install`

---

### Task 1: shadcn init（CLI 2.10.0，Tailwind v3 路径）

**Files:**
- Create: `web/components.json`
- Create: `web/src/lib/utils.ts`
- Modify: `web/tailwind.config.js`（CLI 注入 shadcn 色板/动画，Task 2 再改造成 token 映射）
- Modify: `web/src/index.css`（CLI 注入 @layer base 变量块，Task 2 再重写）
- Modify: `web/package.json`（新增 class-variance-authority clsx tailwind-merge tailwindcss-animate）

- [ ] **Step 1: 运行 init**

```bash
npx -y shadcn@2.10.0 init -c /Users/taowen/project/navbook/web -y --base-color neutral --css-variables
```

预期：生成 `components.json`、`src/lib/utils.ts`（导出 `cn`），tailwind.config.js 被注入 `colors`/`keyframes`/`animation`/`plugins: [require('tailwindcss-animate')]`（或等价写法），index.css 末尾追加 `@layer base { :root {...} .dark {...} }`。

若交互提示 package manager / base color 等且 `-y` 未跳过：选 pnpm、neutral、css variables。

- [ ] **Step 2: 处理包管理器产物**

检查 `ls web/package-lock.json`。若存在（CLI 误用 npm）：

```bash
rm web/package-lock.json
pnpm install
```

确认 `web/package.json` dependencies 含 `class-variance-authority`、`clsx`、`tailwind-merge`，devDependencies 含 `tailwindcss-animate`。

- [ ] **Step 3: 验证产物**

```bash
cat web/components.json   # 应含 "$schema"、tailwind.config 指向、aliases: {"components": "@/components", "ui": "@/components/ui", "utils": "@/lib/utils"}
ls web/src/lib/utils.ts    # 存在，导出 cn()
pnpm -F web build          # 仍通过（页面未动，旧组件还在）
```

- [ ] **Step 4: Commit**

```bash
git add web/components.json web/src/lib web/tailwind.config.js web/src/index.css web/package.json pnpm-lock.yaml
git commit -m "chore(web): shadcn init（CLI 2.10.0，Tailwind v3）"
```

---

### Task 2: token 映射——shadcn 语义变量别名到现有 --color-*

**Files:**
- Modify: `web/src/index.css`（全文替换为下方内容）
- Modify: `web/tailwind.config.js`（全文替换为下方内容）

- [ ] **Step 1: 重写 index.css**

原则：现有 `--color-*` 原值不动（design.pen 同源）；shadcn 变量做**别名**，改主题仍只动 `--color-*` 一层。不使用模板的 `hsl(var(--x))` 三通道写法（源是 hex）。

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* 设计令牌：与 design.pen 保持一致，改主题只动这里（shadcn 语义变量均为别名） */
:root {
  --color-page: #f4f5f8;
  --color-surface: #ffffff;
  --color-line: #e6e8ee;
  --color-row-hover: #f9fafc;

  --color-primary: #4f46e5;
  --color-primary-hover: #4338ca;
  --color-primary-soft: #eef2ff;

  --color-ink: #171b26;
  --color-ink-secondary: #5b6472;
  --color-ink-faint: #9aa1b0;

  --color-sidebar: #101423;
  --color-sidebar-hover: #1c2236;
  --color-sidebar-muted: #8a92a6;
  --color-sidebar-divider: #222a40;

  --color-danger: #dc2626;
  --color-danger-soft: #fee2e2;
  --color-success: #059669;
  --color-success-soft: #d1fae5;

  /* shadcn 语义层（别名，勿套 hsl()） */
  --background: var(--color-page);
  --foreground: var(--color-ink);
  --card: var(--color-surface);
  --card-foreground: var(--color-ink);
  --popover: var(--color-surface);
  --popover-foreground: var(--color-ink);
  --primary: var(--color-primary);
  --primary-foreground: #ffffff;
  --secondary: var(--color-row-hover);
  --secondary-foreground: var(--color-ink);
  --muted: var(--color-row-hover);
  --muted-foreground: var(--color-ink-secondary);
  --accent: var(--color-row-hover);
  --accent-foreground: var(--color-ink);
  --destructive: var(--color-danger);
  --destructive-foreground: #ffffff;
  --border: var(--color-line);
  --input: var(--color-line);
  --ring: var(--color-primary);
  --radius: 0.5rem;
}

body {
  @apply bg-page text-ink font-sans antialiased;
}
```

注意：语义 token 不要用 `bg-primary/80` 这类透明度修饰符（`var()` 别名不支持拆 alpha 通道），需要半透明时用原有 `--color-*` 对应的 hex 或 `bg-surface/80`（`--color-surface` 本身是 hex，支持）。

- [ ] **Step 2: 重写 tailwind.config.js**

```js
import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 原有业务 token（页面代码直接引用，保留）
        page: 'var(--color-page)',
        surface: 'var(--color-surface)',
        line: 'var(--color-line)',
        'row-hover': 'var(--color-row-hover)',
        primary: {
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
          soft: 'var(--color-primary-soft)',
        },
        ink: {
          DEFAULT: 'var(--color-ink)',
          secondary: 'var(--color-ink-secondary)',
          faint: 'var(--color-ink-faint)',
        },
        sidebar: {
          DEFAULT: 'var(--color-sidebar)',
          hover: 'var(--color-sidebar-hover)',
          muted: 'var(--color-sidebar-muted)',
          divider: 'var(--color-sidebar-divider)',
        },
        danger: {
          DEFAULT: 'var(--color-danger)',
          soft: 'var(--color-danger-soft)',
        },
        success: {
          DEFAULT: 'var(--color-success)',
          soft: 'var(--color-success-soft)',
        },
        // shadcn 语义色（直接 var() 引用，不套 hsl()——源变量是 hex 别名）
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
          hover: 'var(--color-primary-hover)',
          soft: 'var(--color-primary-soft)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [tailwindcssAnimate],
}
```

要点：`primary.hover/soft` 两个子键是原有业务用的（`bg-primary-hover`/`bg-primary-soft`），与 shadcn 的 `primary.foreground` 合并进同一对象，不能丢。若 Task 1 的 init 给 config 加了 keyframes/animation（accordion 等），保留即可（未用到不生效）。

- [ ] **Step 3: 构建验证**

```bash
pnpm -F web build
```

预期：成功（旧组件仍引用 `--color-*` 系 token，不受影响）。

- [ ] **Step 4: Commit**

```bash
git add web/src/index.css web/tailwind.config.js
git commit -m "feat(web): shadcn 语义变量别名映射到现有设计 token"
```

---

### Task 3: 添加 12 个组件 + 三处修正

**Files:**
- Create: `web/src/components/ui/{button,input,select,badge,card,table,pagination,dialog,alert-dialog,sonner,skeleton,label,switch}.tsx`

- [ ] **Step 1: 添加组件**

```bash
npx -y shadcn@2.10.0 add button input select badge card table pagination dialog alert-dialog sonner skeleton label switch -c /Users/taowen/project/navbook/web -y
```

预期：13 个小写文件落到 `web/src/components/ui/`（select 会带 select-trigger 等子件，dialog 带 dialog-close 等）。Radix 依赖（`@radix-ui/react-select`、`-dialog`、`-alert-dialog`、`-label`、`-switch`、`-slot`）+ `sonner` 装进 `web/package.json`。若出现 `web/package-lock.json`，删除并在根目录 `pnpm install`。

- [ ] **Step 2: 修正 sonner.tsx（去 next-themes）**

2.x 的 sonner 模板 import 了 `next-themes`（Next.js 专属）。全文替换 `web/src/components/ui/sonner.tsx`：

```tsx
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      richColors
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-surface group-[.toaster]:text-ink group-[.toaster]:border-line group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-ink-secondary',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
```

- [ ] **Step 3: 圆角统一 rounded-md → rounded-lg**

shadcn 组件默认 `rounded-md`（0.375rem→经 config 映射后 0.5rem - 2px），旧设计是 `rounded-lg`。批量替换新组件目录（不动旧手写组件）：

```bash
cd /Users/taowen/project/navbook/web
grep -rl 'rounded-md' src/components/ui | while read f; do sed -i '' 's/rounded-md/rounded-lg/g' "$f"; done
grep -rn 'rounded-md' src/components/ui || echo OK
```

- [ ] **Step 4: badge.tsx 增加 success variant**

`web/src/components/ui/badge.tsx` 的 `badgeVariants` 增加（完整 cva 定义中 variants.badge 下追加）：

```tsx
success: 'border-transparent bg-success-soft text-success',
```

与现有 `default`/`secondary`/`destructive`/`outline` 并列。`bg-success-soft`/`text-success` 来自 Task 2 保留的业务 token。

- [ ] **Step 5: 构建验证 + Commit**

```bash
pnpm -F web build && pnpm -F web lint
git add web/src/components/ui web/package.json pnpm-lock.yaml
git commit -m "feat(web): 添加 shadcn 基础组件（sonner 去 next-themes、圆角对齐、badge success）"
```

---

### Task 4: 基础组合件 + Toaster 挂载

**Files:**
- Create: `web/src/components/admin/DataTableCard.tsx`
- Create: `web/src/components/admin/TablePagination.tsx`
- Create: `web/src/components/admin/ConfirmDialog.tsx`
- Create: `web/src/components/admin/Loading.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/admin/CopyField.tsx`、`web/src/components/admin/ThemeCard.tsx`（换新 button/badge/cn）

- [ ] **Step 1: DataTableCard.tsx（单表 + sticky 表头，替代旧 TableCard 双表格方案）**

```tsx
import type { ReactNode } from 'react';
import { Table, TableBody, TableHeader, TableRow } from '@/components/ui/table';
import { TableLoadingOverlay } from './Loading';

interface DataTableCardProps {
  /** 列宽 px；0 = 弹性列（放最后）。单表格 + colgroup，天然不存在表头/表体错位 */
  cols: number[];
  /** <TableRow><TableHead>…</TableHead></TableRow> */
  headers: ReactNode;
  loading?: boolean;
  /** 分页等，固定在滚动区外 */
  footer?: ReactNode;
  /** <TableRow><TableCell>…</TableCell></TableRow> */
  children: ReactNode;
}

/** 表格容器：sticky 表头 + 表体滚动。旧双表格方案（滚动条贯穿/列错位问题）废弃 */
export function DataTableCard({ cols, headers, loading, footer, children }: DataTableCardProps) {
  const colgroup = (
    <colgroup>
      {cols.map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}
    </colgroup>
  );
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain [&_table]:table-fixed">
        <Table>
          {colgroup}
          <TableHeader>
            {headers}
          </TableHeader>
          <TableBody>{children}</TableBody>
        </Table>
      </div>
      {loading && <TableLoadingOverlay />}
      {footer && <div className="shrink-0 border-t border-line px-4 py-2.5">{footer}</div>}
    </div>
  );
}
```

sticky 表头由页面在 `<TableHead className="sticky top-0 z-10 ...">` 上声明（见 Task 5/6 用法）。

- [ ] **Step 2: Loading.tsx**

```tsx
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

/** 页面级加载占位（查询首屏） */
export function Loading({ text = '加载中...' }: { text?: string }) {
  return <div className="py-16 text-center text-sm text-ink-faint">{text}</div>;
}

/** 悬浮在表格内容区上方的加载遮罩（翻页/首载覆盖旧数据） */
export function TableLoadingOverlay({ text = '加载中...' }: { text?: string }) {
  return (
    <div data-testid="table-loading" className="absolute inset-0 z-20 flex items-center justify-center bg-surface/80">
      <div className="flex items-center gap-2 text-sm text-ink-secondary">
        <Loader2 size={16} className="animate-spin text-primary" />
        {text}
      </div>
    </div>
  );
}

/** 查询失败占位（替代旧 ErrorNote 的整页用法） */
export function LoadError({ children = '加载失败，请刷新重试' }: { children?: ReactNode }) {
  return <div className="py-16 text-center text-sm text-danger">{children}</div>;
}
```

- [ ] **Step 3: TablePagination.tsx（保留紧凑页码序列算法）**

```tsx
import { Button } from '@/components/ui/button';

/** 紧凑页码序列：首尾各留 1 页，当前页附近连续，其余折叠为省略号 */
function pageSeq(page: number, pageCount: number): Array<number | '...'> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const gap = (n: number) => (Math.abs(n - page) < 2 || n === 1 || n === pageCount ? n : '...');
  return Array.from({ length: pageCount }, (_, i) => gap(i + 1)).filter(
    (n, i, arr) => n !== '...' || arr[i - 1] !== '...',
  );
}

interface Props {
  page: number;
  pageCount: number;
  total: number;
  onChange: (page: number) => void;
}

export function TablePagination({ page, pageCount, total, onChange }: Props) {
  if (pageCount <= 1) {
    return <div className="text-xs text-ink-faint">共 {total} 条</div>;
  }
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-ink-faint">共 {total} 条 · 第 {page}/{pageCount} 页</span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          上一页
        </Button>
        {pageSeq(page, pageCount).map((n, i) =>
          typeof n !== 'number' ? (
            <span key={`e${i}`} className="px-1 text-xs text-ink-faint">…</span>
          ) : (
            <Button
              key={n}
              size="sm"
              variant={n === page ? 'default' : 'outline'}
              className={n === page ? 'pointer-events-none' : ''}
              onClick={() => onChange(n)}
            >
              {n}
            </Button>
          ),
        )}
        <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
          下一页
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: ConfirmDialog.tsx（通用确认框，替代原生 confirm）**

```tsx
import type { ReactNode } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** 支持多行（导入确认带统计） */
  description: ReactNode;
  confirmText?: string;
  /** 危险操作红色确认按钮 */
  destructive?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open, onOpenChange, title, description, confirmText = '确认', destructive = false, onConfirm,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="whitespace-pre-line">{description}</AlertDialogDescription>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            className={cn(destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90')}
            onClick={onConfirm}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 5: App.tsx 挂载 Toaster**

在 `<QueryClientProvider>` 内层（BrowserRouter 外或内均可，放 BrowserRouter 之前）加：

```tsx
import { Toaster } from '@/components/ui/sonner';
// ...
return (
  <QueryClientProvider client={qc}>
    <Toaster position="top-center" />
    <BrowserRouter>
      {/* ...原 Routes 不动... */}
    </BrowserRouter>
  </QueryClientProvider>
);
```

- [ ] **Step 6: CopyField / ThemeCard 换新组件**

- `CopyField.tsx`：`import { Button } from '@/components/ui/button'`；`variant="outline"` 保持。
- `ThemeCard.tsx`：`Button` → `@/components/ui/button`（原 `variant="primary"` → `variant="default"`，"启用"按钮；当前主题按钮 `variant="outline" disabled`）；`Badge` → `@/components/ui/badge`（`tone="primary"` → 默认 variant）；`cx` → `cn`（`@/lib/utils`）。

- [ ] **Step 7: 构建验证 + Commit**

```bash
pnpm -F web build && pnpm -F web lint
git add web/src/components/admin web/src/App.tsx
git commit -m "feat(web): DataTableCard(sticky 表头)/分页/确认框/Toaster 基础组合件"
```

---

### Task 5: 分类管理页（工具栏 + Dialog 表单）

**Files:**
- Create: `web/src/components/admin/CategoryDialog.tsx`
- Modify: `web/src/routes/Admin/Categories.tsx`（全文替换）

- [ ] **Step 1: CategoryDialog.tsx（新增/编辑共用）**

```tsx
import { useEffect, useState } from 'react';
import { useAddCategory, useEditCategory, useCategories } from '@/api/hooks';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/** category_list 返回行（camelCase）；提交时映射回 snake_case */
export interface CategoryRow {
  id: number;
  name: string;
  property: number;
  weight: number;
  description: string | null;
  fontIcon: string | null;
  fid: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 传入 = 编辑模式，回填整行 */
  row?: CategoryRow | null;
  onDone?: () => void;
}

export function CategoryDialog({ open, onOpenChange, row }: Props) {
  const add = useAddCategory();
  const edit = useEditCategory();
  const pending = add.isPending || edit.isPending;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [weight, setWeight] = useState('0');
  const [fontIcon, setFontIcon] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [fid, setFid] = useState('0');

  const { data: catData } = useCategories(1, 100);
  const cats: Array<{ id: number; name: string }> = catData?.data ?? [];

  // 打开时按模式重置：编辑回填整行，新增清空
  useEffect(() => {
    if (!open) return;
    if (row) {
      setName(row.name);
      setDescription(row.description ?? '');
      setWeight(String(row.weight ?? 0));
      setFontIcon(row.fontIcon ?? '');
      setIsPrivate(row.property === 1);
      setFid(String(row.fid ?? 0));
    } else {
      setName(''); setDescription(''); setWeight('0'); setFontIcon(''); setIsPrivate(false); setFid('0');
    }
  }, [open, row]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('分类名称必填');
      return;
    }
    // 编辑携带整行数据：只带 name 会把 property 等硬编码重置，
    // property:0 会让私有分类对游客泄露其下链接
    const payload = {
      ...(row ? { id: row.id } : {}),
      name: name.trim(),
      description: description.trim(),
      weight: Number(weight) || 0,
      font_icon: fontIcon.trim(),
      property: isPrivate ? 1 : 0,
      fid: Number(fid) || 0,
    };
    try {
      if (row) {
        await edit.mutateAsync(payload);
        toast.success('分类已更新');
      } else {
        await add.mutateAsync(payload);
        toast.success('分类已创建');
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{row ? '编辑分类' : '新增分类'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">名称 *</Label>
            <Input id="cat-name" value={name} onChange={e => setName(e.target.value)} placeholder="分类名称" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-desc">描述</Label>
            <Input id="cat-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="描述（可选）" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cat-weight">权重</Label>
              <Input id="cat-weight" type="number" value={weight} onChange={e => setWeight(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-icon">图标 class</Label>
              <Input id="cat-icon" value={fontIcon} onChange={e => setFontIcon(e.target.value)} placeholder="如 fa fa-star" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-fid">父分类</Label>
            <select
              id="cat-fid"
              value={fid}
              onChange={e => setFid(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="0">无（顶级分类）</option>
              {cats.filter(c => c.id !== row?.id).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5">
            <div>
              <Label htmlFor="cat-private">私有分类</Label>
              <p className="text-xs text-ink-faint">仅登录后可见，游客不可见其下链接</p>
            </div>
            <Switch id="cat-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={pending}>{pending ? '提交中...' : row ? '更新' : '新增'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

（父分类用原生 select 而非 Radix Select：低频字段，原生够用且规避键盘焦点复杂度；链接的分类是主字段，用 Radix Select，见 Task 6。）

- [ ] **Step 2: Categories.tsx 全文替换**

```tsx
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useCategories, useDelCategory } from '@/api/hooks';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/PageHeader';
import { CategoryDialog, type CategoryRow } from '@/components/admin/CategoryDialog';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { DataTableCard } from '@/components/admin/DataTableCard';
import { TablePagination } from '@/components/admin/TablePagination';

const PAGE_SIZE = 20;

export function AdminCategories() {
  const [page, setPage] = useState(1);
  const { data, isFetching } = useCategories(page, PAGE_SIZE);
  const del = useDelCategory();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<CategoryRow | null>(null);
  const [delTarget, setDelTarget] = useState<CategoryRow | null>(null);

  // 删除末页最后一条后回退，避免停留在空页；count 未知（切换页码的加载间隙）不回退，
  // 否则 pageCount 被误算为 1，会把刚点的页码弹回第 1 页
  const pageCount = Math.max(1, Math.ceil((data?.count ?? 0) / PAGE_SIZE));
  useEffect(() => { if (data && page > pageCount) setPage(pageCount); }, [page, pageCount, data]);

  const cats: CategoryRow[] = data?.data ?? [];
  const total = data?.count ?? 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="分类管理"
        right={
          <Button onClick={() => { setEditRow(null); setDialogOpen(true); }}>
            <Plus size={14} /> 新增分类
          </Button>
        }
      />

      <DataTableCard
        cols={[64, 360, 80, 80, 0]}
        headers={
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky top-0 z-10 bg-[#F9FAFC]">ID</TableHead>
            <TableHead className="sticky top-0 z-10 bg-[#F9FAFC]">名称</TableHead>
            <TableHead className="sticky top-0 z-10 bg-[#F9FAFC]">属性</TableHead>
            <TableHead className="sticky top-0 z-10 bg-[#F9FAFC]">权重</TableHead>
            <TableHead className="sticky top-0 z-10 bg-[#F9FAFC]">操作</TableHead>
          </TableRow>
        }
        loading={isFetching}
        footer={<TablePagination page={page} pageCount={pageCount} total={total} onChange={setPage} />}
      >
        {cats.length === 0 && !isFetching && (
          <TableRow>
            <TableCell colSpan={5} className="py-10 text-center text-ink-faint">暂无分类，点击右上角「新增分类」添加</TableCell>
          </TableRow>
        )}
        {cats.map(c => (
          <TableRow key={c.id}>
            <TableCell className="text-ink-faint">{c.id}</TableCell>
            <TableCell className="font-medium text-ink">{c.name}</TableCell>
            <TableCell>
              {c.property === 1
                ? <Badge variant="destructive">私有</Badge>
                : <Badge variant="secondary">公开</Badge>}
            </TableCell>
            <TableCell className="text-ink-secondary">{c.weight}</TableCell>
            <TableCell>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setEditRow(c); setDialogOpen(true); }}>
                  编辑
                </Button>
                <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setDelTarget(c)}>
                  删除
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </DataTableCard>

      <CategoryDialog open={dialogOpen} onOpenChange={setDialogOpen} row={editRow} />
      <ConfirmDialog
        open={delTarget !== null}
        onOpenChange={v => { if (!v) setDelTarget(null); }}
        title={`删除分类「${delTarget?.name ?? ''}」？`}
        description="该操作不可撤销，其下链接将失去分类归属。"
        confirmText="删除"
        destructive
        onConfirm={() => {
          if (!delTarget) return;
          del.mutate(delTarget.id, {
            onSuccess: () => toast.success('分类已删除'),
            onError: e => toast.error(e instanceof Error ? e.message : '删除失败'),
          });
          setDelTarget(null);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: 构建验证 + Commit**

```bash
pnpm -F web build && pnpm -F web lint
git add web/src/routes/Admin/Categories.tsx web/src/components/admin/CategoryDialog.tsx
git commit -m "feat(web): 分类管理迁移 shadcn（Dialog 表单 + 确认框 + toast + sticky 表头）"
```

---

### Task 6: 链接管理页（补编辑能力）

**Files:**
- Create: `web/src/components/admin/LinkDialog.tsx`
- Modify: `web/src/routes/Admin/Links.tsx`（全文替换）

- [ ] **Step 1: LinkDialog.tsx（新增/编辑共用，Radix Select 选分类）**

```tsx
import { useEffect, useState } from 'react';
import { useAddLink, useEditLink, useAllCategories } from '@/api/hooks';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

/** link_list 返回行（camelCase，见 workers handlers/link.ts LinkRow）；提交映射回 snake_case */
export interface LinkRow {
  id: number;
  fid: number;
  title: string;
  url: string;
  description: string | null;
  weight: number;
  property: number;
  urlStandby: string | null;
  fontIcon: string | null;
  categoryName?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 传入 = 编辑模式，回填整行（此前页面无编辑功能，这是补齐的能力） */
  row?: LinkRow | null;
}

export function LinkDialog({ open, onOpenChange, row }: Props) {
  const add = useAddLink();
  const edit = useEditLink();
  const pending = add.isPending || edit.isPending;
  const { data: catData } = useAllCategories();
  const cats: Array<{ id: number; name: string }> = catData?.data ?? [];

  const [fid, setFid] = useState('0');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [urlStandby, setUrlStandby] = useState('');
  const [description, setDescription] = useState('');
  const [fontIcon, setFontIcon] = useState('');
  const [weight, setWeight] = useState('0');
  const [isPrivate, setIsPrivate] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (row) {
      setFid(String(row.fid));
      setTitle(row.title);
      setUrl(row.url);
      setUrlStandby(row.urlStandby ?? '');
      setDescription(row.description ?? '');
      setFontIcon(row.fontIcon ?? '');
      setWeight(String(row.weight ?? 0));
      setIsPrivate(row.property === 1);
    } else {
      setFid('0'); setTitle(''); setUrl(''); setUrlStandby('');
      setDescription(''); setFontIcon(''); setWeight('0'); setIsPrivate(false);
    }
  }, [open, row]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fid || fid === '0') { toast.error('请选择分类'); return; }
    if (!title.trim()) { toast.error('标题必填'); return; }
    if (!url.trim()) { toast.error('URL 必填'); return; }
    const payload = {
      ...(row ? { id: row.id } : {}),
      fid: Number(fid),
      title: title.trim(),
      url: url.trim(),
      url_standby: urlStandby.trim(),
      description: description.trim(),
      weight: Number(weight) || 0,
      property: isPrivate ? 1 : 0,
      font_icon: fontIcon.trim(),
    };
    try {
      if (row) {
        await edit.mutateAsync(payload);
        toast.success('链接已更新');
      } else {
        await add.mutateAsync(payload);
        toast.success('链接已创建');
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{row ? '编辑链接' : '新增链接'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>分类 *</Label>
            <Select value={fid} onValueChange={setFid}>
              <SelectTrigger>
                <SelectValue placeholder="选择分类" />
              </SelectTrigger>
              <SelectContent>
                {cats.map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-title">标题 *</Label>
            <Input id="link-title" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-url">URL *</Label>
            <Input id="link-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-standby">备用 URL</Label>
            <Input id="link-standby" value={urlStandby} onChange={e => setUrlStandby(e.target.value)} placeholder="https://...（可选）" className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-desc">描述</Label>
            <Input id="link-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="描述（可选）" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="link-weight">权重</Label>
              <Input id="link-weight" type="number" value={weight} onChange={e => setWeight(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="link-icon">图标 class</Label>
              <Input id="link-icon" value={fontIcon} onChange={e => setFontIcon(e.target.value)} placeholder="如 fa fa-star" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5">
            <div>
              <Label htmlFor="link-private">私有链接</Label>
              <p className="text-xs text-ink-faint">仅登录后可见</p>
            </div>
            <Switch id="link-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={pending}>{pending ? '提交中...' : row ? '更新' : '新增'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Links.tsx 全文替换**

```tsx
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useLinks, useDelLink } from '@/api/hooks';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TableHead, TableRow, TableCell } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/PageHeader';
import { LetterAvatar } from '@/components/admin/LetterAvatar';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { DataTableCard } from '@/components/admin/DataTableCard';
import { LinkDialog, type LinkRow } from '@/components/admin/LinkDialog';
import { TablePagination } from '@/components/admin/TablePagination';

const PAGE_SIZE = 20;

export function AdminLinks() {
  const [page, setPage] = useState(1);
  const { data: linkData, isFetching } = useLinks(page, PAGE_SIZE);
  const del = useDelLink();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<LinkRow | null>(null);
  const [delTarget, setDelTarget] = useState<LinkRow | null>(null);

  // 删除末页最后一条后回退，避免停留在空页；count 未知（切换页码的加载间隙）不回退，
  // 否则 pageCount 被误算为 1，会把刚点的页码弹回第 1 页
  const pageCount = Math.max(1, Math.ceil((linkData?.count ?? 0) / PAGE_SIZE));
  useEffect(() => { if (linkData && page > pageCount) setPage(pageCount); }, [page, pageCount, linkData]);

  const links: LinkRow[] = linkData?.data ?? [];
  const total = linkData?.count ?? 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="链接管理"
        right={
          <Button onClick={() => { setEditRow(null); setDialogOpen(true); }}>
            <Plus size={14} /> 新增链接
          </Button>
        }
      />

      <DataTableCard
        cols={[64, 260, 320, 128, 0]}
        headers={
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky top-0 z-10 bg-[#F9FAFC]">ID</TableHead>
            <TableHead className="sticky top-0 z-10 bg-[#F9FAFC]">标题</TableHead>
            <TableHead className="sticky top-0 z-10 bg-[#F9FAFC]">URL</TableHead>
            <TableHead className="sticky top-0 z-10 bg-[#F9FAFC]">分类</TableHead>
            <TableHead className="sticky top-0 z-10 bg-[#F9FAFC]">操作</TableHead>
          </TableRow>
        }
        loading={isFetching}
        footer={<TablePagination page={page} pageCount={pageCount} total={total} onChange={setPage} />}
      >
        {links.length === 0 && !isFetching && (
          <TableRow>
            <TableCell colSpan={5} className="py-10 text-center text-ink-faint">暂无链接，点击右上角「新增链接」添加</TableCell>
          </TableRow>
        )}
        {links.map(l => (
          <TableRow key={l.id}>
            <TableCell className="text-ink-faint">{l.id}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2.5">
                <LetterAvatar text={l.title} />
                <span className="font-medium text-ink">{l.title}</span>
              </div>
            </TableCell>
            <TableCell className="truncate font-mono text-xs text-ink-secondary">{l.url}</TableCell>
            <TableCell className="text-ink-secondary">{l.categoryName}</TableCell>
            <TableCell>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setEditRow(l); setDialogOpen(true); }}>
                  编辑
                </Button>
                <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setDelTarget(l)}>
                  删除
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </DataTableCard>

      <LinkDialog open={dialogOpen} onOpenChange={setDialogOpen} row={editRow} />
      <ConfirmDialog
        open={delTarget !== null}
        onOpenChange={v => { if (!v) setDelTarget(null); }}
        title={`删除链接「${delTarget?.title ?? ''}」？`}
        description="该操作不可撤销。"
        confirmText="删除"
        destructive
        onConfirm={() => {
          if (!delTarget) return;
          del.mutate(delTarget.id, {
            onSuccess: () => toast.success('链接已删除'),
            onError: e => toast.error(e instanceof Error ? e.message : '删除失败'),
          });
          setDelTarget(null);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: 构建验证 + Commit**

```bash
pnpm -F web build && pnpm -F web lint
git add web/src/routes/Admin/Links.tsx web/src/components/admin/LinkDialog.tsx
git commit -m "feat(web): 链接管理迁移 shadcn 并补齐编辑能力（全字段 Dialog）"
```

---

### Task 7: 站点设置 + Token 管理

**Files:**
- Modify: `web/src/routes/Admin/Settings.tsx`
- Modify: `web/src/routes/Admin/Token.tsx`

- [ ] **Step 1: Settings.tsx 改造点（按序应用）**

1. imports 替换：
   - 删 `Badge/Button/Card/Input/ErrorNote, Loading, SuccessNote`、`cx` 旧引用
   - 加：`import { Badge } from '@/components/ui/badge'; import { Button } from '@/components/ui/button'; import { Card } from '@/components/ui/card'; import { Input } from '@/components/ui/input'; import { Switch } from '@/components/ui/switch'; import { toast } from 'sonner';`
   - 加：`import { ConfirmDialog } from '@/components/admin/ConfirmDialog'; import { Loading, LoadError } from '@/components/admin/Loading';`
2. 状态 `msg/error` 状态与底部 `{msg && <SuccessNote>…}{error && <ErrorNote>…}` 整块删除，onSuccess/onError 回调改 `toast.success(...)` / `toast.error(e2.message)`
3. 隐私模式手写 switch（`role="switch"` 那个 `<button>`）→ `<Switch checked={cfg.site_private} disabled={save.isPending} onCheckedChange={onTogglePrivacy} aria-label="隐私模式开关" />`
4. 隐私开关二次确认：加 `const [confirmPrivacy, setConfirmPrivacy] = useState(false)`；`onTogglePrivacy` 只 `setConfirmPrivacy(true)`；新 confirm 文案沿用原文案，确认后执行原 `save.mutate(...)` 逻辑
5. `<Card className="mb-8">` → `<Card className="mb-8 p-5">`（shadcn Card 无内边距），两处；`<Badge tone="primary">` → `<Badge>`（默认 variant 即主色）、`tone="neutral"` → `variant="secondary"`
6. `if (isLoading) return <Loading />; if (isError || !data?.data) return <ErrorNote>…` → `LoadError`
7. 表单 `onSaveInfo`：成功 `toast.success('已保存，首页刷新后生效')`，失败 `toast.error(e2.message)`

- [ ] **Step 2: Token.tsx 改造点**

1. imports：`Button` → `@/components/ui/button`；`Card` → `@/components/ui/card`；`ErrorNote, Loading` → `Loading, LoadError`（admin/Loading）；加 `toast`、`ConfirmDialog`
2. `<Card className="mb-8 space-y-5">` → `<Card className="mb-8 space-y-5 p-5">`；`<Card>` → `<Card className="p-5">`
3. `variant="danger"` → `variant="destructive"`
4. `confirm(...)` → ConfirmDialog（`const [confirmRegen, setConfirmRegen] = useState(false)`），确认后 `regen.mutate(undefined, { onSuccess: () => toast.success('SecretKey 已重新生成'), onError: e => toast.error(e.message) })`

- [ ] **Step 3: 构建验证 + Commit**

```bash
pnpm -F web build && pnpm -F web lint
git add web/src/routes/Admin/Settings.tsx web/src/routes/Admin/Token.tsx
git commit -m "feat(web): 站点设置/Token 管理迁移 shadcn（Switch/确认框/toast）"
```

---

### Task 8: 导入导出 + 主题 + 登录 + 初始化 + 布局

**Files:**
- Modify: `web/src/routes/Admin/ImportExport.tsx`
- Modify: `web/src/routes/Admin/Theme.tsx`
- Modify: `web/src/routes/Login.tsx`
- Modify: `web/src/routes/Init.tsx`
- Modify: `web/src/routes/Admin/Layout.tsx`

- [ ] **Step 1: ImportExport.tsx 改造点**

1. imports：`Badge` → `@/components/ui/badge`（`tone="success"` → `variant="success"`、`tone="primary"` → 默认、`tone="neutral"` → `variant="secondary"`）；`Button` → 新；`Card` → 新（`<Card className="mb-8">` → `<Card className="mb-8 p-5">` 等，补 p-5）；`ErrorNote` → 删，加 `toast`、`ConfirmDialog`
2. 原生 `confirm` 导入确认改为 ConfirmDialog：`onFile` 解析成功后 `setPendingFile(...)` 同时 `setConfirmImport(true)`；description 用已解析统计（`文件「name」：X 个分类 / Y 条链接。\n同名分类将合并，重复 URL 将跳过。\n注意：导入后的条目将对访客公开。`，ConfirmDialog 的 description 支持 `whitespace-pre-line`）；确认即调 `doImport()`
3. `doExport`/`doImport` 的 catch 改 `toast.error(...)`；`doImport` 成功后 `toast.success(`导入完成：新建 ${res.data.categories_created} 分类 / 导入 ${res.data.links_imported} 链接`)`
4. 底部 `{error && <ErrorNote>…}` 删除，`error` state 删除

- [ ] **Step 2: Theme.tsx 改造点**

1. imports：`Badge` → 新（`tone="primary"` → 默认 variant）；`ErrorNote, Loading` → `Loading, LoadError`
2. `onSwitch` 的 `onError: e => { setError(e.message) }` → `toast.error(e.message)`，`error` state 与底部 `{error && <ErrorNote>…}` 删除；成功可加 `toast.success(\`已切换到 ${name}\`)`（onSuccess 里用主题名）

- [ ] **Step 3: Login.tsx 改造点（保留渐变背景与自定义密码框结构）**

1. 删 `ErrorNote` import；加 `import { toast } from 'sonner'`
2. catch 改 `toast.error(err instanceof Error ? err.message : '操作失败')`；`error` state 与 `{error && ...}` 块删除
3. 密码框 focus 态 class 改 `focus-within:border-ring focus-within:ring-2 focus-within:ring-primary-soft`（等价旧视觉，语义统一）；其余结构不动

- [ ] **Step 4: Init.tsx 改造点**

1. imports：`Button` → `@/components/ui/button`；`Input` → `@/components/ui/input`；删 `ErrorNote`，加 `toast`
2. catch 改 `toast.error(...)`；`error` state 与 `{error && <ErrorNote>…}` 删除；提交按钮已有 `type="submit"`（保留）

- [ ] **Step 5: Layout.tsx 改造点**

1. `import { cx } from '@/components/ui/cx'` → `import { cn } from '@/lib/utils'`；两处 `cx(` → `cn(`
2. 其余（侧栏结构/登出）不动

- [ ] **Step 6: 构建验证 + Commit**

```bash
pnpm -F web build && pnpm -F web lint
git add web/src/routes
git commit -m "feat(web): 导入导出/主题/登录/初始化/布局迁移 shadcn 与 toast"
```

---

### Task 9: 删除旧手写组件

**Files:**
- Delete: `web/src/components/ui/{Button,Input,Badge,Card,Pagination,Feedback,Table,cx}.tsx`（8 个文件）
- 保留: `web/src/components/ui/PageHeader.tsx`（纯排版）及全部 shadcn 小写组件

- [ ] **Step 1: 确认无残留引用**

```bash
grep -rn "components/ui/Button\|components/ui/Input\|components/ui/Badge\|components/ui/Card\|components/ui/Pagination\|components/ui/Feedback\|components/ui/Table\|ui/cx" web/src
```

预期：无输出。若有，修正引用后再继续。

- [ ] **Step 2: 删除**

```bash
rm web/src/components/ui/Button.tsx web/src/components/ui/Input.tsx web/src/components/ui/Badge.tsx web/src/components/ui/Card.tsx web/src/components/ui/Pagination.tsx web/src/components/ui/Feedback.tsx web/src/components/ui/Table.tsx web/src/components/ui/cx.ts
```

- [ ] **Step 3: 构建验证 + Commit**

```bash
pnpm -F web build && pnpm -F web lint
git add -A web/src/components
git commit -m "refactor(web): 删除旧手写 UI 组件，shadcn 迁移完成"
```

---

### Task 10: 浏览器端到端走查

**Files:** 无代码改动（发现问题回前面 task 修）

- [ ] **Step 1: 起本地环境**

用 `run` skill（或手动）：根目录 `pnpm dev` 若无聚合脚本，则分开起——`pnpm -F workers dev`（wrangler，8787，D1 本地）+ `pnpm -F web dev`（vite 5173，已配 /api 代理）。

- [ ] **Step 2: Playwright 走查清单（http://localhost:5173/admin）**

逐项验证（登录密码用本地 D1 里的账号，或先走 /admin/init）：

1. 登录页：错误密码 → toast 报错；正确密码进入后台
2. 分类管理：新增 Dialog（必填校验、私有开关、父分类下拉）；行内编辑回填（重点验证私有分类编辑后 property 不被重置——编辑一个私有分类不改任何字段保存，前台 guest 接口确认仍 403/不可见）；删除确认框；末页删除回退
3. 链接管理：新增（分类 Radix Select、URL 必填）；**编辑回填全字段**（重点：fid/私有/权重/备用URL）；删除；分页
4. 表格滚动：窗口压矮，表头 sticky 不随滚、滚动条正常、列对齐
5. 站点设置：隐私开关确认框 + Switch 状态刷新；保存 toast
6. Token：重新生成 SecretKey 确认框 + toast + 复制按钮
7. 导入导出：导出下载；选 JSON 出确认框（含统计）；导入后 stats badges
8. 主题管理：切换主题 + toast；当前主题徽标
9. 视觉对比：与迁移前截图对比配色/圆角/密度无回退（重点关注按钮主色、表格表头底色 #F9FAFC、对话框圆角）

- [ ] **Step 3: 收尾**

```bash
pnpm build   # 根聚合构建，确认 workers/dist 产物正常
```

（构建产物不 commit；仅确认聚合链路不因 web 变化破坏。）

---

## Self-Review 记录

- **Spec 覆盖**：§1 基础设施=Task 1/3；§2 token=Task 2；§3 组件映射=Task 3/4/5/6/7/8/9；§4 表格=Task 4(DataTableCard)+5/6(用法)；§5 页面=Task 5-8；§6 错误处理=各 task 的 toast 步骤；§7 验证=各 task build/lint + Task 10。无缺口。
- **占位符**：无 TBD/TODO；Task 7/8 用"改造点"精确指令（旧代码在仓库里，指令含新旧对照语义），关键新文件均为完整代码。
- **类型一致性**：`CategoryRow`（Task 5 定义/使用一致）、`LinkRow`（Task 6 定义/使用一致，与 workers `handlers/link.ts:19` 字段对齐）、`ConfirmDialog`/`DataTableCard`/`TablePagination` props 在 Task 4 定义、Task 5/6/7/8 调用一致；`cn` 来源统一 `@/lib/utils`。
- **风险注记**：shadcn 2.10.0 是 v3 末代 CLI（4.x 需 Tailwind v4）——记录在案，未来升 Tailwind v4 时组件源码已在自己仓库，无锁定。
