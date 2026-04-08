// 开启调试日志，看看 Loon 到底有没有把参数传进来
console.log(`[调试] 当前收到系统参数: ${typeof $argument !== "undefined" ? $argument : "未定义(undefined)"}`);

const args = typeof $argument !== "undefined" ? $argument.split("===") : [];
const GITHUB_TOKEN = args[0] || "";
const DOMAINS = (args[1] || "").split(",").map(d => d.trim());
const CUSTOM_URL = args[2] || "https://cdn.jsdelivr.net/gh/ymyuuu/IPDB@main/bestcf.txt";

const GIST_FILENAME = "CF_Hosts.txt";
const STICKY_MS = 120; 
const MIN_IMPROVEMENT = 30; 

// 防抖限制 
const lastRun = parseInt($persistentStore.read("CF_LAST_RUN") || "0");
if (Date.now() - lastRun < 60000) {
    console.log("⏳ 触发防抖：距离上次运行不足 1 分钟，退出。");
    $done();
}
$persistentStore.write(Date.now().toString(), "CF_LAST_RUN");

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

async function burstPing(ip, host) {
    const p1 = ping(ip, host);
    const p2 = new Promise(r => setTimeout(() => r(ping(ip, host)), 100)); 
    const p3 = new Promise(r => setTimeout(() => r(ping(ip, host)), 200)); 
    
    const results = await Promise.all([p1, p2, p3]);
    const valid = results.filter(r => r.delay < 9999);
    if (valid.length < 2) return { ip, delay: 9999 };
    return { ip, Math.round(valid.reduce((sum, r) => sum + r.delay, 0) / valid.length) };
}

async function fetchDiverseIPs() {
    return new Promise(resolve => {
        $httpClient.get(CUSTOM_URL, (err, resp, data) => {
            if (err || !data) {
                console.log(`❌ IP 库拉取失败，请检查网络或 URL: ${CUSTOM_URL}`);
                return resolve([]);
            }
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
            console.log(`📥 成功跨网段抽取 ${candidates.length} 个候选 IP`);
            resolve(candidates);
        });
    });
}

async function syncToGist(ip) {
    const apiBase = "https://api.github.com/gists";
    const headers = { "Authorization": `token ${GITHUB_TOKEN}`, "Accept": "application/vnd.github.v3+json", "User-Agent": "Loon" };
    const hostContent = `[Host]\n# 自动更新: ${new Date().toLocaleString()}\n` + DOMAINS.map(d => `${d} = ${ip}`).join("\n");
    const payload = { files: { [GIST_FILENAME]: { content: hostContent } } };

    try {
        const gists = await new Promise(res => $httpClient.get({ url: apiBase, headers }, (e, r, d) => res(JSON.parse(d || "[]"))));
        let target = Array.isArray(gists) ? gists.find(g => g.files && g.files[GIST_FILENAME]) : null;

        if (!target) {
            console.log("📝 未发现旧 Gist，准备创建新 Gist...");
            const createRes = await new Promise(res => $httpClient.post({ url: apiBase, headers, body: JSON.stringify({...payload, description: "Loon 优选 CF 节点", public: false}) }, (e, r, d) => res(JSON.parse(d || "{}"))));
            if (createRes && createRes.files) {
                $notification.post("🎉 调度中心创建成功！", "点击复制订阅链接", "去 Loon 的 Host 中添加订阅", {"update-pasteboard": createRes.files[GIST_FILENAME].raw_url});
                console.log("✅ 新 Gist 创建成功！");
            } else {
                console.log("❌ Gist 创建失败，请检查 Token 权限！返回: " + JSON.stringify(createRes));
            }
        } else {
            console.log(`📝 发现现有 Gist (ID: ${target.id})，准备更新...`);
            await new Promise(res => $httpClient.patch({ url: `${apiBase}/${target.id}`, headers, body: JSON.stringify(payload) }, () => res()));
            console.log("✅ Gist 更新成功！");
        }
        return true;
    } catch (e) {
        console.log("❌ Gist 同步抛出异常: " + e);
        return false;
    }
}

async function main() {
    if (!GITHUB_TOKEN || !DOMAINS[0]) {
        console.log("❌ 严重错误：Token 或 域名 变量为空！(如果你是手动点击运行的，大概率是 Loon 没有传入 argument)");
        return $done();
    }
    const mainDomain = DOMAINS[0];

    const ips = await fetchDiverseIPs();
    if (ips.length === 0) return $done();

    const currentIP = $persistentStore.read("CF_CURRENT_IP");
    
    let currentDelay = 9999;
    if (currentIP) {
        currentDelay = (await burstPing(currentIP, mainDomain)).delay;
        if (currentDelay <= STICKY_MS) {
            console.log(`🛡️ 粘性保护生效: 当前 IP (${currentIP}) 延迟 ${currentDelay}ms，健康度优，停止测速。`);
            return $done();
        }
    }

    const defaultDelay = (await ping(mainDomain)).delay;
    const results = await Promise.all(ips.map(ip => ping(ip, mainDomain)));
    results.sort((a, b) => a.delay - b.delay);
    const best = results[0];

    console.log(`📊 战况 | 旧IP: ${currentDelay}ms | 直连(默认解析): ${defaultDelay}ms | 新黑马: ${best.delay}ms`);

    if (best.delay < 9999 && best.delay < (currentDelay - MIN_IMPROVEMENT) && best.delay < defaultDelay) {
        console.log(`🚀 满足换线条件，正在将 ${best.ip} 同步至云端...`);
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
                diff: currentDelay === 9999 ? "未知" : (currentDelay - best.delay),
                percent: currentDelay === 9999 ? 100 : Math.round((currentDelay - best.delay) / currentDelay * 100),
                count: stats.count
            }), "CF_NOTIFY_FLAG");
        }
    } else {
         console.log("⚖️ 新黑马不够快，或所有节点均超时，放弃本次调度。");
    }
    $done();
}

main();
