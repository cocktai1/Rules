/**
 * AI 专用节点深度测活 (主动发包打标版)
 * 特性：包含 Cloudflare 盾精准识别修复。
 * 行为：只为成功解锁的节点添加 AI 前缀，失败的节点原样保留，绝不删除任何节点。
 * 环境：仅支持 Surge / Loon 运行环境。
 */

async function operator(proxies = [], targetPlatform, context) {
  const $ = typeof $substore !== 'undefined' ? $substore : undefined;
  if (!$) throw new Error('当前环境不支持 $substore 对象');
  
  const { isLoon, isSurge } = $.env;
  if (!isLoon && !isSurge) throw new Error('AI 主动检测仅支持 Loon 和 Surge (需 http-client-policy 能力)');

  // ========== 1. 配置区 ==========
  const PREFIX = "✨ AI | "; 
  const TIMEOUT = 4000; // 超时时间：4秒
  const CONCURRENCY = 8; // 并发数，不要太高
  const URL = `https://ios.chat.openai.com`; // 风控最严接口
  
  // 高危地区与安全协议配置
  const HIGH_RISK_REGIONS = /(港|HK|Hong|深|广|京|沪|中|China|CN|Macau|门|俄|Russia|RU|伊朗|Iran)/i;
  const INHERENT_TLS_TYPES = new Set(['trojan', 'hysteria', 'hysteria2', 'tuic']);

  const target = isLoon ? 'Loon' : isSurge ? 'Surge' : undefined;
  
  // 这里用来存放真正需要去发起 HTTP 测速的任务队列
  const tasks = [];
  
  // ========== 2. 静态预判与任务收集 ==========
  for (let proxy of proxies) {
    let type = (proxy.type || '').toLowerCase();
    let name = (proxy.name || '').trim();

    // 如果是高危地区，直接跳过测速（保留原样，不打 AI 标签）
    if (HIGH_RISK_REGIONS.test(name)) continue;

    // 强制 TLS 校验
    let isSecure = false;
    if (INHERENT_TLS_TYPES.has(type)) {
      isSecure = true;
    } else if (type === 'vless' || type === 'vmess') {
      let hasTLS = proxy.tls === true || proxy.tls === 'true' || proxy.tls === 1;
      let hasReality = !!(proxy['reality-opts'] || (proxy.flow && /reality/i.test(proxy.flow)));
      if (hasTLS || hasReality) isSecure = true;
    }
    
    // 只有协议安全的节点，才配去敲 OpenAI 的大门
    if (isSecure) {
      tasks.push(() => checkNode(proxy));
    }
  }

  // ========== 3. HTTP 动态检测核心 ==========
  async function checkNode(proxy) {
    try {
      const node = ProxyUtils.produce([proxy], target);
      if (!node) return;

      const startedAt = Date.now();
      
      // 发起请求
      const res = await $.http.get({
        url: URL,
        timeout: TIMEOUT,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1',
        },
        'policy-descriptor': node,
        node: node,
      });

      const status = parseInt(res.status ?? res.statusCode ?? 200);
      let bodyStr = String(res.body ?? res.rawBody);

      // 核心判断逻辑修复：严防 Cloudflare 假阳性
      if (status === 403) {
        // 1. 如果返回体里包含明显的 HTML 标签或 CF 特征，说明被拦截，抛弃
        if (/<html/i.test(bodyStr) || /cloudflare|cf-ray/i.test(bodyStr)) {
          throw new Error("被 Cloudflare 拦截");
        }
        
        // 2. 如果包含明确的地区不支持提示，说明 IP 被封锁，抛弃
        if (/unsupported_country/i.test(bodyStr)) {
          throw new Error("地区不支持");
        }

        // 3. 排除以上情况后，才是真正能用来跑 AI 的节点
        const latency = Date.now() - startedAt;
        
        // 清理原名字中可能存在的过长垃圾信息，并加上前缀
        let cleanName = proxy.name.replace(/剩余|到期|流量|[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/g, '').trim();
        proxy.name = `${PREFIX}${cleanName}`;
        proxy._ai_latency = latency;
        proxy._gpt = true; // 保留原生字段兼容性
        
        $.info(`[AI 解锁成功] ${proxy.name} | 延迟: ${latency}ms`);
        
      } else if (status !== 200) {
        throw new Error(`异常状态码: ${status}`);
      }
    } catch (e) {
      // 测速失败或超时，什么都不做，让原节点保持原样默默留在数组里
      // 注释掉了 error 日志，避免满屏报错影响查看
      // $.error(`[AI 检测未通过] ${proxy.name} - ${e.message ?? e}`);
    }
  }

  // 并发执行队列
  await executeAsyncTasks(tasks, { concurrency: CONCURRENCY });

  // ★★★ 核心改变：直接返回包含所有节点（部分被打标、部分保持原样）的总数组 ★★★
  return proxies;

  // ========== 辅助并发控制函数 ==========
  function executeAsyncTasks(tasks, { concurrency = 1 } = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        let running = 0;
        let index = 0;

        function executeNextTask() {
          while (index < tasks.length && running < concurrency) {
            const taskIndex = index++;
            const currentTask = tasks[taskIndex];
            running++;

            currentTask()
              .catch(() => {}) // 忽略单任务报错
              .finally(() => {
                running--;
                executeNextTask();
              });
          }

          if (running === 0 && index === tasks.length) {
            resolve();
          }
        }
        executeNextTask();
      } catch (e) {
        reject(e);
      }
    });
  }
}
