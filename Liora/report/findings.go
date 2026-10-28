package report

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"

	"liora/db"
)

// 发现页「导出」与任务报告共用的渲染:把一批 findings 表行渲染成汇总 Markdown、
// 单条 Markdown、或 CSV。JSON 由 server 层直接用 DTO 序列化,不在此处。

// sortFindingsForExport 按严重等级降序、再按时间倒序、最后按 ID 倒序排,与汇总报告
// 的分组一致。ID 兜底保证同一秒创建的发现也有稳定顺序。
func sortFindingsForExport(fs []*db.DBFinding) {
	sort.SliceStable(fs, func(i, j int) bool {
		ri, rj := severityRank(fs[i].Severity), severityRank(fs[j].Severity)
		if ri != rj {
			return ri < rj // sevRank 越小越严重
		}
		if !fs[i].CreatedAt.Equal(fs[j].CreatedAt) {
			return fs[i].CreatedAt.After(fs[j].CreatedAt)
		}
		return fs[i].ID > fs[j].ID
	})
}

// findingTitle 取漏洞可读标题:名称 → 类别 → 「未分类」。
func findingTitle(f *db.DBFinding) string {
	return nz(f.Name, nz(f.VulnClass, "未分类"))
}

// statusLabel 把 triage 状态渲染成中文;未知状态原样输出,避免吞掉数据。
func statusLabel(status string) string {
	switch status {
	case db.FindingPending:
		return "待处理"
	case db.FindingInProgress:
		return "处理中"
	case db.FindingConfirmed:
		return "已确认"
	case db.FindingResolved:
		return "已处理"
	case db.FindingFixed:
		return "已修复"
	case db.FindingFalsePositive:
		return "误报"
	case db.FindingIgnored:
		return "忽略"
	case db.FindingDuplicate:
		return "重复"
	case db.FindingRiskAccepted:
		return "风险接受"
	default:
		return nz(status, db.FindingPending)
	}
}

func verdictLabel(verdict string) string {
	switch verdict {
	case "reproduced":
		return "已复现"
	case "fixed":
		return "已修复"
	case "inconclusive":
		return "无法判定"
	default:
		return nz(verdict, "未记录")
	}
}

// findingRenderOpts 控制同一条发现在不同交付物里的章节差异:
// 任务报告不带「所属任务」,发现导出不带复测(复测只在任务上下文有意义)。
type findingRenderOpts struct {
	traffic       []db.FindingTrafficBinding
	retest        *db.FindingRetest
	headingPrefix string
	includeStatus bool
	includeTask   bool
	includeReport bool
	attachments   bool
}

// writeFindingBlock 是任务报告与发现导出唯一的逐条渲染入口,避免两份渲染漂移。
func writeFindingBlock(b *strings.Builder, idx int, f *db.DBFinding, opts findingRenderOpts) {
	fmt.Fprintf(b, "### %s%d. [%s] %s\n\n", opts.headingPrefix, idx, strings.ToUpper(nz(f.Severity, "info")), findingTitle(f))
	if f.VulnClass != "" {
		fmt.Fprintf(b, "- **类别**：%s\n", f.VulnClass)
	}
	if opts.includeStatus {
		fmt.Fprintf(b, "- **状态**：%s\n", statusLabel(f.Status))
	}
	if opts.includeTask {
		if desc := strings.TrimSpace(f.TaskDescription); desc != "" {
			fmt.Fprintf(b, "- **所属任务**：%s\n", singleLine(desc))
		}
	}
	fmt.Fprintf(b, "- **发现时间**：%s\n", f.CreatedAt.Format("2006-01-02 15:04:05"))
	if r := opts.retest; r != nil {
		fmt.Fprintf(b, "- **复测**：%s（%s）", verdictLabel(r.Verdict), nz(r.Verdict, "unknown"))
		if r.FinishedAt != nil {
			fmt.Fprintf(b, " · %s", r.FinishedAt.Format("2006-01-02 15:04:05"))
		}
		if s := strings.TrimSpace(r.Summary); s != "" {
			fmt.Fprintf(b, " — %s", singleLine(s))
		}
		b.WriteString("\n")
	}
	b.WriteString("\n")
	if s := strings.TrimSpace(f.Summary); s != "" {
		fmt.Fprintf(b, "%s\n\n", s)
	}
	if e := strings.TrimSpace(f.Evidence); e != "" {
		fmt.Fprintf(b, "**证据：**\n\n```\n%s\n```\n\n", e)
	}
	if opts.includeReport {
		if f.Report != "" && f.EvidenceVersion != f.ReportEvidenceVersion {
			b.WriteString("**报告状态：** 证据已变更，详细报告待更新。\n\n")
		}
		if rep := strings.TrimSpace(f.Report); rep != "" {
			b.WriteString("**详细报告：**\n\n")
			b.WriteString(rep)
			b.WriteString("\n\n")
		}
	}
	b.WriteString(trafficMarkdown(f, opts.traffic, opts.attachments))
	b.WriteString("---\n\n")
}

