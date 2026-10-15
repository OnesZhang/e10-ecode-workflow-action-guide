/**
 * Workflow Action Guide —— 前置入口
 *
 * 目标页面：PC 端 `/sp/workflow/` 下的页面。
 * 职责（按前端工程约定，前置入口只做轻量判断）：
 * 1. 判断当前路由是否在 `/sp/workflow/` 前缀内；
 * 2. 首次命中时异步加载业务模块 `coms/WorkflowActionGuide`（非前置，独立分片）；
 * 3. 模块加载失败时保持页面原样，不抛错、不注入任何节点。
 *
 * 悬浮入口的挂载 / 卸载 / 页面变化重渲染全部由业务模块自行处理，
 * 因此入口加载成功后即停止轮询，不再占用定时器。
 */
import { asyncImport } from '@weapp/ecodesdk';

const PATH_PREFIX = '/sp/workflow/';
const POLL_INTERVAL = 1000;

let loading = null;

function isTargetPath() {
  return window.location.pathname.indexOf(PATH_PREFIX) === 0;
}

/**
 * 异步加载业务模块并启动。
 * 重要：'${appId}' 是 E10 平台的运行时占位符，平台会自动替换为实际 appId，不要改成字面量。
 */
function ensureLoaded() {
  if (loading || !isTargetPath()) return;
  loading = asyncImport('${appId}', 'coms/WorkflowActionGuide')
    .then((mod) => {
      const boot = mod && (mod.default || mod);
      if (typeof boot === 'function') boot();
      else loading = null;
    })
    .catch((error) => {
      loading = null;
      console.error('[workflow-action-guide] 业务模块加载失败，页面保持原样', error);
    });
}

const timer = window.setInterval(() => {
  if (loading) {
    window.clearInterval(timer);
    return;
  }
  ensureLoaded();
}, POLL_INTERVAL);

ensureLoaded();
