// === 参数读取与安全检查 ===
const ARG = (typeof $argument === "object" && $argument !== null) ? $argument : {};
const isPlaceholder = (value) => typeof value === "string" && /^\{.+\}$/.test(value.trim());

const GITHUB_TOKEN = (ARG.CF_TOKEN || "").trim();
const DOMAINS_RAW = (ARG.CF_DOMAIN || "").trim();
const CUSTOM_URL = (ARG.CF_IP_URL || "https://cdn.jsdelivr.net/gh/ymyuuu/IPDB@main/bestcf.txt").trim();
const GIST_ID = (ARG.CF_GIST_ID || "").trim();
const MIN_IMPROVEMENT = Number.parseInt((ARG.CF_MIN_IMPROVEMENT || "120").trim(), 10) || 120;
const STICKY_MS = Number.parseInt((ARG.CF_STICKY_MS || "180").trim(), 10) || 180;
const MIN_SWITCH_MINUTES = Number.parseInt((ARG.CF_MIN_SWITCH_MINUTES || "720").trim(), 10) || 720;
const CANDIDATE_LIMIT = Number.parseInt((ARG.CF_CANDIDATE_LIMIT || "20").trim(), 10) || 20;
const EVAL_ROUNDS = Math.min(5, Math.max(1, Number.parseInt((ARG.CF_EVAL_ROUNDS || "3").trim(), 10) || 3));
const PING_SAMPLES = Math.min(6, Math.max(2, Number.parseInt((ARG.CF_PING_SAMPLES || "4").trim(), 10) || 4));
const JITTER_WEIGHT = Number.parseFloat((ARG.CF_JITTER_WEIGHT || "0.9").trim()) || 0.9;
const REQUIRE_BEAT_DNS = ((ARG.CF_REQUIRE_BEAT_DNS || "on") + "").trim().toLowerCase();
const DNS_MARGIN_MS = Number.parseInt((ARG.CF_DNS_MARGIN_MS || "120").trim(), 10) || 120;
const MAX_ACCEPT_DELAY = Number.parseInt((ARG.CF_MAX_ACCEPT_DELAY || "450").trim(), 10) || 450;
const PROBE_PATH = (ARG.CF_PROBE_PATH || "").trim();
const PROBE_TIMEOUT = Number.parseInt((ARG.CF_PROBE_TIMEOUT || "4000").trim(), 10) || 4000;
const MIN_PROBE_KBPS = Number.parseInt((ARG.CF_MIN_PROBE_KBPS || "300").trim(), 10) || 300;
const BAD_RUN_PAUSE_MINUTES = Number.parseInt((ARG.CF_BAD_RUN_PAUSE_MINUTES || "30").trim(), 10) || 30;
const USE_IN_PROXY = ((ARG.CF_USE_IN_PROXY || "on") + "").trim().toLowerCase();
const OUTPUT_MODE = ((ARG.CF_OUTPUT_MODE || "plugin") + "").trim().toLowerCase();
const GIST_FILENAME = (ARG.CF_GIST_FILE || "CF_HostMap.plugin").trim();
const GENERATED_ICON = (ARG.CF_GENERATED_ICON || "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Cloudflare.png").trim();
const POST_SYNC_SCRIPT_URL = (ARG.CF_POST_SYNC_SCRIPT_URL || "https://raw.githubusercontent.com/cocktai1/Rules/refs/heads/main/Loon/Scripts/cf_post_sync_refresh.js").trim();
const GENERATED_CRON = (ARG.CF_GENERATED_CRON || "17 * * * *").trim();
const LOW_NOISE_MODE = ((ARG.CF_LOW_NOISE_MODE || "on") + "").trim().toLowerCase();
const NOTIFY_COOLDOWN_MINUTES = Number.parseInt((ARG.CF_NOTIFY_COOLDOWN_MINUTES || "180").trim(), 10) || 180;
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
const BAD_RUN_PAUSE_MS = BAD_RUN_PAUSE_MINUTES * 60 * 1000;
const NOTIFY_COOLDOWN_MS = NOTIFY_COOLDOWN_MINUTES * 60 * 1000;

function shouldSendNotification(channel, fingerprint) {
    const lowNoise = LOW_NOISE_MODE === "on" || LOW_NOISE_MODE === "true" || LOW_NOISE_MODE === "1";
    const tsKey = `CF_NOTIFY_LAST_TS_${channel}`;
    const fpKey = `CF_NOTIFY_LAST_FP_${channel}`;
    const now = Date.now();
    const lastTs = Number.parseInt($persistentStore.read(tsKey) || "0", 10) || 0;
    const lastFp = $persistentStore.read(fpKey) || "";

    if (lowNoise && lastFp === fingerprint && now - lastTs < NOTIFY_COOLDOWN_MS) {
        return false;
    }

    $persistentStore.write(String(now), tsKey);
    $persistentStore.write(fingerprint, fpKey);
    return true;
}

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

