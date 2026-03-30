/**
 * Smart-Node-Engine (智能节点调度引擎)
 * 核心特性：延迟 Produce、动态 Worker 池、TTL 生命周期管理、自动延迟排序
 */

async function operator(proxies = [], targetPlatform, env) {
  const $ = typeof $substore !== 'undefined' ? $substore : undefined;
  if (!$) throw new Error('当前环境不支持 $substore');
  const { isLoon, isSurge } = $.env;
  if (!isLoon && !isSurge) throw new Error('仅支持 Loon 和 Surge (需 http-client-policy 能力)');

  // ========== 1. 引擎配置与环境提取 ==========
  const args = typeof $arguments !== 'undefined' ? $arguments : {};
  const CONFIG = {
    method: (args.method || 'head').toLowerCase(),
    validStatus: new RegExp(args.status || '204'),
    url: decodeURIComponent(args.url || 'http://connectivitycheck.platform.hicloud.com/generate_204'),
    ua: decodeURIComponent(args.ua || 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1'),
    timeout: parseFloat(args.timeout || 4000), // 超时缩短至4秒，快速失败
    showLatency: args.show_latency !== false,
    cacheEnabled: args.cache !== false,
    ttlSuccess: 10 * 60 * 1000, // 成功节点缓存 10 分钟
    ttlFail: 2 * 60 * 1000,     // 失败节点缓存 2 分钟
    tgChatId: args.telegram_chat_id,
    tgBotToken: args.telegram_bot_token
  };

  const target = isLoon ? 'Loon' : isSurge ? 'Surge' : undefined;
  const cache = typeof scriptResourceCache !== 'undefined' ? scriptResourceCache : new Map();
  const httpMethod = $.http[CONFIG.method]; // 提前绑定，减少动态查找

  // 获取订阅名用于播报
  let subName = env?.source?._collection?.displayName || env?.source?._collection?.name || '未命名订阅';
  if (!env?.source?._collection) {
    for (const [key, value] of Object.entries(env.source || {})) {
      if (!key.startsWith('_')) { subName = value.displayName || value.name; break; }
    }
  }

  // ========== 2. 核心检测与缓存逻辑 ==========
  async function processNode(proxy) {
    // 构造超短 Cache ID 降低 GC 压力
    let authStr = (proxy.uuid || proxy.password || proxy['auth-str'] || proxy.pass || '').slice(0, 8);
    let cacheId = CONFIG.cacheEnabled ? `ping:${proxy.server}:${proxy.port}:${proxy.type}:${authStr}` : null;
    let now = Date.now();

    // 1. 极速缓存拦截 (跳过 produce)
    if (CONFIG.cacheEnabled) {
      const cached = cache.get(cacheId);
      if (cached && (now - cached.time < cached.ttl)) {
        proxy._status = cached.status;
        if (cached.status === 'valid') {
          proxy._latency = cached.latency;
          if (CONFIG.showLatency) proxy.name = `[${cached.latency}ms] ${proxy.name}`;
        }
        return;
      }
    }

    // 2. 缓存未命中，开始产生节点 (延迟 Produce)
    let node;
    try {
      node = ProxyUtils.produce([proxy], target);
      if (!node) {
        proxy._status = 'incompatible';
        return;
      }
    } catch (e) {
      proxy._status = 'incompatible';
      return;
    }

    // 3. 发起真实网络探测
    try {
      const res = await httpMethod({
        url: CONFIG.url,
        headers: { 'User-Agent': CONFIG.ua },
        'policy-descriptor': node,
        node: node,
        timeout: CONFIG.timeout
      });

      const status = parseInt(res.status || res.statusCode || 200);
      if (CONFIG.validStatus.test(status)) {
        const latency = Date.now() - now; // 保持 Number 类型，用于后续排序
        proxy._status = 'valid';
        proxy._latency = latency;
        if (CONFIG.showLatency) proxy.name = `[${latency}ms] ${proxy.name}`;
        
        if (CONFIG.cacheEnabled) {
          cache.set(cacheId, { status: 'valid', latency, time: now, ttl: CONFIG.ttlSuccess });
        }
      } else {
        throw new Error('Status mismatch');
      }
    } catch (e) {
      proxy._status = 'fail';
      if (CONFIG.cacheEnabled) {
        cache.set(cacheId, { status: 'fail', time: now, ttl: CONFIG.ttlFail });
      }
    }
  }

  // ========== 3. 高性能 Worker 调度模型 ==========
  let taskIndex = 0;
  async function worker() {
    while (taskIndex < proxies.length) {
      let currentIndex = taskIndex++;
      await processNode(proxies[currentIndex]);
    }
  }

  // 动态并发计算：最小 5，最大 20。随节点数量动态扩展
  const concurrency = Math.min(20, Math.max(5, Math.floor(proxies.length / 5)));
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  // ========== 4. 数据归类与智能排序 (调度引擎核心) ==========
  const validProxies = [];
  const failedProxies = [];

  for (let i = 0; i < proxies.length; i++) {
    let p = proxies[i];
    if (p._status === 'valid') {
      validProxies.push(p);
    } else if (p._status === 'fail') {
      failedProxies.push(p);
    }
  }

  // 按延迟从小到大排序，最快节点永远在最上面
  validProxies.sort((a, b) => (a._latency || 9999) - (b._latency || 9999));

  // ========== 5. 安全的 Telegram 播报 ==========
  if (CONFIG.tgChatId && CONFIG.tgBotToken && failedProxies.length > 0) {
    try {
      // 使用 HTML 转义，彻底解决 MarkdownV2 特殊符号导致发送失败的问题
      const safeSubName = subName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      let text = `<b>${safeSubName}</b> 节点测试失败名单:\n`;
      text += failedProxies.map(p => {
        let safeName = (p.name || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `❌ [${p.type}] <code>${safeName}</code>`;
      }).join('\n');

      // 如果字符过长，截断防报错
      if (text.length > 3500) text = text.substring(0, 3500) + '\n... (省略过多失败节点)';

      await $.http.post({
        url: `https://api.telegram.org/bot${CONFIG.tgBotToken}/sendMessage`,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: CONFIG.tgChatId, text, parse_mode: 'HTML' }),
        timeout: 5000
      });
    } catch (e) {
      $.error('Telegram 播报发送失败: ' + e);
    }
  }

  return validProxies;
}
