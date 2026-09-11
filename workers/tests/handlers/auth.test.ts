import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { getDb } from '../../src/db/client';
import { checkLoginHandler, createSkHandler, appInfoHandler } from '../../src/handlers/auth';
import { initHandler, loginHandler } from '../../src/handlers/init';
import { md5 } from '../../src/lib/md5';
import { resetTables, seedUser, validToken } from '../helpers';

beforeEach(async () => {
  await resetTables();
});

const db = () => getDb(env.DB);

describe('check_login', () => {
  it('合法 token 返回 PHP 原版形状（code 200 + data "true"）', async () => {
    await seedUser();
    const res = await checkLoginHandler(db(), validToken());
    expect(res.code).toBe(200);
    expect(res.data).toBe('true');
    expect(res.msg).toBe('success');
  });

  it('SecretKey 未生成时退化 token 被拒（不走 ?? 退化路径）', async () => {
    await env.DB.prepare('INSERT INTO on_users (username, password_hash, created_at) VALUES (?, ?, ?)')
      .bind('admin', md5('test123'), 1710000000).run();
    const res = await checkLoginHandler(db(), md5('admin'));
    expect(res.code).toBe(-1002);
  });

  it('非法 token 被拒', async () => {
    await seedUser();
    expect((await checkLoginHandler(db(), 'bad')).code).toBe(-1002);
  });
});

describe('init / login', () => {
  it('init 建用户 + 生成 SecretKey', async () => {
    const res = await initHandler(db(), 'admin', 'test123');
    expect(res.code).toBe(0);
    expect(res.data.secret_key).toMatch(/^[0-9a-f]{32}$/);
    // secret_key 存在 on_options 且 init 后 token 可用
    const { authenticate } = await import('../../src/middleware/auth');
    expect(await authenticate(db(), '', md5('admin' + res.data.secret_key), undefined, '')).toBe('admin');
  });

  it('重复 init 被拒', async () => {
    await initHandler(db(), 'admin', 'test123');
    await expect(initHandler(db(), 'hacker', 'pass123')).rejects.toThrow('已经初始化');
  });

  it('login 正确密码返回 cookie（与 authenticate cookie 通道一致）', async () => {
    await initHandler(db(), 'admin', 'test123');
    const res = await loginHandler(db(), 'test123', 'my-ua');
    expect(res.code).toBe(0);
    expect(res.data!.cookie).toBe(md5('admin' + md5('test123') + 'navbook' + 'my-ua'));
  });

  it('login 错误密码 -1002', async () => {
    await initHandler(db(), 'admin', 'test123');
    expect((await loginHandler(db(), 'wrong', 'ua')).code).toBe(-1002);
  });

  it('login 用户未初始化 -2000', async () => {
    expect((await loginHandler(db(), 'x', 'ua')).code).toBe(-2000);
  });
});

describe('create_sk / app_info', () => {
  it('create_sk 覆盖旧 SecretKey', async () => {
    await seedUser();
    const res = await createSkHandler(db());
    expect(res.data.secret_key).toMatch(/^[0-9a-f]{32}$/);
    expect(res.data.secret_key).not.toBe('sk_test');
    // 新 token 立即可用（成功 code=200，PHP 原版形状）
    expect((await checkLoginHandler(db(), md5('admin' + res.data.secret_key))).code).toBe(200);
    // 旧 token 失效
    expect((await checkLoginHandler(db(), validToken())).code).toBe(-1002);
  });

  it('create_sk 未初始化时 throw', async () => {
    await expect(createSkHandler(db())).rejects.toThrow('请先初始化');
  });

  it('app_info 返回元信息', async () => {
    const empty = await appInfoHandler(db(), '0.5.0');
    expect(empty.data.has_user).toBe(false);
    await seedUser();
    const res = await appInfoHandler(db(), '0.5.0');
    expect(res.data.has_user).toBe(true);
    expect(res.data.username).toBe('admin');
    expect(res.data.client_version).toBe('0.5.0');
    // 插件契约：code==200 才读 onenav_version；版本须落在 [0.9, 2)（插件 parseFloat("0.9.32")=0.9，v>=2 被"发生异常"分支拒绝）
    expect(res.code).toBe(200);
    expect(res.msg).toBe('success');
    expect(res.data.onenav_version).toMatch(/^v1\./);
    const v = parseFloat(res.data.onenav_version.split('-')[0].substring(1));
    expect(v).toBeGreaterThanOrEqual(0.9);
    expect(v).toBeLessThan(2);
  });
});

describe('token_info', () => {
  it('返回 username/secret_key/token（token=validToken 公式）', async () => {
    await seedUser();
    const { tokenInfoHandler } = await import('../../src/handlers/auth');
    const res = await tokenInfoHandler(db());
    expect(res.code).toBe(0);
    expect(res.data!.username).toBe('admin');
    expect(res.data!.secret_key).toBe('sk_test');
    expect(res.data!.token).toBe(validToken());
  });

  it('未初始化返回 -2000', async () => {
    const { tokenInfoHandler } = await import('../../src/handlers/auth');
    const res = await tokenInfoHandler(db());
    expect(res.code).toBe(-2000);
  });
});
