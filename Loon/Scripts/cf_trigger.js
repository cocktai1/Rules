const url = $request.url;
const domains = (typeof $argument !== "undefined" ? $argument : "").split(",").map(d => d.trim());

// 性能极限压榨：仅做最简单的字符串匹配，不是目标域名瞬间退出
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
            
            // 极客风 UI 弹窗
            $notification.post(
                "🚀 专属 CDN 线路已优化", 
                `访问命中: ${data.domain}`, 
                `✨ 相比上一节点延迟降低 ${data.diff}ms，提速约 ${data.percent}%。\n🛡️ 今日系统已为您自动进行 ${data.count} 次灾备调度。`
            );
            
            // 拔掉旗帜
            $persistentStore.write("", "CF_NOTIFY_FLAG");
        } catch (e) {}
    }
}

$done({});
