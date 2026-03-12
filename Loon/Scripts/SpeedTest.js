/**
 * @name 节点测速 (极限爆发测速版)
 * @description 逼近 iOS 内存极限，瞬间吞吐 25MB 数据以测算高带宽节点的峰值
 */

const title = '节点测速';
const pingUrl = 'https://cp.cloudflare.com/generate_204'; 

// 极限并发策略：5条线程，每条拉取 5MB 数据，总计 25MB (逼近内存红线)
const threadCount = 5; 
const bytesPerThread = 5242880; 
const totalBytes = threadCount * bytesPerThread; 

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
        pingResult = "Ping失败 (" + String(error.message || error) + ")";
    }

    // 2. 极限多线程爆发测速度
    try {
        let dlStart = Date.now();
        
        let tasks = [];
        for (let i = 0; i < threadCount; i++) {
            let url = `https://speed.cloudflare.com/__down?bytes=${bytesPerThread}&v=${Math.random()}`;
            tasks.push(httpGet(url, true));
        }

        await Promise.all(tasks);
        
        let dlEnd = Date.now();

        // 核心计算：哪怕只用了 0.5 秒下完 25MB，也能算出极高的 MB/s
        let timeInSeconds = Math.max((dlEnd - dlStart) / 1000, 0.001); 
        let bytesPerSecond = totalBytes / timeInSeconds;
        
        speedMbps = ((bytesPerSecond * 8) / 1000000).toFixed(2); 
        speedMBs = (bytesPerSecond / 1048576).toFixed(2); 
    } catch (error) {
        finalError = error;
    }

    // 3. 渲染结果
    if (finalError && speedMbps === "0.00") {
        let errMsg = String(finalError.message || finalError);
        $done({
            title: "测速失败",
            content: "测速过程意外中断",
            htmlMessage: `
            <p style="text-align: center; font-family: -apple-system; padding-top: 15px;">
                <br><font color="#f00">-------------------------<br>
                <b>⟦ 测速失败 ⟧</b><br>
                -------------------------</font><br><br>
                <b>${nodeName}</b><br><br>
                <small>如果看到此报错，可能是 25MB 瞬间吞吐触发了系统内存限制。<br>底层报错：${errMsg}</small>
            </p>`
        });
    } else {
        let htmlMessage = `
        <p style="text-align: center; font-family: -apple-system; font-size: large; font-weight: 300; padding-top: 15px;">
            <br><font color="#00b400">-------------------------<br>
            <b>⟦ 爆发测速结果 ⟧ </b><br>
            -------------------------</font><br><br>
            <b>节点名称</b><br>
            <small><small>${nodeName}</small></small><br><br>
            <b>网络延迟</b><br>
            <small>${pingResult}</small><br><br>
            <b>爆发极速 (25MB载荷)</b><br>
            <small><font color="#007aff">${speedMbps} Mbps</font> (${speedMBs} MB/s)</small><br><br>
            -----------------------------------<br>
            <font color="#6959CD"><small>Loon SpeedTest Burst</small></font>
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
