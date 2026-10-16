import {
  EditorColorControl,
  EditorPropertyAccordion,
  EditorPropertyAccordionItem,
  EditorPropertyRow,
  EditorPropertySection,
  EditorRangeControl,
} from "#/components/editor/EditorPropertyControls";
import {
  EDITOR_PROPERTIES_SECTION_ID,
  type EditorPropertiesSectionId,
} from "#/components/editor/editorSidebarPreferences";
import type { EditorSubtitlePanelProperties } from "#/components/editor/EditorSubtitlePanel";
import { useSubtitleFontOptions } from "#/components/editor/useSubtitleFontOptions";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Spinner } from "#/components/ui/spinner";
import type { SubtitleStyleSettings } from "#/lib/subtitles/types";

export function EditorSubtitleStyleControls({
  subtitleStyleSettings,
  setSubtitleStyleSettings,
  editorPropertiesOpenSections,
  onEditorPropertiesOpenSectionsChange,
}: Pick<
  EditorSubtitlePanelProperties,
  "editorPropertiesOpenSections" | "onEditorPropertiesOpenSectionsChange"
> &
  Pick<
    EditorSubtitlePanelProperties["subtitles"],
    "subtitleStyleSettings" | "setSubtitleStyleSettings"
  >) {
  const {
    currentFontOption,
    bundledFontOptions,
    localFontOptions,
    loadingLocalFonts,
    requestLocalFonts,
  } = useSubtitleFontOptions(subtitleStyleSettings.fontFamily);
  function updateStyleSetting<Key extends keyof SubtitleStyleSettings>(
    key: Key,
    value: SubtitleStyleSettings[Key],
  ) {
    setSubtitleStyleSettings((current) => ({ ...current, [key]: value }));
  }
  return (
    <EditorPropertyAccordion<EditorPropertiesSectionId>
      value={editorPropertiesOpenSections}
      onValueChange={onEditorPropertiesOpenSectionsChange}
    >
      <EditorPropertyAccordionItem<EditorPropertiesSectionId>
        value={EDITOR_PROPERTIES_SECTION_ID.subtitleStyle}
        title="Subtitle style"
      >
        <EditorPropertySection title="Text">
          <EditorPropertyRow label="Font">
            <Select
              value={subtitleStyleSettings.fontFamily}
              items={[
                ...(currentFontOption ? [currentFontOption] : []),
                ...bundledFontOptions,
                ...localFontOptions,
              ]}
              onValueChange={(value) => {
                if (value !== null) {
                  updateStyleSetting("fontFamily", value);
                }
              }}
              onOpenChange={(open) => {
                if (open) {
                  requestLocalFonts();
                }
              }}
            >
              <SelectTrigger size="sm" variant="editor">
                <SelectValue placeholder="Select font" />
              </SelectTrigger>
              <SelectContent>
                {currentFontOption && (
                  <SelectGroup>
                    <SelectLabel>Current Font</SelectLabel>
                    <SelectItem value={currentFontOption.value}>
                      {currentFontOption.label}
                    </SelectItem>
                  </SelectGroup>
                )}
                <SelectGroup>
                  <SelectLabel>Included Fonts</SelectLabel>
                  {bundledFontOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
                {localFontOptions.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Installed Fonts</SelectLabel>
                    {localFontOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {loadingLocalFonts && (
                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                    <Spinner className="h-3.5 w-3.5" />
                    Loading installed fonts...
                  </div>
                )}
              </SelectContent>
            </Select>
          </EditorPropertyRow>

          <EditorColorControl
            label="Color"
            value={subtitleStyleSettings.fontColor}
            onChange={(value) => updateStyleSetting("fontColor", value)}
          />
          <EditorRangeControl
            label="Size"
            value={subtitleStyleSettings.fontSize}
            min={16}
            max={150}
            step={1}
            unit="px"
            onChange={(value) => updateStyleSetting("fontSize", value)}
          />
        </EditorPropertySection>

        <EditorPropertySection title="Shadow">
          <EditorColorControl
            label="Color"
            value={subtitleStyleSettings.shadowColor}
            onChange={(value) => updateStyleSetting("shadowColor", value)}
          />
          <EditorRangeControl
            label="Blur"
            value={subtitleStyleSettings.shadowBlur}
            min={0}
            max={24}
            step={1}
            unit="px"
            onChange={(value) => updateStyleSetting("shadowBlur", value)}
          />
          <EditorRangeControl
            label="Offset"
            value={subtitleStyleSettings.shadowOffsetY}
            min={-16}
            max={24}
            step={1}
            unit="px"
            onChange={(value) => updateStyleSetting("shadowOffsetY", value)}
          />
        </EditorPropertySection>

        <EditorPropertySection title="Stroke">
          <EditorColorControl
            label="Color"
            value={subtitleStyleSettings.strokeColor}
            onChange={(value) => updateStyleSetting("strokeColor", value)}
          />
          <EditorRangeControl
            label="Width"
            value={subtitleStyleSettings.strokeWidth}
            min={0}
            max={32}
            step={0.5}
            unit="px"
            onChange={(value) => updateStyleSetting("strokeWidth", value)}
          />
        </EditorPropertySection>

        <EditorPropertySection title="Position">
          <EditorRangeControl
            label="X"
            value={subtitleStyleSettings.positionX}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(value) => updateStyleSetting("positionX", value)}
          />
          <EditorRangeControl
            label="Y"
            value={subtitleStyleSettings.positionY}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(value) => updateStyleSetting("positionY", value)}
          />
        </EditorPropertySection>
      </EditorPropertyAccordionItem>
    </EditorPropertyAccordion>
  );
}
