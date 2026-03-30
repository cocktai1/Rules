/**
 * Sub-Store 通用清洗脚本 v4.0 (极限性能版)
 * 针对移动端 JS 引擎优化：移除重度 API 依赖，改用原生循环与正则提速。
 */

function operator(proxies, targetPlatform) {
  // ========== 1. 静态环境与常量初始化 ==========
  const isLoon = (typeof $loon !== 'undefined') || (typeof $substore !== 'undefined' && $substore.env && $substore.env.isLoon);

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
  const FLAG_RE = /[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/; // 极速识别 Emoji 国旗
  
  const AD_KEYWORDS = ['官网', '群', '流量', '到期', '重置', '订阅', '机场', '网址', '客服', '购买', '更新', '通知', '公告', '续费', '过期', '剩余', '套餐', '教程', '邀请', '签到', '试用', 'tg群', 'telegram', '频道', 'channel', '联系', '防失联', '备用', 'app下载', '获取', 'expire', 'traffic', 'remaining'];
  const AD_RE = new RegExp(AD_KEYWORDS.join('|'), 'i');
  const MAX_NAME_LEN = 60;

  // 预判外部 API 是否可用，避免在循环内反复查找
  const hasGetFlag = typeof ProxyUtils !== 'undefined' && typeof ProxyUtils.getFlag === 'function';

  // ========== 2. 高效遍历与清洗流程 ==========
  const seen = new Set();
  const result = [];

  for (let i = 0; i < proxies.length; i++) {
    let p = proxies[i];
    let type = (p.type || '').toLowerCase();
    let name = (p.name || '').trim();
    let server = (p.server || '').trim();
    let port = Number(p.port);

    // [前置快速过滤] - 越容易触发的条件放越前面，尽早 continue 结束循环
    if (!SAFE_TYPES.has(type) || (isLoon && LOON_UNSUPPORTED.has(type))) continue;
    if (!server || PRIVATE_IP_RE.test(server)) continue;
    if (!port || port < 1 || port > 65535 || BLOCKED_PORTS.has(port)) continue;
    if (name.length > MAX_NAME_LEN || AD_RE.test(name)) continue;

    let cipher = (p.cipher || p.method || '').toLowerCase();
    let network = (p.network || p.type2 || '').toLowerCase();

    // [安全性检查]
    if (type === 'vmess' && UNSAFE_VMESS_CIPHERS.has(cipher)) continue;
    if (SS_TYPES.has(type) && UNSAFE_SS_CIPHERS.has(cipher)) continue;

    // [去重检查] - IP:端口:协议
    let uniqueKey = server.toLowerCase() + ':' + port + ':' + type;
    if (seen.has(uniqueKey)) continue;

    // [协议细分规则检查]
    if (type === 'vless') {
      if (!UUID_RE.test(p.uuid || '')) continue;
      let hasTLS = p.tls === true || p.tls === 'true' || p.tls === 1;
      let hasReality = !!(p['reality-opts'] || (p.flow && /reality/i.test(p.flow)));
      if (!hasTLS && !hasReality) continue;
      if (isLoon && (!LOON_TRANSPORTS.has(network) || (hasTLS && !p.sni && !p.servername))) continue;
    } else if (type === 'vmess') {
      if (!UUID_RE.test(p.uuid || '')) continue;
      if (isLoon && (!LOON_VMESS_CIPHERS.has(cipher) || !LOON_TRANSPORTS.has(network) || isNaN(Number(p.alterId)))) continue;
    } else if (type === 'trojan') {
      if (!p.password || p.tls === false) continue;
      if (isLoon && !LOON_TRANSPORTS.has(network)) continue;
    } else if (SS_TYPES.has(type)) {
      if (!cipher || (!p.password && p.password !== 0)) continue;
    } else if (type === 'hysteria2') {
      if (!p.password && !p.auth && !p['auth-str']) continue;
    } else if (type === 'hysteria') {
      if (isLoon || (!p['auth-str'] && !p.auth && !p.password)) continue;
    } else if (type === 'tuic') {
      if (!UUID_RE.test(p.uuid || '') || (!p.password && p.password !== 0)) continue;
    }

    // 存入去重哈希表
    seen.add(uniqueKey);

    // ========== 3. 节点信息美化与增强配置 ==========
    // 自动添加地区旗帜
    if (hasGetFlag && name && !FLAG_RE.test(name)) {
      try {
        let flag = ProxyUtils.getFlag(name);
        if (flag) p.name = flag + ' ' + name;
      } catch (e) {}
    }

    // 统一强制注入增强参数
    p['skip-cert-verify'] = true;
    p.udp = true;
    p.tfo = true;

    // 压入最终结果
    result.push(p);
  }

  return result;
}
