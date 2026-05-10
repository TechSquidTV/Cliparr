# Diagrams

This file captures the current HLS playback, preview-ready warmup, export, and
proxy decision trees. It reflects the stable branch behavior after the fallback,
timeline normalization, alternate track selection, playlist rewrite, proxy
auth/cache handling, and export memory fixes.

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

## Preview Ready Warmup Tree

```mermaid
flowchart TD
    A["Active preview source is HLS stream"] --> B["Set playbackReadyRange for selection"]
    B --> C["Paused auto-warmup starts from selection start"]
    C --> D["Warm exact playback/selection start first"]
    D --> E["Warm an initial front window"]
    E --> F["Publish readyUntilTime = min(videoReadyUntil, audioReadyUntil)"]
    F --> G{"Still paused and selection not complete?"}
    G -- "Yes" --> H["Schedule extension warmup toward selection end"]
    G -- "No" --> I{"Both tracks reached selection end?"}
    H --> I
    I -- "Yes" --> J["Status = ready"]
    I -- "No" --> K["Status = warming or idle"]

    L["User presses Play"] --> M{"Matching start-target warmup in flight?"}
    M -- "Yes" --> N["Wait for that exact warmup target first"]
    M -- "No" --> O["Start playback immediately"]
    N --> O
    O --> P["Cancel background selection warmup"]
    P --> Q["Preview Ready band advances with confirmed playback progress"]

    R["Paused seek outside ready range"] --> S["Warm seek target silently"]
    S --> T["Restart paused selection warmup from selection start/end"]

    U["Playback pauses before selection is ready"] --> V["Resume paused selection warmup from selection start"]
```

## Export Source Selection Tree

```mermaid
flowchart TD
    A["User opens Export"] --> B{"Export source preference"}
    B -- "Direct/original" --> C{"Session has direct media URL?"}
    C -- "Yes" --> D["Use direct source for export"]
    C -- "No" --> E["No exportable stream"]

    B -- "HLS playback" --> F{"Session has HLS URL?"}
    F -- "Yes" --> G["Use HLS URL for export"]
    F -- "No" --> E

    B -- "Auto" --> H{"exportFallbackSourceUrl set?"}
    H -- "Yes" --> D
    H -- "No" --> I{"Session has HLS URL?"}
    I -- "Yes" --> G
    I -- "No" --> C
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

## Proxy Media Request Tree

```mermaid
flowchart TD
    A["Client requests /api/media/:handleId"] --> B["Resolve handle request URL"]
    B --> C{"Request origin matches provider baseUrl origin?"}
    C -- "Yes" --> D["Attach provider auth/session headers"]
    C -- "No" --> E["Do not attach provider auth headers"]

    D --> F{"Range request or not HLS-derived?"}
    E --> F

    F -- "Yes" --> G["Fetch upstream and stream response directly"]
    F -- "No" --> H["Build short-lived cache key"]
    H --> I{"Cached response exists?"}
    I -- "Yes" --> J["Serve cached response"]
    I -- "No" --> K{"Matching in-flight response exists?"}
    K -- "Yes" --> L["Wait for in-flight response and reuse it"]
    K -- "No" --> M["Fetch upstream and snapshot response"]
    M --> N{"Upstream response is HLS playlist?"}
    N -- "Yes" --> O["Rewrite playlist body before caching/serving"]
    N -- "No" --> P["Cache small media response body when eligible"]
```

## Export Output Flow

```mermaid
flowchart TD
    A["User clicks Export"] --> B["Build fresh Mediabunny input from export source URL"]
    B --> C["Create Output(BufferTarget)"]
    C --> D["Conversion.init validates selected tracks and audio plan"]
    D --> E{"Conversion valid?"}
    E -- "No" --> F["Surface conversion/discard error"]
    E -- "Yes" --> G["Execute conversion"]
    G --> H["Patch MP4 metadata boxes when needed"]
    H --> I["Return Blob from target buffer"]
    I --> J["Do not reopen the finished Blob just to recheck audio"]
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
    D --> L["Optional playbackReadyRange for HLS preview only"]
    L --> M["EditorTimeline Preview Ready overlay and note"]
    B --> G["EditorScreen export source selection"]
    C --> G
    F --> G
    G --> H["exportClip input URL"]
    H --> N["exportClip builds a fresh input"]
    I --> N
```
