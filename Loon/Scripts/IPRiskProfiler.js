/**
 * @name 节点 IP 风险扫描仪 (高容错防崩溃版)
 * @description 探测节点真实 IP，扫描其归属地、服务商类型及欺诈风险程度
 */

const title = 'IP Risk Profiler';
const apiUrl = 'https://ipwho.is/?lang=zh-CN';

let nodeName = "未知节点";
if (typeof $environment !== 'undefined' && $environment.params) {
    nodeName = typeof $environment.params === 'object' ? ($environment.params.node || "当前策略") : $environment.params;
}

async function checkIPRisk() {
    try {
        let result = await fetchIPData(apiUrl, true);
        
        if (!result.success) {
            throw new Error(result.message || "获取 IP 信息失败");
        }

        // 解析基本信息 (增加防御性防空值处理)
        let ip = result.ip || "未知 IP";
        let location = `${result.country || "未知国家"} - ${result.city || "未知城市"}`;
        
        let conn = result.connection || {};
        let isp = conn.isp || "未知 ISP";
        let asn = conn.asn ? `AS${conn.asn} ${conn.org || ""}` : "未知 ASN";
        let ipType = conn.type || "未知类型";

        // 解析安全/风险特征 (关键修复：如果 security 为空，给一个空对象保底)
        let sec = result.security || {}; 
        let riskScore = 0;
        let riskTags = [];

        // 风险评估逻辑
        if (sec.proxy) { riskScore += 50; riskTags.push("已知代理"); }
        if (sec.vpn) { riskScore += 30; riskTags.push("VPN池"); }
        if (sec.tor) { riskScore += 80; riskTags.push("暗网节点"); }
        if (sec.hosting) { riskScore += 30; riskTags.push("数据中心/机房"); }
        
        if (ipType === "isp" || ipType === "cellular") { 
            riskScore = Math.max(0, riskScore - 10); 
            riskTags.push(ipType === "cellular" ? "原生蜂窝移动" : "原生家庭宽带");
        } else if (ipType !== "未知类型") {
            riskTags.push(`类型: ${ipType}`);
        }

        if (riskTags.length === 0) riskTags.push("常规IP (无明显特征)");

        // UI 颜色与评级
        let levelColor = "#00b400"; // 绿色
        let levelText = "🟢 极度纯净 (原生)";
        if (riskScore > 0 && riskScore <= 30) {
            levelColor = "#ff9800"; // 橙色
            levelText = "🟡 中等风险 (机房/解锁节点)";
        } else if (riskScore > 30) {
            levelColor = "#f44336"; // 红色
            levelText = "🔴 极高风险 (极易触发风控/验证码)";
        }

        let htmlMessage = `
        <p style="text-align: center; font-family: -apple-system; font-size: large; font-weight: 300; padding-top: 15px;">
            <br><font color="${levelColor}">-------------------------<br>
            <b>⟦ 节点 IP 质量评估 ⟧ </b><br>
            -------------------------</font><br><br>
            
            <b>节点名称</b><br>
            <small>${nodeName}</small><br><br>

            <b>出口 IP 地址</b><br>
            <small>${ip}</small><br><br>

            <b>物理归属地</b><br>
            <small>${location}</small><br><br>

            <b>ISP 与 运营商</b><br>
            <small>${isp}<br>${asn}</small><br><br>

            <font color="${levelColor}">-------------------------</font><br>
            <b>风险评级: ${riskScore} 分</b><br>
            <small><font color="${levelColor}">${levelText}</font></small><br>
            <small><b>特征标签:</b> ${riskTags.join(" | ")}</small><br>
            <font color="${levelColor}">-------------------------</font><br><br>

            <font color="#6959CD"><small>Loon IP Risk Profiler</small></font>
        </p>
        `;

        $done({
            title: "IP 扫描完成",
            content: `IP: ${ip}\n评级: ${levelText.split(' ')[1]}`, 
            htmlMessage: htmlMessage
        });

    } catch (error) {
        let errMsg = String(error.message || error);
        $done({
            title: "扫描失败",
            content: "节点失联或请求超时",
            htmlMessage: `
            <p style="text-align: center; font-family: -apple-system; padding-top: 15px;">
                <br><font color="#f00">-------------------------<br>
                <b>⟦ 扫描失败 ⟧</b><br>
                -------------------------</font><br><br>
                <b>${nodeName}</b><br><br>
                <small>请确认节点可用。<br>报错信息：${errMsg}</small>
            </p>`
        });
    }
}

function fetchIPData(url, useNode = false) {
    return new Promise((resolve, reject) => {
        let isResolved = false;

        let fallbackTimer = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                reject(new Error("Request Timeout (节点无响应或接口被墙)"));
            }
        }, 5000); 

        let options = { url: url }; 
        if (useNode && nodeName !== "未知节点" && nodeName !== "当前策略") {
            options.node = nodeName; 
        }

        $httpClient.get(options, (error, response, data) => {
            if (isResolved) return; 
            isResolved = true;
            clearTimeout(fallbackTimer);
            
            if (error) {
                reject(error);
            } else if (response.status !== 200) {
                reject(new Error(`HTTP 状态码异常: ${response.status}`));
            } else {
                try {
                    let jsonData = JSON.parse(data);
                    resolve(jsonData);
                } catch (e) {
                    reject(new Error("API 解析失败 (可能触发了反爬验证)"));
                }
            }
        });
    });
}

checkIPRisk();
