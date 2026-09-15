import { z } from 'zod';

export const addCategorySchema = z.object({
  token: z.string().optional(),
  // 长度上限是防滥用护栏（宽松）；DB 列长仅为文档（SQLite 不强制，PHP 原版同样不拒绝超长）
  name: z.string().min(1).max(64),
  property: z.coerce.number().int().min(0).max(1).optional().default(0),
  weight: z.coerce.number().int().min(0).optional().default(0),
  description: z.string().max(512).optional().default(''),
  font_icon: z.string().max(64).optional().default(''),
  fid: z.coerce.number().int().min(0).optional().default(0),
});

export const editCategorySchema = addCategorySchema.extend({
  id: z.coerce.number().int().positive(),
});

export const delCategorySchema = z.object({
  token: z.string().optional(),
  id: z.coerce.number().int().positive(),
});

export const getACategorySchema = z.object({
  token: z.string().optional(),
  id: z.coerce.number().int().positive(),
});

export const addLinkSchema = z.object({
  token: z.string().optional(),
  fid: z.coerce.number().int().positive(),
  title: z.string().min(1).max(512),
  url: z.url().max(2048),
  description: z.string().max(512).optional().default(''),
  weight: z.coerce.number().int().min(0).optional().default(0),
  property: z.coerce.number().int().min(0).max(1).optional().default(0),
  url_standby: z.string().max(2048).optional().default(''),
  font_icon: z.string().max(512).optional().default(''),
});

export const editLinkSchema = addLinkSchema.extend({
  id: z.coerce.number().int().positive(),
});

export const delLinkSchema = z.object({
  token: z.string().optional(),
  id: z.coerce.number().int().positive(),
});

export const getALinkSchema = z.object({
  token: z.string().optional(),
  id: z.coerce.number().int().positive(),
});

export const qCategoryLinkSchema = z.object({
  token: z.string().optional(),
  category_id: z.coerce.number().int().positive(),
});

// 关键词长度 2-32 对齐 PHP Api.php global_search 的 strlen 校验
export const globalSearchSchema = z.object({
  token: z.string().optional(),
  keyword: z.string().min(2).max(32),
});

export const initSchema = z.object({
  username: z.string().min(1).max(32),
  password: z.string().min(6).max(64),
});

export const loginSchema = z.object({
  password: z.string().min(1).max(64),
});

export const setSiteSchema = z.object({
  token: z.string().optional(),
  // FormData 传来 '1'/'0' 字符串（z.coerce.boolean 会把 '0' 当 true，禁用）
  site_private: z.enum(['0', '1']).transform(v => v === '1').optional(),
  site_title: z.string().min(1).max(64).optional(),
  site_subtitle: z.string().max(128).optional(),
});

// ---------- AI ----------

export const aiProviderSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  preset: z.string().min(1).max(32),
  baseUrl: z.url().max(256),
  apiKey: z.string().max(256),   // 允许回显的打码占位(含 ***),保存时合并回原值
  model: z.string().min(1).max(128),
  enabled: z.boolean(),
});

export const aiConfigSchema = z.object({
  token: z.string().optional(),
  providers: z.array(aiProviderSchema).max(10),
  activeProviderId: z.string().max(64).nullable(),
  systemPrompt: z.string().max(4000).optional().default(''),
});
