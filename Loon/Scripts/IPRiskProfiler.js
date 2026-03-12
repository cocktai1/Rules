/**
 * @name 节点 IP 风险扫描仪 (双栈透视版)
 * @description 优先显示真实网络出口，并强制探测隐藏的备用协议 (IPv4/IPv6)
 */

const title = 'IP Risk Profiler';
const apiUrl = 'https://ipwho.is/?lang=zh-CN';

let nodeName = "未知节点";
if (typeof $environment !== 'undefined' && $environment.params) {
    nodeName = typeof $environment.params === 'object' ? ($environment.params.node || "当前策略") : $environment.params;
}

async function checkIPRisk() {
    try {
        // 1. 探测真实优先出口及风险信息
        let result = await fetchIPData(apiUrl, true);
        
        if (!result.success) {
            throw new Error(result.message || "获取 IP 信息失败");
        }

        let realIp = result.ip || "未知 IP";
        let isV6 = realIp.includes(':'); // 判断真实出口是 IPv6 还是 IPv4
        
        // 2. 强制逼出隐藏的另一条路线 (双栈探测)
        let secondaryIpText = "探测中...";
        try {
            if (isV6) {
                // 真实是 v6，强制去抓 v4
                secondaryIpText = await fetchRawIP('https://ipv4.icanhazip.com', true);
            } else {
                // 真实是 v4，强制去抓 v6
                secondaryIpText = await fetchRawIP('https://ipv6.icanhazip.com', true);
            }
        } catch (e) {
            // 如果抓不到，说明这个节点是单栈的
            secondaryIpText = isV6 ? "无 IPv4 出口 (纯v6节点)" : "未开启 IPv6 支持";
        }

        // 3. 解析基础地理信息
        let countryEmoji = getFlagEmoji(result.country_code);
        let location = `${countryEmoji} ${result.country || "未知"} - ${result.city || ""}`;
        
        // 4. 解析网络供应商信息
        let conn = result.connection || {};
        let isp = conn.isp || "未知 ISP";
        let asn = conn.asn ? `AS${conn.asn} ${conn.org || ""}` : "未知 ASN";
        let ipType = conn.type || "unknown";

        // 5. 风险评估与安全扫描
        let sec = result.security || {}; 
        let riskScore = 0;
        let riskTags = [];

        if (sec.proxy) { riskScore += 40; riskTags.push("识别为代理"); }
        if (sec.vpn) { riskScore += 30; riskTags.push("VPN入口"); }
        if (sec.tor) { riskScore += 80; riskTags.push("Tor出口节点"); }
        if (sec.hosting) { riskScore += 30; riskTags.push("机房IP (Hosting)"); }
        if (sec.relay) { riskScore += 20; riskTags.push("中继节点"); }
        
        if (ipType === "isp") {
            riskScore = Math.max(0, riskScore - 15);
            riskTags.push("原生家庭宽带");
        } else if (ipType === "cellular") {
            riskScore = Math.max(0, riskScore - 20);
            riskTags.push("原生移动网络");
        }

        if (riskTags.length === 0) riskTags.push("常规/无特殊标记");

        // 6. 定义等级与 UI 颜色
        let levelColor = "#00b400"; 
        let levelText = "🟢 极度纯净 (原生推荐)";
        if (riskScore > 0 && riskScore <= 40) {
            levelColor = "#ff9800"; 
            levelText = "🟡 中等风险 (多为解锁节点)";
        } else if (riskScore > 40) {
            levelColor = "#f44336"; 
            levelText = "🔴 风险预警 (易触发现验证码)";
        }

        // 7. 渲染带双栈信息的极客面板
        let htmlMessage = `
        <p style="text-align: center; font-family: -apple-system; font-size: large; font-weight: 300; padding-top: 15px;">
            <br><font color="${levelColor}">-------------------------<br>
            <b>⟦ IP RISK PROFILER ⟧ </b><br>
            -------------------------</font><br><br>
            
            <b>节点名称</b><br>
            <small>${nodeName}</small><br><br>

            <b>👑 优先真实出口 (${isV6 ? 'IPv6' : 'IPv4'})</b><br>
            <small><b>${realIp}</b></small><br><br>

            <b>👻 隐藏备用出口 (${isV6 ? 'IPv4' : 'IPv6'})</b><br>
            <small><font color="#888">${secondaryIpText}</font></small><br><br>

            <b>地理归属</b><br>
            <small>${location}</small><br><br>

            <b>ISP 供应商</b><br>
            <small>${isp}<br><small>${asn}</small></small><br><br>

            <font color="${levelColor}">-------------------------</font><br>
            <b>风险分值: ${riskScore}</b><br>
            <small><font color="${levelColor}">${levelText}</font></small><br>
            <small><b>特征:</b> ${riskTags.join(" | ")}</small><br>
            <font color="${levelColor}">-------------------------</font><br><br>

            <font color="#999"><small>Powered by Dual-Stack Scanner</small></font>
        </p>
        `;

        $done({
            title: "IP 扫描完成",
            content: `真实出口: ${isV6 ? 'IPv6' : 'IPv4'} | 风险: ${riskScore}`, 
            htmlMessage: htmlMessage
        });

    } catch (error) {
        let errMsg = String(error.message || error);
        $done({
            title: "扫描异常",
            content: "检测失败，请检查节点",
            htmlMessage: `<p style="text-align: center; padding-top: 20px;"><font color="#f00"><b>扫描失败</b></font><br><br><small>${errMsg}</small></p>`
        });
    }
}

// 获取单协议纯净 IP 的轻量级请求
function fetchRawIP(url, useNode = false) {
    return new Promise((resolve, reject) => {
        let isResolved = false;
        let timeoutTimer = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                reject(new Error("Timeout"));
            }
        }, 4000); // 备用出口探测给 4 秒超时

        let options = { url: url };
        if (useNode && nodeName !== "未知节点" && nodeName !== "当前策略") {
            options.node = nodeName;
        }

        $httpClient.get(options, (error, response, data) => {
            if (isResolved) return;
            isResolved = true;
            clearTimeout(timeoutTimer);
            if (error || response.status !== 200) {
                reject(new Error("Failed"));
            } else {
                resolve(data.trim()); // 去除换行符，只留干净的 IP
            }
        });
    });
}

function getFlagEmoji(countryCode) {
    if (!countryCode) return "🌐";
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char =>  127397 + char.charCodeAt());
    return String.fromCodePoint(...codePoints);
}

function fetchIPData(url, useNode = false) {
    return new Promise((resolve, reject) => {
        let isResolved = false;
        let timeoutTimer = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                reject(new Error("网络请求超时"));
            }
        }, 6000); 

        let options = { url: url }; 
        if (useNode && nodeName !== "未知节点" && nodeName !== "当前策略") {
            options.node = nodeName; 
        }

        $httpClient.get(options, (error, response, data) => {
            if (isResolved) return; 
            isResolved = true;
            clearTimeout(timeoutTimer);
            if (error) reject(error);
            else if (response.status !== 200) reject(new Error(`API 响应错误: ${response.status}`));
            else {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error("数据解析异常")); }
            }
        });
    });
}

checkIPRisk();
