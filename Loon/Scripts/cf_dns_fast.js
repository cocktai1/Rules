const BEST_IP_KEY = "CF_BEST_IP";

// 瞬间从本地持久化缓存读取最优 IP
let ip = $persistentStore.read(BEST_IP_KEY);

// 冷启动兜底
if (!ip) {
    ip = "104.18.25.1"; 
}

// 核心修复：Loon 严格要求单一字符串 address，不能用 addresses 数组！
$done({
    address: ip,
    ttl: 600
});