function calcStats(delays) {
    if (!delays.length) return { avg: 9999, jitter: 9999, successRate: 0 };
    const avg = delays.reduce((a, b) => a + b, 0) / delays.length;
    const max = Math.max(...delays);
    const min = Math.min(...delays);
    return {
        avg: Math.round(avg),
        jitter: Math.round(max - min),
        successRate: delays.length / PING_SAMPLES
    };
}

function calcScore(metrics) {
    const penalty = Math.round((1 - metrics.successRate) * 900);
    return Math.round(metrics.avg + metrics.jitter * JITTER_WEIGHT + penalty);
}

async function samplePing(ip, host) {
    const tasks = [];
    for (let i = 0; i < PING_SAMPLES; i += 1) {
        tasks.push(new Promise(resolve => setTimeout(() => resolve(ping(ip, host)), i * 90)));
    }
    const results = await Promise.all(tasks);
    const validDelays = results.filter(r => r.delay < 9999).map(r => r.delay);
    const stats = calcStats(validDelays);
    return {
        ip,
        delay: stats.avg,
        jitter: stats.jitter,
        successRate: Number(stats.successRate.toFixed(2)),
        score: calcScore(stats),
        probeKbps: null
    };
}

function normalizeProbePath(value) {
    if (!value) return "";
    if (value.startsWith("http://") || value.startsWith("https://")) {
        const idx = value.indexOf("/", value.indexOf("//") + 2);
        return idx >= 0 ? value.slice(idx) : "/";
    }
    return value.startsWith("/") ? value : `/${value}`;
}

function normalizeProbePathList(value) {
    if (!value) return [];
    return value
        .split(",")
        .map(v => normalizeProbePath(v.trim()))
        .filter(Boolean)
        .slice(0, 4);
}

async function runSingleProbe(ip, host, path) {
    if (!path) return null;

    const started = Date.now();
    return new Promise(resolve => {
        const url = `http://${ip}${path}`;
        const headers = { "Host": host, "User-Agent": "Mozilla/5.0" };
        $httpClient.get({ url, headers, timeout: PROBE_TIMEOUT, node: "DIRECT", "binary-mode": true }, (err, resp, data) => {
            if (err || !resp || resp.status < 200 || resp.status >= 400) {
                resolve({ kbps: 0, ok: false });
                return;
            }

            const elapsedSec = Math.max((Date.now() - started) / 1000, 0.2);
            let bytes = 0;
            if (typeof data === "string") {
                bytes = data.length;
            } else if (data && typeof data.byteLength === "number") {
                bytes = data.byteLength;
            } else if (data && typeof data.length === "number") {
                bytes = data.length;
            }

            const kbps = Math.round((bytes / 1024) / elapsedSec);
            resolve({ kbps, ok: kbps > 0 });
        });
    });
}

async function runProbe(ip, host) {
    const paths = normalizeProbePathList(PROBE_PATH);
    if (!paths.length) return null;

    const all = [];
    for (const p of paths) {
        const r = await runSingleProbe(ip, host, p);
        if (r) all.push(r);
    }
    const ok = all.filter(r => r.ok && r.kbps > 0);
    if (!ok.length) return { kbps: 0, ok: false };
    const avg = Math.round(ok.reduce((s, r) => s + r.kbps, 0) / ok.length);
    return { kbps: avg, ok: true };
}

