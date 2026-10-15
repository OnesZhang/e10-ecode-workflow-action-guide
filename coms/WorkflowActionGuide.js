/**
 * Workflow Action Guide —— 业务模块
 *
 * 在**流程页**右上角挂一个悬浮的 “i” 入口，点开后按当前用户语言说明
 * 「右上角动作按钮」和「更多菜单」里每一项是什么操作。
 *
 * 页面判定：不看 URL，看平台有没有给当前页面注入流程上下文
 * （`getFlowPageSDK().baseStore.baseParam.workflowId`）。这样经典流程详情
 * `/sp/workflow/flowpage/view/{id}` 与 e-builder 流程卡片
 * `/sp/ebdfpage/card/…/{id}` 是同一种页面都能命中，而 `/sp/workflow/newflow`、
 * `/sp/ebdapp/detail/…/flow/nodeInfo` 这类非实例页不会命中。
 *
 * 绑定方式（关键）：动作的稳定标识是平台的 `menutype`（SUBMIT / SAVE_DATA / DELETE …），
 * **不是按钮名称**。名称可以被管理员自定义、也会随界面语言变化，menutype 不变。
 *
 * 数据来源（全部运行时读取，不点击、不提交、不修改平台节点）：
 * 1. 首选官方口子 `window.weappWorkflow.getFlowPageSDK().baseStore.operMenus`
 *    （平台 JS-SDK 文档：查看当前流程下操作按钮清单），字段含
 *    `menutype / title / istop / useable / orderid`；`istop===1` 是右上角按钮，其余进「更多」。
 * 2. 口子不可用时降级：右上角按钮读动作条内 button 文案，
 *    「更多」菜单项读容器内 Menu 组件的 `data-weapp-agent-id` 再走
 *    `__WEAPP_AGENT_BRIDGE__.describe(id)`（不展开菜单），此时按名称匹配。
 *
 * 语言：`weappUtils.getLang()`（实测 `zh_CN`），`zh*` 显示中文名称 + 中文释义，其余显示英文。
 * 面板里显示的名称优先用平台实际标题（改过名就跟着显示改后的名字，与屏幕一致）。
 */

const ROOT_ID = 'wfg-guide-root';
const BAR_SELECTORS = ['.ui-title-right-container', '.ui-title-right', '.ui-title'];
const MENU_SELECTOR = '[data-weapp-agent-id][data-weapp-agent-type="Menu"]';
/** 流程「更多」菜单的 agent id 固定带此后缀，用来反查它所在的动作条。 */
const MORE_MENU_SELECTOR = '[data-weapp-agent-id*="-morebtn_"]';
/** 需要在本应用节点上被拦下的指针事件（避免被平台当成「点击抽屉外部」）。 */
const SWALLOWED_EVENTS = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'click'];
const TICK_INTERVAL = 800;

/**
 * 操作清单与释义：来自《泛微 E10 操作菜单中英对照 A-功能释义》（54 项）。
 * zd = 功能释义（中文），ed = 功能释义（English），zh/en = 清单里的中英文名称（用于降级匹配）。
 */
