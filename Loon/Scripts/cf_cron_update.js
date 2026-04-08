// === 终极智能参数读取 (原生 JSON 解析 + 完美防漏) ===
let argObj = {};
if (typeof $argument === "string") {
    try { argObj = JSON.parse($argument); } catch(e) {}
} else if (typeof $argument === "object") {
    argObj = $argument;
}

// 核心防御：剔除 Loon 手动运行时的 {CF_XXX} 占位符 Bug
function getRealVal(val) {
    if (val && typeof val === "string" && val.trim() !== "" && !val.includes("{CF_")) {
        return val.trim();
    }
    return "";
}

const GITHUB_TOKEN = getRealVal(argObj.token);
const DOMAINS_RAW = getRealVal(argObj.domain);
let CUSTOM_URL = getRealVal(argObj.url);
if (!CUSTOM_URL) CUSTOM_URL = "https://cdn.jsdelivr.net/gh/ymyuuu/IPDB@main/bestcf.txt";

// 🛑 防呆拦截：精准识别 Loon 的手动运行 Bug
if (!GITHUB_TOKEN || !DOMAINS_RAW) {
    console.log("⚠️ 拦截提示：未获取到 Token 或 域名！");
    console.log("❌ 如果你是点击了【▶️手动运行】按钮，这是 Loon 自身的底层传参 Bug 导致的。");
    console.log("💡 正确测试方法：请去 Loon 插件 UI 填好参数，然后【开关一次手机 Wi-Fi】触发真实网络运行！");
    $done();
}

const DOMAINS = DOMAINS_RAW.split(",").map(d => d.trim()).filter(Boolean);

console.log(`[参数检查] Token: 已获取(隐藏)`);
console.log(`[参数检查] 域名: ${DOMAINS.join(", ")}`);
console.log(`[参数检查] IP库: ${CUSTOM_URL}`);
// ========================================================

const GIST_FILENAME = "CF_Hosts.txt";
const STICKY_MS = 120; // 粘性保护阈值
const MIN_IMPROVEMENT = 30; // 最小提升阈值

// 防抖限制 (1分钟内不重复跑)
const lastRun = parseInt($persistentStore.read("CF_LAST_RUN") || "0");
if (Date.now() - lastRun < 60000) {
    console.log("⏳ 防抖触发：距离上次运行不足1分钟，静默退出。");
    $done();
}
$persistentStore.write(Date.now().toString(), "CF_LAST_RUN");

// 单次测速
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

// 👑 Burst 发包探测 (测 3 次求平均，防丢包)
async function burstPing(ip, host) {
    const p1 = ping(ip, host);
    const p2 = new Promise(r => setTimeout(() => r(ping(ip, host)), 100)); 
    const p3 = new Promise(r => setTimeout(() => r(ping(ip, host)), 200)); 
    
    const results = await Promise.all([p1, p2, p3]);
    const valid = results.filter(r => r.delay < 9999);
    
    if (valid.length < 2) return { ip, delay: 9999 };
    
    const avgDelay = Math.round(valid.reduce((sum, r) => sum + r.delay, 0) / valid.length);
    return { ip, delay: avgDelay };
}

// 👑 跨网段抽取候选者
async function fetchDiverseIPs() {
    return new Promise(resolve => {
        $httpClient.get(CUSTOM_URL, (err, resp, data) => {
            if (err || !data) {
                console.log(`❌ IP 库拉取失败`);
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
            console.log("📝 准备创建新 Gist...");
            const createRes = await new Promise(res => $httpClient.post({ url: apiBase, headers, body: JSON.stringify({...payload, description: "Loon 优选 CF 节点", public: false}) }, (e, r, d) => res(JSON.parse(d || "{}"))));
            if (createRes && createRes.files) {
                $notification.post("🎉 调度中心创建成功！", "点击复制订阅链接", "去 Loon 的 Host 中添加该链接订阅", {"update-pasteboard": createRes.files[GIST_FILENAME].raw_url});
            }
        } else {
            console.log(`📝 发现现有 Gist，准备更新...`);
            await new Promise(res => $httpClient.patch({ url: `${apiBase}/${target.id}`, headers, body: JSON.stringify(payload) }, () => res()));
        }
        return true;
    } catch (e) {
        console.log("❌ Gist 同步异常");
        return false;
    }
}

// 主干逻辑
async function main() {
    const mainDomain = DOMAINS[0];
    const ips = await fetchDiverseIPs();
    if (ips.length === 0) return $done();

    const currentIP = $persistentStore.read("CF_CURRENT_IP");
    
    let currentDelay = 9999;
    if (currentIP) {
        currentDelay = (await burstPing(currentIP, mainDomain)).delay;
        if (currentDelay <= STICKY_MS) {
            console.log(`🛡️ 粘性保护生效: 当前 ${currentIP} 延迟 ${currentDelay}ms，健康度优，停止调度。`);
            return $done();
        }
    }

    const defaultDelay = (await ping(mainDomain)).delay;
    const results = await Promise.all(ips.map(ip => ping(ip, mainDomain)));
    results.sort((a, b) => a.delay - b.delay);
    const best = results[0];

    console.log(`📊 战况 | 旧IP: ${currentDelay}ms | 直连(默认): ${defaultDelay}ms | 新黑马: ${best.delay}ms`);

    if (best.delay < 9999 && best.delay < (currentDelay - MIN_IMPROVEMENT) && best.delay < defaultDelay) {
        console.log(`🚀 满足大幅换线条件，准备同步 ${best.ip} 到云端 Gist...`);
        const synced = await syncToGist(best.ip);
        if (synced) {
            $persistentStore.write(best.ip, "CF_CURRENT_IP");
            
            let stats = JSON.parse($persistentStore.read("CF_STATS") || '{"date":"","count":0}');
            const today = new Date().toLocaleDateString();
            if (stats.date !== today) stats = { date: today, count: 0 };
            stats.count += 1;
            $persistentStore.write(JSON.stringify(stats), "CF_STATS");

            // 埋下临场通知旗帜
            $persistentStore.write(JSON.stringify({
                domain: mainDomain,
                diff: currentDelay === 9999 ? "未知" : (currentDelay - best.delay),
                percent: currentDelay === 9999 ? 100 : Math.round((currentDelay - best.delay) / currentDelay * 100),
                count: stats.count
            }), "CF_NOTIFY_FLAG");
            console.log("✅ 同步完毕，已埋下前台通知旗帜。");
        }
    } else {
        console.log("⚖️ 维持现状。");
    }
    
    $done();
}

main();
