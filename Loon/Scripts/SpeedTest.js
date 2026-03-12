/**
 * @name 节点测速 (多线程并发峰值版)
 * @description 模拟专业测速软件，4并发拉满带宽，测出真实极速
 */

const title = '节点测速';
const pingUrl = 'https://cp.cloudflare.com/generate_204'; 

// 采用多线程策略：4条线程，每条拉取 3MB 数据，总计 12MB
const threadCount = 4; 
const bytesPerThread = 3145728; 
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

    // 2. 多线程并发测速度
    try {
        let dlStart = Date.now();
        
        // 创建 4 个并发下载任务
        let tasks = [];
        for (let i = 0; i < threadCount; i++) {
            // 给 URL 加个随机数防止缓存
            let url = `https://speed.cloudflare.com/__down?bytes=${bytesPerThread}&v=${Math.random()}`;
            tasks.push(httpGet(url, true));
        }

        // 等待 4 个任务同时完成 (Promise.all)
        await Promise.all(tasks);
        
        let dlEnd = Date.now();

        // 计算速度
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
            <b>⟦ 并发测速结果 ⟧ </b><br>
            -------------------------</font><br><br>
            <b>节点名称</b><br>
            <small><small>${nodeName}</small></small><br><br>
            <b>网络延迟</b><br>
            <small>${pingResult}</small><br><br>
            <b>峰值速度 (4线程)</b><br>
            <small><font color="#007aff">${speedMbps} Mbps</font> (${speedMBs} MB/s)</small><br><br>
            -----------------------------------<br>
            <font color="#6959CD"><small>Loon SpeedTest Multi-Thread</small></font>
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
