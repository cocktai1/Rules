// === 参数读取与安全检查 ===
const GITHUB_TOKEN = (typeof $argument !== "undefined" && $argument.CF_TOKEN) ? $argument.CF_TOKEN.trim() : "";
const DOMAINS_RAW = (typeof $argument !== "undefined" && $argument.CF_DOMAIN) ? $argument.CF_DOMAIN.trim() : "";
const CUSTOM_URL = (typeof $argument !== "undefined" && $argument.CF_IP_URL) ? $argument.CF_IP_URL.trim() : "https://cdn.jsdelivr.net/gh/ymyuuu/IPDB@main/bestcf.txt";
const GIST_ID = (typeof $argument !== "undefined" && $argument.CF_GIST_ID) ? $argument.CF_GIST_ID.trim() : "";

// 如果未填写核心参数，直接安全退出，不做任何处理
if (!GITHUB_TOKEN || !DOMAINS_RAW || !GIST_ID) {
    console.log("⚠️ 参数缺失：请在插件配置中填入 Token、域名和 Gist ID。");
    $done();
}

const DOMAINS = DOMAINS_RAW.split(",").map(d => d.trim()).filter(Boolean);
if (DOMAINS.length === 0) $done();

console.log(`[运行信息] 目标域名: ${DOMAINS.join(", ")}`);

// ========================================================
const GIST_FILENAME = "CF_Hosts.txt";
const STICKY_MS = 120;
const MIN_IMPROVEMENT = 30;

// 防抖逻辑
const lastRun = parseInt($persistentStore.read("CF_LAST_RUN") || "0");
if (Date.now() - lastRun < 60000) {
    console.log("⏳ 距上次运行不足1分钟，静默跳过。");
    $done();
}
$persistentStore.write(Date.now().toString(), "CF_LAST_RUN");

function ping(ip, host) {
    return new Promise(resolve => {
        const start = Date.now();
        const url = host ? `http://${ip}/cdn-cgi/trace` : `https://${ip}/cdn-cgi/trace`;
        const headers = host ? { "Host": host, "User-Agent": "Mozilla/5.0" } : {};
        $httpClient.get({ url, headers, timeout: 1500 }, (err, resp) => {
            if (!err && resp && resp.status === 200) resolve({ ip, delay: Date.now() - start });
            else resolve({ ip, delay: 9999 });
        });
    });
}

async function burstPing(ip, host) {
    const p1 = ping(ip, host);
    const p2 = new Promise(r => setTimeout(() => r(ping(ip, host)), 100)); 
    const p3 = new Promise(r => setTimeout(() => r(ping(ip, host)), 200)); 
    const results = await Promise.all([p1, p2, p3]);
    const valid = results.filter(r => r.delay < 9999);
    if (valid.length < 2) return { ip, delay: 9999 };
    return { ip, delay: Math.round(valid.reduce((sum, r) => sum + r.delay, 0) / valid.length) };
}

async function fetchDiverseIPs() {
    return new Promise(resolve => {
        $httpClient.get(CUSTOM_URL || "https://cdn.jsdelivr.net/gh/ymyuuu/IPDB@main/bestcf.txt", (err, resp, data) => {
            if (err || !data) return resolve([]);
            const rawIps = data.split(/\r?\n/).map(l => l.split(/[,\s#]/)[0].trim()).filter(ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip));
            const subnetMap = new Map();
            rawIps.forEach(ip => {
                const subnet = ip.split('.').slice(0, 2).join('.');
                if (!subnetMap.has(subnet)) subnetMap.set(subnet, []);
                subnetMap.get(subnet).push(ip);
            });
            let candidates = [];
            for (let [subnet, ips] of subnetMap.entries()) {
                candidates.push(...ips.slice(0, 2));
                if (candidates.length >= 15) break;
            }
            resolve(candidates);
        });
    });
}

async function syncToGist(ip) {
    const apiBase = "https://api.github.com/gists";
    const headers = { "Authorization": `token ${GITHUB_TOKEN}`, "Accept": "application/vnd.github.v3+json", "User-Agent": "Loon" };
    const hostContent = `[Host]\n# 更新时间: ${new Date().toLocaleString()}\n` + DOMAINS.map(d => `${d} = ${ip}`).join("\n");
    const payload = { files: { [GIST_FILENAME]: { content: hostContent } } };

    try {
        await new Promise(res => $httpClient.patch({ url: `${apiBase}/${GIST_ID}`, headers, body: JSON.stringify(payload) }, () => res()));
        return true;
    } catch (e) {
        console.log("❌ Gist 更新失败");
        return false;
    }
}

async function main() {
    const mainDomain = DOMAINS[0];
    const ips = await fetchDiverseIPs();
    if (ips.length === 0) return $done();

    const currentIP = $persistentStore.read("CF_CURRENT_IP");
    let currentDelay = 9999;
    if (currentIP) {
        currentDelay = (await burstPing(currentIP, mainDomain)).delay;
        if (currentDelay <= STICKY_MS) {
            console.log(`[状态] 当前节点 ${currentIP} (${currentDelay}ms) 健康，跳过调度。`);
            return $done();
        }
    }

    const defaultDelay = (await ping(mainDomain)).delay;
    const results = await Promise.all(ips.map(ip => ping(ip, mainDomain)));
    results.sort((a, b) => a.delay - b.delay);
    const best = results[0];

    console.log(`[测速] 旧IP: ${currentDelay}ms | 直连: ${defaultDelay}ms | 优选: ${best.delay}ms`);

    if (best.delay < 9999 && best.delay < (currentDelay - MIN_IMPROVEMENT) && best.delay < defaultDelay) {
        const synced = await syncToGist(best.ip);
        if (synced) {
            $persistentStore.write(best.ip, "CF_CURRENT_IP");
            let stats = JSON.parse($persistentStore.read("CF_STATS") || '{"date":"","count":0}');
            const today = new Date().toLocaleDateString();
            if (stats.date !== today) stats = { date: today, count: 0 };
            stats.count += 1;
            $persistentStore.write(JSON.stringify(stats), "CF_STATS");

            $persistentStore.write(JSON.stringify({
                domain: mainDomain,
                ip: best.ip,
                delay: best.delay,
                diff: currentDelay === 9999 ? "未知" : (currentDelay - best.delay),
                count: stats.count
            }), "CF_NOTIFY_FLAG");
            console.log("✅ 调度完成。");
        }
    }
    $done();
}

main();
