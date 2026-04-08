// === 参数读取与安全检查 ===
const ARG = (typeof $argument === "object" && $argument !== null) ? $argument : {};
const isPlaceholder = (value) => typeof value === "string" && /^\{.+\}$/.test(value.trim());

const GITHUB_TOKEN = (ARG.CF_TOKEN || "").trim();
const DOMAINS_RAW = (ARG.CF_DOMAIN || "").trim();
const CUSTOM_URL = (ARG.CF_IP_URL || "https://cdn.jsdelivr.net/gh/ymyuuu/IPDB@main/bestcf.txt").trim();
const GIST_ID = (ARG.CF_GIST_ID || "").trim();
const MIN_IMPROVEMENT = Number.parseInt((ARG.CF_MIN_IMPROVEMENT || "30").trim(), 10) || 30;
const STICKY_MS = Number.parseInt((ARG.CF_STICKY_MS || "120").trim(), 10) || 120;
const MIN_SWITCH_MINUTES = Number.parseInt((ARG.CF_MIN_SWITCH_MINUTES || "360").trim(), 10) || 360;
const USE_IN_PROXY = ((ARG.CF_USE_IN_PROXY || "on") + "").trim().toLowerCase();
const OUTPUT_MODE = ((ARG.CF_OUTPUT_MODE || "plugin") + "").trim().toLowerCase();
const GIST_FILENAME = (ARG.CF_GIST_FILE || "CF_HostMap.plugin").trim();
const AUTO_REFRESH_SUB = ((ARG.CF_AUTO_REFRESH_SUB || "on") + "").trim().toLowerCase();

if (
    typeof $argument === "undefined" ||
    isPlaceholder(GITHUB_TOKEN) ||
    isPlaceholder(DOMAINS_RAW) ||
    isPlaceholder(GIST_ID)
) {
    console.log("⚠️ 参数尚未生效：请在插件参数页填写真实值后再执行。手动运行脚本时可能出现占位符未解析。");
    $done();
    return;
}

// 如果未填写核心参数，直接安全退出，不做任何处理
if (!GITHUB_TOKEN || !DOMAINS_RAW || !GIST_ID) {
    console.log("⚠️ 参数缺失：请在插件配置中填入 Token、域名和 Gist ID。");
    $done();
    return;
}

const DOMAINS = DOMAINS_RAW.split(",").map(d => d.trim()).filter(Boolean);
if (DOMAINS.length === 0) {
    console.log("⚠️ 参数错误：CF_DOMAIN 至少需要一个域名。");
    $done();
    return;
}

console.log(`[运行信息] 目标域名: ${DOMAINS.join(", ")}`);

// ========================================================
const MIN_SWITCH_INTERVAL_MS = MIN_SWITCH_MINUTES * 60 * 1000;

// 防抖逻辑
const lastRun = parseInt($persistentStore.read("CF_LAST_RUN") || "0");
if (Date.now() - lastRun < 60000) {
    console.log("⏳ 距上次运行不足1分钟，静默跳过。");
    $done();
    return;
}
$persistentStore.write(Date.now().toString(), "CF_LAST_RUN");

function ping(ip, host) {
    return new Promise(resolve => {
        const start = Date.now();
        const url = host ? `http://${ip}/cdn-cgi/trace` : `https://${ip}/cdn-cgi/trace`;
        const headers = host ? { "Host": host, "User-Agent": "Mozilla/5.0" } : {};
        $httpClient.get({ url, headers, timeout: 1500, node: "DIRECT" }, (err, resp) => {
            if (!err && resp && resp.status === 200) resolve({ ip, delay: Date.now() - start });
            else resolve({ ip, delay: 9999 });
        });
    });
}

