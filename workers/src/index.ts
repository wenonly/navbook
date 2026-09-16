import { createApp } from './router';

// Hono app 是合法的 Worker 导出（带 fetch/request 等处理器的对象）
export default createApp();
export { AgentTurnDO } from './do/AgentTurnDO';
