const URL = "https://cdn.jsdelivr.net/gh/ymyuuu/IPDB@main/bestcf.txt";
const BEST_IP_KEY = "CF_BEST_IP";
const TIMEOUT = 1000; 

const isIPv4 = ip => /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(ip);

const shuffle = (arr) => {
    let m = arr.length, t, i;
    while (m) {
        i = Math.floor(Math.random() * m--);
        t = arr[m]; arr[m] = arr[i]; arr[i] = t;
    }
    return arr;
};

function fetchIPs() {
    return new Promise(resolve => {
        $httpClient.get(URL, (err, resp, data) => {
            if (err || !data) return resolve(null);
            try {
                const set = new Set();
                data.split(/\r?\n/).forEach(line => {
                    const ip = line.split(/[,\s#]/)[0].trim();
                    if (isIPv4(ip)) set.add(ip);
                });
                const ips = Array.from(set).slice(0, 30);
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
        $httpClient.get({ url: `http://${ip}`, timeout: TIMEOUT }, (err) => {
            const delay = Date.now() - start;
            resolve({ ip, delay: (delay < TIMEOUT && !err) ? delay : 9999 });
        });
    });
}

async function main() {
    console.log("🚀 [后台任务] 开始拉取并优选 CF IP...");
    const ips = await fetchIPs();
    
    if (!ips) {
        console.log("❌ 拉取失败，保留原有 IP");
        return $done();
    }

    const testList = shuffle(ips).slice(0, 5);
    const results = await Promise.all(testList.map(ip => httpPing(ip)));
    results.sort((a, b) => a.delay - b.delay);

    let bestIP = results[0].delay < 9999 ? results[0].ip : shuffle(ips)[0];
    
    const oldBestIP = $persistentStore.read(BEST_IP_KEY);
    $persistentStore.write(bestIP, BEST_IP_KEY);
    console.log(`✅ [后台任务] 测速完成，最优 IP: ${bestIP}`);

    if (oldBestIP !== bestIP) {
        $notification.post("✨ CF 优选节点已更新 (后台)", `新节点: ${bestIP}`, `测速延迟: ${results[0].delay}ms\n已为您自动调度至当前最快线路。`);
    }
    
    $done();
}

main();
