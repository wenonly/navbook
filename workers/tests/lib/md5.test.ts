import { describe, it, expect } from 'vitest';
import { md5 } from '../../src/lib/md5';

describe('md5（RFC 1321 向量，与 PHP md5() 输出一致）', () => {
  it('空字符串', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });
  it('"a"', () => {
    expect(md5('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
  });
  it('"abc"', () => {
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });
  it('"message digest"', () => {
    expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
  });
  it('同步 API（无 await）', () => {
    expect(typeof md5('x')).toBe('string');
  });
});
