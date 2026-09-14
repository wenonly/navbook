import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind class 合并（后者覆盖前者同维度值），shadcn 组件统一入口 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
