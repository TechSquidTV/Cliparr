import { fieldLabelWideClasses } from "#/components/ui/control-styles";

export const exportHelperTextClassName =
  "min-h-9 text-xs leading-relaxed text-muted-foreground";

export function ExportSectionHeader({ children }: { children: string }) {
  return (
    <div className="border-b border-border px-3 py-2">
      <div className={fieldLabelWideClasses}>{children}</div>
    </div>
  );
}
