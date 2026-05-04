# Diagrams

This file captures the current HLS playback, export, and proxy decision trees.
It reflects the final branch behavior after the fallback, timeline, alternate
track selection, playlist rewrite, and export memory fixes.

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

## HLS Track Selection Tree

```mermaid
flowchart TD
    A["Open candidate input"] --> B["Load non-I-frame video tracks"]
    B --> C{"Any video tracks?"}
    C -- "No" --> D["sourceVideoTrack = null"]
    C -- "Yes" --> E["sourceVideoTrack = first video track"]

    E --> F{"Source video decodable?"}
    F -- "Yes" --> G["previewVideoTrack = sourceVideoTrack"]
    F -- "No" --> H["Scan alternate HLS video tracks"]
    H --> I{"Found decodable alternate?"}
    I -- "Yes" --> J["previewVideoTrack = alternate track"]
    I -- "No" --> K["previewVideoTrack = null"]

    D --> L["Load all audio tracks"]
    G --> L
    J --> L
    K --> L

    L --> M["sourceAudioTrack = preferred pairable track for sourceVideoTrack"]
    M --> N["previewAudioTrack = preferred pairable track for previewVideoTrack"]
    N --> O{"Preview audio decodable or AC-3 family?"}
    O -- "Yes" --> P["Keep preview audio"]
    O -- "No" --> Q["Drop preview audio, keep source audio metadata"]
```

## Source Vs Preview Track Tree

```mermaid
flowchart TD
    A["Tracks selected for this candidate"] --> B{"Which responsibility?"}

    B -- "Source semantics" --> C["Use sourceVideoTrack/sourceAudioTrack"]
    C --> D["Check live/export-blocking state"]
    C --> E["Compute timelineOffsetSeconds"]
    C --> F["Compute duration and source timeline end"]
    C --> G["Keep export/editor range aligned"]

    B -- "Browser preview" --> H["Use previewVideoTrack/previewAudioTrack"]
    H --> I["Create CanvasSink / AudioBufferSink"]
    H --> J["Read preview dimensions"]
    H --> K["Schedule preview frames and audio"]
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

## Playlist Rewrite Tree

```mermaid
flowchart TD
    A["Proxy rewrites HLS playlist line"] --> B{"Comment with URI attribute?"}
    B -- "Yes" --> C["Rewrite each URI=\"...\" value"]
    B -- "No" --> D["Rewrite full media line URI"]

    C --> E["resolvePlaylistUri(basePath, uri)"]
    D --> E

    E --> F{"URI absolute?"}
    F -- "Yes" --> G["Preserve full absolute URL as nextPath"]
    F -- "No" --> H["Resolve relative URI against current playlist basePath"]

    G --> I["Create proxy handle with basePath = playlistBasePath(nextPath)"]
    H --> I
    I --> J["Nested relative URIs continue from the correct host/path"]
```

## Export Output Flow

```mermaid
flowchart TD
    A["User clicks Export"] --> B["Build Mediabunny input + Output(BufferTarget)"]
    B --> C["Conversion.init validates selected tracks and audio plan"]
    C --> D{"Conversion valid?"}
    D -- "No" --> E["Surface conversion/discard error"]
    D -- "Yes" --> F["Execute conversion"]
    F --> G["Patch MP4 metadata boxes when needed"]
    G --> H["Return Blob from target buffer"]
    H --> I["Do not reopen the finished Blob just to recheck audio"]
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
    D --> J["Source tracks for duration/export alignment"]
    D --> K["Preview tracks for browser playback"]
    B --> G["EditorScreen export source selection"]
    C --> G
    F --> G
    G --> H["exportClip input URL"]
    I --> H
```
