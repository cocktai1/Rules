/**
 * AI 专用节点深度测速筛选 (主动发包版)
 * 结合静态强规则与动态 HTTP 连通性测试。
 * 仅支持 Surge / Loon 运行环境。
 */

async function operator(proxies = [], targetPlatform, context) {
  const $ = typeof $substore !== 'undefined' ? $substore : undefined;
  if (!$) throw new Error('当前环境不支持 $substore 对象');
  
  const { isLoon, isSurge } = $.env;
  if (!isLoon && !isSurge) throw new Error('AI 主动检测仅支持 Loon 和 Surge (需 http-client-policy 能力)');

  // ========== 1. 配置区 ==========
  const PREFIX = "✨ AI | "; 
  const TIMEOUT = 4000; // 超时时间：4秒足以判断节点质量
  const CONCURRENCY = 8; // 并发数：建议 8-10，太高容易被宿主 App 杀掉
  const URL = `https://ios.chat.openai.com`; // 业界公认风控最严接口
  
  // 高危地区与安全协议配置
  const HIGH_RISK_REGIONS = /(港|HK|Hong|深|广|京|沪|中|China|CN|Macau|门|俄|Russia|RU|伊朗|Iran)/i;
  const INHERENT_TLS_TYPES = new Set(['trojan', 'hysteria', 'hysteria2', 'tuic']);

  // ========== 2. 第一阶段：极速静态预过滤 ==========
  // 目的：把明显不行（无 TLS、高危地区）的节点先剔除，不浪费 HTTP 请求资源
  const candidates = [];
  
  for (let p of proxies) {
    let type = (p.type || '').toLowerCase();
    let name = (p.name || '').trim();

    // 剔除高危地区
    if (HIGH_RISK_REGIONS.test(name)) continue;

    // 强制 TLS 校验
    let isSecure = false;
    if (INHERENT_TLS_TYPES.has(type)) {
      isSecure = true;
    } else if (type === 'vless' || type === 'vmess') {
      let hasTLS = p.tls === true || p.tls === 'true' || p.tls === 1;
      let hasReality = !!(p['reality-opts'] || (p.flow && /reality/i.test(p.flow)));
      if (hasTLS || hasReality) isSecure = true;
    }
    
    // 只有安全的节点才进入候选名单
    if (isSecure) {
      candidates.push(p);
    }
  }

  // ========== 3. 第二阶段：HTTP 动态检测 ==========
  const target = isLoon ? 'Loon' : isSurge ? 'Surge' : undefined;
  const validAIProxies = []; // 最终输出的优选节点

  async function checkNode(proxy) {
    try {
      const node = ProxyUtils.produce([proxy], target);
      if (!node) return;

      const startedAt = Date.now();
      
      // 发起带策略的 HTTP 请求
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
      let msg = "";
      
      try {
        let bodyJson = JSON.parse(bodyStr);
        msg = bodyJson?.error?.code || bodyJson?.error?.error_type || bodyJson?.cf_details || "";
      } catch (e) {}

      // 核心判断逻辑：
      // 如果是被 CF 拦截，通常是 400 或响应包含特定错误。
      // 403 并且没有提示 unsupported_country，说明成功通过了最外层盾，走到未鉴权逻辑，证明 IP 干净。
      if (status === 403 && !/unsupported_country/i.test(msg)) {
        const latency = Date.now() - startedAt;
        
        // 清理原名字中可能存在的过长垃圾信息，并加上前缀
        let cleanName = proxy.name.replace(/剩余|到期|流量|[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/g, '').trim();
        proxy.name = `${PREFIX}${cleanName}`;
        proxy._ai_latency = latency;
        
        validAIProxies.push(proxy); // 测速成功，放入最终数组
        $.info(`[AI 解锁成功] ${proxy.name} | 延迟: ${latency}ms`);
      }
    } catch (e) {
      // 超时或连接失败，直接丢弃该节点
      $.error(`[AI 检测失败] ${proxy.name} - ${e.message ?? e}`);
    }
  }

  // 并发执行队列
  await executeAsyncTasks(
    candidates.map(proxy => () => checkNode(proxy)),
    { concurrency: CONCURRENCY }
  );

  // 只返回通过了双重校验（TLS + 连通性）的节点
  return validAIProxies;

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
