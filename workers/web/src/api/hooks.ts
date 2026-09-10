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

export const useAddCategory = () =>
  useInvalidatingMutation((data: Record<string, unknown>) => api.addCategory(data),
    [['categories'], ['publicNav']]);
export const useEditCategory = () =>
  useInvalidatingMutation((data: Record<string, unknown>) => api.editCategory(data),
    [['categories'], ['publicNav']]);
export const useDelCategory = () =>
  useInvalidatingMutation((id: number) => api.delCategory(id),
    [['categories'], ['publicNav']]);
export const useAddLink = () =>
  useInvalidatingMutation((data: Record<string, unknown>) => api.addLink(data),
    [['links'], ['publicNav']]);
export const useEditLink = () =>
  useInvalidatingMutation((data: Record<string, unknown>) => api.editLink(data),
    [['links'], ['publicNav']]);
export const useDelLink = () =>
  useInvalidatingMutation((id: number) => api.delLink(id),
    [['links'], ['publicNav']]);