const ACTIONS = [
  { zh: '批准', en: 'Approve', zd: '审批人同意当前节点的处理意见，流程按预设路径流转至下一节点。', ed: 'Approver accepts the current decision; the workflow advances to the next node along the preset path.' },
  { zh: '提交', en: 'Submit', zd: '节点处理人填写完表单后提交，流程流转到下一处理人或节点。', ed: 'Handler completes and submits the form; the workflow routes to the next assignee or node.' },
  { zh: '提交至退回节点', en: 'Submit to Return Node', zd: '提交时可直接指定回到此前被退回的节点，跳过中间环节重新开始审批。', ed: 'Submit directly to the node where it was previously returned, skipping intermediate nodes.' },
  { zh: '保存', en: 'Save', zd: '暂存当前表单填写内容，不提交、不流转，可稍后继续编辑。', ed: 'Save the form as a draft without submitting or routing; edit it later.' },
  { zh: '删除', en: 'Delete', zd: '删除当前流程单据或其草稿，一般用于未提交/草稿状态，可配合还原使用。', ed: 'Delete the request or its draft; typically allowed before submission and can be restored.' },
  { zh: '退回', en: 'Return', zd: '将流程回退到指定节点或发起人，需填写退回意见，之后可按新路径重新审批。', ed: 'Send the request back to a specified node or the originator with comments for re-approval.' },
  { zh: '明细导入', en: 'Details Import', zd: '将外部 Excel 等数据批量导入表单的明细表。', ed: "Bulk-import external data (e.g. Excel) into the form's detail table." },
  { zh: '明细导出', en: 'Details Export', zd: '将表单明细表中的数据导出为 Excel 等文件。', ed: "Export the form's detail table to Excel or another file." },
  { zh: '强制收回', en: 'Forced to Recall', zd: '流程已流转后强制回收到自己手中重新处理，适用于误提交、选错节点等场景。', ed: 'Force-recall an already routed request back to yourself for re-handling.' },
  { zh: '加签', en: 'Add Node', zd: '审批过程中在当前节点前临时增加审批人，支持单人、多人并行或依次等模式。', ed: 'Insert an extra approver before the current node; supports single, parallel or sequential approvers.' },
  { zh: '加审', en: 'Add Approver', zd: '在当前节点临时增加参与审批的人，不改变节点本身结构。', ed: 'Add an additional approver to the current node without changing the node structure.' },
  { zh: '减审', en: 'Remove Approver', zd: '减少当前节点的审批人员，或撤销临时增加的加审人。', ed: 'Remove an approver from the current node, or revoke a previously added approver.' },
  { zh: '抄送批注', en: 'CC Annotations', zd: '对抄送对象附加说明文字，便于被抄送人了解流程背景。', ed: 'Attach explanatory notes to the CC recipients for context.' },
  { zh: '转发批注', en: 'Forwarding Annotations', zd: '转发流程时附带的批注说明（转发用于知会或跟进，原处理人保留处理权）。', ed: 'Notes attached when forwarding; forwarding is for awareness only and the original handler keeps the task.' },
  { zh: '征询回复', en: 'Reply to Request for Comments', zd: '对被征询人发来的征询作出回复，供处理人决策参考。', ed: "Reply to a consultation raised by others, for the handler's reference." },
  { zh: '批示', en: 'Instruction', zd: '领导对流程事项作出指示性意见，用于指导办理或决策。', ed: 'A leader records directive comments to guide handling or decide the matter.' },
  { zh: '超时干预', en: 'Timeout Intervention', zd: '对超时未处理的节点进行催办、跳转、指定流转等强制干预。', ed: 'Intervene on overdue nodes: remind, skip or reassign the pending task.' },
  { zh: '复制流程', en: 'Copy process', zd: '基于已有流程复制生成一份新流程草稿，表单数据可一并带入。', ed: 'Create a new request by copying an existing one, including its form data.' },
  { zh: '关注', en: 'focus on', zd: '关注某条流程，便于在关注列表中持续跟踪其状态与进度。', ed: 'Follow a request to keep tracking its status in your watchlist.' },
  { zh: '退回申请', en: 'Return Request', zd: '流程已通过或已结束后，申请将流程退回重新审批或调整。', ed: 'Request to return an approved or completed workflow for re-approval or correction.' },
  { zh: '转发', en: 'Forward', zd: '将流程详情转交他人查看或跟进，被转发人一般无审批权，原处理权不变。', ed: 'Pass the request details to others for awareness or follow-up; the original handler retains authority.' },
  { zh: '转发收回', en: 'Recall Forwarding', zd: '收回已转发的流程，被转发人不再可见。', ed: 'Revoke a forwarded request; the recipient loses access.' },
  { zh: '传阅', en: 'Circulate', zd: '将流程信息发给相关人员阅示知会，不改变审批路径。', ed: 'Share the request with relevant people for review; the approval path is unchanged.' },
  { zh: '传阅收回', en: 'Recall Circulation', zd: '收回已发出的传阅，被传阅人不再可见。', ed: 'Revoke a circulated request; recipients lose access.' },
  { zh: '意见征询', en: 'Request for Comment', zd: '处理待办前就事项征求他人意见，征询结果仅作参考。', ed: "Solicit others' opinions before handling a pending task; the feedback is advisory only." },
  { zh: '征询收回', en: 'Withdraw Request for Comments', zd: '撤销已发出的征询，被征询人无需再回复。', ed: 'Withdraw a consultation; no reply is expected from the consulted users.' },
  { zh: '结束征询', en: 'End Request for Comments', zd: '提前结束进行中的征询，不再接收新的回复。', ed: 'Close an open consultation early and stop collecting replies.' },
  { zh: '征询转办', en: 'Transfer Request for Comments', zd: '将已发出的征询转交给他人继续处理或回复。', ed: 'Reassign an open consultation to another person for reply.' },
  { zh: '委托', en: 'Entrust', zd: '出差等无法处理时，将流程处理权委托给他人代为办理。', ed: 'Delegate task-handling rights to another person when unavailable, e.g. on a business trip.' },
  { zh: '委托收回', en: 'Delegate Recall', zd: '收回已委托的流程，被委托人不再代为处理。', ed: 'Revoke a delegation; the delegatee can no longer act on your behalf.' },
  { zh: '转办', en: 'Transfer', zd: '将当前审批工作移交给指定他人办理，处理后通常不再退回原处理人。', ed: 'Hand the current approval task over to another person; it does not return to the original handler.' },
  { zh: '催办', en: 'Urge', zd: '提醒当前未处理人、审批人、发起人、抄送人或指定人尽快处理。', ed: 'Send a reminder to the pending handler, approvers, originator, CCs or selected users.' },
  { zh: '督办', en: 'Supervise', zd: '对重大事项全程跟踪督办，以刚性约束机制保障事项落实。', ed: 'Track and supervise major items end-to-end to ensure execution.' },
  { zh: '消息接收设置', en: 'Message receive settings', zd: '配置流程消息提醒的开关、数据范围与推送渠道（站内信、邮件、微信等）。', ed: 'Configure notification on/off, data scope and delivery channels (in-app, email, IM, etc.).' },
  { zh: '事项分享', en: 'Content sharing', zd: '将当前流程以聊天形式发送给指定人员或群组。', ed: 'Share the request with a person or group via chat.' },
  { zh: '事项群聊', en: 'Content group chat', zd: '一键针对当前流程创建讨论群，便于相关方沟通。', ed: 'Create a group chat for the current request in one click.' },
  { zh: '打印', en: 'Print', zd: '按打印模板（网页、Excel、Word 等）输出流程表单。', ed: 'Print the request form using a web, Excel or Word template.' },
  { zh: '打印日志', en: 'Print Log', zd: '记录并显示流程的打印操作日志，便于审计追溯。', ed: 'Show the print history of the request for audit.' },
  { zh: '抄送', en: 'Email', zd: '将流程抄送给他人知会（邮件/消息抄送）。', ed: 'CC the request to others via email or message for awareness.' },
  { zh: '抄送收回', en: 'CC Recall', zd: '收回已发出的抄送。', ed: 'Revoke a sent CC.' },
  { zh: '复制链接', en: 'Copy Link', zd: '复制当前流程的访问链接，便于分享打开。', ed: 'Copy the direct link to the request for sharing.' },
  { zh: '撤回', en: 'Recall', zd: '在满足条件时将流程回退到上一节点或发起节点，以便调整修改后重新提交。', ed: 'Roll the request back to the previous node or originator for revision and resubmission.' },
  { zh: '超时设置', en: 'Timeout Settings', zd: '为节点自定义处理时限，超时可触发提醒或干预。', ed: 'Set a handling deadline for the node; overdue triggers reminders or intervention.' },
  { zh: '设为待办事项', en: 'Set as', zd: '将指定流程标记为个人待办事项，同步到个人待办列表便于跟进。', ed: 'Flag the request as a personal to-do item synced to your to-do list.' },
  { zh: '启用', en: 'Enabled', zd: '启用被暂停/停用的流程或相关配置。', ed: 'Enable a paused or disabled workflow, or its configuration.' },
  { zh: '恢复', en: 'Restore', zd: '将已删除或异常终止的流程恢复到正常状态，继续流转。', ed: 'Restore a deleted or abnormally terminated workflow so it can continue.' },
  { zh: '帮助', en: 'Help', zd: '查看当前操作的帮助说明与使用指引。', ed: 'Show help and usage guidance for the current operation.' },
  { zh: '流程信息', en: 'Process Information', zd: '查看流程的流转图、节点、处理记录与当前状态，实现全程跟踪。', ed: 'View the flow chart, nodes, action history and current status of the request.' },
  { zh: '追加意见', en: 'Additional Comments', zd: '对已提交或已审批的流程补充意见，无需强制重新填写处理意见。', ed: 'Append comments to a submitted or approved request without rewriting the original opinion.' },
  { zh: '强制结束', en: 'Force to End', zd: '直接中断流程审批，使其直接到达结束节点。', ed: 'Force-terminate the workflow and send it straight to the end node.' },
  { zh: '导入流程', en: 'Import Workflow', zd: '按外部数据源及规则生成流程实例，支持灵活匹配字段值。', ed: 'Create workflow instances from an external data source using configurable field mapping.' },
  { zh: '表单日志', en: 'log', zd: '自动记录表单的修改人、修改时间与修改内容，便于审计。', ed: 'Log who changed which fields, when and how, for audit.' },
  { zh: '修改意见', en: 'Modification comments', zd: '在授权范围内修改其他节点或人员的处理意见。', ed: "Modify another node's or user's submitted comments within granted permissions." },
  { zh: '标记标签', en: 'Mark Tags', zd: '为流程事项添加标签，便于分类、检索与状态识别。', ed: 'Tag the request for classification, search and status identification.' }
];

