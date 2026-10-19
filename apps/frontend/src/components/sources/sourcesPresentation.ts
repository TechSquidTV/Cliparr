import { buttonClassName } from "#/components/ui/control-styles";

export const sourceSecondaryButtonClasses = buttonClassName({
  tone: "secondary",
  size: "compact",
  typography: "plain",
});
export const sourceFieldLabelClasses =
  "text-ui-label font-normal normal-case tracking-normal text-muted-foreground";
export const healthySurfaceClasses =
  "border-primary/30 bg-primary/10 text-foreground";
export const SOURCE_STATE_INITIAL = {
  opacity: 0,
  y: 4,
  filter: "blur(6px)",
};
export const SOURCE_STATE_VISIBLE = {
  opacity: 1,
  y: 0,
  filter: "blur(0px)",
};
export const SOURCE_STATE_EXIT = {
  opacity: 0,
  y: -3,
  filter: "blur(6px)",
};
