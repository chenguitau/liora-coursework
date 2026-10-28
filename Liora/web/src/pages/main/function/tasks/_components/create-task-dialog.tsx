"use client";

import * as React from "react";

import {
  Box,
  Button,
  CloseButton,
  Collapse,
  Combobox,
  Grid,
  Group,
  Input,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Pill,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  useCombobox,
} from "@mantine/core";
import { ChevronRightIcon, PaperclipIcon, PlusIcon } from "lucide-react";

import { api } from "@/lib/api";
import { toast } from "@/lib/notifications";
import type { LLMProfile, TaskCategory } from "@/lib/types";

import { appendUploads } from "../task-format";

// 单选分类：输入已有名称可选中，完全无匹配时可即时创建。
function CategoryPicker({
  categories,
  value,
  onValueChange,
  onCategoryCreated,
}: {
  categories: TaskCategory[];
  value?: number;
  onValueChange: (categoryID?: number) => void;
  onCategoryCreated: () => void;
}) {
  const [inputValue, setInputValue] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [localExtra, setLocalExtra] = React.useState<TaskCategory[]>([]);
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const allCategories = React.useMemo(() => {
    const byID = new Map<number, TaskCategory>();
    for (const category of categories) byID.set(category.id, category);
    for (const category of localExtra) if (!byID.has(category.id)) byID.set(category.id, category);
    return [...byID.values()];
  }, [categories, localExtra]);
  const selected = allCategories.find((category) => category.id === value);
  const trimmed = inputValue.trim();
  const lower = trimmed.toLowerCase();
  const matches = allCategories.filter((category) => category.name.toLowerCase().includes(lower));

  const createAndSelect = async () => {
    if (!trimmed || creating) return;
    const existing = allCategories.find((category) => category.name.toLowerCase() === lower);
    if (existing) {
      onValueChange(existing.id);
      setInputValue("");
      combobox.closeDropdown();
      return;
    }
    setCreating(true);
    try {
      const created = await api.createTaskCategory(trimmed);
      setLocalExtra((previous) => [...previous, created]);
      onValueChange(created.id);
      setInputValue("");
      onCategoryCreated();
      combobox.closeDropdown();
      toast.success(`已创建分类「${created.name}」`);
    } catch (error) {
      toast.error(`创建分类失败：${(error as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Combobox
      store={combobox}
      withinPortal
      onOptionSubmit={(id) => {
        if (id === "__create") void createAndSelect();
        else {
          onValueChange(Number(id));
          setInputValue("");
          combobox.closeDropdown();
        }
      }}
    >
      <Combobox.Target>
        {selected ? (
          <Group gap="xs" className="min-h-9 rounded-md border border-border px-2">
            <Pill withRemoveButton onRemove={() => onValueChange(undefined)}>
              {selected.name}
            </Pill>
            <TextInput
              id="task-category"
              variant="unstyled"
              className="min-w-0 flex-1"
              placeholder="搜索分类"
              value={inputValue}
              onChange={(event) => {
                setInputValue(event.currentTarget.value);
                combobox.openDropdown();
              }}
              onFocus={() => combobox.openDropdown()}
            />
            <CloseButton aria-label="清除分类" onClick={() => onValueChange(undefined)} />
          </Group>
        ) : (
          <TextInput
            id="task-category"
            placeholder="搜索分类，或输入新名称后回车创建"
            value={inputValue}
            rightSection={creating ? <Loader size={14} /> : undefined}
            onChange={(event) => {
              setInputValue(event.currentTarget.value);
              combobox.openDropdown();
              combobox.resetSelectedOption();
            }}
            onFocus={() => combobox.openDropdown()}
            onClick={() => combobox.openDropdown()}
            onKeyDown={(event) => {
              if (event.key === "Enter" && matches.length === 0 && trimmed) {
                event.preventDefault();
                void createAndSelect();
              }
            }}
          />
        )}
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Options>
          {matches.map((category) => (
            <Combobox.Option value={String(category.id)} key={category.id}>
              {category.name}
            </Combobox.Option>
          ))}
          {matches.length === 0 && trimmed ? (
            <Combobox.Option value="__create" disabled={creating}>
              <Group gap="xs">
                {creating ? <Loader size={14} /> : <PlusIcon size={14} />}创建分类「{trimmed}」
              </Group>
            </Combobox.Option>
          ) : null}
          {matches.length === 0 && !trimmed ? <Combobox.Empty>输入名称以搜索或创建分类</Combobox.Empty> : null}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

export function CreateTaskDialog({
  categories,
  onCreated,
  onCategoriesChanged,
}: {
  categories: TaskCategory[];
  onCreated: () => void;
  onCategoriesChanged: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [advanced, setAdvanced] = React.useState(false);
  const [name, setName] = React.useState("");
  const [categoryID, setCategoryID] = React.useState<number | undefined>(undefined);
  const [description, setDescription] = React.useState("");
  const [goal, setGoal] = React.useState("");
  const [profiles, setProfiles] = React.useState<LLMProfile[]>([]);
  const [llmProfileID, setLLMProfileID] = React.useState("default");
  const [creating, setCreating] = React.useState(false);
  const [timeoutMin, setTimeoutMin] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [uploadCount, setUploadCount] = React.useState(0);
  const draftIdRef = React.useRef<string>("");
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    api
      .llmProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, []);

  async function pickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!draftIdRef.current) {
      draftIdRef.current =
        globalThis.crypto?.randomUUID?.() ?? `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    }
    setUploading(true);
    try {
      const result = await api.chatUpload("staging", draftIdRef.current, Array.from(files));
      setDescription((previous) => appendUploads(previous, result.attachments));
      setUploadCount((count) => count + result.attachments.length);
    } catch (error) {
      toast.error("上传失败：" + (error as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function createTask() {
    if (!description.trim() || !goal.trim()) {
      toast.error("请填写描述与目标");
      return;
    }
    setCreating(true);
    try {
      const timeoutSec = Math.max(0, Math.floor(Number(timeoutMin) || 0)) * 60;
      await api.createTask({
        name: name.trim(),
        categoryId: categoryID,
        description: description.trim(),
        goal: goal.trim(),
        llmProfileIds: llmProfileID === "default" ? [] : [Number(llmProfileID)],
        timeoutSeconds: timeoutSec,
        seedFirstIntent: false,
        planHeartbeatSeconds: 600,
        coverageEnabled: true,
      });
      toast.success("任务已创建");
      setName("");
      setCategoryID(undefined);
      setDescription("");
      setGoal("");
      setLLMProfileID("default");
      setTimeoutMin("");
      setUploadCount(0);
      draftIdRef.current = "";
      setOpen(false);
      onCreated();
    } catch (error) {
      toast.error("创建失败：" + (error as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Button size="sm" leftSection={<PlusIcon size={16} />} onClick={() => setOpen(true)}>
        新建任务
      </Button>
      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        title="新建任务"
        size="xl"
        centered
        closeOnClickOutside={!creating && !uploading}
        closeOnEscape={!creating && !uploading}
        withCloseButton={!creating && !uploading}
        closeButtonProps={{ "aria-label": "关闭弹窗" }}
        styles={{ body: { display: "flex", flexDirection: "column", maxHeight: "min(74dvh, 44rem)" } }}
      >
        <Text size="sm" c="dimmed">
          定义测试对象与目标，为任务选择合适的模型。
        </Text>
        <Stack gap="md" className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          <Grid gutter="md">
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput
                id="name"
                label="名称（可选）"
                placeholder="例如：官网安全测试"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <Select
                id="task-model"
                label="AI 配置"
                value={llmProfileID}
                onChange={(next) => setLLMProfileID(next ?? "default")}
                data={[
                  { value: "default", label: "使用默认配置" },
                  ...profiles.map((profile) => ({
                    value: String(profile.id),
                    label: `${profile.name} · ${profile.model}`,
                  })),
                ]}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <Textarea
                id="description"
                label="描述"
                withAsterisk
                minRows={4}
                autosize
                description="测试对象与背景：目标地址、授权范围，以及允许/禁止的操作。未填名称时，这段文字会作为任务标题。"
                placeholder="例如：测试 example.com 站点，仅限该域名，禁止暴力破解"
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <Textarea
                id="goal"
                label="目标"
                withAsterisk
                minRows={4}
                autosize
                description="要交付、可核验的最终结果，而不是扫描或验证步骤。系统据此拆解目标并判断任务是否完成。"
                placeholder="例如：验证 SQL 注入与 XSS，并生成含复现步骤的报告"
                value={goal}
                onChange={(event) => setGoal(event.currentTarget.value)}
              />
            </Grid.Col>
          </Grid>
          <Group gap="sm" wrap="wrap" align="center">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => void pickFiles(event.currentTarget.files)}
            />
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              leftSection={uploading ? <Loader size={14} /> : <PaperclipIcon size={14} />}
            >
              上传文件
            </Button>
            <Text size="xs" c="dimmed">
              {uploadCount > 0
                ? `已上传 ${uploadCount} 个文件，文件路径已添加到描述。`
                : "可上传多个文件，作为本次任务的参考资料。"}
            </Text>
          </Group>
          <Paper withBorder radius="md" className="overflow-hidden">
            <Button
              variant="subtle"
              color="gray"
              fullWidth
              justify="space-between"
              size="sm"
              classNames={{ label: "flex-1 text-left" }}
              onClick={() => setAdvanced((current) => !current)}
              rightSection={
                <Text size="xs" c="dimmed">
                  任务分类 · 超时
                </Text>
              }
              leftSection={
                <ChevronRightIcon
                  size={16}
                  className={advanced ? "rotate-90 transition-transform" : "transition-transform"}
                />
              }
            >
              高级设置
            </Button>
            <Collapse in={advanced}>
              <Box p="md" className="border-t border-border/60">
                <Grid gutter="md">
                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <Input.Wrapper
                      id="task-category"
                      label="任务分类"
                      description="可选，单个分类；仅用于任务归类，不影响 Agent 执行。"
                    >
                      <CategoryPicker
                        categories={categories}
                        value={categoryID}
                        onValueChange={setCategoryID}
                        onCategoryCreated={onCategoriesChanged}
                      />
                    </Input.Wrapper>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <NumberInput
                      id="timeout-min"
                      label="任务超时（分钟，可选）"
                      min={0}
                      w={160}
                      placeholder="留空 = 不限时"
                      value={timeoutMin}
                      onChange={(value) => setTimeoutMin(String(value))}
                      description="到点后触发优雅收尾（各 agent 写回 + planner 终局判定），任务进入 timeout 终态。"
                    />
                  </Grid.Col>
                </Grid>
              </Box>
            </Collapse>
          </Paper>
        </Stack>
        <Group justify="flex-end" gap="sm" className="mt-4 shrink-0 border-t border-border/60 pt-4">
          <Button size="sm" variant="default" disabled={creating || uploading} onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button size="sm" onClick={createTask} loading={creating} disabled={uploading}>
            {creating ? "创建中" : "创建"}
          </Button>
        </Group>
      </Modal>
    </>
  );
}
