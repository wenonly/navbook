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

export const initSchema = z.object({
  username: z.string().min(1).max(32),
  password: z.string().min(6).max(64),
});

export const loginSchema = z.object({
  password: z.string().min(1).max(64),
});
