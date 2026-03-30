/**
 * AI 节点标识标注
 */

// 注意：这里必须是小写的 async
async function operator(proxies = [], targetPlatform, context) {
  const $ = typeof $substore !== 'undefined' ? $substore : undefined;
  if (!$) throw new Error('当前环境不支持 $substore 对象');
  
  const { isLoon, isSurge } = $.env;
  if (!isLoon && !isSurge) throw new Error('AI 主动检测仅支持 Loon 和 Surge');

  // ========== 1. 参数配置区 (支持读取你在链接 # 后面加的参数) ==========
  const args = typeof $arguments !== 'undefined' ? $arguments : {};
  
  const PREFIX = "✨ AI | "; 
  const TIMEOUT = parseFloat(args.timeout || 4000); // 优先读取后缀参数，没写就默认 4000
  const CONCURRENCY = parseInt(args.concurrency || 8); // 优先读取后缀参数
  const URL = decodeURIComponent(args.url || 'https://ios.chat.openai.com');
  const METHOD = (args.method || 'get').toLowerCase();
  
  // 高危地区与安全协议配置
  const HIGH_RISK_REGIONS = /(港|HK|Hong|深|广|京|沪|中|China|CN|Macau|门|俄|Russia|RU|伊朗|Iran)/i;
  const INHERENT_TLS_TYPES = new Set(['trojan', 'hysteria', 'hysteria2', 'tuic']);

  const target = isLoon ? 'Loon' : isSurge ? 'Surge' : undefined;
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
    
    // 只有协议安全的节点，才配去测试
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
      
      // 发起请求 (动态使用 method 和 url)
      const res = await $.http[METHOD]({
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
          return; // 被墙了，直接退出这个节点的测试，保留原样
        }
        
        // 2. 如果包含明确的地区不支持提示，说明 IP 被封锁，抛弃
        if (/unsupported_country/i.test(bodyStr)) {
          return; // 地区不支持，退出
        }

        // 3. 排除以上情况后，进行打标
        const latency = Date.now() - startedAt;
        
        // 清理原名字中可能存在的过长垃圾信息，并加上前缀
        let cleanName = proxy.name.replace(/剩余|到期|流量|[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/g, '').trim();
        proxy.name = `${PREFIX}${cleanName}`;
        proxy._ai_latency = latency;
        proxy._gpt = true; 
        
      }
    } catch (e) {
      // 报错或超时了 -> 默默 catch 掉，什么都不做，让原节点保持原样
    }
  }

  // 并发执行队列
  await executeAsyncTasks(tasks, { concurrency: CONCURRENCY });

  // ★★★ 核心机制：强制返回最开始传入的全部节点，绝不漏掉一个 ★★★
  return proxies;

  // ========== 辅助并发控制函数 ==========
  function executeAsyncTasks(tasks, { concurrency = 1 } = {}) {
    return new Promise((resolve) => {
      let running = 0;
      let index = 0;

      function executeNextTask() {
        while (index < tasks.length && running < concurrency) {
          const currentTask = tasks[index++];
          running++;
          currentTask()
            .catch(() => {})
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
    });
  }
}
