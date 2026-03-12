/**
 * @name 节点测速 (高容错版)
 * @description 专治 Reality/VLESS 节点的 error:(null) 和阻断问题
 */

const title = '节点测速';
// 强制使用 HTTPS，防止 Reality 节点丢弃明文 HTTP 导致 error:(null)
const pingUrl = 'https://cp.cloudflare.com/generate_204'; 
const downloadBytes = 10485760; // 10MB 测速文件
const timeoutSeconds = 10; // 给足下载时间

let nodeName = "未知节点";
if (typeof $environment !== 'undefined' && $environment.params) {
    nodeName = typeof $environment.params === 'object' ? ($environment.params.node || "当前策略") : $environment.params;
}

async function testSpeed() {
    let pingResult = "超时";
    let speedMbps = "0.00";
    let speedMBs = "0.00";
    let finalError = null;

    // 1. 独立测延迟 (即使报错也不中断整个脚本)
    try {
        let pingStart = Date.now();
        await httpGet(pingUrl, true, 5);
        pingResult = (Date.now() - pingStart) + " ms";
    } catch (error) {
        pingResult = "Ping失败";
    }

    // 2. 核心测速度
    try {
        let dlStart = Date.now();
        await httpGet(`https://speed.cloudflare.com/__down?bytes=${downloadBytes}`, true, timeoutSeconds);
        let dlEnd = Date.now();

        let timeInSeconds = Math.max((dlEnd - dlStart) / 1000, 0.001); 
        let bytesPerSecond = downloadBytes / timeInSeconds;
        
        speedMbps = ((bytesPerSecond * 8) / 1000000).toFixed(2); 
        speedMBs = (bytesPerSecond / 1048576).toFixed(2); 
    } catch (error) {
        finalError = error;
    }

    // 3. 渲染结果
    if (finalError && speedMbps === "0.00") {
        let errMsg = String(finalError.message || finalError);
        let failReason = errMsg.includes("timeout") ? `测速超时（节点未响应或下载极慢）` : `测速失败: ${errMsg}`;
        
        $done({
            title: "测速失败",
            content: failReason,
            htmlMessage: `
            <p style="text-align: center; font-family: -apple-system; padding-top: 15px;">
                <br><font color="#f00">-------------------------<br>
                <b>⟦ 测速失败 ⟧</b><br>
                -------------------------</font><br><br>
                <b>${nodeName}</b><br><br>
                <small>${failReason}</small>
            </p>`
        });
    } else {
        let htmlMessage = `
        <p style="text-align: center; font-family: -apple-system; font-size: large; font-weight: 300; padding-top: 15px;">
            <br><font color="#00b400">-------------------------<br>
            <b>⟦ 测速结果 ⟧ </b><br>
            -------------------------</font><br><br>
            <b>节点名称</b><br>
            <small><small>${nodeName}</small></small><br><br>
            <b>网络延迟</b><br>
            <small>${pingResult}</small><br><br>
            <b>峰值速度</b><br>
            <small><font color="#007aff">${speedMbps} Mbps</font> (${speedMBs} MB/s)</small><br><br>
            -----------------------------------<br>
            <font color="#6959CD"><small>Loon SpeedTest</small></font>
        </p>
        `;

        $done({
            title: title,
            content: `延迟: ${pingResult} | 速度: ${speedMbps} Mbps`, 
            htmlMessage: htmlMessage
        });
    }
}

function httpGet(url, useNode = false, timeout = 5) {
    return new Promise((resolve, reject) => {
        let options = { url: url, timeout: timeout };
        if (useNode && nodeName !== "未知节点" && nodeName !== "当前策略") {
            options.node = nodeName; 
        }
        $httpClient.get(options, (error, response, data) => {
            if (error) {
                reject(error);
            } else {
                resolve(data);
            }
        });
    });
}

testSpeed();
