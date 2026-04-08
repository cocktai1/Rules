const ARG = (typeof $argument === "object" && $argument !== null) ? $argument : {};
const AUTO_REFRESH_SUB = ((ARG.CF_AUTO_REFRESH_SUB || "on") + "").trim().toLowerCase();
const enabled = AUTO_REFRESH_SUB === "on" || AUTO_REFRESH_SUB === "true" || AUTO_REFRESH_SUB === "1";

if (!enabled) {
    $done();
}

const pendingRaw = $persistentStore.read("CF_PENDING_SUB_REFRESH") || "";
if (!pendingRaw) {
    $done();
}

let pending = null;
try {
    pending = JSON.parse(pendingRaw);
} catch (e) {
    $persistentStore.write("", "CF_PENDING_SUB_REFRESH");
    $done();
}

if (!pending || !pending.domain || !pending.ip) {
    $persistentStore.write("", "CF_PENDING_SUB_REFRESH");
    $done();
}

const lastSyncAt = Number.parseInt($persistentStore.read("CF_LAST_GIST_SYNC_AT") || "0", 10) || 0;
const now = Date.now();

// 仅在最近15分钟内有同步时提醒，避免陈旧提示。
if (lastSyncAt === 0 || now - lastSyncAt > 15 * 60 * 1000) {
    $persistentStore.write("", "CF_PENDING_SUB_REFRESH");
    $done();
}

$notification.post(
    "CF 映射待生效",
    "后置提醒：点击刷新订阅以加载最新 HostMap",
    `${pending.domain} -> ${pending.ip} (${pending.delay}ms)`,
    { openUrl: "loon://update?sub=all" }
);

$persistentStore.write("", "CF_PENDING_SUB_REFRESH");
$done();
