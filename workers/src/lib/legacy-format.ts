import { z } from 'zod';

/** PHP export_json 的孤儿分类容器名（Api.php:858 '默认分类'） */
export const DEFAULT_CATEGORY_NAME = '默认分类';

// decodeEntities 已移至 escape.ts（与 escapeHtml 同居，编解码对称），此处重导出保持既有 import 路径
export { decodeEntities } from './escape';

// ---- onenav.bookmarks 导入格式（与 PHP export_json / ZMark 互通）----

export const onenavLinkSchema = z.object({
  // 长度上限是防滥用的护栏（宽松），不是 PHP 表结构的"文档长度"——
  // SQLite/PHP 原版从不强制列长，存量书签常见 200+ 字符的标题和带 token 的超长 URL
  title: z.string().min(1).max(512),
  // 旧书签可能有任意 scheme，与 DB（无格式约束）一致，不校验 URL 形状
  url: z.string().min(1).max(2048),
  description: z.string().max(512).optional().default(''),
  backup_url: z.string().max(2048).optional().default(''),
  sort_order: z.coerce.number().int().min(0).optional().default(0),
});

export const onenavL2CategorySchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(512).optional().default(''),
  links: z.array(onenavLinkSchema).optional().default([]),
});

export const onenavL1CategorySchema = onenavL2CategorySchema.extend({
  children: z.array(onenavL2CategorySchema).optional().default([]),
});

export const onenavImportSchema = z.object({
  type: z.literal('onenav.bookmarks'),
  version: z.coerce.number().int().optional().default(1),
  categories: z.array(onenavL1CategorySchema).min(1),
});

export type OnenavLink = z.infer<typeof onenavLinkSchema>;
export type OnenavL2Category = z.infer<typeof onenavL2CategorySchema>;
export type OnenavL1Category = z.infer<typeof onenavL1CategorySchema>;
export type OnenavImportPayload = z.infer<typeof onenavImportSchema>;

/** 导出 payload 的形状（type/version/categories 嵌套树） */
export interface OnenavExportPayload {
  type: 'onenav.bookmarks';
  version: 1;
  categories: Array<{
    name: string;
    description: string;
    links: Array<{ title: string; url: string; description: string; backup_url: string; sort_order: number }>;
    children: Array<{
      name: string;
      description: string;
      links: Array<{ title: string; url: string; description: string; backup_url: string; sort_order: number }>;
    }>;
  }>;
}
