const BEST_IP_KEY = "CF_BEST_IP";

// 1. 瞬间从本地持久化缓存读取最优 IP
let ip = $persistentStore.read(BEST_IP_KEY);

// 2. 如果是刚安装，缓存为空，提供高可用兜底池
if (!ip) {
    ip = "104.18.25.1"; // 官方 Anycast 兜底 1
}

const backupIp = "172.64.150.1"; // 官方 Anycast 兜底 2

// 3. 返回双轨 IP 数组，利用 iOS 底层 Happy Eyeballs 机制实现 0 延迟容灾
$done({
    addresses: [ip, backupIp],
    ttl: 600
});
