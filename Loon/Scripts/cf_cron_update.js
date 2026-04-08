const args = typeof $argument !== "undefined" ? $argument.split("===") : [];
const GITHUB_TOKEN = args[0] || "";
const DOMAINS = (args[1] || "").split(",").map(d => d.trim());
const CUSTOM_URL = args[2] || "https://cdn.jsdelivr.net/gh/ymyuuu/IPDB@main/bestcf.txt";

const GIST_FILENAME = "CF_Hosts.txt";
const STICKY_MS = 120; 
const MIN_IMPROVEMENT = 30; 

// 防抖限制 (1分钟内不重复跑)
const lastRun = parseInt($persistentStore.read("CF_LAST_RUN") || "0");
if (Date.now() - lastRun < 60000) $done();
$persistentStore.write(Date.now().toString(), "CF_LAST_RUN");

// 测速核心 (加入超时与容错)
function ping(ip, host) {
    return new Promise(resolve => {
        const start = Date.now();
        const url = host ? `http://${ip}/cdn-cgi/trace` : `https://${ip}/cdn-cgi/trace`;
        const headers = host ? { "Host": host, "User-Agent": "Mozilla/5.0" } : {};
        
        $httpClient.get({ url, headers, timeout: 1500 }, (err, resp) => {
            const delay = Date.now() - start;
            if (!err && resp && resp.status === 200) resolve({ ip, delay });
            else resolve({ ip, delay: 9999 });
        });
    });
}

// 👑 高级特性：Burst 发包探测 (测 3 次求平均，防丢包)
async function burstPing(ip, host) {
    const p1 = ping(ip, host);
    const p2 = new Promise(r => setTimeout(() => r(ping(ip, host)), 100)); // 错开100ms
    const p3 = new Promise(r => setTimeout(() => r(ping(ip, host)), 200)); 
    
    const results = await Promise.all([p1, p2, p3]);
    const valid = results.filter(r => r.delay < 9999);
    
    // 如果丢包超过1个，直接判定不及格
    if (valid.length < 2) return { ip, delay: 9999 };
    
    const avgDelay = Math.round(valid.reduce((sum, r) => sum + r.delay, 0) / valid.length);
    return { ip, delay: avgDelay };
}

// 👑 高级特性：跨网段抽取候选者 (Subnet Diversity)
async function fetchDiverseIPs() {
    return new Promise(resolve => {
        $httpClient.get(CUSTOM_URL, (err, resp, data) => {
            if (err || !data) return resolve([]);
            
            const rawIps = data.split(/\r?\n/).map(l => l.split(/[,\s#]/)[0].trim()).filter(ip => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip));
            const subnetMap = new Map();
            
            // 按前两段(如 104.21)分类
            rawIps.forEach(ip => {
                const subnet = ip.split('.').slice(0, 2).join('.');
                if (!subnetMap.has(subnet)) subnetMap.set(subnet, []);
                subnetMap.get(subnet).push(ip);
            });

            // 每个网段最多抽 2 个，总共拼够 15 个，保证 IP 池物理分布均匀
            let candidates = [];
            for (let [subnet, ips] of subnetMap.entries()) {
                candidates.push(...ips.slice(0, 2));
                if (candidates.length >= 15) break;
            }
            resolve(candidates);
        });
    });
}

// GitHub Gist 同步
async function syncToGist(ip) {
    const apiBase = "https://api.github.com/gists";
    const headers = { "Authorization": `token ${GITHUB_TOKEN}`, "Accept": "application/vnd.github.v3+json", "User-Agent": "Loon" };
    const hostContent = `[Host]\n# 自动更新: ${new Date().toLocaleString()}\n` + DOMAINS.map(d => `${d} = ${ip}`).join("\n");
    const payload = { files: { [GIST_FILENAME]: { content: hostContent } } };

    try {
        const gists = await new Promise(res => $httpClient.get({ url: apiBase, headers }, (e, r, d) => res(JSON.parse(d || "[]"))));
        let target = Array.isArray(gists) ? gists.find(g => g.files && g.files[GIST_FILENAME]) : null;

        if (!target) {
            const createRes = await new Promise(res => $httpClient.post({ url: apiBase, headers, body: JSON.stringify({...payload, description: "Loon 优选 CF 节点", public: false}) }, (e, r, d) => res(JSON.parse(d || "{}"))));
            $notification.post("🎉 调度中心创建成功！", "点击复制订阅链接", "去 Loon 的 Host 中添加订阅", {"update-pasteboard": createRes.files[GIST_FILENAME].raw_url});
        } else {
            await new Promise(res => $httpClient.patch({ url: `${apiBase}/${target.id}`, headers, body: JSON.stringify(payload) }, () => res()));
        }
        return true;
    } catch (e) {
        console.log("❌ Gist 同步失败: " + e);
        return false;
    }
}

async function main() {
    if (!GITHUB_TOKEN || !DOMAINS[0]) return $done();
    const mainDomain = DOMAINS[0];

    const ips = await fetchDiverseIPs();
    if (ips.length === 0) return $done();

    const currentIP = $persistentStore.read("CF_CURRENT_IP");
    
    // 1. Burst 测试当前节点 (最高防丢包标准)
    let currentDelay = 9999;
    if (currentIP) {
        currentDelay = (await burstPing(currentIP, mainDomain)).delay;
        if (currentDelay <= STICKY_MS) {
            console.log(`🛡️ 粘性保护生效: 当前 ${currentDelay}ms，健康度优。`);
            return $done();
        }
    }

    // 2. 基准测试 (普通解析)
    const defaultDelay = (await ping(mainDomain)).delay;

    // 3. 并发测试跨网段候选池
    const results = await Promise.all(ips.map(ip => ping(ip, mainDomain)));
    results.sort((a, b) => a.delay - b.delay);
    const best = results[0];

    console.log(`📊 战况 | 旧: ${currentDelay}ms | 直连: ${defaultDelay}ms | 新: ${best.delay}ms`);

    if (best.delay < 9999 && best.delay < (currentDelay - MIN_IMPROVEMENT) && best.delay < defaultDelay) {
        const synced = await syncToGist(best.ip);
        if (synced) {
            $persistentStore.write(best.ip, "CF_CURRENT_IP");
            
            // 记录当天调度次数 (极客统计)
            let stats = JSON.parse($persistentStore.read("CF_STATS") || '{"date":"","count":0}');
            const today = new Date().toLocaleDateString();
            if (stats.date !== today) stats = { date: today, count: 0 };
            stats.count += 1;
            $persistentStore.write(JSON.stringify(stats), "CF_STATS");

            // 埋下通知旗帜
            $persistentStore.write(JSON.stringify({
                domain: mainDomain,
                diff: currentDelay === 9999 ? "未知" : (currentDelay - best.delay),
                percent: currentDelay === 9999 ? 100 : Math.round((currentDelay - best.delay) / currentDelay * 100),
                count: stats.count
            }), "CF_NOTIFY_FLAG");
        }
    }
    $done();
}

main();
