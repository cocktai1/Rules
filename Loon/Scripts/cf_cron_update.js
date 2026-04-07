const URL = "https://cdn.jsdelivr.net/gh/ymyuuu/IPDB@main/bestcf.txt";
const BEST_IP_KEY = "CF_BEST_IP";
const FAIL_MAP_KEY = "CF_FAIL_MAP";

const TIMEOUT = 2000; // 后台任务，2秒超时很宽裕
const MAX_FAIL = 3;
const MAX_TEST = 10;  // 并发测试数量提升到 10 个

const isIPv4 = ip => /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(ip);

// Fisher-Yates 公平洗牌算法
const shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

// 拉取最新 IP 库
function fetchIPs() {
    return new Promise(resolve => {
        $httpClient.get(URL, (err, resp, data) => {
            if (err || !data) return resolve(null);
            const set = new Set();
            data.split(/\r?\n/).forEach(line => {
                const ip = line.split(/[,\s#]/)[0].trim();
                if (isIPv4(ip)) set.add(ip);
            });
            const ips = Array.from(set).slice(0, 50); // 增加基础池容量
            resolve(ips.length ? ips : null);
        });
    });
}

// 并发 HTTP 测速 (使用 CF 官方 trace 接口)
function httpPing(ip) {
    return new Promise(resolve => {
        const start = Date.now();
        $httpClient.get({
            url: `http://${ip}/cdn-cgi/trace`,
            headers: { 
                "Host": "www.cloudflare.com",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            },
            timeout: TIMEOUT
        }, (err, resp) => {
            const delay = Date.now() - start;
            // 只要没报错且返回了数据，就算物理连通
            if (!err && resp && resp.status === 200 && delay < TIMEOUT) {
                resolve({ ip, delay });
            } else {
                resolve({ ip, delay: 9999 });
            }
        });
    });
}

async function main() {
    console.log("🚀 [CF 优选] 后台定时测速启动...");

    let failMap = {};
    try { failMap = JSON.parse($persistentStore.read(FAIL_MAP_KEY) || "{}"); } catch {}

    const ips = await fetchIPs();
    if (!ips) {
        console.log("❌ IP 库拉取失败，任务中止，保留上次最优结果");
        return $done();
    }

    // 过滤黑名单，如果全黑了就清空黑名单重来
    let candidates = ips.filter(ip => (failMap[ip] || 0) < MAX_FAIL);
    if (candidates.length === 0) {
        failMap = {};
        candidates = ips;
    }

    const testList = shuffle(candidates).slice(0, MAX_TEST);
    console.log(`🎯 正在并发探测 ${testList.length} 个节点...`);
    
    const results = await Promise.all(testList.map(ip => httpPing(ip)));
    results.sort((a, b) => a.delay - b.delay);

    let bestIP;
    if (results[0].delay < 9999) {
        bestIP = results[0].ip;
        console.log(`🏆 探测成功！当前最优节点: ${bestIP} (${results[0].delay}ms)`);
    } else {
        bestIP = shuffle(ips)[0];
        console.log(`⚠️ 所有节点响应超时，已随机选取兜底节点: ${bestIP}`);
    }

    // 更新黑名单计数并进行内存自清理 (只保留当前候选池的记录)
    let newFailMap = {};
    results.forEach(r => {
        if (r.delay >= TIMEOUT) {
            newFailMap[r.ip] = (failMap[r.ip] || 0) + 1;
        } else {
            newFailMap[r.ip] = 0;
        }
    });

    const oldBestIP = $persistentStore.read(BEST_IP_KEY);

    $persistentStore.write(bestIP, BEST_IP_KEY);
    $persistentStore.write(JSON.stringify(newFailMap), FAIL_MAP_KEY);

    // 仅在 IP 真正切换，且测速成功的情况下通知用户
    if (oldBestIP !== bestIP && results[0].delay < 9999) {
        $notification.post(
            "✨ CF 优选节点已切换",
            `新节点: ${bestIP}`,
            `测速延迟: ${results[0].delay}ms，已自动为您调度调度。`
        );
    }

    $done();
}

main();
