/**
 * @name 节点测速 
 * @description 引入原生 JS 超时引爆器，解决慢节点/丢包节点卡死等待几十秒的问题
 */

const title = '节点测速';

const testDurationMs = 5000; // 持续测速时长：5秒
const chunkSize = 2097152; // 每个碎块 2MB
const concurrency = 4; // 并发 4 条线程

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
    let failCount = 0; 

    try {
        while (Date.now() - dlStart < testDurationMs) {
            let tasks = [];
            for (let i = 0; i < concurrency; i++) {
                let url = `https://speed.cloudflare.com/__down?bytes=${chunkSize}&v=${Math.random()}`;
                tasks.push(downloadChunk(url));
            }
            
            // 如果遇到德国等丢包节点，原生 JS 超时器会强行在 4 秒内斩断卡死的 Promise
            let results = await Promise.all(tasks);
            let batchBytes = results.reduce((sum, bytes) => sum + bytes, 0);
            totalBytesDownloaded += batchBytes;

            if (batchBytes === 0) {
                failCount++;
                if (failCount >= 2) break; // 连续 2 批完全没速度，认定断流，直接结算
            } else {
                failCount = 0; 
            }
        }

        let dlEnd = Date.now();
        let rawTimeMs = dlEnd - dlStart;
        
        // 补偿部分 TLS 握手时间 (由于没测 Ping，我们保守扣除 500ms)
        let pureTransferTimeMs = Math.max(rawTimeMs - 500, 100); 
        
        let timeInSeconds = pureTransferTimeMs / 1000;
        let bytesPerSecond = totalBytesDownloaded / timeInSeconds;
        
        speedMbps = ((bytesPerSecond * 8) / 1000000).toFixed(2); 
        speedMBs = (bytesPerSecond / 1048576).toFixed(2); 

    } catch (error) {
        finalError = error;
    }

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

// 带有“原生 JS 定时自毁机制”的下载器
function downloadChunk(url) {
    return new Promise((resolve) => {
        let isResolved = false;

        // 手写一个 4 秒超时引爆器。一旦触发，直接宣告当前碎块下载失败（算作 0 速度）
        let fallbackTimer = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                resolve(0); 
            }
        }, 4000); 

        let options = { url: url }; 
        if (nodeName !== "未知节点" && nodeName !== "当前策略") {
            options.node = nodeName; 
        }

        $httpClient.get(options, (error, response, data) => {
            // 如果已经被超时器抢先结束了，后续的数据直接丢弃
            if (isResolved) return; 
            
            isResolved = true;
            clearTimeout(fallbackTimer); // 下载成功，拆除定时炸弹
            
            if (error || !response || response.status !== 200) {
                resolve(0); 
            } else {
                resolve(chunkSize); 
            }
        });
    });
}

testSpeed();
