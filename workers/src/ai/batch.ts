// 批量工具工厂与执行策略——agent 的"执行引擎"关注点。
// buildBatchTools:action 枚举按「当前工具集 + 最终策略」动态生成(内置与 MCP 通吃,
// 未来任何新工具零代码自动可嵌);batch_read 并发、batch_write 顺序(确认卡清单编号确定)。
// resolveExecPolicy:确认行为的唯一决策点(toolPolicy 配置 > MCP trust 已映射的 danger > 工具默认)。
import type { AiTool } from './tools';
import type { ToolPolicy, WorkerDB } from './types';

const BATCH_WRITE_MAX = 20;
const BATCH_READ_MAX = 10;
const BATCH_READ_CONCURRENCY = 4;

/** 唯一决策点:所有确认行为收口到这一个纯函数(配置覆盖 > 工具 defaultPolicy > danger 默认) */
export function resolveExecPolicy(
  tool: Pick<AiTool, 'name' | 'danger' | 'defaultPolicy'>,
  policy: ToolPolicy,
): 'auto' | 'confirm' {
  return policy[tool.name] ?? tool.defaultPolicy ?? (tool.danger === 'write' ? 'confirm' : 'auto');
}

/** 简单并发池:最多 limit 个 in-flight,结果保持提交顺序 */
async function runPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function buildBatchTools(available: AiTool[], policy: ToolPolicy): AiTool[] {
  const isBatch = (t: AiTool) => t.name === 'batch_read' || t.name === 'batch_write';
  const autoActions = available.filter(t => !isBatch(t) && resolveExecPolicy(t, policy) === 'auto').map(t => t.name);
  const confirmActions = available.filter(t => !isBatch(t) && resolveExecPolicy(t, policy) === 'confirm').map(t => t.name);
  const byName = new Map(available.map(t => [t.name, t]));

  const opSchema = (enumNames: string[], max: number) => ({
    type: 'array', minItems: 1, maxItems: max,
    description: '操作列表(按提交顺序)',
    items: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: enumNames },
        args: { type: 'object', description: '该工具的参数对象' },
      },
      required: ['action', 'args'],
    },
  });

  async function runOps(db: WorkerDB, ops: any[], want: 'auto' | 'confirm', concurrent: boolean) {
    const results: any[] = [];
    let okCount = 0;
    const execOne = async (op: any, i: number) => {
      const tool = byName.get(String(op?.action));
      if (!tool || isBatch(tool) || resolveExecPolicy(tool, policy) !== want) {
        results[i] = { index: i, action: op?.action, ok: false,
          error: { code: -2000, msg: `不允许的操作:${String(op?.action)}(本批仅接受${want === 'auto' ? '直接执行' : '需确认'}类工具,且不能嵌套 batch)` } };
        return;
      }
      try {
        const res = await tool.execute(db, (op.args ?? {}) as Record<string, any>);
        const ok = !(res && typeof res === 'object' && 'code' in res && (res as any).code !== 0);
        if (ok) okCount++;
        results[i] = { index: i, action: op.action, ok, result: res };
      } catch (e) {
        results[i] = { index: i, action: op.action, ok: false,
          error: { code: -2000, msg: e instanceof Error ? e.message : '执行异常' } };
      }
    };
    if (concurrent) await runPool(ops, BATCH_READ_CONCURRENCY, execOne);
    else for (let i = 0; i < ops.length; i++) await execOne(ops[i], i);   // 写有序、清单编号确定
    return { code: okCount === ops.length ? 0 : -1,   // 部分失败 → 顶层 code=-1,卡片显红"失败"
      total: ops.length, ok_count: okCount, fail_count: ops.length - okCount, results };
  }

  const summarizeBatch = (label: string, a: Record<string, any>, r: unknown, allowed: string[]) => {
    const ops: any[] = Array.isArray(a.operations) ? a.operations : [];
    if (r == null) {   // 确认卡/预执行:编号多行清单,复用子工具 summarize(args, null)
      const lines = ops.map((op, i) => {
        const t = byName.get(String(op?.action));
        return `${i + 1}. ${t && allowed.includes(t.name) ? t.summarize(op.args ?? {}, null) : `(${String(op?.action)} 不可批次执行)`}`;
      });
      return `批量 ${ops.length} 项${label}:\n${lines.join('\n')}`;
    }
    const b = r as any;   // 结果卡:计数 + 失败明细
    const head = `批量 ${b.total ?? ops.length} 项:${b.ok_count ?? 0} 成功,${b.fail_count ?? 0} 失败`;
    const fails = (b.results ?? []).filter((x: any) => !x.ok)
      .map((x: any) => `#${x.index + 1} ${x.action} 失败:${x.error?.msg ?? x.result?.msg ?? '未知错误'}`);
    return [head, ...fails].join('\n');
  };

  return [
    {
      name: 'batch_read',
      description: `批量执行多个查询/读取类工具,并发运行(抓取多个链接、多处搜索等场景优先用本工具一次提交;最多 ${BATCH_READ_MAX} 项,并发 ${BATCH_READ_CONCURRENCY})。单项失败不影响其余,结果按提交顺序逐项返回。`,
      parameters: { type: 'object', properties: { operations: opSchema(autoActions, BATCH_READ_MAX) }, required: ['operations'] },
      danger: 'read',
      summarize: (a, r) => summarizeBatch('读操作', a, r, autoActions),
      execute: async (db, a) => {
        const ops = a.operations;
        if (!Array.isArray(ops) || ops.length === 0) throw new Error('operations 不能为空');
        if (ops.length > BATCH_READ_MAX) throw new Error(`单次最多 ${BATCH_READ_MAX} 个操作,请拆分提交`);
        return runOps(db, ops, 'auto', true);
      },
    },
    {
      name: 'batch_write',
      description: `批量提交多个写/需确认操作,一张确认卡整批执行(≥2 项此类操作时优先用本工具,单项仍用对应单工具;最多 ${BATCH_WRITE_MAX} 项)。operations 按顺序执行,单项失败不影响其余,结果逐项返回。`,
      parameters: { type: 'object', properties: { operations: opSchema(confirmActions, BATCH_WRITE_MAX) }, required: ['operations'] },
      danger: 'write',
      summarize: (a, r) => summarizeBatch('写操作', a, r, confirmActions),
      execute: async (db, a) => {
        const ops = a.operations;
        if (!Array.isArray(ops) || ops.length === 0) throw new Error('operations 不能为空');
        if (ops.length > BATCH_WRITE_MAX) throw new Error(`单次最多 ${BATCH_WRITE_MAX} 个操作,请拆分提交`);
        return runOps(db, ops, 'confirm', false);
      },
    },
  ];
}
