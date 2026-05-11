import { useRef, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { GOAL_STATUSES, GOAL_LEVELS } from "@paperclipai/shared";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { goalsApi } from "../api/goals";
import { agentsApi } from "../api/agents";
import { assetsApi } from "../api/assets";
import { ApiError } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Maximize2,
  Minimize2,
  Target,
  Layers,
  User,
} from "lucide-react";
import { cn } from "../lib/utils";
import { MarkdownEditor, type MarkdownEditorRef } from "./MarkdownEditor";
import { StatusBadge } from "./StatusBadge";

const levelLabels: Record<string, string> = {
  company: "Company",
  team: "Team",
  agent: "Agent",
  task: "Task",
};

const ALLOWED_PARENT_LEVEL: Record<string, string | null> = {
  company: null,
  team: "company",
  agent: "team",
  task: "agent",
};

const CHILD_LEVEL_FOR: Record<string, string> = {
  company: "team",
  team: "agent",
  agent: "task",
};

type GoalViolation = {
  code: string;
  field: "level" | "parentId" | "ownerAgentId" | "status";
  message: string;
};

export function NewGoalDialog() {
  const { newGoalOpen, newGoalDefaults, closeNewGoal } = useDialog();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("planned");
  const [level, setLevel] = useState("company");
  const [parentId, setParentId] = useState("");
  const [ownerAgentId, setOwnerAgentId] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [levelInitialized, setLevelInitialized] = useState(false);
  const [topLevelError, setTopLevelError] = useState("");
  const [violations, setViolations] = useState<GoalViolation[]>([]);

  const [statusOpen, setStatusOpen] = useState(false);
  const [levelOpen, setLevelOpen] = useState(false);
  const [parentOpen, setParentOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const descriptionEditorRef = useRef<MarkdownEditorRef>(null);

  const appliedParentId = parentId || newGoalDefaults.parentId || "";

  const { data: goals } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && newGoalOpen,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && newGoalOpen,
  });

  // Initialize level from parent's level when dialog opens
  useEffect(() => {
    if (!newGoalOpen || levelInitialized) return;
    if (newGoalDefaults.parentId && !goals) return; // wait for goals to load

    if (newGoalDefaults.parentId) {
      const parent = (goals ?? []).find((g) => g.id === newGoalDefaults.parentId);
      setLevel(parent ? (CHILD_LEVEL_FOR[parent.level] ?? "company") : "company");
    } else {
      setLevel("company");
    }
    setLevelInitialized(true);
  }, [newGoalOpen, levelInitialized, goals, newGoalDefaults.parentId]);

  const createGoal = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      goalsApi.create(selectedCompanyId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.goals.list(selectedCompanyId!) });
      reset();
      closeNewGoal();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) {
        const body = err.body as {
          error?: string;
          details?: { violations?: GoalViolation[] };
        } | null;
        setTopLevelError(body?.error ?? "Validation failed");
        setViolations(body?.details?.violations ?? []);
      } else {
        setTopLevelError((err as Error).message ?? "Failed to create goal");
        setViolations([]);
      }
    },
  });

  const uploadDescriptionImage = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedCompanyId) throw new Error("No company selected");
      return assetsApi.uploadImage(selectedCompanyId, file, "goals/drafts");
    },
  });

  function reset() {
    setTitle("");
    setDescription("");
    setStatus("planned");
    setLevel("company");
    setParentId("");
    setOwnerAgentId("");
    setExpanded(false);
    setLevelInitialized(false);
    setTopLevelError("");
    setViolations([]);
  }

  function handleSubmit() {
    if (!selectedCompanyId || !title.trim()) return;
    setTopLevelError("");
    setViolations([]);
    createGoal.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      status,
      level,
      ...(appliedParentId ? { parentId: appliedParentId } : {}),
      ...(ownerAgentId ? { ownerAgentId } : {}),
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const currentParent = (goals ?? []).find((g) => g.id === appliedParentId);
  const currentOwner = (agents ?? []).find((a) => a.id === ownerAgentId);

  const allowedParentLevel = ALLOWED_PARENT_LEVEL[level];
  const filteredParentOptions = allowedParentLevel
    ? (goals ?? []).filter((g) => g.level === allowedParentLevel)
    : [];

  const ownerRequired = level === "team" || level === "agent";
  const fieldViolations = (field: string) => violations.filter((v) => v.field === field);

  return (
    <Dialog
      open={newGoalOpen}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          closeNewGoal();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn("p-0 gap-0", expanded ? "sm:max-w-2xl" : "sm:max-w-lg")}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {selectedCompany && (
              <span className="bg-muted px-1.5 py-0.5 rounded text-xs font-medium">
                {selectedCompany.name.slice(0, 3).toUpperCase()}
              </span>
            )}
            <span className="text-muted-foreground/60">&rsaquo;</span>
            <span>{newGoalDefaults.parentId ? "New sub-goal" : "New goal"}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={() => { reset(); closeNewGoal(); }}
            >
              <span className="text-lg leading-none">&times;</span>
            </Button>
          </div>
        </div>

        {/* Title */}
        <div className="px-4 pt-4 pb-2 shrink-0">
          <input
            className="w-full text-lg font-semibold bg-transparent outline-none placeholder:text-muted-foreground/50"
            placeholder="Goal title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Tab" && !e.shiftKey) {
                e.preventDefault();
                descriptionEditorRef.current?.focus();
              }
            }}
            autoFocus
          />
        </div>

        {/* Description */}
        <div className="px-4 pb-2 overflow-y-auto max-h-[50vh]">
          <MarkdownEditor
            ref={descriptionEditorRef}
            value={description}
            onChange={setDescription}
            placeholder="Add description..."
            bordered={false}
            contentClassName={cn("text-sm text-muted-foreground", expanded ? "min-h-[220px]" : "min-h-[120px]")}
            imageUploadHandler={async (file) => {
              const asset = await uploadDescriptionImage.mutateAsync(file);
              return asset.contentPath;
            }}
          />
        </div>

        {/* Top-level 422 error */}
        {topLevelError && (
          <div className="px-4 py-1 text-xs text-destructive border-t border-destructive/20 bg-destructive/5">
            {topLevelError}
          </div>
        )}

        {/* Property chips */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-t border-border flex-wrap">
          {/* Status */}
          <Popover open={statusOpen} onOpenChange={setStatusOpen}>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/50 transition-colors">
                <StatusBadge status={status} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-1" align="start">
              {GOAL_STATUSES.map((s) => (
                <button
                  key={s}
                  className={cn(
                    "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 capitalize",
                    s === status && "bg-accent"
                  )}
                  onClick={() => { setStatus(s); setStatusOpen(false); }}
                >
                  {s}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          {/* Level */}
          <Popover open={levelOpen} onOpenChange={setLevelOpen}>
            <PopoverTrigger asChild>
              <button className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-accent/50 transition-colors",
                fieldViolations("level").length > 0 ? "border-destructive" : "border-border",
              )}>
                <Layers className="h-3 w-3 text-muted-foreground" />
                {levelLabels[level] ?? level}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-1" align="start">
              {GOAL_LEVELS.map((l) => (
                <button
                  key={l}
                  className={cn(
                    "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
                    l === level && "bg-accent"
                  )}
                  onClick={() => {
                    setLevel(l);
                    setLevelOpen(false);
                    // Clear parent when it's no longer valid for the new level
                    const newAllowedParent = ALLOWED_PARENT_LEVEL[l];
                    if (appliedParentId) {
                      const parent = (goals ?? []).find((g) => g.id === appliedParentId);
                      if (parent && parent.level !== newAllowedParent) {
                        setParentId("");
                      }
                    }
                  }}
                >
                  {levelLabels[l] ?? l}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          {fieldViolations("level").map((v) => (
            <span key={v.code} className="text-xs text-destructive">{v.message}</span>
          ))}

          {/* Parent goal — hidden for company level (no parent allowed) */}
          {level !== "company" && (
            <Popover open={parentOpen} onOpenChange={setParentOpen}>
              <PopoverTrigger asChild>
                <button className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-accent/50 transition-colors",
                  fieldViolations("parentId").length > 0 ? "border-destructive" : "border-border",
                )}>
                  <Target className="h-3 w-3 text-muted-foreground" />
                  {currentParent
                    ? currentParent.title
                    : `Parent ${allowedParentLevel ? `(${levelLabels[allowedParentLevel]} goal)` : "goal"}`}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1" align="start">
                <button
                  className={cn(
                    "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
                    !appliedParentId && "bg-accent"
                  )}
                  onClick={() => { setParentId(""); setParentOpen(false); }}
                >
                  No parent
                </button>
                {filteredParentOptions.length === 0 && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    No {allowedParentLevel} goals available
                  </p>
                )}
                {filteredParentOptions.map((g) => (
                  <button
                    key={g.id}
                    className={cn(
                      "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 truncate",
                      g.id === appliedParentId && "bg-accent"
                    )}
                    onClick={() => { setParentId(g.id); setParentOpen(false); }}
                  >
                    {g.title}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}
          {fieldViolations("parentId").map((v) => (
            <span key={v.code} className="text-xs text-destructive">{v.message}</span>
          ))}

          {/* Owner — shown for team and agent levels */}
          {ownerRequired && (
            <Popover open={ownerOpen} onOpenChange={setOwnerOpen}>
              <PopoverTrigger asChild>
                <button className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-accent/50 transition-colors",
                  fieldViolations("ownerAgentId").length > 0 ? "border-destructive" : "border-border",
                )}>
                  <User className="h-3 w-3 text-muted-foreground" />
                  {currentOwner ? currentOwner.name : "Owner (required)"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1" align="start">
                <button
                  className={cn(
                    "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
                    !ownerAgentId && "bg-accent"
                  )}
                  onClick={() => { setOwnerAgentId(""); setOwnerOpen(false); }}
                >
                  No owner
                </button>
                {(agents ?? []).map((a) => (
                  <button
                    key={a.id}
                    className={cn(
                      "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 truncate",
                      a.id === ownerAgentId && "bg-accent"
                    )}
                    onClick={() => { setOwnerAgentId(a.id); setOwnerOpen(false); }}
                  >
                    {a.name}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}
          {fieldViolations("ownerAgentId").map((v) => (
            <span key={v.code} className="text-xs text-destructive">{v.message}</span>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 py-2.5 border-t border-border">
          <Button
            size="sm"
            disabled={!title.trim() || createGoal.isPending || (ownerRequired && !ownerAgentId)}
            onClick={handleSubmit}
          >
            {createGoal.isPending ? "Creating…" : newGoalDefaults.parentId ? "Create sub-goal" : "Create goal"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
