import { memo } from "react";

import {
  exportHelperTextClassName,
  ExportSectionHeader,
} from "#/components/export/ExportSectionHeader";
import { fieldLabelWideClasses } from "#/components/ui/control-styles";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import {
  type ExportFileNameTemplateKind,
  type ExportFileNameTemplateSettings,
  getExportFileNameTemplateTokens,
} from "#/lib/export/exportFileName";
const templateOptions: ReadonlyArray<{
  kind: ExportFileNameTemplateKind;
  label: string;
  description: string;
}> = [
  {
    kind: "movie",
    label: "Movies",
    description: "Used for films and non-episode items.",
  },
  {
    kind: "episode",
    label: "TV Shows",
    description: "Used for episode exports with series metadata.",
  },
];

function templateOptionFor(kind: ExportFileNameTemplateKind) {
  return (
    templateOptions.find((option) => option.kind === kind) ?? templateOptions[0]
  );
}

interface EditorFilenameTemplateSectionProperties {
  editingTemplateKind: ExportFileNameTemplateKind;
  onEditingTemplateKindChange: (kind: ExportFileNameTemplateKind) => void;
  fileNameTemplates: ExportFileNameTemplateSettings;
  onFileNameTemplateChange: (
    kind: ExportFileNameTemplateKind,
    template: string,
  ) => void;
  onResetFileNameTemplate: (kind: ExportFileNameTemplateKind) => void;
}

function EditorFilenameTemplateSectionComponent({
  editingTemplateKind,
  onEditingTemplateKindChange,
  fileNameTemplates,
  onFileNameTemplateChange,
  onResetFileNameTemplate,
}: EditorFilenameTemplateSectionProperties) {
  const editingTemplateOption = templateOptionFor(editingTemplateKind);
  const visibleTokens = getExportFileNameTemplateTokens(editingTemplateKind);

  return (
    <section className="rounded-md border border-border bg-card">
      <ExportSectionHeader>Filename Template</ExportSectionHeader>
      <div className="space-y-3 p-3">
        <div className="grid gap-3 sm:grid-cols-editor-export-template sm:items-end">
          <label className="space-y-1.5">
            <span className={fieldLabelWideClasses}>Template Set</span>
            <Select
              value={editingTemplateKind}
              items={templateOptions.map((option) => ({
                value: option.kind,
                label: option.label,
              }))}
              onValueChange={(value) => {
                if (value !== null) {
                  onEditingTemplateKindChange(value);
                }
              }}
            >
              <SelectTrigger size="sm">
                <SelectValue placeholder="Select template set" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Templates</SelectLabel>
                  {templateOptions.map((option) => (
                    <SelectItem key={option.kind} value={option.kind}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </label>

          <button
            type="button"
            onClick={() => onResetFileNameTemplate(editingTemplateKind)}
            className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Reset
          </button>
        </div>

        <label className="block space-y-1.5">
          <span className={fieldLabelWideClasses}>Pattern</span>
          <input
            type="text"
            value={fileNameTemplates[editingTemplateKind]}
            onChange={(event) =>
              onFileNameTemplateChange(editingTemplateKind, event.target.value)
            }
            className="control-focus h-8 w-full rounded-md border border-input bg-background px-2.5 font-mono text-xs text-foreground outline-none transition-colors focus-visible:border-ring"
            spellCheck={false}
          />
        </label>

        <p className={exportHelperTextClassName}>
          {editingTemplateOption.description}
        </p>

        <div className="rounded-md border border-border bg-background px-3 py-2">
          <div className={fieldLabelWideClasses}>Available Tokens</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {visibleTokens.map((token) => (
              <code
                key={token}
                className="rounded-md border border-border bg-card px-2 py-0.5 font-mono text-ui-label text-foreground"
              >
                {`{${token}}`}
              </code>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export const EditorFilenameTemplateSection = memo(
  EditorFilenameTemplateSectionComponent,
);
