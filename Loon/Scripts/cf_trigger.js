// 1. 基本安全环境检查
if (typeof $request === "undefined" || typeof $argument === "undefined") {
    $done();
}

const url = $request.url;
const DOMAINS_RAW = $argument.CF_DOMAIN || "";

// 2. 如果未配置域名，直接安全放行
if (!DOMAINS_RAW) {
    $done(); 
}

const domains = DOMAINS_RAW.split(",").map(d => d.trim()).filter(Boolean);

// 3. 极速域名匹配逻辑
let isTarget = false;
for (let i = 0; i < domains.length; i++) {
    if (url.includes(domains[i])) {
        isTarget = true;
        break;
    }
}

// 4. 非目标域名（如 Sub-Store），直接放行请求，不作任何干预
if (!isTarget) {
    $done(); 
}

// 5. 命中目标域名，执行通知逻辑
const flagStr = $persistentStore.read("CF_NOTIFY_FLAG");
if (flagStr) {
    try {
        const data = JSON.parse(flagStr);
        // 正常、专业的极客风通知
        $notification.post(
            "CF 节点调度完成", 
            `命中域名: ${data.domain}`, 
            `已切换至优选 IP: ${data.ip}\n当前延迟: ${data.delay}ms (降低 ${data.diff}ms)\n今日累计自动调度: ${data.count} 次`
        );
        $persistentStore.write("", "CF_NOTIFY_FLAG");
    } catch (e) {}
}

$done();