function uniqueIPv4List(items) {
    const seen = new Set();
    const list = [];
    for (const ip of items) {
        if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) continue;
        if (seen.has(ip)) continue;
        seen.add(ip);
        list.push(ip);
    }
    return list;
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
        $httpClient.get({ url: CUSTOM_URL || "https://cdn.jsdelivr.net/gh/ymyuuu/IPDB@main/bestcf.txt", timeout: 5000, node: "DIRECT" }, (err, resp, data) => {
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

async function fetchDnsResolvedIPs(domain) {
    const endpoints = [
        {
            url: `https://dns.alidns.com/resolve?name=${encodeURIComponent(domain)}&type=A`,
            headers: { "Accept": "application/dns-json", "User-Agent": "Loon" }
        },
        {
            url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`,
            headers: { "Accept": "application/dns-json", "User-Agent": "Loon" }
        }
    ];

    const results = [];
    for (const endpoint of endpoints) {
        // 任一 DoH 可用即可，不让单点失败影响整体。
        const ips = await new Promise((resolve) => {
            $httpClient.get({ url: endpoint.url, headers: endpoint.headers, timeout: 2500, node: "DIRECT" }, (err, resp, data) => {
                if (err || !resp || resp.status !== 200 || !data) {
                    resolve([]);
                    return;
                }
                try {
                    const json = JSON.parse(data);
                    const answer = Array.isArray(json.Answer) ? json.Answer : [];
                    const list = answer.map(item => item && item.data ? String(item.data).trim() : "");
                    resolve(uniqueIPv4List(list));
                } catch (e) {
                    resolve([]);
                }
            });
        });
        results.push(...ips);
    }

    return uniqueIPv4List(results).slice(0, 6);
}

async function syncToGist(ip) {
    const apiBase = "https://api.github.com/gists";
    const headers = { "Authorization": `token ${GITHUB_TOKEN}`, "Accept": "application/vnd.github.v3+json", "User-Agent": "Loon" };
    const withProxy = USE_IN_PROXY === "on" || USE_IN_PROXY === "true" || USE_IN_PROXY === "1";
    const hostLines = DOMAINS.map(d => withProxy ? `${d} = ${ip}, use-in-proxy=true` : `${d} = ${ip}`);
    const hostBody = `[Host]\n# 更新时间: ${new Date().toLocaleString()}\n` + hostLines.join("\n");
    const pluginHeader = [
        "#!name=CF HostMap Sync",
        "#!desc=由 CF 优选脚本自动生成，请勿手动编辑。",
        "#!author=@Lee",
        "#!loon_version=3.2.1"
    ].join("\n");
    const hostContent = OUTPUT_MODE === "host" ? hostBody : `${pluginHeader}\n\n${hostBody}`;
    const payload = { files: { [GIST_FILENAME]: { content: hostContent } } };

    try {
        await new Promise((resolve, reject) => {
            $httpClient.patch({ url: `${apiBase}/${GIST_ID}`, headers, body: JSON.stringify(payload) }, (err, resp) => {
                if (err || !resp || resp.status < 200 || resp.status >= 300) {
                    reject(new Error(`status=${resp ? resp.status : "n/a"}`));
                    return;
                }
                resolve();
            });
        });

        // 写后快速校验，避免接口成功但文件未按预期更新。
        await new Promise((resolve, reject) => {
            $httpClient.get({ url: `${apiBase}/${GIST_ID}`, headers, timeout: 4000, node: "DIRECT" }, (err, resp, data) => {
                if (err || !resp || resp.status !== 200 || !data) {
                    reject(new Error("verify-failed"));
                    return;
                }
                try {
                    const json = JSON.parse(data);
                    const files = json.files || {};
                    const current = files[GIST_FILENAME] && typeof files[GIST_FILENAME].content === "string"
                        ? files[GIST_FILENAME].content
                        : "";
                    const mustContain = `${DOMAINS[0]} = ${ip}`;
                    if (!current.includes(mustContain)) {
                        reject(new Error("verify-mismatch"));
                        return;
                    }
                    resolve();
                } catch (e) {
                    reject(new Error("verify-parse-error"));
                }
            });
        });

        return true;
    } catch (e) {
        console.log(`❌ Gist 更新失败: ${e.message}`);
        return false;
    }
}

async function main() {
    const mainDomain = DOMAINS[0];
    const sourceIPs = await fetchDiverseIPs();
    const dnsIPs = await fetchDnsResolvedIPs(mainDomain);

    const currentIP = $persistentStore.read("CF_CURRENT_IP");
    const candidates = uniqueIPv4List([
        ...(currentIP ? [currentIP] : []),
        ...dnsIPs,
        ...sourceIPs
    ]).slice(0, 30);

    if (candidates.length === 0) {
        console.log("❌ 没有可用候选 IP，跳过本轮。");
        $done();
        return;
    }

    const results = await Promise.all(candidates.map(ip => burstPing(ip, mainDomain)));
    results.sort((a, b) => a.delay - b.delay);
    const best = results[0];

    const currentResult = currentIP
        ? (results.find(r => r.ip === currentIP) || { ip: currentIP, delay: 9999 })
        : { ip: "", delay: 9999 };
    const dnsBest = results.filter(r => dnsIPs.includes(r.ip)).sort((a, b) => a.delay - b.delay)[0] || { ip: "-", delay: 9999 };

    console.log(`[候选] 缓存IP=${currentResult.ip || "无"}/${currentResult.delay}ms | DNS最佳=${dnsBest.ip}/${dnsBest.delay}ms | 池最佳=${best.ip}/${best.delay}ms`);

    const now = Date.now();
    const lastSwitchAt = Number.parseInt($persistentStore.read("CF_LAST_SWITCH_AT") || "0", 10) || 0;
    const sinceLastSwitch = now - lastSwitchAt;
    const intervalMet = sinceLastSwitch >= MIN_SWITCH_INTERVAL_MS;
    const currentHealthy = currentIP && currentResult.delay <= STICKY_MS;
    const currentUnhealthy = !currentIP || currentResult.delay >= 9999 || currentResult.delay > STICKY_MS;
    const betterBy = currentResult.delay - best.delay;
    const healthyCandidate = best.delay < 9999;

    let shouldSwitch = false;
    let reason = "";

    if (!healthyCandidate) {
        reason = "最佳候选不可用";
    } else if (!currentIP) {
        shouldSwitch = true;
        reason = "首次写入映射";
    } else if (best.ip === currentIP) {
        reason = "最佳候选与当前映射一致";
    } else if (currentHealthy && !intervalMet) {
        reason = `未达到最小切换间隔(${MIN_SWITCH_MINUTES}分钟)`;
    } else if (currentUnhealthy && betterBy > 0) {
        shouldSwitch = true;
        reason = "当前映射不健康，切换到可用更优IP";
    } else if (intervalMet && betterBy >= MIN_IMPROVEMENT) {
        shouldSwitch = true;
        reason = `满足切换阈值(提升 ${betterBy}ms)`;
    } else {
        reason = `提升不足阈值(仅提升 ${betterBy}ms, 阈值 ${MIN_IMPROVEMENT}ms)`;
    }

    if (shouldSwitch) {
        const synced = await syncToGist(best.ip);
        if (synced) {
            $persistentStore.write(best.ip, "CF_CURRENT_IP");
            $persistentStore.write(String(now), "CF_LAST_SWITCH_AT");
            let stats = { date: "", count: 0 };
            try {
                stats = JSON.parse($persistentStore.read("CF_STATS") || '{"date":"","count":0}');
            } catch (e) {
                stats = { date: "", count: 0 };
            }
            const today = new Date().toLocaleDateString();
            if (stats.date !== today) stats = { date: today, count: 0 };
            stats.count += 1;
            $persistentStore.write(JSON.stringify(stats), "CF_STATS");

            $persistentStore.write(JSON.stringify({
                domain: mainDomain,
                ip: best.ip,
                delay: best.delay,
                diff: currentResult.delay === 9999 ? "未知" : (currentResult.delay - best.delay),
                count: stats.count
            }), "CF_NOTIFY_FLAG");

            if (AUTO_REFRESH_SUB === "on" || AUTO_REFRESH_SUB === "true" || AUTO_REFRESH_SUB === "1") {
                $notification.post(
                    "CF 优选已更新",
                    "点击后刷新订阅以应用 Host 替换",
                    `${mainDomain} -> ${best.ip} (${best.delay}ms), 原IP ${currentResult.delay}ms, 模式 ${OUTPUT_MODE}`,
                    { openUrl: "loon://update?sub=all" }
                );
            }

            console.log(`✅ 调度完成: ${reason}`);
        }
    } else {
        console.log(`ℹ️ 本轮不切换: ${reason}`);
    }
    $done();
}

main();
