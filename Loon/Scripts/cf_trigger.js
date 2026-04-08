const url = $request.url;

// 官方纯正读取方式
const DOMAINS_RAW = (typeof $argument !== "undefined" && $argument.CF_DOMAIN) ? $argument.CF_DOMAIN : "";
const domains = DOMAINS_RAW.split(",").map(d => d.trim()).filter(Boolean);

let isTarget = false;
for (let i = 0; i < domains.length; i++) {
    if (url.indexOf(domains[i]) !== -1) {
        isTarget = true;
        break;
    }
}

if (isTarget) {
    const flagStr = $persistentStore.read("CF_NOTIFY_FLAG");
    if (flagStr) {
        try {
            const data = JSON.parse(flagStr);
            $notification.post(
                "🚀 专属 CDN 线路已优化", 
                `访问命中: ${data.domain}`, 
                `✨ 相比上一节点延迟降低 ${data.diff}ms，提速约 ${data.percent}%。\n🛡️ 今日系统已为您自动进行 ${data.count} 次灾备调度。`
            );
            $persistentStore.write("", "CF_NOTIFY_FLAG");
        } catch (e) {}
    }
}

$done({});