// FindingsMarkdown 把一批 findings 整合成一份汇总报告(摘要 + 按严重等级分组,
// 每条含类别/状态/所属任务/证据/详细报告/流量证据)。
func FindingsMarkdown(fs []*db.DBFinding, generatedAt time.Time) string {
	items := append([]*db.DBFinding(nil), fs...)
	sortFindingsForExport(items)

	var b strings.Builder
	b.WriteString("# 漏洞发现汇总报告\n\n")
	fmt.Fprintf(&b, "- **生成时间**：%s\n", generatedAt.Format("2006-01-02 15:04:05"))
	fmt.Fprintf(&b, "- **发现总数**：%d 个\n\n", len(items))

	// 摘要:各严重等级计数。
	counts := map[string]int{}
	for _, f := range items {
		counts[f.Severity]++
	}
	b.WriteString("## 摘要\n\n")
	b.WriteString("| 严重等级 | 数量 |\n| --- | --- |\n")
	for _, s := range []struct{ key, label string }{
		{"critical", "严重"}, {"high", "高危"}, {"medium", "中危"}, {"low", "低危"},
	} {
		fmt.Fprintf(&b, "| %s | %d |\n", s.label, counts[s.key])
	}
	b.WriteString("\n")

	if len(items) == 0 {
		b.WriteString("_无匹配的漏洞。_\n")
		return b.String()
	}

	b.WriteString("## 漏洞明细\n\n")
	for i, f := range items {
		writeFindingBlock(&b, i+1, f, findingRenderOpts{
			traffic:       f.TrafficBindings,
			includeStatus: true,
			includeTask:   true,
			includeReport: true,
		})
	}
	return b.String()
}

// SingleFindingMarkdown 渲染单条漏洞为一份独立 Markdown(用于「一漏洞一文件」打包)。
func SingleFindingMarkdown(f *db.DBFinding, generatedAt time.Time) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# [%s] %s\n\n", strings.ToUpper(nz(f.Severity, "info")), findingTitle(f))
	if f.VulnClass != "" {
		fmt.Fprintf(&b, "- **类别**：%s\n", f.VulnClass)
	}
	fmt.Fprintf(&b, "- **严重等级**：%s\n", nz(f.Severity, "info"))
	fmt.Fprintf(&b, "- **状态**：%s\n", statusLabel(f.Status))
	if desc := strings.TrimSpace(f.TaskDescription); desc != "" {
		fmt.Fprintf(&b, "- **所属任务**：%s\n", singleLine(desc))
	}
	fmt.Fprintf(&b, "- **发现时间**：%s\n", f.CreatedAt.Format("2006-01-02 15:04:05"))
	fmt.Fprintf(&b, "- **生成时间**：%s\n\n", generatedAt.Format("2006-01-02 15:04:05"))
	if s := strings.TrimSpace(f.Summary); s != "" {
		fmt.Fprintf(&b, "## 概述\n\n%s\n\n", s)
	}
	if e := strings.TrimSpace(f.Evidence); e != "" {
		fmt.Fprintf(&b, "## 证据\n\n```\n%s\n```\n\n", e)
	}
	if rep := strings.TrimSpace(f.Report); rep != "" {
		b.WriteString("## 详细报告\n\n")
		b.WriteString(rep)
		b.WriteString("\n")
	}
	b.WriteString(trafficMarkdown(f, f.TrafficBindings, true))
	return b.String()
}

