import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from './client';

export interface Paged<T> {
  code: number;
  msg: string;
  count: number;
  data: T[];
}

export function useCategories(page: number, limit: number) {
  return useQuery({
    queryKey: ['categories', page, limit],
    queryFn: () => api.listCategories(page, limit),
    placeholderData: keepPreviousData,
  });
}

/** 下拉选择等场景要全量分类（后端 limit 上限 100，分类数远小于此） */
export function useAllCategories() {
  return useQuery({
    queryKey: ['categories', 'all'],
    queryFn: () => api.listCategories(1, 100),
  });
}

/** 链接筛选条件（后台工具栏）；undefined 字段不发给后端 */
export interface LinkFilters {
  keyword?: string;
  categoryId?: number;
  property?: number;
}

export function useLinks(page: number, limit: number, filters: LinkFilters = {}) {
  return useQuery({
    queryKey: ['links', page, limit, filters],
    queryFn: () => api.listLinks(page, limit, {
      ...(filters.keyword ? { keyword: filters.keyword } : {}),
      ...(filters.categoryId ? { category_id: filters.categoryId } : {}),
      ...(filters.property !== undefined ? { property: filters.property } : {}),
    }),
    placeholderData: keepPreviousData,
  });
}

export interface ThemeEntry {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  preview?: string;
}

export function useThemes() {
  return useQuery({
    queryKey: ['themes'],
    queryFn: () => api.themes<{ data: { active: string; themes: ThemeEntry[] } }>(),
  });
}

export const useSetTheme = () =>
  useInvalidatingMutation((id: string) => api.setTheme(id), [['themes']]);

function useInvalidatingMutation<TVars>(
  mutationFn: (vars: TVars) => Promise<unknown>,
  keysToInvalidate: string[][],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      for (const key of keysToInvalidate) qc.invalidateQueries({ queryKey: key });
    },
  });
}

// 分类写操作同时失效 ['links']：Links 表格缓存了 categoryName，分类改名/删除后会过期
export const useAddCategory = () =>
  useInvalidatingMutation((data: Record<string, unknown>) => api.addCategory(data),
    [['categories'], ['links']]);
export const useEditCategory = () =>
  useInvalidatingMutation((data: Record<string, unknown>) => api.editCategory(data),
    [['categories'], ['links']]);
export const useDelCategory = () =>
  useInvalidatingMutation((id: number) => api.delCategory(id),
    [['categories'], ['links']]);
export const useAddLink = () =>
  useInvalidatingMutation((data: Record<string, unknown>) => api.addLink(data),
    [['links']]);
export const useEditLink = () =>
  useInvalidatingMutation((data: Record<string, unknown>) => api.editLink(data),
    [['links']]);
export const useDelLink = () =>
  useInvalidatingMutation((id: number) => api.delLink(id),
    [['links']]);
