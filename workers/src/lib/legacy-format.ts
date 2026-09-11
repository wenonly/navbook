import { z } from 'zod';

/** PHP export_json 的孤儿分类容器名（Api.php:858 '默认分类'） */
export const DEFAULT_CATEGORY_NAME = '默认分类';

/**
 * html_entity_decode($s, ENT_QUOTES, 'UTF-8') 的等价实现（覆盖 htmlspecialchars 产生的五种实体）。
 * &amp; 必须最后解码，否则 "&amp;lt;" 会被二次解码成 "<"。
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');
}

// ---- onenav.bookmarks 导入格式（与 PHP export_json / ZMark 互通）----

export const onenavLinkSchema = z.object({
  title: z.string().min(1).max(64),
  // 旧书签可能有任意 scheme，与 DB（无格式约束）一致，不校验 URL 形状
  url: z.string().min(1).max(256),
  description: z.string().max(256).optional().default(''),
  backup_url: z.string().max(256).optional().default(''),
  sort_order: z.coerce.number().int().min(0).optional().default(0),
});

export const onenavL2CategorySchema = z.object({
  name: z.string().min(1).max(32),
  description: z.string().max(128).optional().default(''),
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
