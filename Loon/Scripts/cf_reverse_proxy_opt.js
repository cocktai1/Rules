const URL = "https://cdn.jsdelivr.net/gh/ymyuuu/IPDB@main/bestcf.txt";

// ===== 缓存 Key =====
const POOL_KEY = "CF_POOL";
const POOL_TIME_KEY = "CF_POOL_TIME";
const BEST_IP_KEY = "CF_BEST_IP";
const BEST_IP_TIME_KEY = "CF_BEST_IP_TIME";
const FAIL_MAP_KEY = "CF_FAIL_MAP";

// ===== 参数 =====
const POOL_TTL = 6 * 60 * 60 * 1000;      // IP池缓存 6h
const SWITCH_INTERVAL = 20 * 60 * 1000;   // 最优IP使用 20分钟
const DNS_TTL = 600;

const MAX_TEST = 5;        // 每次并发测速数量
// ⚠️ 极其关键：必须降低超时时间，否则会导致 DNS 整体超时而失效！
const TIMEOUT = 800;       // HTTP探测超时(ms) 降至 800ms
const MAX_FAIL = 3;        // 最大失败次数

// ===== 工具 =====
const isIPv4 = ip => /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(ip);

const shuffle = (arr) => {
    let m = arr.length, t, i;
    while (m) {
        i = Math.floor(Math.random() * m--);
        t = arr[m]; arr[m] = arr[i]; arr[i] = t;
    }
    return arr;
};

const parseIPs = data => {
    const set = new Set();
    data.split(/\r?\n/).forEach(line => {
        const ip = line.split(/[,\s#]/)[0].trim();
        if (isIPv4(ip)) set.add(ip);
    });
    return Array.from(set).slice(0, 30);
};

function fetchIPs() {
    return new Promise(resolve => {
        $httpClient.get(URL, (err, resp, data) => {
            if (err || !data) return resolve(null);
            try {
                const ips = parseIPs(data);
                resolve(ips.length ? ips : null);
            } catch {
                resolve(null);
            }
        });
    });
}

function httpPing(ip) {
    return new Promise(resolve => {
        const start = Date.now();
        // 换回 GET，防止某些运营商墙阻断 HEAD 请求
        $httpClient.get({
            url: `http://${ip}`,
            timeout: TIMEOUT
        }, (err, resp, data) => {
            const delay = Date.now() - start;
            if (delay < TIMEOUT && !err) {
                resolve({ ip, delay });
            } else {
                resolve({ ip, delay: 9999 }); 
            }
        });
    });
}

// ===== 主逻辑 =====
async function main() {
    const now = Date.now();

    // 提前读取旧的优选 IP，用于比对通知
    let oldBestIP = $persistentStore.read(BEST_IP_KEY);
    
    // 【通知增强】首次检测到域名触发
    if (!oldBestIP) {
        $notification.post("🚀 CF 优选已触发", "首次检测到目标域名请求", "正在全网寻找最快节点，请稍等...");
    }

    let pool = ($persistentStore.read(POOL_KEY) || "").split(",");
    const poolTime = parseInt($persistentStore.read(POOL_TIME_KEY) || "0");

    // ===== 1. 更新 IP 池 =====
    if (!pool[0] || now - poolTime > POOL_TTL) {
        console.log("🚀 开始更新 CF 优选 IP 池...");
        const newPool = await fetchIPs();

        if (newPool) {
            pool = newPool;
            $persistentStore.write(pool.join(","), POOL_KEY);
            $persistentStore.write(now.toString(), POOL_TIME_KEY);
            $persistentStore.write("{}", FAIL_MAP_KEY); 
        } else if (!pool[0]) {
            pool = ["104.18.25.1", "172.64.150.1", "104.21.50.1", "1.1.1.1"];
        }
    }

    let failMap = {};
    try { failMap = JSON.parse($persistentStore.read(FAIL_MAP_KEY) || "{}"); } catch {}

    let bestIP = oldBestIP;
    let lastSwitch = parseInt($persistentStore.read(BEST_IP_TIME_KEY) || "0");

    // ===== 2. 重新测速选优 =====
    if (!bestIP || now - lastSwitch > SWITCH_INTERVAL) {
        console.log("⚡ 开始并发测速选最优 IP...");

        let candidates = pool.filter(ip => (failMap[ip] || 0) < MAX_FAIL);
        if (candidates.length === 0) {
            failMap = {};
            candidates = pool;
        }

        const testList = shuffle(candidates).slice(0, MAX_TEST);
        console.log(`🎯 抽选探测目标: ${testList.join(", ")}`);
        
        const results = await Promise.all(testList.map(ip => httpPing(ip)));
        results.sort((a, b) => a.delay - b.delay);

        results.forEach(r => {
            console.log(`📡 ${r.ip} -> ${r.delay === 9999 ? 'Timeout' : r.delay + 'ms'}`);
            if (r.delay >= TIMEOUT) {
                failMap[r.ip] = (failMap[r.ip] || 0) + 1;
            } else {
                failMap[r.ip] = 0; 
            }
        });

        if (results[0].delay < 9999) {
            bestIP = results[0].ip;
        } else {
            console.log("⚠️ 测速全败，使用兜底 IP");
            bestIP = shuffle(pool)[0]; 
        }

        $persistentStore.write(bestIP, BEST_IP_KEY);
        $persistentStore.write(now.toString(), BEST_IP_TIME_KEY);
        $persistentStore.write(JSON.stringify(failMap), FAIL_MAP_KEY);

        // 【通知增强】仅当选出的 IP 与上次不同，才发通知
        //if (oldBestIP && bestIP !== oldBestIP) {
           // $notification.post("✨ CF 优选节点已切换", `新节点: ${bestIP}`, `旧节点: ${oldBestIP} \n已为您自动调度至当前最快线路。`);
       // }
    //}

    // ===== 3. DNS 返回 (双重兼容版) =====
    $done({
        address: bestIP,         // 兼容旧版格式
        addresses: [bestIP],     // 兼容新版格式
        ttl: DNS_TTL
    });
}

main();
