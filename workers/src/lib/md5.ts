import { md5 as jsMd5 } from 'js-md5';

/**
 * 同步 MD5，输出 32 位小写 hex，与 PHP md5() 完全一致。
 * 用于 token（md5(USER + SecretKey)）和 cookie 校验。
 */
export function md5(input: string): string {
  return jsMd5(input);
}