/**
 * menutype → 清单中文名称（稳定标识，改名不失效）。
 * 前 19 项来自目标页面实测 `getFlowPageSDK().baseStore.operMenus`；
 * AGREE / VERIFY / REJECT / TAKE_BACK / TURNTODO / REMARKADVICE 来自平台
 * 《e10-流程详情前端JS-SDK文档》「常用 menutype」表。
 */
const MENU_TYPES = {
  SUBMIT: '提交',
  SAVE_DATA: '保存',
  DELETE: '删除',
  IMPORT: '复制流程',
  WATCH: '关注',
  FORWARD: '转发',
  REMIND: '催办',
  MESSAGE_SET: '消息接收设置',
  MATTERS_FORWARD: '事项分享',
  MATTERS_GROUP: '事项群聊',
  PRINT: '打印',
  PRINT_LOG: '打印日志',
  COPY_URL: '复制链接',
  SET_AS_TODO: '设为待办事项',
  FLOW_INFO: '流程信息',
  FORM_LOG: '表单日志',
  AGENT: '委托',
  CC: '抄送',
  MARK_TAG: '标记标签',
  AGREE: '批准',
  REJECT: '退回',
  TAKE_BACK: '强制收回',
  TURNTODO: '转办',
  REMARKADVICE: '意见征询'
};

