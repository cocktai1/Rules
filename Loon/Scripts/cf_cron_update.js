const URL = "https://cdn.jsdelivr.net/gh/ymyuuu/IPDB@main/bestcf.txt";
const BEST_IP_KEY = "CF_BEST_IP";
const FAIL_MAP_KEY = "CF_FAIL_MAP";

const TIMEOUT = 1200;
const MAX_FAIL = 3;

// 正则校验 IPv4
const isIPv4 = ip => /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(ip);

// 真正的公平洗牌算法 (Fisher-Yates)
const shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

function fetchIPs() {
    return new Promise(resolve => {
        $httpClient.get(URL, (err, resp, data) => {
            if (err || !data) return resolve(null);
            
            const set = new Set();
            data.split(/\r?\n/).forEach(line => {
                const ip = line.split(/[,\s#]/)[0].trim();
                if (isIPv4(ip)) set.add(ip);
            });
            const ips = Array.from(set).slice(0, 30);
            resolve(ips.length ? ips : null);
        });
    });
}

function httpPing(ip) {
    return new Promise(resolve => {
        const start = Date.now();
        // Loon 专属写法：直接向 IP 发起请求，通过 Host 伪装，请求轻量级 204 接口
        $httpClient.get({
            url: `http://${ip}/generate_204`,
            headers: { Host: "cp.cloudflare.com" },
            timeout: TIMEOUT
        }, (err, resp) => {
            const delay = Date.now() - start;
            // 确保没有网络错误，并且 CF 真的返回了 2xx 状态码
            const isOk = !err && resp && (resp.status === 204 || resp.status === 200);
            resolve({
                ip,
                delay: (isOk && delay < TIMEOUT) ? delay : 9999
            });
        });
    });
}

async function main() {
    console.log("🚀 CF 后台测速优选启动");

    let failMap = {};
    try { failMap = JSON.parse($persistentStore.read(FAIL_MAP_KEY) || "{}"); } catch {}

    const ips = await fetchIPs();
    if (!ips) {
        console.log("❌ GitHub IP 库拉取失败，保留上次结果");
        return $done();
    }

    // 剔除连续失败的 IP
    let candidates = ips.filter(ip => (failMap[ip] || 0) < MAX_FAIL);
    if (candidates.length === 0) {
        failMap = {};
        candidates = ips;
    }

    const testList = shuffle(candidates).slice(0, 5);
    const results = await Promise.all(testList.map(ip => httpPing(ip)));
    results.sort((a, b) => a.delay - b.delay);

    let bestIP;
    if (results[0].delay < 9999) {
        bestIP = results[0].ip;
        console.log(`🏆 测速完成，最优 IP: ${bestIP} (${results[0].delay}ms)`);
    } else {
        bestIP = shuffle(ips)[0];
        console.log(`⚠️ 所有节点超时，启用随机兜底 IP: ${bestIP}`);
    }

    // 更新失败计数器
    results.forEach(r => {
        if (r.delay >= TIMEOUT) {
            failMap[r.ip] = (failMap[r.ip] || 0) + 1;
        } else {
            failMap[r.ip] = 0;
        }
    });

    const oldBestIP = $persistentStore.read(BEST_IP_KEY);

    $persistentStore.write(bestIP, BEST_IP_KEY);
    $persistentStore.write(JSON.stringify(failMap), FAIL_MAP_KEY);

    // 仅在 IP 发生实质性变化时通知
    if (oldBestIP !== bestIP) {
        $notification.post(
            "✨ CF 优选已更新",
            `新 IP: ${bestIP}`,
            `当前延迟: ${results[0].delay < 9999 ? results[0].delay + 'ms' : '超时兜底'}`
        );
    }

    $done();
}

main();
