# Diagrams

This file captures the HLS playback and export fallback decision trees behind the
`EditorScreen` review finding.

## Playback Candidate Tree

```mermaid
flowchart TD
    A["Editor session opens"] --> B["Build playback candidates"]
    B --> C{"Has HLS URL?"}
    C -- "Yes" --> D["Add HLS stream candidate first"]
    C -- "No" --> E["Skip HLS candidate"]
    D --> F{"Has direct media URL?"}
    E --> F
    F -- "Yes" --> G["Add direct source candidate second"]
    F -- "No" --> H["Playback candidates ready"]
    G --> H
```

## Playback Fallback Tree

```mermaid
flowchart TD
    A["Try next playback candidate"] --> B{"Input opens and reads?"}
    B -- "No" --> C["Failure category: open-or-read"]
    C --> D{"Failed source was HLS and direct URL exists?"}
    D -- "Yes" --> E["Remember direct source as export fallback"]
    D -- "No" --> F["Do not change export fallback"]
    E --> G["Try next candidate"]
    F --> G

    B -- "Yes" --> H{"Why can't preview use the tracks?"}
    H -- "Live HLS" --> I["Failure category: shared-export-blocking"]
    I --> J{"Direct URL exists?"}
    J -- "Yes" --> K["Remember direct source as export fallback"]
    J -- "No" --> L["Keep HLS export source and surface error later"]
    K --> G
    L --> G

    H -- "No decodable tracks / no Web Audio" --> M["Failure category: preview-only"]
    M --> N["Do not change export fallback"]
    N --> G

    H -- "Tracks are previewable" --> O["Preview succeeds"]
    O --> P["Show active source label"]
```

## Why The Categories Matter

```mermaid
flowchart TD
    A["Preview falls back from HLS"] --> B{"Why couldn't preview use HLS?"}
    B -- "Open/read failure" --> C["HLS is unusable for export too"]
    C --> D["Export should switch to direct source"]

    B -- "Preview-only limitation" --> E["Browser preview cannot use HLS, but export still might"]
    E --> F["Keep HLS as export source"]

    B -- "Shared export-blocking limitation" --> G["Preview and export both reject this HLS path"]
    G --> H["Use direct fallback if available, otherwise leave export blocked"]
```

## Export Source Selection Tree

```mermaid
flowchart TD
    A["User clicks Export"] --> B{"exportFallbackSourceUrl set?"}
    B -- "Yes" --> C["Use direct source for export"]
    B -- "No" --> D{"Session has HLS URL?"}
    D -- "Yes" --> E["Use HLS URL for export"]
    D -- "No" --> F{"Session has direct media URL?"}
    F -- "Yes" --> G["Use direct source for export"]
    F -- "No" --> H["No exportable stream"]
```

## Timeline Normalization Tree

```mermaid
flowchart TD
    A["Preview or export needs a source timestamp"] --> B{"Any selected track uses Unix-epoch timestamps?"}
    B -- "No" --> C["Use UI time directly as source time"]
    B -- "Yes" --> D["Read the earliest selected track timestamp"]
    D --> E["Store it as timelineOffsetSeconds"]
    E --> F["Preview duration = source end time - timeline offset"]
    E --> G["Preview seek/read time = UI time + timeline offset"]
    E --> H["Export trim.start/end = UI time + timeline offset"]
```

## End-To-End Summary

```mermaid
flowchart LR
    A["Provider session data"] --> B["session.hlsUrl"]
    A --> C["session.mediaUrl"]
    B --> D["useEditorPlayback"]
    C --> D
    D --> E["Preview source chosen"]
    D --> F["Optional exportFallbackSourceUrl"]
    D --> I["Optional timelineOffsetSeconds"]
    B --> G["EditorScreen export source selection"]
    C --> G
    F --> G
    G --> H["exportClip input URL"]
    I --> H
```
