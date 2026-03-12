/**
 * @name 节点测速
 * @description 5秒拉锯测速
 */

const title = '节点测速';

// 核心测速参数
const testDurationMs = 5000; // 持续测速时长：5秒 (拉长一点，彻底稀释掉最初的握手时间)
const chunkSize = 2097152; // 每个碎块 2MB (绝对不会爆内存)
const concurrency = 4; // 并发 4 条线程火力全开

let nodeName = "未知节点";
if (typeof $environment !== 'undefined' && $environment.params) {
    nodeName = typeof $environment.params === 'object' ? ($environment.params.node || "当前策略") : $environment.params;
}

async function testSpeed() {
    let speedMbps = "0.00";
    let speedMBs = "0.00";
    let finalError = null;

    let totalBytesDownloaded = 0;
    let dlStart = Date.now();
    let dlEnd = dlStart;
    let failCount = 0; 

    try {
        // 舍弃 Ping，直接进入 5 秒高压拉锯战
        while (Date.now() - dlStart < testDurationMs) {
            let tasks = [];
            for (let i = 0; i < concurrency; i++) {
                // 加随机数防止 CDN 缓存
                let url = `https://speed.cloudflare.com/__down?bytes=${chunkSize}&v=${Math.random()}`;
                tasks.push(downloadChunk(url));
            }
            
            let results = await Promise.all(tasks);
            let batchBytes = results.reduce((sum, bytes) => sum + bytes, 0);
            totalBytesDownloaded += batchBytes;

            // 如果没拿到数据，记录失败；连续 2 次全失败提前终止
            if (batchBytes === 0) {
                failCount++;
                if (failCount >= 2) break;
            } else {
                failCount = 0; 
            }
        }

        dlEnd = Date.now();

        // 计算峰值速度
        let rawTimeMs = dlEnd - dlStart;
        
        // 【核心补偿】：因为我们没有测 Ping，直接扣除 600ms 作为保守的 TLS 握手损耗
        // 这样算出来的速度更贴近视频流媒体长连接下的真实网速
        let pureTransferTimeMs = Math.max(rawTimeMs - 600, 100); 
        
        let timeInSeconds = pureTransferTimeMs / 1000;
        let bytesPerSecond = totalBytesDownloaded / timeInSeconds;
        
        speedMbps = ((bytesPerSecond * 8) / 1000000).toFixed(2); 
        speedMBs = (bytesPerSecond / 1048576).toFixed(2); 

    } catch (error) {
        finalError = error;
    }

    // 渲染极简面板
    if (finalError && totalBytesDownloaded === 0) {
        let errMsg = String(finalError.message || finalError);
        $done({
            title: "测速失败",
            content: "测速失败",
            htmlMessage: `
            <p style="text-align: center; font-family: -apple-system; padding-top: 15px;">
                <br><font color="#f00">-------------------------<br>
                <b>⟦ 测速失败 ⟧</b><br>
                -------------------------</font><br><br>
                <b>${nodeName}</b><br><br>
                <small>${errMsg}</small>
            </p>`
        });
    } else {
        let htmlMessage = `
        <p style="text-align: center; font-family: -apple-system; font-size: large; font-weight: 300; padding-top: 15px;">
            <br><font color="#00b400">-------------------------<br>
            <b>⟦ 纯净测速结果 ⟧ </b><br>
            -------------------------</font><br><br>
            <b>节点名称</b><br>
            <small><small>${nodeName}</small></small><br><br>
            <b>真实峰值带宽</b><br>
            <small><font color="#007aff">${speedMbps} Mbps</font> (${speedMBs} MB/s)</small><br><br>
            -----------------------------------<br>
            <font color="#6959CD"><small>Loon Speedtest Pure</small></font>
        </p>
        `;

        $done({
            title: title,
            content: `节点: ${nodeName}\n速度: ${speedMbps} Mbps`, 
            htmlMessage: htmlMessage
        });
    }
}

// 纯粹的下载器，不带 timeout 参数防止断流 Bug
function downloadChunk(url) {
    return new Promise((resolve) => {
        let options = { url: url }; 
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

testSpeed();
