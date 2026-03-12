/**
 * @name 全平台解锁检测仪 (All-in-One Unlock Checker)
 * @description 并发检测节点对 AI、流媒体、社交媒体的解锁状态
 */

const title = '全平台解锁检测';

// 获取节点名称
let nodeName = "未知节点";
if (typeof $environment !== 'undefined' && $environment.params) {
    nodeName = typeof $environment.params === 'object' ? ($environment.params.node || "当前策略") : $environment.params;
}

// 定义需要检测的平台字典
const testTargets = {
    AI: [
        { name: "ChatGPT", url: "https://ios.chat.openai.com/public-api/mobile/server_status/v1" },
        { name: "Claude AI", url: "https://claude.ai/login" },
        { name: "Gemini", url: "https://gemini.google.com/app" }
    ],
    Social: [
        { name: "Instagram", url: "https://www.instagram.com/" },
        { name: "TikTok", url: "https://www.tiktok.com/explore" },
        { name: "X (Twitter)", url: "https://x.com/" }
    ],
    Media: [
        { name: "Netflix", url: "https://www.netflix.com/title/81215567" },
        { name: "Disney+", url: "https://www.disneyplus.com/" },
        { name: "YouTube", url: "https://www.youtube.com/premium" }
    ]
};

async function checkAll() {
    let resultsHTML = "";
    let summaryText = [];

    // 遍历三大分类
    for (const [category, platforms] of Object.entries(testTargets)) {
        let categoryIcon = category === "AI" ? "🤖" : category === "Social" ? "📱" : "🎬";
        let categoryName = category === "AI" ? "AI 大模型" : category === "Social" ? "社交媒体" : "流媒体";
        
        resultsHTML += `<b>${categoryIcon} ${categoryName}</b><br>`;
        
        // 发起并发测试
        let tasks = platforms.map(p => testPlatform(p.name, p.url));
        let results = await Promise.all(tasks);
        
        // 渲染每一项的结果
        results.forEach(res => {
            resultsHTML += `<small>${res.icon} ${res.name}: <font color="${res.color}">${res.status}</font></small><br>`;
            if (res.isBlocked) summaryText.push(res.name); // 收集被墙的平台用于通知
        });
        resultsHTML += `<br>`;
    }

    // 生成底部的总结文案
    let finalSummary = summaryText.length === 0 
        ? "🎉 完美！全部平台均已解锁！" 
        : `⚠️ 存在限制: ${summaryText.join(", ")} 未解锁`;

    // 构建高逼格 UI 面板
    let htmlMessage = `
    <p style="text-align: left; font-family: -apple-system; font-size: large; font-weight: 300; padding-top: 15px; padding-left: 10px;">
        <font color="#007aff">----------------------------------</font><br>
        <b style="display:block; text-align:center;">⟦ 🌐 节点解锁雷达 ⟧</b>
        <font color="#007aff">----------------------------------</font><br>
        
        <b>🎯 当前节点</b><br>
        <small><font color="#888">${nodeName}</font></small><br><br>

        ${resultsHTML}
        
        <font color="#007aff">----------------------------------</font><br>
        <small><b>📊 诊断总结</b></small><br>
        <small>${finalSummary}</small><br>
        <font color="#007aff">----------------------------------</font><br><br>

        <span style="display:block; text-align:center;"><font color="#999"><small>Loon Radar Active</small></font></span>
    </p>
    `;

    $done({
        title: "解锁探测完成",
        content: finalSummary, 
        htmlMessage: htmlMessage
    });
}

// 核心探测函数 (包含原生超时保护与状态码分析)
function testPlatform(name, url) {
    return new Promise((resolve) => {
        let isResolved = false;

        // 4秒超时引爆器
        let timeoutTimer = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                resolve({ name: name, status: "超时/阻断", icon: "⏳", color: "#f44336", isBlocked: true });
            }
        }, 4000); 

        let options = { 
            url: url,
            headers: {
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            }
        }; 

        if (nodeName !== "未知节点" && nodeName !== "当前策略") {
            options.node = nodeName; 
        }

        $httpClient.get(options, (error, response, data) => {
            if (isResolved) return; 
            isResolved = true;
            clearTimeout(timeoutTimer);
            
            if (error) {
                // 网络层直接报错，通常是底层 TCP 握手失败或被 GFW 阻断
                resolve({ name: name, status: "连接失败", icon: "❌", color: "#f44336", isBlocked: true });
            } else {
                let status = response.status;
                
                // 【核心判别逻辑】
                // 403 通常意味着 IP 被服务商拉黑/限制区域 (如 ChatGPT/Claude 常见的风控)
                // 404 或 451 通常意味着流媒体内容在该区域不可用
                if (status === 403 || status === 404 || status === 451 || status === 429) {
                    resolve({ name: name, status: "受限/封锁", icon: "🔴", color: "#f44336", isBlocked: true });
                } 
                // 200, 204, 301, 302, 307 都视为连通和解锁
                else if (status >= 200 && status < 400) {
                    // 特殊针对 TikTok 的地域重定向检测 (如果跳转到特定错误页)
                    if (data && data.includes("Something went wrong")) {
                        resolve({ name: name, status: "区域限制", icon: "🟡", color: "#ff9800", isBlocked: true });
                    } else {
                        resolve({ name: name, status: "原生解锁", icon: "🟢", color: "#00b400", isBlocked: false });
                    }
                } 
                // 其他未知状态码
                else {
                    resolve({ name: name, status: `异常 (${status})`, icon: "🟡", color: "#ff9800", isBlocked: true });
                }
            }
        });
    });
}

// 启动检测
checkAll();