async function evaluateCandidates(candidates, host) {
    const acc = new Map();
    for (let round = 0; round < EVAL_ROUNDS; round += 1) {
        const roundData = await Promise.all(candidates.map(ip => samplePing(ip, host)));
        for (const r of roundData) {
            const old = acc.get(r.ip) || { delay: 0, jitter: 0, successRate: 0, score: 0, count: 0 };
            old.delay += r.delay;
            old.jitter += r.jitter;
            old.successRate += r.successRate;
            old.score += r.score;
            old.count += 1;
            acc.set(r.ip, old);
        }
    }

    const base = Array.from(acc.entries()).map(([ip, v]) => ({
        ip,
        delay: Math.round(v.delay / v.count),
        jitter: Math.round(v.jitter / v.count),
        successRate: Number((v.successRate / v.count).toFixed(2)),
        score: Math.round(v.score / v.count),
        probeKbps: null
    }));

    base.sort((a, b) => a.score - b.score);

    if (!PROBE_PATH) return base;

    const top = base.slice(0, Math.min(6, base.length));
    for (const item of top) {
        const probe = await runProbe(item.ip, host);
        item.probeKbps = probe ? probe.kbps : null;
        if (!probe || !probe.ok) {
            item.score += 600;
            continue;
        }
        if (item.probeKbps < MIN_PROBE_KBPS) {
            item.score += 400;
        } else {
            // 降低评分，鼓励更高吞吐链路。
            item.score -= Math.min(220, Math.round(item.probeKbps / 20));
        }
    }

    base.sort((a, b) => a.score - b.score);
    return base;
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
                if (candidates.length >= CANDIDATE_LIMIT) break;
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
        "#!loon_version=3.2.1",
        `#!icon=${GENERATED_ICON}`
    ].join("\n");

    const generatedScriptBlock = [
        "[Script]",
        `cron \"${GENERATED_CRON}\" script-path=${POST_SYNC_SCRIPT_URL}, tag=CFHostMap后置提醒, argument=[CF_AUTO_REFRESH_SUB=${AUTO_REFRESH_SUB},CF_LOW_NOISE_MODE=${LOW_NOISE_MODE},CF_NOTIFY_COOLDOWN_MINUTES=${NOTIFY_COOLDOWN_MINUTES}]`
    ].join("\n");

    const hostContent = OUTPUT_MODE === "host"
        ? hostBody
        : `${pluginHeader}\n\n${hostBody}\n\n${generatedScriptBlock}`;
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
    const pauseUntil = Number.parseInt($persistentStore.read("CF_SWITCH_PAUSE_UNTIL") || "0", 10) || 0;
    if (Date.now() < pauseUntil) {
        const leftMin = Math.ceil((pauseUntil - Date.now()) / 60000);
        console.log(`⏸️ 处于退避窗口，剩余约 ${leftMin} 分钟，跳过切换。`);
        $done();
        return;
    }

    const mainDomain = DOMAINS[0];
    const sourceIPs = await fetchDiverseIPs();
    const dnsIPs = await fetchDnsResolvedIPs(mainDomain);

    const currentIP = $persistentStore.read("CF_CURRENT_IP");
    const candidates = uniqueIPv4List([
        ...(currentIP ? [currentIP] : []),
        ...dnsIPs,
        ...sourceIPs
    ]).slice(0, CANDIDATE_LIMIT);

    if (candidates.length === 0) {
        console.log("❌ 没有可用候选 IP，跳过本轮。");
        $done();
        return;
    }

    const results = await evaluateCandidates(candidates, mainDomain);
    const best = results[0];

    const currentResult = currentIP
        ? (results.find(r => r.ip === currentIP) || { ip: currentIP, delay: 9999, jitter: 9999, successRate: 0, score: 9999, probeKbps: null })
        : { ip: "", delay: 9999, jitter: 9999, successRate: 0, score: 9999, probeKbps: null };
    const dnsBest = results.filter(r => dnsIPs.includes(r.ip)).sort((a, b) => a.score - b.score)[0] || { ip: "-", delay: 9999, jitter: 9999, successRate: 0, score: 9999, probeKbps: null };

    const bestProbe = best && best.probeKbps !== null ? `${best.probeKbps}KB/s` : "n/a";
    const dnsProbe = dnsBest && dnsBest.probeKbps !== null ? `${dnsBest.probeKbps}KB/s` : "n/a";

    console.log(`[候选] 缓存IP=${currentResult.ip || "无"}/${currentResult.delay}ms/j${currentResult.jitter}/s${currentResult.score} | DNS最佳=${dnsBest.ip}/${dnsBest.delay}ms/p${dnsProbe}/s${dnsBest.score} | 池最佳=${best.ip}/${best.delay}ms/p${bestProbe}/s${best.score}`);

    const now = Date.now();
    const lastSwitchAt = Number.parseInt($persistentStore.read("CF_LAST_SWITCH_AT") || "0", 10) || 0;
    const sinceLastSwitch = now - lastSwitchAt;
    const intervalMet = sinceLastSwitch >= MIN_SWITCH_INTERVAL_MS;
    const currentHealthy = currentIP && currentResult.delay <= STICKY_MS;
    const currentUnhealthy = !currentIP || currentResult.delay >= 9999 || currentResult.delay > STICKY_MS;
    const betterBy = currentResult.delay - best.delay;
    const scoreBetterBy = currentResult.score - best.score;
    const healthyCandidate = best.delay < 9999;
    const requireBeatDns = REQUIRE_BEAT_DNS === "on" || REQUIRE_BEAT_DNS === "true" || REQUIRE_BEAT_DNS === "1";
    const beatsDnsEnough = dnsBest.delay < 9999 ? (best.delay + DNS_MARGIN_MS < dnsBest.delay) : true;
    const probeEnabled = Boolean(normalizeProbePath(PROBE_PATH));
    const probeHealthy = !probeEnabled || (best.probeKbps !== null && best.probeKbps >= MIN_PROBE_KBPS);

    let shouldSwitch = false;
    let reason = "";
    let badRound = false;

    if (!healthyCandidate) {
        reason = "最佳候选不可用";
        badRound = true;
    } else if (!probeHealthy) {
        reason = `业务探针速率不足(${best.probeKbps || 0}KB/s < ${MIN_PROBE_KBPS}KB/s)`;
        badRound = true;
    } else if (best.delay > MAX_ACCEPT_DELAY) {
        reason = `候选延迟过高(${best.delay}ms>${MAX_ACCEPT_DELAY}ms)，不固化映射`;
        badRound = true;
    } else if (!currentIP) {
        if (requireBeatDns && !beatsDnsEnough) {
            reason = `首次运行且未显著优于DNS(阈值 ${DNS_MARGIN_MS}ms)，保持DNS动态调度`;
        } else {
            shouldSwitch = true;
            reason = "首次写入映射";
        }
    } else if (best.ip === currentIP) {
        reason = "最佳候选与当前映射一致";
    } else if (currentUnhealthy && betterBy > 0) {
        shouldSwitch = true;
        reason = "当前映射不健康，优先恢复到更优可用IP";
    } else if (requireBeatDns && !beatsDnsEnough) {
        reason = `未显著优于DNS(阈值 ${DNS_MARGIN_MS}ms)，不固化映射`;
    } else if (currentHealthy && !intervalMet) {
        reason = `未达到最小切换间隔(${MIN_SWITCH_MINUTES}分钟)`;
    } else if (intervalMet && betterBy >= MIN_IMPROVEMENT && scoreBetterBy >= Math.round(MIN_IMPROVEMENT * 0.6)) {
        shouldSwitch = true;
        reason = `满足切换阈值(延迟提升 ${betterBy}ms, 评分提升 ${scoreBetterBy})`;
    } else {
        reason = `提升不足阈值(延迟提升 ${betterBy}ms, 评分提升 ${scoreBetterBy})`;
    }

    if (shouldSwitch) {
        const synced = await syncToGist(best.ip);
        if (synced) {
            $persistentStore.write("0", "CF_BAD_ROUND_COUNT");
            $persistentStore.write("0", "CF_SWITCH_PAUSE_UNTIL");
            $persistentStore.write(best.ip, "CF_CURRENT_IP");
            $persistentStore.write(String(now), "CF_LAST_SWITCH_AT");
            $persistentStore.write(String(now), "CF_LAST_GIST_SYNC_AT");
            $persistentStore.write(JSON.stringify({
                domain: mainDomain,
                ip: best.ip,
                delay: best.delay,
                oldDelay: currentResult.delay
            }), "CF_PENDING_SUB_REFRESH");
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
                const fp = `${mainDomain}|${best.ip}|${OUTPUT_MODE}`;
                if (shouldSendNotification("MAIN", fp)) {
                    $notification.post(
                        "CF 优选已更新",
                        "点击后刷新订阅以应用 Host 替换",
                        `${mainDomain} -> ${best.ip} (${best.delay}ms), 原IP ${currentResult.delay}ms, 模式 ${OUTPUT_MODE}`,
                        { openUrl: "loon://update?sub=all" }
                    );
                }
            }

            console.log(`✅ 调度完成: ${reason}`);
        }
    } else {
        if (badRound) {
            const badCount = (Number.parseInt($persistentStore.read("CF_BAD_ROUND_COUNT") || "0", 10) || 0) + 1;
            $persistentStore.write(String(badCount), "CF_BAD_ROUND_COUNT");
            if (badCount >= 3) {
                const until = Date.now() + BAD_RUN_PAUSE_MS;
                $persistentStore.write(String(until), "CF_SWITCH_PAUSE_UNTIL");
                $persistentStore.write("0", "CF_BAD_ROUND_COUNT");
                console.log(`⏸️ 连续劣化 ${badCount} 轮，进入退避 ${BAD_RUN_PAUSE_MINUTES} 分钟。`);
            }
        } else {
            $persistentStore.write("0", "CF_BAD_ROUND_COUNT");
        }
        console.log(`ℹ️ 本轮不切换: ${reason}`);
    }
    $done();
}

main();