/** 「更多」是菜单展开器，本身没有 menutype，作为结构性条目单独处理。 */
const MORE_OPENER = {
  zh: '更多',
  en: 'More',
  zd: '展开其余操作菜单，下面这个分组就是菜单里的每一项。',
  ed: 'Opens the extra actions menu; every item is listed in the group below.'
};

const I18N = {
  zh: {
    title: '操作说明',
    secTop: '右上角按钮',
    secMore: '「更多」菜单',
    close: '关闭'
  },
  en: {
    title: 'Action Guide',
    secTop: 'Top-right buttons',
    secMore: '"More" menu',
    close: 'Close'
  }
};

const BY_ZH = {};
const BY_EN = {};
ACTIONS.forEach(entry => {
  BY_ZH[entry.zh] = entry;
  BY_EN[entry.en.toLowerCase()] = entry;
});

let root = null;
let panel = null;
let launcher = null;
let closeBtn = null;
let signature = '';
let open = false;
let timer = null;
let onKeyDown = null;
let onDocumentClick = null;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/** 当前界面语言：`zh*` 走中文，其余（含取不到）走英文。 */
function currentLang() {
  try {
    const utils = window.weappUtils;
    const lang = utils && typeof utils.getLang === 'function' ? String(utils.getLang() || '') : '';
    return lang.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
  } catch (error) {
    return 'en';
  }
}

/**
 * 平台是否为当前页面注入了流程上下文（判据与 entry.js 一致）。
 * 不看 URL：经典流程详情 `/sp/workflow/flowpage/*` 与 e-builder 流程卡片
 * `/sp/ebdfpage/card/*` 是同一类页面，而 `/sp/workflow/newflow`、
 * `/sp/ebdapp/detail/…/flow/nodeInfo` 不是。
 */
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

