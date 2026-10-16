import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { EditorRangeControl } from "#/components/editor/EditorPropertyControls";
import { DialogWindow } from "#/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsPanels,
  TabsTab,
} from "#/components/ui/tabs";

function Controls() {
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [size, setSize] = useState(24);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <main className="space-y-4 p-6">
      <button ref={trigger} onClick={() => setOpen(true)}>
        Open controls
      </button>
      <DialogWindow
        open={open}
        onClose={() => setOpen(false)}
        title="Test controls"
        closeDisabled={locked}
        finalFocus={trigger}
      >
        <div className="space-y-4 p-4">
          <EditorRangeControl
            label="Subtitle size"
            value={size}
            min={16}
            max={150}
            step={1}
            unit="px"
            onChange={setSize}
          />
          <Switch
            aria-label="Lock dialog"
            checked={locked}
            onCheckedChange={setLocked}
          />
          <Select
            defaultValue="video"
            items={{ video: "Video", audio: "Audio" }}
          >
            <SelectTrigger aria-label="Output type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="video">Video</SelectItem>
              <SelectItem value="audio">Audio</SelectItem>
            </SelectContent>
          </Select>
          {[false, true].map((springIndicator) => (
            <Tabs key={String(springIndicator)} defaultValue="one">
              <TabsList
                springIndicator={springIndicator}
                aria-label={springIndicator ? "Spring tabs" : "Standard tabs"}
              >
                <TabsTab value="one">First</TabsTab>
                <TabsTab value="two">Second</TabsTab>
              </TabsList>
              <TabsPanels>
                <TabsPanel value="one">Short panel</TabsPanel>
                <TabsPanel value="two">
                  <div className="h-32">Tall panel</div>
                </TabsPanel>
              </TabsPanels>
            </Tabs>
          ))}
        </div>
      </DialogWindow>
    </main>
  );
}

const container = document.querySelector("#root");
if (!container) {
  throw new Error("Missing controls root");
}
createRoot(container).render(<Controls />);
