"use client";
import * as React from "react";

import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Flex,
  Group,
  Modal,
  Popover,
  ScrollArea,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  ClockIcon,
  FileCode2Icon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  PlugIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { AsyncState } from "@/components/async-state";
import { useAsyncData } from "@/hooks/use-async-data";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { toast } from "@/lib/notifications";
import type { Agent, MCPServer, MissingSkill, SkillCall } from "@/lib/types";
import { cn } from "@/lib/utils";

const CLOSE_BUTTON_PROPS = { "aria-label": "关闭弹窗" } as const;

// 未调用过的 skill 仍显示「从未调用」，其余时间走共享格式（short）。
function fmtLastUsed(ts?: string) {
  return ts ? fmtTime(ts, "short") : "从未调用";
}
// ── Tree node ──────────────────────────────────────────────────────────────
interface TreeNode {
  name: string;
  path: string; // relative to skill root, dirs WITHOUT trailing slash
  type: "file" | "dir";
  children: TreeNode[];
}
// Backend returns dirs as "scripts/" (trailing slash) and files as "scripts/a.py".
function buildTree(entries: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();
  function ensureDir(dirPath: string): TreeNode[] {
    const existing = dirMap.get(dirPath);
    if (existing) return existing.children;
    const parts = dirPath.split("/");
    let nodes = root;
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      let dir = dirMap.get(cur);
      if (!dir) {
        dir = { name: part, path: cur, type: "dir", children: [] };
        nodes.push(dir);
        dirMap.set(cur, dir);
      }
      nodes = dir.children;
    }
    return nodes;
  }
  for (const entry of [...entries].sort()) {
    if (entry.endsWith("/")) {
      // Explicit directory entry — ensure the node exists (may already be created)
      ensureDir(entry.slice(0, -1));
    } else {
      // File — ensure parent dirs exist, then push file node
      const parts = entry.split("/");
      const nodes = parts.length > 1 ? ensureDir(parts.slice(0, -1).join("/")) : root;
      const fname = parts[parts.length - 1];
      if (fname) nodes.push({ name: fname, path: entry, type: "file", children: [] });
    }
  }
  sortNodes(root);
  return root;
}
// sortNodes orders every level like a file explorer: directories before files,
// then case-insensitive by name. Recurses into children.
function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  for (const n of nodes) {
    if (n.children.length > 0) sortNodes(n.children);
  }
}
// ── State types ───────────────────────────────────────────────────────────
type Selected =
  | {
      skill: string;
      path: null;
    }
  | {
      skill: string;
      path: string;
    };
type Creating = {
  skill: string;
  inDir: string;
  kind: "file" | "dir";
} | null;
type PendingDelete =
  | {
      kind: "skill";
      skill: string;
    }
  | {
      kind: "file";
      skill: string;
      path: string;
    }
  | {
      kind: "dir";
      skill: string;
      path: string;
    }
  | null;
