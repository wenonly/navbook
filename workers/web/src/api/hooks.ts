import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export function usePublicNav() {
  return useQuery({ queryKey: ['publicNav'], queryFn: api.publicNav });
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api.listCategories() });
}

export function useLinks(categoryId?: number) {
  return useQuery({
    queryKey: ['links', categoryId],
    queryFn: () => api.listLinks(1, 100, categoryId),
  });
}

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
    [['categories'], ['publicNav'], ['links']]);
export const useEditCategory = () =>
  useInvalidatingMutation((data: Record<string, unknown>) => api.editCategory(data),
    [['categories'], ['publicNav'], ['links']]);
export const useDelCategory = () =>
  useInvalidatingMutation((id: number) => api.delCategory(id),
    [['categories'], ['publicNav'], ['links']]);
export const useAddLink = () =>
  useInvalidatingMutation((data: Record<string, unknown>) => api.addLink(data),
    [['links'], ['publicNav']]);
export const useEditLink = () =>
  useInvalidatingMutation((data: Record<string, unknown>) => api.editLink(data),
    [['links'], ['publicNav']]);
export const useDelLink = () =>
  useInvalidatingMutation((id: number) => api.delLink(id),
    [['links'], ['publicNav']]);
