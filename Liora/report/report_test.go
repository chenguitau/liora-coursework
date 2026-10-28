package report

import (
	"strings"
	"testing"
	"time"

	"liora/db"
)

func findingAt(id int64, sev, name, status string, created time.Time) *db.DBFinding {
	return &db.DBFinding{ID: id, Severity: sev, Name: name, VulnClass: "SQL注入", Status: status, Summary: "summary-" + name, Evidence: "poc-" + name, CreatedAt: created}
}

func TestMarkdownEmptyReportIsExplicit(t *testing.T) {
	out := Markdown(Input{Title: "空任务", GeneratedAt: time.Unix(0, 0)})
	for _, want := range []string{"# 渗透测试报告 — 空任务", "**数据来源**：findings 表，本任务发现记录 0 条", "确认发现：**0** 个", "_本次未确认漏洞。_"} {
		if !strings.Contains(out, want) {
			t.Fatalf("empty report missing %q:\n%s", want, out)
		}
	}
}

func TestMarkdownOrdersBySeverityTimeThenID(t *testing.T) {
	base := time.Date(2026, 10, 21, 1, 0, 0, 0, time.UTC)
	in := Input{GeneratedAt: base, Findings: []*db.DBFinding{
		findingAt(1, "high", "old-high", db.FindingConfirmed, base),
		findingAt(2, "high", "new-high", db.FindingConfirmed, base.Add(time.Minute)),
		findingAt(3, "critical", "crit", db.FindingConfirmed, base),
		findingAt(4, "low", "low", db.FindingConfirmed, base),
		findingAt(5, "high", "same-second-high", db.FindingConfirmed, base.Add(time.Minute)),
		findingAt(6, "info", "unknown-sev", db.FindingConfirmed, base),
	}}
	out := Markdown(in)
	order := []string{"crit", "same-second-high", "new-high", "old-high", "low", "unknown-sev"}
	last := -1
	for _, name := range order {
		idx := strings.Index(out, "### ")
		_ = idx
		pos := strings.Index(out, name)
		if pos < 0 {
			t.Fatalf("missing %q", name)
		}
		if pos < last {
			t.Fatalf("%q rendered out of order", name)
		}
		last = pos
	}
	// Same severity + same second: higher ID first (5 before 2).
	if strings.Index(out, "same-second-high") > strings.Index(out, "new-high") {
		t.Fatalf("ID tie-breaker not applied")
	}
}

func TestMarkdownRendersStatusTrafficAndRetest(t *testing.T) {
	now := time.Date(2026, 10, 21, 2, 0, 0, 0, time.UTC)
	finished := now.Add(time.Hour)
	f := findingAt(9, "high", "布尔盲注", db.FindingConfirmed, now)
	f.Report = "详细复现步骤"
	in := Input{
		Title: "任务A", Goal: "验证注入", GeneratedAt: now,
		AssetCounts: map[string]int{"app": 2, "ip": 1},
		Findings:    []*db.DBFinding{f},
		Traffic: map[int64][]db.FindingTrafficBinding{9: {{
			ID: 7, FindingID: 9, Role: "proof", Note: "证明注入",
			Snapshot: db.TrafficEvidenceSnapshot{Method: "GET", URL: "http://example.test/a?id=1", Status: 200},
		}}},
		Retests: map[int64]*db.FindingRetest{9: {ID: 3, FindingID: 9, Status: "completed", Verdict: "fixed", Summary: "已修复", FinishedAt: &finished}},
	}
	out := Markdown(in)
	for _, want := range []string{
		"# 渗透测试报告 — 任务A",
		"任务目标**：验证注入",
		"确认发现：**1** 个",
		"严重等级：严重 0 / 高危 1",
		"资产：app 2、ip 1",
		"复测：已修复 1",
		"状态**：已确认",
		"类别**：SQL注入",
		"复测**：已修复（fixed）",
		"— 已修复",
		"详细报告：**",
		"详细复现步骤",
		"## 关联流量证据",
		"证据 #7 · proof",
		"GET http://example.test/a?id=1",
		"状态码 200",
		"证明注入",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("report missing %q:\n%s", want, out)
		}
	}
}

