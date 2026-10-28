// Package report renders deliverable Markdown from the findings table: the
// triage status, the evidence bound to each finding, and the latest completed
// retest. It is a pure renderer — it never queries the database.
package report

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"liora/db"
)

// Input bundles what the task report needs. Traffic and Retests are keyed by
// findings.id; missing keys simply render no evidence/retest section. Related
// holds read-only findings inherited from direct source tasks; they are listed
// separately and never counted in the task's own totals.
type Input struct {
	Title       string
	Goal        string
	GeneratedAt time.Time
	AssetCounts map[string]int
	Findings    []*db.DBFinding
	Traffic     map[int64][]db.FindingTrafficBinding
	Retests     map[int64]*db.FindingRetest
	Related     []*db.DBFinding
}

// Markdown renders the task report. It is deterministic for the same input:
// findings are ordered by severity, then created_at, then id.
func Markdown(in Input) string {
	items := make([]*db.DBFinding, 0, len(in.Findings))
	for _, f := range in.Findings {
		if f != nil {
			items = append(items, f)
		}
	}
	sortFindingsForExport(items)

	statusCounts := map[string]int{}
	severity := map[string]int{}
	retests := map[string]int{}
	for _, f := range items {
		statusCounts[f.Status]++
		severity[f.Severity]++
		if r := in.Retests[f.ID]; r != nil && r.Status == "completed" {
			retests[r.Verdict]++
		}
	}

	var b strings.Builder
	fmt.Fprintf(&b, "# 渗透测试报告 — %s\n\n", nz(singleLine(in.Title), "未命名任务"))
	fmt.Fprintf(&b, "- **任务目标**：%s\n", nz(singleLine(in.Goal), "（未指定）"))
	fmt.Fprintf(&b, "- **生成时间**：%s\n", in.GeneratedAt.Format("2006-01-02 15:04:05"))
	fmt.Fprintf(&b, "- **数据来源**：findings 表，本任务发现记录 %d 条\n\n", len(items))

	b.WriteString("## 摘要\n\n")
	fmt.Fprintf(&b, "- 发现记录：**%d** 条\n", len(items))
	confirmed := statusCounts[db.FindingConfirmed]
	fmt.Fprintf(&b, "- 确认发现：**%d** 个\n", confirmed)
	if len(items) > 0 {
		other := len(items) - confirmed - statusCounts[db.FindingPending] - statusCounts[db.FindingFalsePositive]
		fmt.Fprintf(&b, "- 状态分布：已确认 %d / 待处理 %d / 误报 %d / 其他 %d\n",
			confirmed, statusCounts[db.FindingPending], statusCounts[db.FindingFalsePositive], other)
		fmt.Fprintf(&b, "- 严重等级：严重 %d / 高危 %d / 中危 %d / 低危 %d / 其他 %d\n",
			severity[db.SeverityCritical], severity[db.SeverityHigh], severity[db.SeverityMedium], severity[db.SeverityLow],
			len(items)-severity[db.SeverityCritical]-severity[db.SeverityHigh]-severity[db.SeverityMedium]-severity[db.SeverityLow])
	}
	b.WriteString("- 资产：")
	types := make([]string, 0, len(in.AssetCounts))
	for t := range in.AssetCounts {
		types = append(types, t)
	}
	sort.Strings(types)
	for i, t := range types {
		if i > 0 {
			b.WriteString("、")
		}
		fmt.Fprintf(&b, "%s %d", t, in.AssetCounts[t])
	}
	b.WriteString("\n")
	if len(retests) > 0 {
		parts := make([]string, 0, len(retests))
		for _, v := range []string{"reproduced", "fixed", "inconclusive"} {
			if retests[v] > 0 {
				parts = append(parts, fmt.Sprintf("%s %d", verdictLabel(v), retests[v]))
			}
		}
		fmt.Fprintf(&b, "- 复测：%s\n", strings.Join(parts, " / "))
	}
	if len(in.Related) > 0 {
		fmt.Fprintf(&b, "- 关联任务发现：%d 条（只读，不计入本任务统计）\n", len(in.Related))
	}
	b.WriteString("\n")

	b.WriteString("## 发现\n\n")
	if len(items) == 0 {
		b.WriteString("_本次未确认漏洞。_\n")
	} else {
		for i, f := range items {
			writeFindingBlock(&b, i+1, f, findingRenderOpts{
				traffic:       in.Traffic[f.ID],
				retest:        in.Retests[f.ID],
				includeStatus: true,
				includeReport: true,
			})
		}
	}

	related := make([]*db.DBFinding, 0, len(in.Related))
	for _, f := range in.Related {
		if f != nil {
			related = append(related, f)
		}
	}
	if len(related) > 0 {
		sortFindingsForExport(related)
		b.WriteString("## 关联任务发现（只读，不计入本任务统计）\n\n")
		fmt.Fprintf(&b, "以下 %d 条来自直接来源任务，仅用于核对上下文；统计与结论以上方本任务发现为准。\n\n", len(related))
		for i, f := range related {
			writeFindingBlock(&b, i+1, f, findingRenderOpts{
				headingPrefix: "R",
				includeStatus: true,
				includeTask:   true,
			})
		}
	}
	return b.String()
}

// singleLine keeps a model/user supplied title or goal from breaking the
// Markdown structure with embedded newlines.
func singleLine(s string) string {
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	return strings.TrimSpace(s)
}

// severityRank orders known severities; unknown values sort after low instead of
// falling through to the map zero value (which used to put "info" with critical).
func severityRank(s string) int {
	switch s {
	case db.SeverityCritical:
		return 0
	case db.SeverityHigh:
		return 1
	case db.SeverityMedium:
		return 2
	case db.SeverityLow:
		return 3
	default:
		return 4
	}
}

// nz returns d when s is blank.
func nz(s, d string) string {
	if strings.TrimSpace(s) == "" {
		return d
	}
	return s
}
