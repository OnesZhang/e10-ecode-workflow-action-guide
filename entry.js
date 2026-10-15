/**
 * Workflow Action Guide —— 前置入口
 *
 * 职责（按前端工程约定，前置入口只做轻量判断）：
 * 1. 判断「当前页面是不是流程页」——**不看 URL**，而是看平台有没有给这个页面注入流程上下文
 *    （`getFlowPageSDK().baseStore.baseParam.workflowId`）；
 * 2. 首次命中时异步加载业务模块 `coms/WorkflowActionGuide`（非前置，独立分片）；
 * 3. 模块加载失败时保持页面原样，不抛错、不注入任何节点。
 *
 * 为什么不用 URL 判断：同为流程页，URL 可以是
 * `/sp/workflow/flowpage/view/{requestId}`（经典流程详情），
 * 也可以是 `/sp/ebdfpage/card/…/{requestId}`（e-builder 流程卡片页）；
 * 而 `/sp/workflow/newflow`、`/sp/ebdapp/detail/…/flow/nodeInfo` 这些**不是**流程实例页。
 * 用 `workflowId` 判断与 URL 形态无关，新的流程页面形态会自动覆盖。
 *
 * 悬浮入口的挂载 / 卸载 / 页面变化重渲染全部由业务模块自行处理，
 * 因此入口加载成功后即停止轮询，不再占用定时器。
 */
import { asyncImport } from '@weapp/ecodesdk';

const POLL_INTERVAL = 1000;

let loading = null;

/** 平台是否为当前页面注入了流程上下文。 */
function isWorkflowPage() {
  try {
    const wf = window.weappWorkflow;
    const sdk = wf && typeof wf.getFlowPageSDK === 'function' ? wf.getFlowPageSDK() : null;
    const param = sdk && sdk.baseStore ? sdk.baseStore.baseParam : null;
    return !!(param && String(param.workflowId || '').trim());
  } catch (error) {
    return false;
  }
}

/**
 * 异步加载业务模块并启动。
 * 重要：'${appId}' 是 E10 平台的运行时占位符，平台会自动替换为实际 appId，不要改成字面量。
 */
function ensureLoaded() {
  if (loading || !isWorkflowPage()) return;
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