func TestMarkdownOmitsEvidenceSectionsWhenAbsent(t *testing.T) {
	now := time.Now()
	out := Markdown(Input{GeneratedAt: now, Findings: []*db.DBFinding{findingAt(1, "low", "x", db.FindingPending, now)}})
	if strings.Contains(out, "关联流量证据") {
		t.Fatalf("unexpected traffic section:\n%s", out)
	}
	if strings.Contains(out, "复测**") {
		t.Fatalf("unexpected retest section:\n%s", out)
	}
	if !strings.Contains(out, "状态**：待处理") {
		t.Fatalf("status label missing:\n%s", out)
	}
}

func TestMarkdownMarksStaleReport(t *testing.T) {
	now := time.Now()
	f := findingAt(1, "medium", "stale", db.FindingConfirmed, now)
	f.Report = "旧报告"
	f.EvidenceVersion, f.ReportEvidenceVersion = 2, 1
	out := Markdown(Input{GeneratedAt: now, Findings: []*db.DBFinding{f}})
	if !strings.Contains(out, "证据已变更，详细报告待更新。") {
		t.Fatalf("stale report not marked:\n%s", out)
	}
}

func TestMarkdownSanitizesTitleAndGoalNewlines(t *testing.T) {
	out := Markdown(Input{Title: "A\n# B", Goal: "g\r\nh", GeneratedAt: time.Now()})
	if strings.Contains(out, "A\n# B") {
		t.Fatalf("title newline leaked into heading:\n%s", out)
	}
	if !strings.Contains(out, "# 渗透测试报告 — A # B") {
		t.Fatalf("title not sanitized:\n%s", out)
	}
}

func TestMarkdownRelatedFindingsAreSeparate(t *testing.T) {
	now := time.Now()
	own := findingAt(1, "high", "本任务发现", db.FindingConfirmed, now)
	related := findingAt(2, "medium", "来源任务发现", db.FindingPending, now)
	related.TaskDescription = "来源任务A"
	out := Markdown(Input{Title: "子任务", GeneratedAt: now, Findings: []*db.DBFinding{own}, Related: []*db.DBFinding{related}})
	if !strings.Contains(out, "发现记录：**1** 条") {
		t.Fatalf("own count changed by related finding:\n%s", out)
	}
	if !strings.Contains(out, "关联任务发现：1 条（只读，不计入本任务统计）") {
		t.Fatalf("related summary missing:\n%s", out)
	}
	if !strings.Contains(out, "## 关联任务发现（只读，不计入本任务统计）") || !strings.Contains(out, "### R1. [MEDIUM] 来源任务发现") {
		t.Fatalf("related section missing:\n%s", out)
	}
	if !strings.Contains(out, "所属任务**：来源任务A") {
		t.Fatalf("related provenance missing:\n%s", out)
	}
}

func TestFindingsMarkdownSharesFindingBlock(t *testing.T) {
	now := time.Now()
	f := findingAt(1, "critical", "共用块", db.FindingFalsePositive, now)
	f.TaskDescription = "任务X"
	f.TrafficBindings = []db.FindingTrafficBinding{{ID: 2, Role: "baseline", Snapshot: db.TrafficEvidenceSnapshot{Method: "POST", URL: "http://x/", Status: 500}}}
	out := FindingsMarkdown([]*db.DBFinding{f}, now)
	for _, want := range []string{"### 1. [CRITICAL] 共用块", "状态**：误报", "所属任务**：任务X", "关联流量证据", "证据 #2 · baseline"} {
		if !strings.Contains(out, want) {
			t.Fatalf("export missing %q:\n%s", want, out)
		}
	}
}

func TestFindingsCSVUsesChineseStatus(t *testing.T) {
	now := time.Now()
	csv := string(FindingsCSV([]*db.DBFinding{findingAt(1, "high", "csv", db.FindingRiskAccepted, now)}))
	if !strings.Contains(csv, "风险接受") {
		t.Fatalf("CSV status not localized:\n%s", csv)
	}
}
