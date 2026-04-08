const ARG = (typeof $argument === "object" && $argument !== null) ? $argument : {};
const AUTO_REFRESH_SUB = ((ARG.CF_AUTO_REFRESH_SUB || ARG["CF_AUTO_REFRESH_SUB"] || "on") + "").trim().toLowerCase();
const LOW_NOISE_MODE = ((ARG.CF_LOW_NOISE_MODE || ARG["CF_LOW_NOISE_MODE"] || "on") + "").trim().toLowerCase();
const NOTIFY_COOLDOWN_MINUTES = Number.parseInt(((ARG.CF_NOTIFY_COOLDOWN_MINUTES || ARG["CF_NOTIFY_COOLDOWN_MINUTES"] || "180") + "").trim(), 10) || 180;
const enabled = AUTO_REFRESH_SUB === "on" || AUTO_REFRESH_SUB === "true" || AUTO_REFRESH_SUB === "1";
const lowNoise = LOW_NOISE_MODE === "on" || LOW_NOISE_MODE === "true" || LOW_NOISE_MODE === "1";
const cooldownMs = NOTIFY_COOLDOWN_MINUTES * 60 * 1000;

if (!enabled) {
    $done();
    return;
}

const pendingRaw = $persistentStore.read("CF_PENDING_SUB_REFRESH") || "";
if (!pendingRaw) {
    $done();
    return;
}

let pending = null;
try {
    pending = JSON.parse(pendingRaw);
} catch (e) {
    $persistentStore.write("", "CF_PENDING_SUB_REFRESH");
    $done();
    return;
}

if (!pending || !pending.domain || !pending.ip) {
    $persistentStore.write("", "CF_PENDING_SUB_REFRESH");
    $done();
    return;
}

const lastSyncAt = Number.parseInt($persistentStore.read("CF_LAST_GIST_SYNC_AT") || "0", 10) || 0;
const now = Date.now();

// 仅在最近15分钟内有同步时提醒，避免陈旧提示。
if (lastSyncAt === 0 || now - lastSyncAt > 15 * 60 * 1000) {
    $persistentStore.write("", "CF_PENDING_SUB_REFRESH");
    $done();
    return;
}

const fp = `${pending.domain}|${pending.ip}|post`;
const postTs = Number.parseInt($persistentStore.read("CF_NOTIFY_LAST_TS_POST") || "0", 10) || 0;
const postFp = $persistentStore.read("CF_NOTIFY_LAST_FP_POST") || "";
const mainTs = Number.parseInt($persistentStore.read("CF_NOTIFY_LAST_TS_MAIN") || "0", 10) || 0;
const mainFp = $persistentStore.read("CF_NOTIFY_LAST_FP_MAIN") || "";

if (lowNoise) {
    if (postFp === fp && now - postTs < cooldownMs) {
        $persistentStore.write("", "CF_PENDING_SUB_REFRESH");
        $done();
        return;
    }

    const mainComparableFp = `${pending.domain}|${pending.ip}|plugin`;
    if ((mainFp === mainComparableFp || mainFp.startsWith(`${pending.domain}|${pending.ip}|`)) && now - mainTs < cooldownMs) {
        $persistentStore.write("", "CF_PENDING_SUB_REFRESH");
        $done();
        return;
    }
}

$notification.post(
    "CF 映射待生效",
    "后置提醒：点击刷新订阅以加载最新 HostMap",
    `${pending.domain} -> ${pending.ip} (${pending.delay}ms)`,
    { openUrl: "loon://update?sub=all" }
);

$persistentStore.write(String(now), "CF_NOTIFY_LAST_TS_POST");
$persistentStore.write(fp, "CF_NOTIFY_LAST_FP_POST");

$persistentStore.write("", "CF_PENDING_SUB_REFRESH");
$done();