// ── Page ──────────────────────────────────────────────────────────────────
export default function SkillsPage() {
  // 技能列表走统一四态：首载骨架、失败常驻可重试；刷新保留上一份，树不闪空。
  const skillsQ = useAsyncData(() => api.skills(), []);
  const skills = skillsQ.data ?? [];
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [agentsError, setAgentsError] = React.useState(false);
  const [selected, setSelected] = React.useState<Selected | null>(null);
  const selectedName = selected?.skill;
  const [visibility, setVisibility] = React.useState<Record<string, string[]>>({});
  const [visibilityError, setVisibilityError] = React.useState<string | null>(null);
  const visibilitySeq = React.useRef(0);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [skillQuery, setSkillQuery] = React.useState("");
  const [skillFilter, setSkillFilter] = React.useState("all");
  const [skillSort, setSkillSort] = React.useState("name");
  // file editor
  const [fileContent, setFileContent] = React.useState("");
  const [fileLoading, setFileLoading] = React.useState(false);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [fileReload, setFileReload] = React.useState(0);
  const fileSeq = React.useRef(0);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  // inline create — using a ref to avoid stale closure in onBlur
  const [creating, setCreating] = React.useState<Creating>(null);
  const [newEntryName, setNewEntryName] = React.useState("");
  const inlineRef = React.useRef<HTMLInputElement>(null);
  // cancelRef prevents onBlur from committing when Escape was pressed
  const cancelRef = React.useRef(false);
  // new skill dialog
  const [newOpen, setNewOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newDesc, setNewDesc] = React.useState("");
  const [newLicense, setNewLicense] = React.useState("");
  const [newCompat, setNewCompat] = React.useState("");
  const [newInst, setNewInst] = React.useState("");
  const [newMcps, setNewMcps] = React.useState<string[]>([]);
  const [newVisibility, setNewVisibility] = React.useState<string[]>([]);
  const [mcpOptions, setMcpOptions] = React.useState<MCPServer[]>([]);
  const [creatingSkill, setCreatingSkill] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const uploadRef = React.useRef<HTMLInputElement>(null);
  // skill detail — MCP edit state (optimistic, rolls back on error)
  const [detailMcps, setDetailMcps] = React.useState<string[]>([]);
  const [detailTab, setDetailTab] = React.useState("files");
  // delete confirmation
  const [pendingDelete, setPendingDelete] = React.useState<PendingDelete>(null);
  // 有未保存修改时被拦下的目标选择，等用户确认「放弃并切换」后才生效。
  const [pendingSelect, setPendingSelect] = React.useState<Selected | null>(null);
  const [pendingClose, setPendingClose] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [pendingOverwrite, setPendingOverwrite] = React.useState<{
    file: File;
    message: string;
  } | null>(null);
  // 调用统计：列表页的次数/最近调用随 api.skills() 一起回来；选中某个 skill 时再拉它的
  // 最近调用明细。missing = 被点名但不存在的 skill（想用但没有）。
  const [usageCalls, setUsageCalls] = React.useState<SkillCall[]>([]);
  const [usageLoading, setUsageLoading] = React.useState(false);
  const [usageError, setUsageError] = React.useState<string | null>(null);
  // 快速切换 skill 时旧请求可能后到；序号保证只有最新一次请求能写入状态。
  const usageSeq = React.useRef(0);
  const [missing, setMissing] = React.useState<MissingSkill[]>([]);
  // ── Data ──────────────────────────────────────────────────────────────────
  const loadSide = React.useCallback(() => {
    setAgentsError(false);
    api
      .agents()
      .then(setAgents)
      .catch(() => setAgentsError(true));
    api
      .mcpServers()
      .then(setMcpOptions)
      .catch(() => {
        /* Optional sidebar data is retried on refresh. */
      });
    api
      .missingSkills()
      .then(setMissing)
      .catch(() => {
        /* Optional sidebar data is retried on refresh. */
      });
  }, []);
  // 变更后统一刷新：旁路数据 + 技能列表。
  const load = React.useCallback(() => {
    loadSide();
    skillsQ.reload();
  }, [loadSide, skillsQ.reload]);
  React.useEffect(() => {
    loadSide();
  }, [loadSide]);
  // 可见性按 skill 批量补拉：一次刷新只发一轮并发请求，不拖慢列表首屏。
  // 失败时明确报错，不能把"没拉到"渲染成"未勾选"。
  const loadVisibility = React.useCallback(() => {
    const list = skillsQ.data ?? [];
    const seq = ++visibilitySeq.current;
    if (list.length === 0) {
      setVisibilityError(null);
      return;
    }
    setVisibilityError(null);
    void Promise.all(list.map((s) => api.skillVisibility(s.name).then((ids) => [s.name, ids] as const)))
      .then((pairs) => {
        if (visibilitySeq.current !== seq) return;
        setVisibility((prev) => {
          const next = { ...prev };
          for (const [name, ids] of pairs) next[name] = ids;
          return next;
        });
      })
      .catch(() => {
        if (visibilitySeq.current !== seq) return;
        setVisibilityError("权限加载失败");
      });
  }, [skillsQ.data]);
  React.useEffect(() => {
    loadVisibility();
  }, [loadVisibility]);
  // ── Upload a .zip skill ───────────────────────────────────────────────────
  async function uploadZip(file: File, overwrite = false) {
    setUploading(true);
    try {
      const r = await api.uploadSkill(file, overwrite);
      toast.success(`已安装 Skill：${r.name}（${r.files} 个文件）`);
      load();
    } catch (e) {
      const msg = (e as Error).message;
      // offer overwrite when the skill already exists
      if (!overwrite && msg.includes("已存在")) {
        setPendingOverwrite({ file, message: msg });
      } else {
        toast.error("上传失败：" + msg);
      }
    } finally {
      setUploading(false);
    }
  }
  function onUploadPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // reset so picking the same file again re-fires
    if (f) void uploadZip(f);
  }
  React.useEffect(() => {
    if (creating) {
      // Small timeout so the element is actually in the DOM before focusing
      setTimeout(() => inlineRef.current?.focus(), 20);
    }
  }, [creating]);
  // Sync detail-panel MCP state when the selected skill changes.
  React.useEffect(() => {
    if (!selectedName) return;
    const sk = skills.find((s) => s.name === selectedName);
    setDetailMcps(sk?.mcps ?? []);
  }, [selectedName, skills]);
  // Recent calls for the selected skill (detail panel only).
  // 序号防旧响应覆盖新选择；失败保留可见错误，而不是伪装成"没有调用记录"。
  React.useEffect(() => {
    const seq = ++usageSeq.current;
    if (!selectedName) {
      setUsageCalls([]);
      setUsageError(null);
      setUsageLoading(false);
      return;
    }
    setUsageCalls([]);
    setUsageError(null);
    setUsageLoading(true);
    api
      .skillUsage(selectedName, 20)
      .then((calls) => {
        if (usageSeq.current === seq) setUsageCalls(calls);
      })
      .catch((e) => {
        if (usageSeq.current !== seq) return;
        setUsageError((e as Error).message || "加载失败");
      })
      .finally(() => {
        if (usageSeq.current === seq) setUsageLoading(false);
      });
  }, [selectedName]);
  React.useEffect(() => {
    void fileReload;
    const seq = ++fileSeq.current;
    if (!selected || selected.path === null) {
      setFileLoading(false);
      setFileContent("");
      setDirty(false);
      setFileError(null);
      return;
    }
    // 先清空上一份内容：读失败时不能把旧文件内容留在编辑框里、被保存到新路径。
    // seq 防止快速切换文件时旧请求覆盖新内容。
    setFileContent("");
    setDirty(false);
    setFileError(null);
    setFileLoading(true);
    api
      .readSkillFile(selected.skill, selected.path)
      .then((c) => {
        if (fileSeq.current === seq) setFileContent(c);
      })
      .catch((e) => {
        if (fileSeq.current === seq) setFileError((e as Error).message);
      })
      .finally(() => {
        if (fileSeq.current === seq) setFileLoading(false);
      });
  }, [selected, fileReload]);
  // ── Selection guard ───────────────────────────────────────────────────────
  // 切换文件/技能会立刻用新内容覆盖编辑器：不拦一下，正在改的正文就静默丢了。
  function requestSelect(next: Selected) {
    if (selected?.skill === next.skill && selected?.path === next.path) return;
    if (dirty && selected && selected.path !== null) {
      setPendingSelect(next);
      return;
    }
    setSelected(next);
  }
  // ── Expand helpers ────────────────────────────────────────────────────────
  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function ensureExpanded(skill: string, dirPath: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(skill);
      if (dirPath) {
        let cur = "";
        for (const part of dirPath.split("/")) {
          cur = cur ? `${cur}/${part}` : part;
          next.add(`${skill}:${cur}`);
        }
      }
      return next;
    });
  }
  // ── Inline create ─────────────────────────────────────────────────────────
  function startCreate(skill: string, inDir: string, kind: "file" | "dir") {
    cancelRef.current = false;
    ensureExpanded(skill, inDir);
    setCreating({ skill, inDir, kind });
    setNewEntryName("");
  }
  // Use a ref snapshot so commitCreate reads the latest creating value
  // without depending on potentially stale closure state.
  const creatingRef = React.useRef<Creating>(null);
  React.useEffect(() => {
    creatingRef.current = creating;
  }, [creating]);
  const newEntryRef = React.useRef("");
  React.useEffect(() => {
    newEntryRef.current = newEntryName;
  }, [newEntryName]);
  async function commitCreate() {
    if (cancelRef.current) {
      cancelRef.current = false;
      return;
    }
    const c = creatingRef.current;
    const name = newEntryRef.current.trim();
    setCreating(null);
    setNewEntryName("");
    if (!c || !name) return;
    const fullPath = c.inDir ? `${c.inDir}/${name}` : name;
    try {
      if (c.kind === "dir") {
        await api.createSkillDir(c.skill, fullPath);
        toast.success(`已创建文件夹：${fullPath}`);
        ensureExpanded(c.skill, fullPath);
      } else {
        await api.writeSkillFile(c.skill, fullPath, "");
        toast.success(`已创建文件：${fullPath}`);
        requestSelect({ skill: c.skill, path: fullPath });
        ensureExpanded(c.skill, c.inDir);
      }
      load();
    } catch (e) {
      toast.error("创建失败：" + (e as Error).message);
    }
  }
  function cancelCreate() {
    cancelRef.current = true;
    setCreating(null);
    setNewEntryName("");
  }
  async function deletePath(skill: string, path: string) {
    try {
      await api.deleteSkillPath(skill, path);
      toast.success(`已删除：${path}`);
      if (selected?.skill === skill && (selected.path === path || selected.path?.startsWith(`${path}/`))) {
        setSelected({ skill, path: null });
      }
      load();
    } catch (e) {
      toast.error("删除失败：" + (e as Error).message);
      // 抛给确认框：失败时保持打开，不假装已删除。
      throw e;
    }
  }
  async function deleteSkill(name: string) {
    try {
      await api.deleteSkill(name);
      toast.success(`已删除 Skill：${name}`);
      if (selected?.skill === name) setSelected(null);
      load();
    } catch (e) {
      toast.error("删除失败：" + (e as Error).message);
      throw e;
    }
  }
  async function runPendingDelete() {
    const p = pendingDelete;
    if (!p) return;
    setDeleting(true);
    try {
      if (p.kind === "skill") await deleteSkill(p.skill);
      else await deletePath(p.skill, p.path);
      // 只有真的删掉才关确认框；失败时留在原地，用户能看到原因并重试。
      setPendingDelete(null);
    } catch {
      /* 错误已 toast */
    } finally {
      setDeleting(false);
    }
  }
  async function saveFile() {
    if (!selected || selected.path === null) return;
    setSaving(true);
    try {
      await api.writeSkillFile(selected.skill, selected.path, fileContent);
      toast.success("已保存");
      setDirty(false);
    } catch (e) {
      toast.error("保存失败：" + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function toggleSkillMcp(skillName: string, mcpName: string, mcpOn: boolean) {
    const next = mcpOn ? [...detailMcps, mcpName] : detailMcps.filter((n) => n !== mcpName);
    setDetailMcps(next);
    try {
      await api.updateSkillMeta(skillName, { mcps: next });
      toast.success(`${mcpOn ? "关联" : "取消关联"}「${mcpName}」`);
      load();
    } catch (e) {
      // roll back on error
      setDetailMcps(detailMcps);
      toast.error("操作失败：" + (e as Error).message);
    }
  }
  async function toggleVisibility(skillName: string, agentId: string, agentName: string) {
    const on = (visibility[skillName] ?? []).includes(agentId);
    try {
      await api.toggleSkillVisibility(agentId, skillName, !on);
      toast.success(`${on ? "取消" : "授予"}「${agentName}」可见`);
      const ids = await api.skillVisibility(skillName);
      setVisibility((v) => ({ ...v, [skillName]: ids }));
    } catch (e) {
      toast.error("操作失败：" + (e as Error).message);
    }
  }
  async function createNewSkill() {
    if (!newName.trim()) {
      toast.error("请填写 name");
      return;
    }
    if (!newDesc.trim()) {
      toast.error("description 为必填项");
      return;
    }
    setCreatingSkill(true);
    try {
      const name = newName.trim();
      await api.createSkill({
        name,
        description: newDesc.trim(),
        license: newLicense.trim() || undefined,
        compatibility: newCompat.trim() || undefined,
        mcps: newMcps.length ? newMcps : undefined,
        instructions: newInst.trim() || undefined,
      });
      // apply initial visibility (fire-and-forget per agent; best-effort)
      await Promise.all(newVisibility.map((id) => api.toggleSkillVisibility(id, name, true)));
      toast.success("已创建 Skill");
      setNewOpen(false);
      setNewName("");
      setNewDesc("");
      setNewLicense("");
      setNewCompat("");
      setNewInst("");
      setNewMcps([]);
      setNewVisibility([]);
      load();
    } catch (e) {
      toast.error("创建失败：" + (e as Error).message);
    } finally {
      setCreatingSkill(false);
    }
  }
  // ── Inline input JSX helper (NOT a React component — avoids remount on re-render) ──
  // Defined as a plain function returning JSX so React never sees a new component type.
  function inlineInputJSX(indent: number) {
    return (
      <Flex key="__inline_create__" className="flex items-center gap-1 py-0.5 pr-2" style={{ paddingLeft: indent }}>
        {creating?.kind === "dir" ? (
          <FolderIcon size={14} className="shrink-0 text-primary" />
        ) : (
          <FileTextIcon size={14} className="shrink-0 text-muted-foreground" />
        )}
        <TextInput
          ref={inlineRef}
          aria-label={creating?.kind === "dir" ? "新文件夹名称" : "新文件名称"}
          size="xs"
          className="min-w-0 flex-1"
          classNames={{ input: "font-mono text-xs tabular-nums" }}
          placeholder={creating?.kind === "dir" ? "folder-name" : "filename.py"}
          value={newEntryName}
          onChange={(e) => setNewEntryName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // 中文输入法选词也是 Enter：此时提交会把还没上屏的拼音当成文件名建出来。
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              cancelRef.current = false;
              void commitCreate();
            }
            if (e.key === "Escape") cancelCreate();
          }}
          onBlur={() => {
            void commitCreate();
          }}
        />
      </Flex>
    );
  }
  // ── Recursive tree renderer ───────────────────────────────────────────────
  function renderTree(nodes: TreeNode[], skill: string, depth: number): React.ReactNode {
    // depth+1: the skill root sits at 8px (px-2); its children indent one step
    // further in so the tree reads as nested under the skill folder.
    const baseIndent = 8 + (depth + 1) * 14;
    return nodes.map((node) => {
      if (node.type === "dir") {
        const key = `${skill}:${node.path}`;
        const open = expanded.has(key);
        return (
          <Stack key={node.path}>
            <Flex
              role="treeitem"
              aria-label={node.name}
              aria-expanded={open}
              aria-level={depth + 2}
              tabIndex={0}
              className="group flex cursor-pointer select-none items-center gap-1 rounded-sm py-1 pr-1 hover:bg-muted/60"
              style={{ paddingLeft: baseIndent }}
              onClick={() => toggleExpanded(key)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggleExpanded(key);
                }
              }}
            >
              <ChevronRightIcon size={14} className={cn("shrink-0 transition-transform", open && "rotate-90")} />
              {open ? (
                <FolderOpenIcon size={14} className="shrink-0 text-primary" />
              ) : (
                <FolderIcon size={14} className="shrink-0 text-primary" />
              )}
              <Text size="sm" className="min-w-0 flex-1 truncate" title={node.path}>
                {node.name}
              </Text>
              <Group
                gap={0}
                wrap="nowrap"
                className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="gray"
                  title="新建文件"
                  aria-label={`在 ${node.path} 下新建文件`}
                  onClick={(e) => {
                    e.stopPropagation();
                    startCreate(skill, node.path, "file");
                  }}
                >
                  <FilePlusIcon size={12} aria-hidden="true" />
                </ActionIcon>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="gray"
                  title="新建文件夹"
                  aria-label={`在 ${node.path} 下新建文件夹`}
                  onClick={(e) => {
                    e.stopPropagation();
                    startCreate(skill, node.path, "dir");
                  }}
                >
                  <FolderPlusIcon size={12} aria-hidden="true" />
                </ActionIcon>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="red"
                  title="删除文件夹"
                  aria-label={`删除文件夹 ${node.path}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDelete({ kind: "dir", skill, path: node.path });
                  }}
                >
                  <Trash2Icon size={12} aria-hidden="true" />
                </ActionIcon>
              </Group>
            </Flex>
            {open && (
              <>
                {renderTree(node.children, skill, depth + 1)}
                {creating?.skill === skill && creating.inDir === node.path && inlineInputJSX(baseIndent + 14)}
              </>
            )}
          </Stack>
        );
      }
      // file node
      const isSelected = selected?.skill === skill && selected.path === node.path;
      return (
        <Flex
          key={node.path}
          role="treeitem"
          aria-label={node.name}
          aria-selected={isSelected}
          aria-level={depth + 2}
          tabIndex={0}
          className={cn(
            "group flex cursor-pointer select-none items-center gap-1 rounded-sm py-1 pr-1",
            isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted/60",
          )}
          style={{ paddingLeft: baseIndent + 16 }}
          onClick={() => requestSelect({ skill, path: node.path })}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              requestSelect({ skill, path: node.path });
            }
          }}
        >
          <FileTextIcon size={14} className="shrink-0 text-muted-foreground" />
          <Text size="xs" ff="monospace" className="min-w-0 flex-1 truncate tabular-nums" title={node.path}>
            {node.name}
          </Text>
          <Group
            gap={0}
            wrap="nowrap"
            className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <ActionIcon
              size="xs"
              variant="subtle"
              color="red"
              title="删除文件"
              aria-label={`删除文件 ${node.path}`}
              onClick={(e) => {
                e.stopPropagation();
                setPendingDelete({ kind: "file", skill, path: node.path });
              }}
            >
              <Trash2Icon size={12} aria-hidden="true" />
            </ActionIcon>
          </Group>
        </Flex>
      );
    });
  }
  // 最近调用明细四态：加载中 / 失败 / 有记录 / 无记录。失败时给出可见错误，
  // 而不是和"没有记录"混为一谈。
  function renderUsage() {
    if (usageLoading) {
      return (
        <Text size="sm" c="dimmed">
          加载调用明细…
        </Text>
      );
    }
    if (usageError) {
      return (
        <Text role="alert" size="sm" className="text-destructive">
          调用记录加载失败：{usageError}
        </Text>
      );
    }
    if (usageCalls.length === 0) {
      return (
        <Stack align="center" gap={6} py="lg" className="rounded-md border border-dashed border-border/60 text-center">
          <ClockIcon size={24} className="text-muted-foreground" aria-hidden="true" />
          <Text size="sm" c="dimmed">
            还没有调用记录。
          </Text>
        </Stack>
      );
    }
    return (
      <Stack gap={0} className="overflow-hidden rounded-md border border-border">
        <Box px="sm" py={6} className="border-b border-border bg-muted/60">
          <Text size="xs" c="dimmed">
            最近 {usageCalls.length} 次调用
          </Text>
        </Box>
        <ScrollArea.Autosize mah={224} scrollbars="y" scrollbarSize={6}>
          {usageCalls.map((c, i) => (
            <Flex
              key={`${c.ts}-${i}`}
              align="center"
              gap="xs"
              px="sm"
              py={6}
              className="border-b border-border last:border-b-0"
            >
              <Text size="xs" ff="monospace" c="dimmed" className="tabular-nums">
                {fmtLastUsed(c.ts)}
              </Text>
              <Badge size="xs" variant="default" ff="monospace" className="normal-case">
                {c.agent_key || "—"}
              </Badge>
              <Text size="xs" c="dimmed" ml="auto">
                {c.task_id > 0 ? `任务 #${c.task_id}` : c.session_id ? "对话会话" : "—"}
              </Text>
            </Flex>
          ))}
        </ScrollArea.Autosize>
      </Stack>
    );
  }
  const selectedSkill = selected ? (skills.find((s) => s.name === selected.skill) ?? null) : null;
  const filteredSkills = skills
    .filter((s) => {
      const q = skillQuery.trim().toLowerCase();
      const matchesQuery =
        !q || [s.name, s.description ?? "", ...(s.mcps ?? [])].some((value) => value.toLowerCase().includes(q));
      const matchesFilter =
        skillFilter === "all" ||
        (skillFilter === "used" && s.calls > 0) ||
        (skillFilter === "unused" && s.calls === 0) ||
        (skillFilter === "mcp" && (s.mcps?.length ?? 0) > 0);
      return matchesQuery && matchesFilter;
    })
    .sort((a, b) => {
      if (skillSort === "calls") return b.calls - a.calls || a.name.localeCompare(b.name);
      if (skillSort === "recent") {
        return (b.last_used ?? "").localeCompare(a.last_used ?? "") || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });
  function openSkill(name: string) {
    const skill = skills.find((item) => item.name === name);
    const initialPath = skill?.files.includes("SKILL.md")
      ? "SKILL.md"
      : (skill?.files.find((file) => !file.endsWith("/")) ?? null);
    setDetailTab("files");
    ensureExpanded(name, "");
    requestSelect({ skill: name, path: initialPath });
  }
  function closeSkill() {
    if (saving) return;
    if (dirty) {
      setPendingClose(true);
      return;
    }
    setSelected(null);
  }
  return (
    <Stack gap="xl" className="min-w-0 flex-1">
      <PageHeader
        icon={SparklesIcon}
        title="技能库"
        description="管理技能文件、关联工具与 Agent 授权。"
        meta={[`共 ${skills.length} 个技能`]}
        actions={
          <>
            {/* 缺口清单：agent 点名调用、但库里没有的 skill —— 直接是该补什么的依据。 */}
            {missing.length > 0 && (
              <Popover>
                <Popover.Target>
                  <Button
                    size="sm"
                    variant="outline"
                    leftSection={
                      <Text component="span" className="text-warning">
                        <AlertTriangleIcon size={14} aria-hidden="true" />
                      </Text>
                    }
                  >
                    {missing.length} 个未命中调用
                  </Button>
                </Popover.Target>
                <Popover.Dropdown className="max-h-72 w-80 overflow-y-auto overscroll-contain">
                  <Text size="xs" c="dimmed" className="mb-2">
                    Agent 点名调用、但技能库里不存在的 skill。按被点名次数排序。
                  </Text>
                  <Stack gap={4}>
                    {missing.map((m) => (
                      <Flex key={m.skill} className="flex items-center gap-2">
                        <Text
                          component="code"
                          size="xs"
                          ff="monospace"
                          className="min-w-0 flex-1 truncate tabular-nums"
                          title={m.skill}
                        >
                          {m.skill}
                        </Text>
                        <Text size="xs" ff="monospace" c="dimmed" className="shrink-0 tabular-nums">
                          {m.calls} 次
                        </Text>
                        <Text size="xs" c="dimmed" className="shrink-0">
                          {fmtLastUsed(m.last_used)}
                        </Text>
                      </Flex>
                    ))}
                  </Stack>
                </Popover.Dropdown>
              </Popover>
            )}
            <input
              ref={uploadRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={onUploadPick}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={uploading}
              onClick={() => uploadRef.current?.click()}
              title="上传包含 SKILL.md 的 .zip 压缩包"
              leftSection={<UploadIcon size={16} aria-hidden="true" />}
            >
              {uploading ? "上传中…" : "上传压缩包"}
            </Button>
            <Button size="sm" onClick={() => setNewOpen(true)} leftSection={<PlusIcon size={16} aria-hidden="true" />}>
              新建 Skill
            </Button>
          </>
        }
      />
      <Flex className="flex flex-wrap items-center gap-2.5">
        <TextInput
          aria-label="搜索 Skill"
          size="sm"
          leftSection={<SearchIcon size={14} aria-hidden="true" />}
          placeholder="搜索名称、用途或 MCP…"
          value={skillQuery}
          onChange={(event) => setSkillQuery(event.target.value)}
          className="min-w-0 flex-1 sm:max-w-sm"
        />
        <Popover>
          <Popover.Target>
            <Button size="sm" variant="outline" leftSection={<SlidersHorizontalIcon size={14} aria-hidden="true" />}>
              筛选与排序
              {(skillFilter !== "all" || skillSort !== "name") && (
                <>
                  <Box component="span" className="inline-block size-1.5 rounded-full bg-primary" aria-hidden="true" />
                  <Text component="span" className="sr-only">
                    已应用筛选或排序
                  </Text>
                </>
              )}
            </Button>
          </Popover.Target>
          <Popover.Dropdown className="w-64 space-y-4">
            <Select
              role="combobox"
              id="skill-filter"
              label="显示"
              aria-label="筛选技能"
              value={skillFilter}
              onChange={(value) => setSkillFilter(value || "all")}
              data={[
                { value: "all", label: "全部技能" },
                { value: "used", label: "已调用" },
                { value: "unused", label: "从未调用" },
                { value: "mcp", label: "关联 MCP" },
              ]}
            />
            <Select
              role="combobox"
              id="skill-sort"
              label="排序"
              aria-label="技能排序"
              value={skillSort}
              onChange={(value) => setSkillSort(value || "name")}
              data={[
                { value: "name", label: "名称排序" },
                { value: "calls", label: "调用最多" },
                { value: "recent", label: "最近调用" },
              ]}
            />
            {(skillFilter !== "all" || skillSort !== "name") && (
              <Button
                size="sm"
                variant="subtle"
                onClick={() => {
                  setSkillFilter("all");
                  setSkillSort("name");
                }}
              >
                重置
              </Button>
            )}
          </Popover.Dropdown>
        </Popover>
        {(skillQuery || skillFilter !== "all") && (
          <Text size="xs" c="dimmed" role="status">
            {filteredSkills.length} 个匹配
          </Text>
        )}
      </Flex>
      {(visibilityError || agentsError) && (
        <Alert color="red" variant="light">
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Text size="xs">
              {agentsError ? "Agent 列表加载失败，暂无法修改授权。" : "权限加载失败，暂无法修改授权。"}
            </Text>
            <Button size="compact-sm" variant="outline" onClick={agentsError ? loadSide : loadVisibility}>
              重试
            </Button>
          </Group>
        </Alert>
      )}
      <AsyncState
        status={skillsQ.status}
        error={skillsQ.error}
        onRetry={skillsQ.reload}
        refreshing={skillsQ.refreshing}
        isEmpty={filteredSkills.length === 0}
        skeleton={
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            {[0, 1].map((i) => (
              <Skeleton key={i} h={176} radius="md" />
            ))}
          </SimpleGrid>
        }
        empty={
          <Stack
            align="center"
            gap="xs"
            px="md"
            py="xl"
            className="rounded-md border border-dashed border-border/60 text-center"
          >
            <SparklesIcon size={24} className="text-muted-foreground" aria-hidden="true" />
            <Text size="sm" fw={500}>
              {skills.length ? "没有匹配的技能" : "还没有技能"}
            </Text>
            <Text size="sm" c="dimmed" className="max-w-md">
              {skills.length ? "调整搜索或筛选条件。" : "新建 Skill 或导入压缩包，添加可供 Agent 使用的方法。"}
            </Text>
          </Stack>
        }
      >
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          {filteredSkills.map((skill) => (
            <Card key={skill.name} padding={0} className="min-w-0">
              <Flex align="flex-start" gap="sm" px="md" pt="md" pb="sm">
                <UnstyledButton
                  aria-label={`编辑 Skill ${skill.name}`}
                  onClick={() => openSkill(skill.name)}
                  className="group flex min-w-0 flex-1 items-start gap-3 text-left"
                >
                  <ThemeIcon size="lg" radius="md" variant="light" color="blue" aria-hidden="true">
                    <SparklesIcon size={16} />
                  </ThemeIcon>
                  <Stack gap={4} className="min-w-0 flex-1">
                    <Group gap="xs" wrap="nowrap" className="min-w-0">
                      <Text size="sm" fw={600} truncate>
                        {skill.name}
                      </Text>
                      <ChevronRightIcon size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Group>
                    <Text size="sm" c="dimmed" lineClamp={2} title={skill.description} className="leading-relaxed">
                      {skill.description || "未填写技能描述"}
                    </Text>
                    <Group gap="sm" mt={2} wrap="wrap">
                      <Text size="xs" c="dimmed">
                        {skill.files.filter((file) => !file.endsWith("/")).length} 个文件
                      </Text>
                      {!!skill.mcps?.length && (
                        <Text size="xs" c="dimmed">
                          {skill.mcps.length} 个 MCP
                        </Text>
                      )}
                      <Text size="xs" c="dimmed">
                        {skill.calls > 0 ? `${skill.calls} 次调用` : "尚未调用"}
                      </Text>
                    </Group>
                  </Stack>
                </UnstyledButton>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="red"
                  className="shrink-0"
                  aria-label={`删除 Skill ${skill.name}`}
                  onClick={() => setPendingDelete({ kind: "skill", skill: skill.name })}
                >
                  <Trash2Icon size={16} aria-hidden="true" />
                </ActionIcon>
              </Flex>
              <Box
                component="fieldset"
                aria-label={`${skill.name} 的 Agent 授权`}
                className="m-0 mt-auto min-w-0 border-0 border-t border-solid border-border px-4 py-3"
              >
                <Group gap={6} mb={6}>
                  <ShieldCheckIcon size={14} className="text-muted-foreground" aria-hidden="true" />
                  <Text size="sm" fw={500} c="dimmed">
                    Agent 授权
                  </Text>
                </Group>
                <Group gap={6} className="min-w-0">
                  {agents.map((agent) => {
                    const checked = (visibility[skill.name] ?? []).includes(agent.id);
                    const disabled = !!visibilityError || !!agentsError || !visibility[skill.name];
                    return (
                      <Box
                        key={agent.id}
                        component="label"
                        htmlFor={`skill-${skill.name}-${agent.id}`}
                        className={cn(
                          "inline-flex min-h-7 max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors",
                          checked
                            ? "border-success/40 bg-success/10 text-success"
                            : "border-border text-muted-foreground hover:border-input",
                          disabled && "cursor-default opacity-50",
                        )}
                      >
                        <Checkbox
                          id={`skill-${skill.name}-${agent.id}`}
                          size="xs"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => void toggleVisibility(skill.name, agent.id, agent.name)}
                        />
                        <Text size="xs" truncate>
                          {agent.name}
                        </Text>
                      </Box>
                    );
                  })}
                  {agents.length === 0 && (
                    <Text size="xs" c="dimmed">
                      {agentsError ? "加载失败" : "暂无 Agent"}
                    </Text>
                  )}
                </Group>
              </Box>
            </Card>
          ))}
        </SimpleGrid>
      </AsyncState>

      <Modal
        opened={!!selectedSkill}
        onClose={() =>
          ((open) => {
            if (!open) closeSkill();
          })(false)
        }
        title={selectedSkill?.name}
        closeButtonProps={CLOSE_BUTTON_PROPS}
        size="min(1100px, calc(100vw - 2rem))"
        styles={{
          body: { display: "flex", flexDirection: "column", height: "min(72dvh, 46rem)" },
        }}
        centered
      >
        <Text size="sm" c="dimmed" mb="sm">
          {selectedSkill?.description || "管理技能文件与关联工具。"}
        </Text>
        {selectedSkill && (
          <Tabs
            value={detailTab}
            onChange={(value) => setDetailTab(value || "files")}
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            <Tabs.List variant="line" mb="sm">
              <Tabs.Tab value="files">文件</Tabs.Tab>
              <Tabs.Tab value="resources">关联 MCP</Tabs.Tab>
              <Tabs.Tab value="usage">调用记录</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="files" keepMounted className="flex min-h-0 flex-1 flex-col">
              <Box className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-md border border-border md:grid-cols-[220px_minmax(0,1fr)] md:grid-rows-1">
                <Stack gap={0} className="min-h-0 min-w-0 border-b border-border md:border-r md:border-b-0">
                  <Flex align="center" justify="space-between" px="xs" py={6}>
                    <Text size="xs" c="dimmed">
                      文件
                    </Text>
                    <Group gap={2}>
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        color="gray"
                        aria-label={`在 ${selectedSkill.name} 下新建文件`}
                        onClick={() => startCreate(selectedSkill.name, "", "file")}
                      >
                        <FilePlusIcon size={14} aria-hidden="true" />
                      </ActionIcon>
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        color="gray"
                        aria-label={`在 ${selectedSkill.name} 下新建文件夹`}
                        onClick={() => startCreate(selectedSkill.name, "", "dir")}
                      >
                        <FolderPlusIcon size={14} aria-hidden="true" />
                      </ActionIcon>
                    </Group>
                  </Flex>
                  <ScrollArea
                    className="max-h-40 min-h-0 flex-1 md:max-h-none"
                    classNames={{ viewport: "[&>div]:!block" }}
                  >
                    <Stack role="tree" aria-label="Skill 文件" gap={0} p="xs">
                      {renderTree(buildTree(selectedSkill.files), selectedSkill.name, -1)}
                      {creating?.skill === selectedSkill.name && creating.inDir === "" && inlineInputJSX(8)}
                    </Stack>
                  </ScrollArea>
                </Stack>
                {/* 暗色下编辑区用 surface-muted，和文件树/弹层拉开层次。 */}
                <Stack gap={0} className="min-h-0 min-w-0 flex-1 bg-surface-muted">
                  <Flex align="center" gap="xs" px="sm" py="xs" className="border-b border-border">
                    <FileCode2Icon size={14} className="text-muted-foreground" aria-hidden="true" />
                    <Text size="xs" ff="monospace" className="min-w-0 truncate">
                      {selected?.path || "选择文件"}
                    </Text>
                    {dirty && (
                      <Badge size="xs" color="yellow" variant="light" ml="auto" className="shrink-0">
                        未保存
                      </Badge>
                    )}
                  </Flex>
                  {fileLoading ? (
                    <Stack p="md">
                      <Skeleton h={128} radius="sm" />
                    </Stack>
                  ) : fileError ? (
                    <Stack role="alert" gap="sm" p="md">
                      <Text size="xs" className="text-destructive">
                        {fileError}
                      </Text>
                      <Button
                        size="compact-sm"
                        variant="outline"
                        onClick={() => setFileReload((n) => n + 1)}
                        className="self-start"
                      >
                        重试
                      </Button>
                    </Stack>
                  ) : selected?.path ? (
                    <Textarea
                      // key 让切换文件时重建 textarea：复用旧节点会保留上一个文件的
                      // scrollTop，长文件切到长文件时首行（frontmatter）就被卷出视野。
                      key={`${selected.skill}:${selected.path}`}
                      aria-label="文件内容"
                      variant="unstyled"
                      className="flex min-h-0 flex-1 flex-col"
                      classNames={{
                        // Mantine 的 Input wrapper 默认 block/auto 高；只给 textarea 加
                        // flex-1 不生效，会被压成默认两行、面板其余留白。wrapper 也要
                        // 成为撑满剩余高度的 flex 容器，输入框才能在内部滚动。
                        wrapper: "flex min-h-0 flex-1 flex-col",
                        input:
                          "min-h-0 flex-1 resize-none bg-transparent px-4 py-3 font-mono text-xs leading-6 tabular-nums",
                      }}
                      value={fileContent}
                      onChange={(event) => {
                        setFileContent(event.target.value);
                        setDirty(true);
                      }}
                    />
                  ) : (
                    <Text size="sm" c="dimmed" p="md">
                      选择左侧文件开始编辑。
                    </Text>
                  )}
                </Stack>
              </Box>
            </Tabs.Panel>
            <Tabs.Panel value="resources" className="flex min-h-0 flex-1 flex-col overflow-y-auto p-0 pt-1">
              <Box component="section">
                <Text id="skill-mcp-label" size="sm" c="dimmed" mb="md" className="leading-relaxed">
                  加载此技能时，Agent 可使用所选 MCP 的工具。选择后自动保存。
                </Text>
                {mcpOptions.length === 0 ? (
                  <Text size="xs" c="dimmed">
                    暂无 MCP，可在「MCP」页添加。
                  </Text>
                ) : (
                  <Box component="fieldset" aria-labelledby="skill-mcp-label" className="m-0 min-w-0 border-0 p-0">
                    {mcpOptions.map((m) => (
                      <Box
                        key={m.id}
                        component="label"
                        htmlFor={`detail-mcp-${m.id}`}
                        className="flex cursor-pointer items-center gap-3 border-b border-border px-1 py-3 last:border-b-0 hover:bg-muted/60"
                      >
                        <Checkbox
                          id={`detail-mcp-${m.id}`}
                          checked={detailMcps.includes(m.name)}
                          onChange={(event) =>
                            ((on) => toggleSkillMcp(selectedSkill.name, m.name, !!on))(event.currentTarget.checked)
                          }
                        />
                        <PlugIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <Box className="min-w-0 flex-1 truncate" fz="sm">
                          {m.name}
                        </Box>
                        <Text size="xs" ff="monospace" c="dimmed">
                          {m.transport}
                        </Text>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            </Tabs.Panel>
            <Tabs.Panel value="usage" className="flex min-h-0 flex-1 flex-col overflow-y-auto p-0 pt-1">
              {/* ── 调用统计 ── */}
              <Stack gap="lg" className="min-w-0">
                <SimpleGrid cols={3} spacing="xs">
                  <Stack gap={2} p="sm" className="rounded-md bg-muted/60">
                    <Text size="lg" fw={600} ff="monospace" className="tabular-nums">
                      {selectedSkill.calls}
                    </Text>
                    <Text size="sm" c="dimmed">
                      总调用次数
                    </Text>
                  </Stack>
                  <Stack gap={2} p="sm" className="rounded-md bg-muted/60">
                    <Text size="lg" fw={600} ff="monospace" className="tabular-nums">
                      {selectedSkill.tasks ?? 0}
                    </Text>
                    <Text size="sm" c="dimmed">
                      覆盖任务数
                    </Text>
                  </Stack>
                  <Stack gap={2} p="sm" className="rounded-md bg-muted/60">
                    <Text size="sm" fw={500} truncate title={fmtLastUsed(selectedSkill.last_used)}>
                      {fmtLastUsed(selectedSkill.last_used)}
                    </Text>
                    <Text size="sm" c="dimmed">
                      最近调用
                    </Text>
                  </Stack>
                </SimpleGrid>
                {(selectedSkill.usage_agents ?? []).length > 0 && (
                  <Group gap={6}>
                    <Text size="xs" c="dimmed">
                      调用方
                    </Text>
                    {(selectedSkill.usage_agents ?? []).map((k) => (
                      <Badge key={k} size="sm" variant="default" ff="monospace" className="normal-case">
                        {k}
                      </Badge>
                    ))}
                  </Group>
                )}
                {renderUsage()}
              </Stack>
            </Tabs.Panel>
          </Tabs>
        )}
        <Group justify="flex-end" mt="md">
          {dirty && detailTab !== "files" && (
            <Text size="xs" className="mr-auto text-warning">
              文件有未保存的修改
            </Text>
          )}
          <Button variant="outline" disabled={saving} onClick={closeSkill}>
            关闭
          </Button>
          {(detailTab === "files" || dirty) && (
            <Button onClick={() => void saveFile()} disabled={!dirty || saving || fileLoading || !!fileError}>
              {saving ? "保存中…" : "保存"}
            </Button>
          )}
        </Group>
      </Modal>

      {/* ── 未保存修改：切换前确认 ── */}
      <Modal
        opened={!!pendingSelect || pendingClose}
        onClose={() =>
          ((open) => {
            if (!open) {
              setPendingSelect(null);
              setPendingClose(false);
            }
          })(false)
        }
        title="放弃未保存的修改？"
        closeButtonProps={CLOSE_BUTTON_PROPS}
        centered
      >
        <Text size="sm" c="dimmed">
          {selected?.path ? `「${selected.skill}/${selected.path}」` : "当前文件"}
          还有未保存的修改，离开后这些修改会丢失。
        </Text>
        <Group justify="flex-end" mt="md">
          <Button
            variant="outline"
            onClick={() => {
              setPendingSelect(null);
              setPendingClose(false);
            }}
          >
            继续编辑
          </Button>
          <Button
            onClick={() => {
              const next = pendingSelect;
              setPendingSelect(null);
              if (pendingClose) {
                setDirty(false);
                setSelected(null);
                setPendingClose(false);
              } else if (next) setSelected(next);
            }}
          >
            {pendingClose ? "放弃并关闭" : "放弃并切换"}
          </Button>
        </Group>
      </Modal>

      {/* ── 删除二次确认 ── */}
      <Modal
        opened={!!pendingOverwrite}
        onClose={() =>
          ((open) => {
            if (!open) setPendingOverwrite(null);
          })(false)
        }
        title="覆盖同名 Skill？"
        closeButtonProps={CLOSE_BUTTON_PROPS}
        centered
      >
        <Text size="sm" c="dimmed">
          {pendingOverwrite?.message}。覆盖后将替换同名 Skill 的文件。
        </Text>
        <Group justify="flex-end" mt="md">
          <Button variant="outline" onClick={() => setPendingOverwrite(null)}>
            取消
          </Button>
          <Button
            onClick={() => {
              const file = pendingOverwrite?.file;
              setPendingOverwrite(null);
              if (file) void uploadZip(file, true);
            }}
          >
            覆盖
          </Button>
        </Group>
      </Modal>
      <Modal
        opened={!!pendingDelete}
        onClose={() =>
          ((o) => {
            if (!o && !deleting) setPendingDelete(null);
          })(false)
        }
        title={
          pendingDelete?.kind === "skill"
            ? `删除 Skill「${pendingDelete.skill}」？`
            : pendingDelete?.kind === "dir"
              ? `删除文件夹「${pendingDelete.path}」？`
              : pendingDelete?.kind === "file"
                ? `删除文件「${pendingDelete.path}」？`
                : "确认删除？"
        }
        closeButtonProps={CLOSE_BUTTON_PROPS}
        centered
      >
        <Text size="sm" c="dimmed">
          {pendingDelete?.kind === "skill"
            ? "将删除该 Skill 的全部文件、MCP 关联与可见性配置。此操作不可撤销。"
            : pendingDelete?.kind === "dir"
              ? "将一并删除该文件夹下的所有文件。此操作不可撤销。"
              : "此操作不可撤销。"}
        </Text>
        <Group justify="flex-end" mt="md">
          <Button disabled={deleting} variant="outline" onClick={() => setPendingDelete(null)}>
            取消
          </Button>
          <Button
            color="red"
            disabled={deleting}
            onClick={(e) => {
              e.preventDefault();
              void runPendingDelete();
            }}
          >
            {deleting ? "删除中…" : "删除"}
          </Button>
        </Group>
      </Modal>

      {/* ── 新建 Skill 对话框 ── */}
      <Modal
        opened={newOpen}
        onClose={() => setNewOpen(false)}
        title="新建 Skill"
        closeButtonProps={CLOSE_BUTTON_PROPS}
        size="lg"
        classNames={{
          content: "flex max-h-[min(88dvh,44rem)] flex-col overflow-hidden",
          header: "shrink-0",
          body: "flex min-h-0 flex-1 flex-col overflow-hidden",
        }}
        centered
      >
        <Text size="sm" c="dimmed" mb="sm">
          填写名称与描述，按需关联 MCP 并选择可见的 Agent。
        </Text>
        <Tabs defaultValue="basic" className="flex min-h-0 flex-1 flex-col">
          <Tabs.List variant="line" mb="md">
            <Tabs.Tab value="basic">基本信息</Tabs.Tab>
            <Tabs.Tab
              value="mcp"
              rightSection={
                newMcps.length > 0 ? (
                  <Badge size="xs" variant="light" circle>
                    {newMcps.length}
                  </Badge>
                ) : undefined
              }
            >
              关联 MCP
            </Tabs.Tab>
            <Tabs.Tab
              value="visibility"
              rightSection={
                newVisibility.length > 0 ? (
                  <Badge size="xs" variant="light" circle>
                    {newVisibility.length}
                  </Badge>
                ) : undefined
              }
            >
              可见性
            </Tabs.Tab>
          </Tabs.List>

          {/* 基本信息 */}
          <Tabs.Panel value="basic" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pt-1">
            <TextInput
              id="sk-name"
              label={
                <>
                  名称{" "}
                  <Text component="span" className="text-destructive">
                    *
                  </Text>
                </>
              }
              description="小写字母 / 数字 / 连字符，1–64 字符"
              placeholder="sqli-deepdive"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Textarea
              id="sk-desc"
              label={
                <>
                  描述{" "}
                  <Text component="span" className="text-destructive">
                    *
                  </Text>
                </>
              }
              rows={2}
              resize="none"
              placeholder="这个 skill 做什么、何时使用。"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <TextInput
                id="sk-license"
                label="license"
                placeholder="MIT / Proprietary"
                value={newLicense}
                onChange={(e) => setNewLicense(e.target.value)}
              />
              <TextInput
                id="sk-compatibility"
                label="compatibility"
                placeholder="需要 sqlmap、python3"
                value={newCompat}
                onChange={(e) => setNewCompat(e.target.value)}
              />
            </SimpleGrid>
            <Textarea
              id="sk-inst"
              label={
                <>
                  正文{" "}
                  <Text component="span" size="xs" c="dimmed" fw={400}>
                    （留空自动生成骨架）
                  </Text>
                </>
              }
              className="flex min-h-0 flex-1 flex-col"
              classNames={{ input: "min-h-28 flex-1 resize-y bg-surface-muted font-mono text-xs leading-relaxed" }}
              placeholder={"## 执行方法\n\n1. 先探测错误\n2. 区分盲注类型\n\n脚本放 scripts/ 目录。"}
              value={newInst}
              onChange={(e) => setNewInst(e.target.value)}
            />
          </Tabs.Panel>

          {/* 关联 MCP */}
          <Tabs.Panel value="mcp" className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-1">
            <Text size="sm" c="dimmed" mb="sm">
              加载 Skill 时才披露并解锁所选 MCP 的工具。
            </Text>
            {mcpOptions.length === 0 ? (
              <Text size="xs" c="dimmed">
                暂无 MCP，可在「MCP」页添加。
              </Text>
            ) : (
              <Stack gap="xs">
                {mcpOptions.map((m) => {
                  const checked = newMcps.includes(m.name);
                  return (
                    <Box
                      key={m.id}
                      component="label"
                      htmlFor={`new-skill-mcp-${m.id}`}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-3 transition-colors",
                        checked ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/60",
                      )}
                    >
                      <Checkbox
                        id={`new-skill-mcp-${m.id}`}
                        checked={checked}
                        onChange={(event) =>
                          ((on) => setNewMcps((cur) => (on ? [...cur, m.name] : cur.filter((n) => n !== m.name))))(
                            event.currentTarget.checked,
                          )
                        }
                      />
                      <Text size="sm">{m.name}</Text>
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Tabs.Panel>

          {/* 可见性 */}
          <Tabs.Panel value="visibility" className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-1">
            <Text size="sm" c="dimmed" mb="sm">
              选中的 Agent 创建后即可见此 Skill。
            </Text>
            {agents.length === 0 ? (
              <Text size="xs" c="dimmed">
                （暂无 Agent）
              </Text>
            ) : (
              <Stack gap="xs">
                {agents.map((a) => {
                  const checked = newVisibility.includes(a.id);
                  return (
                    <Box
                      key={a.key}
                      component="label"
                      htmlFor={`new-skill-agent-${a.id}`}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-3 transition-colors",
                        checked ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/60",
                      )}
                    >
                      <Checkbox
                        id={`new-skill-agent-${a.id}`}
                        checked={checked}
                        onChange={(event) =>
                          ((on) => setNewVisibility((cur) => (on ? [...cur, a.id] : cur.filter((id) => id !== a.id))))(
                            event.currentTarget.checked,
                          )
                        }
                      />
                      <Text size="sm">{a.name}</Text>
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Tabs.Panel>
        </Tabs>
        <Group justify="flex-end" mt="md" className="shrink-0">
          <Button variant="outline" disabled={creatingSkill} onClick={() => setNewOpen(false)}>
            取消
          </Button>
          <Button onClick={createNewSkill} disabled={creatingSkill}>
            {creatingSkill ? "创建中…" : "创建"}
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