function isVisible(node) {
  if (!node) return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * 动作条容器。
 * 同一个页面上可能同时存在多个 `.ui-title-right-container`（e-builder 页面里嵌的表单、
 * 右滑面板自己都可能有），**按文档顺序取第一个并不等于流程动作条** —— 实测在
 * `/sp/ebdpage/view/…` 上会取到嵌在表单里那排不可见的按钮，入口因此被推到页面中部。
 * 流程「更多」菜单的 agent id 固定带 `-morebtn_` 后缀，用它反查所在动作条最可靠；
 * 反查不到时退化为「第一个含可见按钮的动作条」。
 */
function findBar() {
  const moreMenu = document.querySelector(MORE_MENU_SELECTOR);
  if (isVisible(moreMenu)) {
    const owner = moreMenu.closest('.ui-title-right-container')
      || moreMenu.closest('.ui-title-right')
      || moreMenu.closest('.ui-title');
    if (isVisible(owner)) return owner;
  }
  for (let i = 0; i < BAR_SELECTORS.length; i += 1) {
    const nodes = document.querySelectorAll(BAR_SELECTORS[i]);
    for (let j = 0; j < nodes.length; j += 1) {
      const node = nodes[j];
      if (!isVisible(node)) continue;
      const buttons = node.querySelectorAll('button');
      for (let k = 0; k < buttons.length; k += 1) {
        const button = buttons[k];
        if (isVisible(button) && getComputedStyle(button).visibility !== 'hidden') return node;
      }
    }
  }
  return null;
}

/** 平台官方口子：当前流程的操作按钮清单（含稳定标识 menutype）。 */
function readOperMenus() {
  try {
    const wf = window.weappWorkflow;
    const sdk = wf && typeof wf.getFlowPageSDK === 'function' ? wf.getFlowPageSDK() : null;
    const list = sdk && sdk.baseStore ? sdk.baseStore.operMenus : null;
    return Array.isArray(list) ? list : null;
  } catch (error) {
    return null;
  }
}

/** 降级方案：直接读「更多」菜单项文案（走 Agent Bridge，不展开菜单）。 */
function readMenuLabels(wrap) {
  const id = wrap && wrap.getAttribute('data-weapp-agent-id');
  const bridge = window.__WEAPP_AGENT_BRIDGE__;
  if (!id || !bridge || typeof bridge.describe !== 'function') return [];
  let desc;
  try {
    desc = bridge.describe(id);
  } catch (error) {
    return [];
  }
  const items = desc && desc.state && desc.state.items;
  if (!Array.isArray(items)) return [];
  return items.map(item => String((item && item.label) || '').trim()).filter(Boolean);
}

/** 读取当前页面真实的动作清单；没有动作容器时返回 null。 */
function detect() {
  const bar = findBar();
  if (!bar) return null;

  const menuWrap = bar.querySelector(MENU_SELECTOR);
  const moreTitle = menuWrap && menuWrap.querySelector('button') ? (menuWrap.querySelector('button').textContent || '').trim() : '';
  const topItems = [];
  const moreItems = [];

  const ops = readOperMenus();
  if (ops) {
    ops.forEach(op => {
      if (!op || op.useable === 0) return;
      const item = { title: String(op.title || '').trim(), menutype: String(op.menutype || '') };
      if (op.istop === 1) topItems.push(item);
      else moreItems.push(item);
    });
  } else {
    // 口子不可用时按屏幕文案降级：菜单展开器的那个 button 不计入右上角动作
    const buttons = bar.querySelectorAll('button');
    for (let i = 0; i < buttons.length; i += 1) {
      if (buttons[i].closest(MENU_SELECTOR)) continue;
      const label = (buttons[i].textContent || '').trim();
      if (label) topItems.push({ title: label, menutype: '' });
    }
    const menus = bar.querySelectorAll(MENU_SELECTOR);
    let labels = [];
    for (let i = 0; i < menus.length; i += 1) {
      const found = readMenuLabels(menus[i]);
      if (found.length > labels.length) labels = found;
    }
    labels.forEach(label => moreItems.push({ title: label, menutype: '' }));
  }

  return { topItems: topItems, moreItems: moreItems, hasMore: !!menuWrap, moreTitle: moreTitle };
}

/** menutype 优先，其次按名称（中文/英文）匹配到清单条目。 */
function entryFor(item) {
  if (item.menutype && MENU_TYPES[item.menutype] && BY_ZH[MENU_TYPES[item.menutype]]) {
    return BY_ZH[MENU_TYPES[item.menutype]];
  }
  const title = String(item.title || '').trim();
  if (BY_ZH[title]) return BY_ZH[title];
  const lower = title.toLowerCase();
  if (BY_EN[lower]) return BY_EN[lower];
  return null;
}

/** 生成的每一行：名称优先用平台实际标题（改名后与屏幕一致），释义按语言取。 */
function toRows(items, lang) {
  const rows = [];
  const seen = {};
  for (let i = 0; i < items.length; i += 1) {
    const entry = entryFor(items[i]);
    if (!entry || seen[entry.zh]) continue;
    seen[entry.zh] = true;
    rows.push({
      label: items[i].title || (lang === 'zh' ? entry.zh : entry.en),
      desc: lang === 'zh' ? entry.zd : entry.ed
    });
  }
  return rows;
}

function buildSection(title, rows) {
  if (!rows.length) return null;
  const sec = el('div', 'wfg-sec');
  sec.appendChild(el('div', 'wfg-sec-title', title));
  for (let i = 0; i < rows.length; i += 1) {
    const row = el('div', 'wfg-row');
    const main = el('div', 'wfg-main');
    main.appendChild(el('div', 'wfg-name', rows[i].label));
    main.appendChild(el('div', 'wfg-desc', rows[i].desc));
    row.appendChild(main);
    sec.appendChild(row);
  }
  return sec;
}

function setOpen(next) {
  open = next;
  if (panel) panel.style.display = next ? 'flex' : 'none';
  if (root) root.className = 'wfg-root' + (next ? ' wfg-open' : '');
}

/**
 * 按动作条里按钮的实际底边定位入口。
 * 不同页面顶部结构不一样（有的上面还有「第 N 条(共 M 条)」条幅），工具条高度会变；
 * 而且容器自身带内边距（实测容器底部比按钮低 13px），贴容器会让入口显得偏下，
 * 所以取按钮的真实底边 + 8，并在每次 tick 校正一次。
 */
function place() {
  if (!root || !launcher || !panel) return;
  const bar = findBar();
  let bottom = 0;
  let right = 16;
  if (bar) {
    const barRect = bar.getBoundingClientRect();
    const buttons = bar.querySelectorAll('button');
    for (let i = 0; i < buttons.length; i += 1) {
      const rect = buttons[i].getBoundingClientRect();
      if (rect.height > 0 && rect.bottom > bottom) bottom = rect.bottom;
    }
    if (!bottom) bottom = barRect.bottom;
    // 横向也要贴动作条：流程表单可能落在「居中弹窗 / 右侧抽屉」里（实测
    // /sp/ebdapp/build/…?openSource=create 是居中弹窗，动作条右边缘离视口右边缘 677px），
    // 固定 right:16px 会让入口飘到页面最右侧，看起来和流程表单没关系。
    if (barRect.width > 0) right = Math.max(8, Math.round(window.innerWidth - barRect.right));
  }
  const top = bottom > 0 ? Math.round(bottom + 8) : 52;
  launcher.style.top = top + 'px';
  launcher.style.right = right + 'px';
  panel.style.top = (top + 36) + 'px';
  panel.style.right = right + 'px';
}

/** 只清理本模块注入的 DOM，监听器与定时器在页面生命周期内保留，用于跟随路由变化。 */
function clearDom() {
  if (root && root.parentNode) root.parentNode.removeChild(root);
  root = null;
  panel = null;
  launcher = null;
  closeBtn = null;
  signature = '';
  open = false;
}

/**
 * 落在本应用节点上的指针事件：交给自己处理，并在最外层（window 捕获）拦下，不让平台看见。
 *
 * 为什么必须拦：流程表单可能是从右侧滑出的抽屉/弹窗（实测 `.ui-dialog-wrap-right`），
 * 平台把「点击抽屉之外」当作关闭动作。本应用的节点挂在 body 上，点自己的入口会被判成
 * 「点了外面」，于是抽屉连同正在看的流程一起被关掉。
 *
 * 为什么在 window 捕获阶段：捕获顺序是 window → document → … → target，
 * 挂在 window 上比平台任何 document/元素级监听都早，且 `stopPropagation()` 不影响浏览器
 * 默认行为（滚动、选中、滚动条拖动照常）。
 */
function onWindowCapture(event) {
  if (!root || !root.contains(event.target)) return;
  event.stopPropagation();
  if (event.type !== 'click') return;
  if (launcher && launcher.contains(event.target)) {
    setOpen(!open);
    if (typeof launcher.focus === 'function') launcher.focus();
    return;
  }
  if (closeBtn && closeBtn.contains(event.target)) {
    setOpen(false);
    return;
  }
  // 面板内部的其它点击：保持展开即可
}

function render(topRows, moreRows, text) {
  root = el('div', 'wfg-root');
  root.id = ROOT_ID;

  launcher = el('button', 'wfg-launcher');
  launcher.type = 'button';
  launcher.title = text.title;
  launcher.setAttribute('aria-label', text.title);
  launcher.appendChild(el('span', 'wfg-launcher-icon', 'i'));
  launcher.appendChild(el('span', 'wfg-launcher-text', text.title));

  panel = el('div', 'wfg-panel');
  const head = el('div', 'wfg-head');
  const headText = el('div', 'wfg-head-text');
  headText.appendChild(el('div', 'wfg-title', text.title));
  head.appendChild(headText);
  closeBtn = el('button', 'wfg-close', '\u2715');
  closeBtn.type = 'button';
  closeBtn.title = text.close;
  closeBtn.setAttribute('aria-label', text.close);
  head.appendChild(closeBtn);
  panel.appendChild(head);

  const body = el('div', 'wfg-body');
  const sections = [buildSection(text.secTop, topRows), buildSection(text.secMore, moreRows)];
  for (let i = 0; i < sections.length; i += 1) {
    if (sections[i]) body.appendChild(sections[i]);
  }
  panel.appendChild(body);

  root.appendChild(launcher);
  root.appendChild(panel);
  document.body.appendChild(root);
  setOpen(false);
  place();
}

/** 页面变化（路由、动作条重建、语言切换）时重新检测；内容无变化则不动 DOM。 */
function tick() {
  // 平台在页面初始化/重渲染时可能整块替换节点，先做自愈，避免“入口消失后不再回来”
  if (root && !document.body.contains(root)) clearDom();
  if (!isWorkflowPage()) {
    if (root) clearDom();
    return;
  }

  const actions = detect();
  if (!actions) {
    if (root) clearDom();
    return;
  }

  const lang = currentLang();
  const next = lang
    + '#' + actions.topItems.map(i => i.menutype || i.title).join(',')
    + '#' + actions.moreItems.map(i => i.menutype || i.title).join(',');
  if (root && next === signature) {
    // 内容没变也要校正位置：顶部条幅/工具条高度可能变化
    place();
    return;
  }

  const wasOpen = open;
  clearDom();

  const topRows = toRows(actions.topItems, lang);
  const moreRows = toRows(actions.moreItems, lang);
  if (actions.hasMore) {
    const opener = lang === 'zh' ? MORE_OPENER.zh : MORE_OPENER.en;
    topRows.push({
      label: actions.moreTitle || opener,
      desc: lang === 'zh' ? MORE_OPENER.zd : MORE_OPENER.ed
    });
  }
  if (!topRows.length && !moreRows.length) return;

  signature = next;
  render(topRows, moreRows, I18N[lang]);
  if (wasOpen) setOpen(true);
}

/** 业务模块入口：由 entry.js 在命中 `/sp/workflow/` 后调用，只初始化一次。 */
export default function bootstrap() {
  if (window.__WFG_GUIDE_BOOTED__) return;
  window.__WFG_GUIDE_BOOTED__ = true;

  onKeyDown = event => {
    if (event.key === 'Escape' && open) setOpen(false);
  };
  onDocumentClick = () => {
    if (open) setOpen(false);
  };
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('click', onDocumentClick, true);
  for (let i = 0; i < SWALLOWED_EVENTS.length; i += 1) {
    window.addEventListener(SWALLOWED_EVENTS[i], onWindowCapture, true);
  }

  timer = window.setInterval(tick, TICK_INTERVAL);
  tick();
}
