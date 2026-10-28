import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "Liora · 灵探",
  englishName: "Liora",
  logo: "/liora-logo.png",
  logoIcon: "/liora-icon.png",
  version: packageJson.version,
  copyright: `© ${currentYear}, Liora.`,
  meta: {
    title: "Liora · 灵探 — AI 辅助自动化渗透测试平台",
    description: "Liora · 灵探：集成 AI 辅助决策、自动化测试、资产分析、漏洞验证与报告生成的渗透测试平台",
  },
};
