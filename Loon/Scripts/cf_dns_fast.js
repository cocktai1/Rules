// 极简 DNS 脚本，耗时 < 5ms
const BEST_IP_KEY = "CF_BEST_IP";

// 直接从缓存读，如果没有（比如刚装上插件还没跑后台），给个强力兜底
const bestIp = $persistentStore.read(BEST_IP_KEY) || "104.18.25.1"; 

$done({
    address: bestIp,
    addresses: [bestIp],
    ttl: 600
});
