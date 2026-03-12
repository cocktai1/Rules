/**
 * @name 节点测速 (抗内存溢出 + 真实错误追踪版)
 */

const title = '节点测速';
const pingUrl = 'https://cp.cloudflare.com/generate_204'; 
const downloadBytes = 2097152; // 降到 2MB，避开 iOS 的 15MB 内存红线

let nodeName = "未知节点";
if (typeof $environment !== 'undefined' && $environment.params) {
    nodeName = typeof $environment.params === 'object' ? ($environment.params.node || "当前策略") : $environment.params;
}

async function testSpeed() {
    let pingResult = "超时";
    let speedMbps = "0.00";
    let speedMBs = "0.00";
    let finalError = null;

    // 1. 独立测延迟
    try {
        let pingStart = Date.now();
        await httpGet(pingUrl, true);
        pingResult = (Date.now() - pingStart) + " ms";
    } catch (error) {
        // 如果 Ping 失败，保留真实错误但不中断后续下载测试
        pingResult = "Ping失败 (" + String(error.message || error) + ")";
    }

    // 2. 核心测速度
    try {
        let dlStart = Date.now();
        await httpGet(`https://speed.cloudflare.com/__down?bytes=${downloadBytes}`, true);
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
        // 把底层的最真实的报错直接吐出来，不再做修饰
        let errMsg = String(finalError.message || finalError);
        
        $done({
            title: "测速失败",
            content: "原错误信息: " + errMsg,
            htmlMessage: `
            <p style="text-align: center; font-family: -apple-system; padding-top: 15px;">
                <br><font color="#f00">-------------------------<br>
                <b>⟦ 测速失败 ⟧</b><br>
                -------------------------</font><br><br>
                <b>${nodeName}</b><br><br>
                <small><b>底层原声错误：</b><br>${errMsg}</small>
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

function httpGet(url, useNode = false) {
    return new Promise((resolve, reject) => {
        // 去掉了 timeout 属性，防止 10 被解析为 10ms 导致秒杀
        let options = { url: url };
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