var unsafeFilenameChars = regexp.MustCompile(`[^\p{Han}\p{L}\p{N}._-]+`)

// FindingFilename 为「一漏洞一文件」生成安全的 .md 文件名,形如
// critical_SQL注入_#123.md。去掉路径分隔符与控制字符,避免 zip 内非法路径。
func FindingFilename(f *db.DBFinding) string {
	sev := nz(f.Severity, "info")
	title := findingTitle(f)
	name := fmt.Sprintf("%s_%s_#%d", sev, title, f.ID)
	name = unsafeFilenameChars.ReplaceAllString(name, "_")
	name = strings.Trim(name, "._")
	if name == "" {
		name = fmt.Sprintf("finding_%d", f.ID)
	}
	// 防御性:再剥一层路径,杜绝 zip slip。
	name = path.Base(name)
	if len(name) > 120 {
		name = name[:120]
	}
	return name + ".md"
}

// FindingsCSV 把一批 findings 渲染成 CSV(带 UTF-8 BOM,便于 Excel 正确识别中文)。
// 不含大段 report/evidence 全文,只放摘要类字段;需要全文用 Markdown/JSON 导出。
func FindingsCSV(fs []*db.DBFinding) []byte {
	items := append([]*db.DBFinding(nil), fs...)
	sortFindingsForExport(items)

	var buf bytes.Buffer
	buf.WriteString("\xEF\xBB\xBF") // UTF-8 BOM
	w := csv.NewWriter(&buf)
	_ = w.Write([]string{"ID", "名称", "类别", "严重等级", "状态", "所属任务", "发现时间", "概述", "流量证据数量", "流量证据ID"})
	for _, f := range items {
		_ = w.Write([]string{
			fmt.Sprintf("%d", f.ID),
			findingTitle(f),
			f.VulnClass,
			nz(f.Severity, "info"),
			statusLabel(f.Status),
			f.TaskDescription,
			f.CreatedAt.Format("2006-01-02 15:04:05"),
			strings.TrimSpace(f.Summary),
			fmt.Sprint(len(f.TrafficBindings)), findingTrafficIDs(f),
		})
	}
	w.Flush()
	return buf.Bytes()
}

func findingTrafficIDs(f *db.DBFinding) string {
	ids := make([]string, 0, len(f.TrafficBindings))
	for _, b := range f.TrafficBindings {
		ids = append(ids, fmt.Sprint(b.ID))
	}
	return strings.Join(ids, ",")
}

// trafficMarkdown 渲染一条发现的流量证据。bindings 由调用方提供,任务报告用批量
// 查询结果,发现导出用行上已加载的 TrafficBindings。
func trafficMarkdown(f *db.DBFinding, bindings []db.FindingTrafficBinding, attachments bool) string {
	stale := f.Report != "" && f.EvidenceVersion != f.ReportEvidenceVersion
	if len(bindings) == 0 && !stale {
		return ""
	}
	var out strings.Builder
	out.WriteString("\n## 关联流量证据\n\n")
	fmt.Fprintf(&out, "证据版本：%d；绑定数量：%d。\n\n", f.EvidenceVersion, len(bindings))
	if stale {
		out.WriteString("证据已变更，详细报告待更新。\n\n")
	}
	for i, b := range bindings {
		fmt.Fprintf(&out, "%d. **证据 #%d · %s** — `%s %s`，状态码 %d\n", i+1, b.ID, nz(b.Role, "supporting"), b.Snapshot.Method, strings.ReplaceAll(b.Snapshot.URL, "`", "%60"), b.Snapshot.Status)
		if b.Note != "" {
			fmt.Fprintf(&out, "   %s\n", strings.ReplaceAll(b.Note, "\n", "\n   "))
		}
		if attachments {
			fmt.Fprintf(&out, "   [请求报文](evidence/%d/%d/request.http) · [响应报文](evidence/%d/%d/response.http)\n", f.ID, b.ID, f.ID, b.ID)
		}
	}
	out.WriteString("\n")
	return out.String()
}
