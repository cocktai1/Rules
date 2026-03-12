/**
 * @name Loon节点测速
 */
const title = '节点测速';
const pingUrl = 'http://cp.cloudflare.com/generate_204';
const downloadBytes = 10485760; 
const timeoutSeconds = 6; 

let nodeName = "未知节点";
if (typeof $environment !== 'undefined' && $environment.params) {
    nodeName = typeof $environment.params === 'object' ? ($environment.params.node || "当前策略") : $environment.params;
}

async function testSpeed() {
    try {
        let pingStart = Date.now();
        await httpGet(pingUrl, true, 3);
        let ping = Date.now() - pingStart;

        let dlStart = Date.now();
        await httpGet(`https://speed.cloudflare.com/__down?bytes=${downloadBytes}`, true, timeoutSeconds);
        let dlEnd = Date.now();

        let timeInSeconds = Math.max((dlEnd - dlStart) / 1000, 0.001); 
        let bytesPerSecond = downloadBytes / timeInSeconds;
        
        let mbps = ((bytesPerSecond * 8) / 1000000).toFixed(2); 
        let mb_s = (bytesPerSecond / 1048576).toFixed(2); 

        let htmlMessage = `
        <p style="text-align: center; font-family: -apple-system; font-size: large; font-weight: 300; padding-top: 15px;">
            <br><font color="#00b400">-------------------------<br>
            <b>⟦ 测速结果 ⟧ </b><br>
            -------------------------</font><br><br>
            <b>节点名称</b><br>
            <small><small>${nodeName}</small></small><br><br>
            <b>网络延迟</b><br>
            <small>${ping} ms</small><br><br>
            <b>峰值速度</b><br>
            <small><font color="#007aff">${mbps} Mbps</font> (${mb_s} MB/s)</small><br><br>
            -----------------------------------<br>
            <font color="#6959CD"><small>Loon SpeedTest</small></font>
        </p>
        `;

        $done({
            title: title,
            content: `延迟: ${ping} ms | 速度: ${mbps} Mbps`, 
            htmlMessage: htmlMessage
        });

    } catch (error) {
        let errMsg = String(error.message || error);
        let failReason = errMsg.includes("timeout") ? `测速超时（节点过慢或失联）` : `测速失败: ${errMsg}`;
        
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
