/**
 * @name 节点测速 (类 Speedtest)
 * @description 彻底移除 Loon 容易误判的 timeout 参数，纯 JS 逻辑控制 4 秒持续高压测速
 */

const title = '节点测速';
const pingUrl = 'https://cp.cloudflare.com/generate_204'; 

// 核心测速参数
const testDurationMs = 4000; // 持续测速时长：4秒
const chunkSize = 2097152; // 每个碎块 2MB
const concurrency = 3; // 每次并发 3 个请求 (每次压入 6MB，绝不爆内存)

let nodeName = "未知节点";
if (typeof $environment !== 'undefined' && $environment.params) {
    nodeName = typeof $environment.params === 'object' ? ($environment.params.node || "当前策略") : $environment.params;
}

async function testSpeed() {
    let pingResult = "超时";
    let speedMbps = "0.00";
    let speedMBs = "0.00";
    let finalError = null;

    // 1. 测延迟 (去除了底层 timeout)
    try {
        let pingStart = Date.now();
        await httpGet(pingUrl, true);
        pingResult = (Date.now() - pingStart) + " ms";
    } catch (error) {
        pingResult = "Ping失败";
    }

    // 2. 类 Speedtest 时间驱动循环测速
    let totalBytesDownloaded = 0;
    let dlStart = Date.now();
    let dlEnd = dlStart;
    let failCount = 0; // 连续失败计数器

    try {
        // 只要测速还没满 4 秒，就一直循环发包
        while (Date.now() - dlStart < testDurationMs) {
            let tasks = [];
            for (let i = 0; i < concurrency; i++) {
                // 加随机数防止 CDN 缓存骗速度
                let url = `https://speed.cloudflare.com/__down?bytes=${chunkSize}&v=${Math.random()}`;
                tasks.push(downloadChunk(url));
            }
            
            // 等待这 3 个碎块下完
            let results = await Promise.all(tasks);
            
            // 计算这一批下到了多少数据
            let batchBytes = results.reduce((sum, bytes) => sum + bytes, 0);
            totalBytesDownloaded += batchBytes;

            // 异常保护：如果完全没有数据过来，记录失败；连续 2 次全失败说明节点断流，跳出循环
            if (batchBytes === 0) {
                failCount++;
                if (failCount >= 2) break;
            } else {
                failCount = 0; 
            }
        }

        dlEnd = Date.now();

        // 3. 计算 4 秒内的综合峰值速度
        let timeInSeconds = Math.max((dlEnd - dlStart) / 1000, 0.001); 
        let bytesPerSecond = totalBytesDownloaded / timeInSeconds;
        
        speedMbps = ((bytesPerSecond * 8) / 1000000).toFixed(2); 
        speedMBs = (bytesPerSecond / 1048576).toFixed(2); 

    } catch (error) {
        finalError = error;
    }

    // 4. 渲染面板
    if (finalError && totalBytesDownloaded === 0) {
        let errMsg = String(finalError.message || finalError);
        $done({
            title: "测速失败",
            content: "网络连接断开",
            htmlMessage: `
            <p style="text-align: center; font-family: -apple-system; padding-top: 15px;">
                <br><font color="#f00">-------------------------<br>
                <b>⟦ 测速失败 ⟧</b><br>
                -------------------------</font><br><br>
                <b>${nodeName}</b><br><br>
                <small>无数据返回。<br>可能原因：节点断流。<br>${errMsg}</small>
            </p>`
        });
    } else {
        let htmlMessage = `
        <p style="text-align: center; font-family: -apple-system; font-size: large; font-weight: 300; padding-top: 15px;">
            <br><font color="#00b400">-------------------------<br>
            <b>⟦ Speedtest 模拟测速 ⟧ </b><br>
            -------------------------</font><br><br>
            <b>节点名称</b><br>
            <small><small>${nodeName}</small></small><br><br>
            <b>网络延迟</b><br>
            <small>${pingResult}</small><br><br>
            <b>持续峰值 (拉锯4秒)</b><br>
            <small><font color="#007aff">${speedMbps} Mbps</font> (${speedMBs} MB/s)</small><br><br>
            -----------------------------------<br>
            <font color="#6959CD"><small>Loon Speedtest Pro</small></font>
        </p>
        `;

        $done({
            title: title,
            content: `延迟: ${pingResult} | 速度: ${speedMbps} Mbps`, 
            htmlMessage: htmlMessage
        });
    }
}

// 专门下碎块的函数，彻底移除 timeout 参数
function downloadChunk(url) {
    return new Promise((resolve) => {
        let options = { url: url }; // 绝不写 timeout
        if (nodeName !== "未知节点" && nodeName !== "当前策略") {
            options.node = nodeName; 
        }
        $httpClient.get(options, (error, response, data) => {
            if (error || !response || response.status !== 200) {
                resolve(0); 
            } else {
                resolve(chunkSize); 
            }
        });
    });
}

// 基础 HTTP 请求 (测 Ping 用)，彻底移除 timeout 参数
function httpGet(url, useNode = false) {
    return new Promise((resolve, reject) => {
        let options = { url: url }; // 绝不写 timeout
        if (useNode && nodeName !== "未知节点" && nodeName !== "当前策略") {
            options.node = nodeName; 
        }
        $httpClient.get(options, (error, response, data) => {
            if (error) reject(error);
            else resolve(data);
        });
    });
}

testSpeed();
