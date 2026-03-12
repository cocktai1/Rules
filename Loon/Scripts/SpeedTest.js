/**
 * @name 节点测速 (类 Speedtest 时间驱动版)
 * @description 采用持续并发碎块下载，模拟专业测速软件的持续测速机制，无惧内存溢出
 */

const title = '节点测速';
const pingUrl = 'https://cp.cloudflare.com/generate_204'; 

// 核心测速参数
const testDurationMs = 4000; // 持续测速时长：4秒 (可根据耐心微调)
const chunkSize = 2097152; // 每个碎块 2MB，保证不爆内存
const concurrency = 3; // 每次并发 3 个碎块

let nodeName = "未知节点";
if (typeof $environment !== 'undefined' && $environment.params) {
    nodeName = typeof $environment.params === 'object' ? ($environment.params.node || "当前策略") : $environment.params;
}

async function testSpeed() {
    let pingResult = "超时";
    let speedMbps = "0.00";
    let speedMBs = "0.00";
    let finalError = null;

    // 1. 测试延迟 (Ping)
    try {
        let pingStart = Date.now();
        await httpGet(pingUrl, true);
        pingResult = (Date.now() - pingStart) + " ms";
    } catch (error) {
        pingResult = "Ping失败";
    }

    // 2. 类 Speedtest 时间驱动下载测速
    let totalBytesDownloaded = 0;
    let dlStart = Date.now();
    let dlEnd = dlStart;

    try {
        // 只要没到设定的测速时长，就持续疯狂拉取碎块
        while (Date.now() - dlStart < testDurationMs) {
            let tasks = [];
            for (let i = 0; i < concurrency; i++) {
                // 加随机数防止 CDN 缓存
                let url = `https://speed.cloudflare.com/__down?bytes=${chunkSize}&v=${Math.random()}`;
                tasks.push(downloadChunk(url));
            }
            
            // 等待这一批次完成
            let results = await Promise.all(tasks);
            
            // 累加成功下载的字节数
            let batchBytes = results.reduce((sum, bytes) => sum + bytes, 0);
            totalBytesDownloaded += batchBytes;

            // 如果这一批全部失败（0字节），说明节点断流，提前终止测速
            if (batchBytes === 0) break;
        }

        dlEnd = Date.now();

        // 3. 计算极限速度
        let timeInSeconds = Math.max((dlEnd - dlStart) / 1000, 0.001); 
        let bytesPerSecond = totalBytesDownloaded / timeInSeconds;
        
        speedMbps = ((bytesPerSecond * 8) / 1000000).toFixed(2); 
        speedMBs = (bytesPerSecond / 1048576).toFixed(2); 

    } catch (error) {
        finalError = error;
    }

    // 4. 渲染结果面板
    if (finalError && totalBytesDownloaded === 0) {
        let errMsg = String(finalError.message || finalError);
        $done({
            title: "测速失败",
            content: "网络连接中断",
            htmlMessage: `
            <p style="text-align: center; font-family: -apple-system; padding-top: 15px;">
                <br><font color="#f00">-------------------------<br>
                <b>⟦ 测速失败 ⟧</b><br>
                -------------------------</font><br><br>
                <b>${nodeName}</b><br><br>
                <small>底层报错：<br>${errMsg}</small>
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
            <font color="#6959CD"><small>Loon Speedtest Edition</small></font>
        </p>
        `;

        $done({
            title: title,
            content: `延迟: ${pingResult} | 速度: ${speedMbps} Mbps`, 
            htmlMessage: htmlMessage
        });
    }
}

// 封装专门用于碎块下载的请求，下载完立刻释放内存，只返回成功字节数
function downloadChunk(url) {
    return new Promise((resolve) => {
        let options = { url: url, timeout: 3 }; // 每个小块最多等 3 秒
        if (nodeName !== "未知节点" && nodeName !== "当前策略") {
            options.node = nodeName; 
        }
        $httpClient.get(options, (error, response, data) => {
            // 如果报错、没数据或者状态码不是 200，说明这块下载失败，计 0 字节
            if (error || !data || response.status !== 200) {
                resolve(0);
            } else {
                resolve(chunkSize); // 成功返回 2MB 字节数，丢弃真实数据释放内存
            }
        });
    });
}

// 基础的 HTTP 请求 (仅用于测 Ping)
function httpGet(url, useNode = false) {
    return new Promise((resolve, reject) => {
        let options = { url: url, timeout: 3 };
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
