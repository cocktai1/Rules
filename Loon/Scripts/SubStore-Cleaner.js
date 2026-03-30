/**
 * SubStore-Cleaner-Ultra v5.0 (终极性能与高兼容版)
 * 集成了大数组预分配、跨层 API 缓存、高频探测前置与协议容错机制。
 */

function operator(proxies, targetPlatform) {
  // ========== 1. 静态配置与环境 ==========
  const CONFIG = {
    maxNameLen: 60,
    adKeywords: ['官网', '群', '流量', '到期', '重置', '订阅', '机场', '网址', '客服', '购买', '更新', '通知', '公告', '续费', '过期', '剩余', '套餐', '教程', '邀请', '签到', '试用', 'tg群', 'telegram', '频道', 'channel', '联系', '防失联', '备用', 'app下载', '获取', 'expire', 'traffic', 'remaining']
  };
  
  const isLoon = (typeof $loon !== 'undefined') || (typeof $substore !== 'undefined' && $substore.env && $substore.env.isLoon);
  const hasGetFlag = typeof ProxyUtils !== 'undefined' && typeof ProxyUtils.getFlag === 'function';

  // 使用 Set 提升查询速度
  const SAFE_TYPES = new Set(['vmess', 'vless', 'trojan', 'ss', 'shadowsocks', 'ssr', 'hysteria', 'hysteria2', 'tuic', 'snell', 'wireguard']);
  const LOON_UNSUPPORTED = new Set(['wireguard', 'ssr']);
  const LOON_TRANSPORTS = new Set(['tcp', 'ws', 'http', 'h2', 'grpc', '']);
  const LOON_VMESS_CIPHERS = new Set(['auto', 'aes-128-gcm', 'chacha20-poly1305', 'none', '']);
  const UNSAFE_VMESS_CIPHERS = new Set(['none', 'rc4', 'rc4-md5']);
  const UNSAFE_SS_CIPHERS = new Set(['none', 'plain', 'table', 'rc4', 'rc4-md5', 'rc4-md5-6', 'aes-128-cfb', 'aes-192-cfb', 'aes-256-cfb', 'aes-128-ctr', 'aes-192-ctr', 'aes-256-ctr', 'bf-cfb', 'camellia-128-cfb', 'camellia-192-cfb', 'camellia-256-cfb', 'des-cfb', 'idea-cfb', 'seed-cfb', 'salsa20', 'chacha20']);
  const BLOCKED_PORTS = new Set([21, 22, 23, 25, 53, 135, 139, 445, 3389]);
  const SS_TYPES = new Set(['ss', 'shadowsocks', 'ssr']);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const PRIVATE_IP_RE = /^(127\.|0\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|224\.|240\.|255\.255\.255\.255|fc|fd|fe80|::1$|localhost)/i;
  const FLAG_RE = /[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/;
  const AD_RE = new RegExp(CONFIG.adKeywords.join('|'), 'i');

  // ========== 2. 内存预分配与缓存 ==========
  const total = proxies.length;
  const result = new Array(total); // 预分配数组，避免 push 扩容开销
  let resultIdx = 0;
  
  const seen = new Set();
  const flagCache = new Map(); // 缓存国家旗帜查询结果

  // ========== 3. 高效清洗与兼容管道 ==========
  for (let i = 0; i < total; i++) {
    let p = proxies[i];
    
    // 基础属性解构与缓存
    let type = (p.type || '').toLowerCase();
    let server = (p.server || '').trim();
    let port = Number(p.port);

    // [Tier 1: 极速过滤] - 最快暴露问题的条件放最前
    if (!server || !port || port < 1 || port > 65535 || BLOCKED_PORTS.has(port)) continue;
    if (!SAFE_TYPES.has(type) || (isLoon && LOON_UNSUPPORTED.has(type))) continue;
    
    let serverLower = server.toLowerCase(); // 缓存转小写结果
    if (PRIVATE_IP_RE.test(serverLower)) continue;

    // [Tier 2: 较慢的正则过滤]
    let name = (p.name || '').trim();
    if (name.length > CONFIG.maxNameLen || AD_RE.test(name)) continue;

    // 协议与网络属性
    let cipher = (p.cipher || p.method || '').toLowerCase();
    let network = (p.network || p.type2 || '').toLowerCase();
    let authStr = p.uuid || p.password || p.pass || p['auth-str'] || p.auth || '';

    // [Tier 3: 协议安全性与完整性检查]
    // 依据出现概率排序：vmess / vless / trojan / ss 放前
    if (type === 'vmess') {
      if (!UUID_RE.test(authStr)) continue;
      if (UNSAFE_VMESS_CIPHERS.has(cipher)) continue;
      if (p.alterId === undefined) p.alterId = 0; // 自动兼容：补充 alterId
      if (isLoon && (!LOON_VMESS_CIPHERS.has(cipher) || !LOON_TRANSPORTS.has(network) || isNaN(Number(p.alterId)))) continue;
    } 
    else if (type === 'vless') {
      if (!UUID_RE.test(authStr)) continue;
      if (p.tls === undefined) p.tls = true; // 自动兼容：缺失 tls 默认补全
      let hasTLS = p.tls === true || p.tls === 'true' || p.tls === 1;
      let hasReality = !!(p['reality-opts'] || (p.flow && /reality/i.test(p.flow)));
      if (!hasTLS && !hasReality) continue;
      if (isLoon && (!LOON_TRANSPORTS.has(network) || (hasTLS && !p.sni && !p.servername))) continue;
    } 
    else if (type === 'trojan') {
      if (!authStr || p.tls === false) continue;
      if (isLoon && !LOON_TRANSPORTS.has(network)) continue;
      p['skip-cert-verify'] = true; // 仅对 Trojan 开启跳过证书验证
    } 
    else if (SS_TYPES.has(type)) {
      if (UNSAFE_SS_CIPHERS.has(cipher) || !cipher || (!authStr && authStr !== 0)) continue;
      p.udp = true; // 仅对 SS 类显式开启 UDP
    } 
    else if (type === 'hysteria2' || type === 'hysteria') {
      if (!authStr) continue;
      if (type === 'hysteria' && isLoon) continue; 
      p.udp = true;
      p['skip-cert-verify'] = true;
    } 
    else if (type === 'tuic') {
      if (!UUID_RE.test(p.uuid || '') || (!p.password && p.password !== 0)) continue;
      p.udp = true;
    }

    // [Tier 4: 精准去重] - 加入 authStr 防止误杀负载均衡节点
    let uniqueKey = serverLower + ':' + port + ':' + type + ':' + authStr;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);

    // [Tier 5: 旗帜获取与缓存提速]
    if (hasGetFlag && !FLAG_RE.test(name)) {
      let flag = flagCache.get(name);
      if (flag === undefined) {
        try { 
          flag = ProxyUtils.getFlag(name) || ""; 
        } catch (e) { 
          flag = ""; 
        }
        flagCache.set(name, flag);
      }
      if (flag) p.name = flag + ' ' + name;
    }

    // 赋值给预分配数组
    result[resultIdx++] = p;
  }

  // 截断预分配数组中未使用的部分
  result.length = resultIdx;
  return result;
}
