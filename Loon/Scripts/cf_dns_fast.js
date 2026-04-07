const BEST_IP_KEY = "CF_BEST_IP";

// 1. 读取缓存主 IP
let ip = $persistentStore.read(BEST_IP_KEY);

// 2. 冷启动兜底
if (!ip) {
    ip = "104.18.25.1";
}

// 3. 备用 IP 提高容灾 (使用 172 网段，避开容易被劫持的 1.1.1.1)
const backup = "172.64.150.1"; 

// 4. 双轨并发返回，极速响应
$done({
    addresses: [ip, backup], 
    ttl: 600
});
