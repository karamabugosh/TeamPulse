import React, { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { JiraIssueCombobox } from '@/components/jira/JiraIssueCombobox';
import { JiraIssueSummary } from '@/lib/jira-api';

export type QuestionItem = {
  id: string;
  question: string;
  type: 'FREE_TEXT' | 'NUMERICAL' | 'YES_NO' | 'YES_NO_MAYBE' | 'MULTIPLE_CHOICE' | 'SCALE_1_5' | 'ISSUE_REF' | 'BLOCKER';
  options?: string[];
  isRequired: boolean;
  enabled?: boolean;
  order: number;
};

const QUESTION_TYPES = [
  { value: 'FREE_TEXT', label: 'Free Text' },
  { value: 'NUMERICAL', label: 'Numerical' },
  { value: 'YES_NO', label: 'Yes / No' },
  { value: 'YES_NO_MAYBE', label: 'Yes / No / Maybe' },
  { value: 'BLOCKER', label: 'Blocker (Yes → details)' },
  { value: 'MULTIPLE_CHOICE', label: 'Multiple Choice' },
  { value: 'SCALE_1_5', label: 'Rating (1-5)' },
  { value: 'ISSUE_REF', label: 'Jira Issue' },
] as const;

interface SortableQuestionProps {
  question: QuestionItem;
  index: number;
  onUpdate: (id: string, field: keyof QuestionItem, value: any) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onAddOption: (id: string) => void;
  onUpdateOption: (id: string, optIndex: number, value: string) => void;
  onRemoveOption: (id: string, optIndex: number) => void;
}

const SortableQuestion: React.FC<SortableQuestionProps> = ({
  question,
  index,
  onUpdate,
  onRemove,
  onDuplicate,
  onAddOption,
  onUpdateOption,
  onRemoveOption,
}) => {
  const [previewIssue, setPreviewIssue] = useState<JiraIssueSummary | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: question.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              className="mt-2 cursor-grab touch-none text-muted-foreground hover:text-foreground"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-5 w-5" />
            </button>
            <Badge variant="secondary" className="mt-2 shrink-0">
              Q{index + 1}
            </Badge>
            <div className="flex-1 space-y-3">
              <Input
                required
                value={question.question}
                onChange={(e) => onUpdate(question.id, 'question', e.target.value)}
                placeholder="Enter question prompt..."
              />
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={question.type}
                  onChange={(e) => onUpdate(question.id, 'type', e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                >
                  {QUESTION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={question.enabled !== false}
                    onCheckedChange={(v) => onUpdate(question.id, 'enabled', v)}
                  />
                  <Label className="text-sm text-muted-foreground">Enabled</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={question.isRequired}
                    onCheckedChange={(v) => onUpdate(question.id, 'isRequired', v)}
                  />
                  <Label className="text-sm text-muted-foreground">Required</Label>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onDuplicate(question.id)}
                title="Duplicate"
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRemove(question.id)}
                className="hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {question.type === 'ISSUE_REF' && (
            <div className="ml-10 space-y-2">
              <Label className="text-xs text-muted-foreground">Jira Issue Selector</Label>
              <JiraIssueCombobox
                value={previewIssue}
                onSelect={setPreviewIssue}
                onClear={() => setPreviewIssue(null)}
              />
              <p className="text-xs text-muted-foreground">
                Standup participants search and pick a real Jira issue when answering this question.
              </p>
            </div>
          )}

          {question.type === 'BLOCKER' && (
            <div className="ml-10 space-y-1 rounded-lg border border-dashed border-border p-3">
              <p className="text-sm font-medium">Blocker flow</p>
              <p className="text-xs text-muted-foreground">
                Slack shows Yes/No. Yes opens the existing Blocker Details modal (title, reason,
                severity, category, expected resolution, Jira link). No records that the user is
                not blocked — no PulseBlocker is created.
              </p>
            </div>
          )}

          {question.type === 'MULTIPLE_CHOICE' && (
            <div className="ml-10 space-y-2">
              <Label className="text-xs text-muted-foreground">Options</Label>
              {(question.options || []).map((opt, optIdx) => (
                <div key={optIdx} className="flex gap-2">
                  <Input
                    value={opt}
                    onChange={(e) => onUpdateOption(question.id, optIdx, e.target.value)}
                    placeholder={`Option ${optIdx + 1}`}
                    className="text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => onRemoveOption(question.id, optIdx)}
                    className="hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => onAddOption(question.id)}>
                <Plus className="h-3.5 w-3.5" />
                Add Option
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

interface QuestionBuilderProps {
  questions: QuestionItem[];
  onChange: (questions: QuestionItem[]) => void;
}

export const QuestionBuilder: React.FC<QuestionBuilderProps> = ({ questions, onChange }) => {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = questions.findIndex((q) => q.id === active.id);
    const newIndex = questions.findIndex((q) => q.id === over.id);
    const reordered = arrayMove(questions, oldIndex, newIndex).map((q, idx) => ({
      ...q,
      order: idx + 1,
    }));
    onChange(reordered);
  };

  const addQuestion = () => {
    onChange([
      ...questions,
      {
        id: `q_${Date.now()}`,
        question: '',
        type: 'FREE_TEXT',
        isRequired: true,
        order: questions.length + 1,
      },
    ]);
  };

  const updateQuestion = (id: string, field: keyof QuestionItem, value: any) => {
    onChange(
      questions.map((q) => {
        if (q.id !== id) return q;
        const updated = { ...q, [field]: value };
        if (field === 'type' && value === 'MULTIPLE_CHOICE' && !updated.options?.length) {
          updated.options = ['Option 1', 'Option 2'];
        }
        return updated;
      })
    );
  };

  const removeQuestion = (id: string) => {
    onChange(
      questions
        .filter((q) => q.id !== id)
        .map((q, idx) => ({ ...q, order: idx + 1 }))
    );
  };

  const addOption = (id: string) => {
    onChange(
      questions.map((q) =>
        q.id === id
          ? { ...q, options: [...(q.options || []), `Option ${(q.options?.length || 0) + 1}`] }
          : q
      )
    );
  };

  const updateOption = (id: string, optIndex: number, value: string) => {
    onChange(
      questions.map((q) => {
        if (q.id !== id) return q;
        const options = [...(q.options || [])];
        options[optIndex] = value;
        return { ...q, options };
      })
    );
  };

  const removeOption = (id: string, optIndex: number) => {
    onChange(
      questions.map((q) => {
        if (q.id !== id) return q;
        const options = (q.options || []).filter((_, i) => i !== optIndex);
        return { ...q, options };
      })
    );
  };

  const duplicateQuestion = (id: string) => {
    const source = questions.find((q) => q.id === id);
    if (!source) return;
    const copy: QuestionItem = {
      ...source,
      id: `q_${Date.now()}`,
      question: `${source.question} (copy)`,
      order: questions.length + 1,
      options: source.options ? [...source.options] : undefined,
    };
    onChange([...questions, copy]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Question Builder</h3>
          <p className="text-sm text-muted-foreground">Drag to reorder questions</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addQuestion}>
          <Plus className="h-4 w-4" />
          Add Question
        </Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {questions.map((q, idx) => (
              <SortableQuestion
                key={q.id}
                question={q}
                index={idx}
                onUpdate={updateQuestion}
                onRemove={removeQuestion}
                onDuplicate={duplicateQuestion}
                onAddOption={addOption}
                onUpdateOption={updateOption}
                onRemoveOption={removeOption}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {questions.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground">
          No questions yet. Add your first question to get started.
        </div>
      )}
    </div>
  );
};

export default QuestionBuilder;
