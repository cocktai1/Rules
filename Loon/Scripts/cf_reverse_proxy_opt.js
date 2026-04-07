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
const TIMEOUT = 1500;      // HTTP探测超时(ms)
const MAX_FAIL = 3;        // 最大失败次数

// ===== 工具 =====
const isIPv4 = ip => /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(ip);

// 数组洗牌函数 (Fisher-Yates)
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

// ===== HTTP HEAD 测速 (模拟 TCP Ping) =====
function httpPing(ip) {
    return new Promise(resolve => {
        const start = Date.now();
        // 优化：使用 HEAD 方法，减少带宽消耗和接收延迟
        $httpClient.head({
            url: `http://${ip}`,
            timeout: TIMEOUT
        }, (err, resp, data) => {
            const delay = Date.now() - start;
            // 只要在超时时间内有响应(不论状态码是不是200/400/403)，说明节点是活的
            if (delay < TIMEOUT && !err) {
                resolve({ ip, delay });
            } else {
                resolve({ ip, delay: 9999 }); // 超时或彻底连不上
            }
        });
    });
}

// ===== 主逻辑 =====
async function main() {
    const now = Date.now();

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
            // IP 池更新后，清空历史失败记录，给曾经失败的 IP 一个重新做人的机会
            $persistentStore.write("{}", FAIL_MAP_KEY); 
        } else if (!pool[0]) {
            pool = ["104.18.25.1", "172.64.150.1", "104.21.50.1", "1.1.1.1"];
        }
    }

    // ===== 2. 读取失败记录和当前最优 IP =====
    let failMap = {};
    try { failMap = JSON.parse($persistentStore.read(FAIL_MAP_KEY) || "{}"); } catch {}

    let bestIP = $persistentStore.read(BEST_IP_KEY);
    let lastSwitch = parseInt($persistentStore.read(BEST_IP_TIME_KEY) || "0");

    // ===== 3. 是否需要重新测速选优 =====
    if (!bestIP || now - lastSwitch > SWITCH_INTERVAL) {
        console.log("⚡ 开始并发测速选最优 IP...");

        // 过滤掉连续失败超限的 IP
        let candidates = pool.filter(ip => (failMap[ip] || 0) < MAX_FAIL);
        
        // 如果候选池都被拉黑了，清空黑名单重新再来
        if (candidates.length === 0) {
            failMap = {};
            candidates = pool;
        }

        // 优化：洗牌后再切片，确保每个 IP 都有出场机会
        const testList = shuffle(candidates).slice(0, MAX_TEST);

        // 优化：使用 Promise.all 并发发包！总耗时最多 1.5 秒
        console.log(`🎯 抽选探测目标: ${testList.join(", ")}`);
        const results = await Promise.all(testList.map(ip => httpPing(ip)));

        results.sort((a, b) => a.delay - b.delay);

        // 统计结果并记录黑名单
        results.forEach(r => {
            console.log(`📡 ${r.ip} -> ${r.delay === 9999 ? 'Timeout' : r.delay + 'ms'}`);
            if (r.delay >= TIMEOUT) {
                failMap[r.ip] = (failMap[r.ip] || 0) + 1;
            } else {
                failMap[r.ip] = 0; // 一旦成功一次，清除失败计数
            }
        });

        // 选出第一名（如果不全是9999的话）
        if (results[0].delay < 9999) {
            bestIP = results[0].ip;
            console.log(`🏆 测速完成，当前最优 IP: ${bestIP}`);
        } else {
            console.log("⚠️ 所有测速均失败，随机选取兜底 IP");
            bestIP = shuffle(pool)[0]; 
        }

        $persistentStore.write(bestIP, BEST_IP_KEY);
        $persistentStore.write(now.toString(), BEST_IP_TIME_KEY);
        $persistentStore.write(JSON.stringify(failMap), FAIL_MAP_KEY);
    } else {
        // console.log(`🔄 沿用当前最优 IP (TTL未过期): ${bestIP}`);
    }

    // ===== 4. DNS 返回 =====
    $done({
        addresses: [bestIP],
        ttl: DNS_TTL
    });
}

main();
