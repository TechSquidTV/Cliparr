# Diagrams

This file captures the current playback, preview-ready warmup, export, local
media, and proxy decision trees. It reflects the stable branch behavior after
the fallback, timeline normalization, alternate track selection, playlist
rewrite, proxy auth/cache handling, export memory fixes, local file/URL support,
subtitle burn-in, framegrabs, and the frontend refactor that split large editor
workflows into focused hooks/helpers.

## Frontend Responsibility Map

```mermaid
flowchart TD
    A["EditorScreen"] --> A1["EditorHeader / EditorLayout / EditorPreview"]
    A --> A2["EditorControls / EditorTimeline"]
    A --> A3["EditorPlaybackSourcePanel / EditorSubtitlePanel"]
    A --> B["useEditorPlayback"]
    A --> C["useEditorExport"]
    A --> D["useEditorTimeline"]
    A --> E["useEditorKeyboardShortcuts"]
    A --> J["useEditorSubtitles"]
    A --> K["useEditorFramegrab"]

    B --> B1["editorPlaybackSources"]
    B --> B2["useEditorPlaybackRenderLoop"]
    B --> B3["editorPlaybackAudio"]
    B --> B4["editorPlaybackSinks"]
    B --> B5["useEditorPlaybackWarmup"]
    B --> B6["editorPlaybackPlan"]
    B5 --> B7["useEditorPlaybackSelectionWarmup"]

    C --> C1["lazy EditorExportDialog"]
    C --> C2["exportFileName"]
    C --> C3["subtitleExportSummary"]
    C --> C4["exportClip"]
    C4 --> C5["exportMetadata"]
    C4 --> C6["subtitle burn-in processor"]

    K --> H["lazy EditorFramegrabDialog"]
    K --> H1["framegrab canvas helpers"]
    K --> C2

    D --> D1["timelineZoom helpers"]
    E --> E1["editorShortcutCommands"]
    J --> J1["useSubtitleCues"]
    J --> J2["selectPreferredSubtitleTrack"]

    F["SourcesDialog"] --> F1["useSourcesState"]
    F1 --> F2["sourcesStateUtils"]
    F --> F3["SourcesDialogSections"]
    F3 --> F4["SourceConnectPanel"]

    F4 --> G["ProviderConnectFlow"]
    G --> G1["useProviderConnectFlow"]
    G --> G2["ProviderConnectFlowSections"]

    L["LocalVideoOpenDialog"] --> L1["localMediaRegistry"]
    L1 --> L2["buildLocalEditorSession"]
    L1 --> L3["/api/media/local-url"]
```

## Playback Candidate Tree

```mermaid
flowchart TD
    A["Editor session opens"] --> B["Build playback candidates"]
    B --> C{"Has hlsSource?"}
    C -- "Yes" --> D["Add HLS candidate first"]
    D --> D1["Label provider source as hls stream; local URL as hls url"]
    C -- "No" --> E["Skip HLS candidate"]
    D1 --> F{"Has directSource?"}
    E --> F
    F -- "Yes" --> G{"Same media source as HLS candidate?"}
    G -- "Yes" --> H["Do not add duplicate candidate"]
    G -- "No" --> I["Add direct candidate second"]
    I --> I1["Label as direct source, local file, or url"]
    F -- "No" --> H["Playback candidates ready"]
    H --> J["Try candidates in order"]
    I1 --> J
```

## HLS Track Selection Tree

```mermaid
flowchart TD
    A["Open candidate input"] --> A1{"Candidate is HLS stream or HLS URL?"}
    A1 -- "Yes" --> A2["Create Mediabunny input with HLS formats/cache options"]
    A1 -- "No" --> A3["Create Mediabunny input with all formats"]
    A2 --> B["Load non-I-frame video tracks"]
    A3 --> B
    B --> C{"Any video tracks?"}
    C -- "No" --> D["sourceVideoTrack = null"]
    C -- "Yes" --> E["sourceVideoTrack = first non-I-frame video track"]

    E --> F{"Source video codec known and decodable?"}
    F -- "Yes" --> G["previewVideoTrack = sourceVideoTrack"]
    F -- "No" --> H["Scan alternate video tracks"]
    H --> I{"Found decodable alternate?"}
    I -- "Yes" --> J["previewVideoTrack = alternate track"]
    I -- "No" --> K["previewVideoTrack = null"]

    D --> L["Load all audio tracks"]
    G --> L
    J --> L
    K --> L

    L --> M["sourceAudioTrack = selected/fallback track pairable with sourceVideoTrack"]
    M --> N["previewAudioTrack = selected/fallback track pairable with previewVideoTrack"]
    N --> O{"Preview audio codec known and decodable or AC-3 family?"}
    O -- "Yes" --> P["Keep preview audio"]
    O -- "No" --> Q["Drop preview audio, keep source audio metadata"]
```

## Source Vs Preview Track Tree

```mermaid
flowchart TD
    A["Tracks selected for this candidate"] --> B{"Which responsibility?"}

    B -- "Source semantics" --> C["Use sourceVideoTrack/sourceAudioTrack"]
    C --> D["Detect live playback for skipLiveWait and logging"]
    C --> E["Compute timelineOffsetSeconds"]
    C --> F["Compute duration and source timeline end"]
    C --> G["Read source dimensions for export sizing"]

    B -- "Browser preview" --> H["Use previewVideoTrack/previewAudioTrack"]
    H --> I["Create CanvasSink / AudioBufferSink"]
    H --> J{"Audio-only with poster artwork?"}
    J -- "Yes" --> K["Load static poster canvas for preview video"]
    J -- "No" --> L["Read preview/source dimensions"]
    K --> M["Schedule preview frames and audio"]
    L --> M

    C --> N["Keep export/editor range aligned"]
```

## Playback Fallback Tree

```mermaid
flowchart TD
    A["Try next playback candidate"] --> B{"Input opens and reads?"}
    B -- "No" --> C["Failure category: open-or-read"]
    C --> D{"Failed source was HLS and direct/local/url fallback exists?"}
    D -- "Yes" --> E["Remember fallback source for Auto export"]
    D -- "No" --> F["Do not change export fallback"]
    E --> G["Try next candidate"]
    F --> G

    B -- "Yes" --> H{"Why can't preview use the tracks/sinks?"}
    H -- "Browser decoder environment blocks source video or all tracks" --> I["Failure category: shared-export-blocking"]
    I --> J{"Direct/local/url fallback exists?"}
    J -- "Yes" --> K["Remember fallback source for Auto export"]
    J -- "No" --> L["Keep HLS source and surface error later"]
    K --> G
    L --> G

    H -- "No decodable tracks, Web Audio unavailable, or sink setup failed" --> M["Failure category: preview-only"]
    M --> N["Do not change export fallback"]
    N --> G

    H -- "Tracks are previewable" --> O["Preview succeeds"]
    O --> P["Show active source label and fallback message when used"]
```

## Preview Ready Warmup Tree

```mermaid
flowchart TD
    A["Active preview source is provider HLS stream"] --> B["useEditorPlaybackSelectionWarmup sets playbackReadyRange"]
    B --> C["Paused auto-warmup starts from selection start"]
    C --> D["useEditorPlaybackWarmup warms exact playback/selection start first"]
    D --> E["Selection warmup warms an initial front window"]
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
    S --> T{"Seek lands in selection?"}
    T -- "Yes" --> U["Restart paused selection warmup from selection start/end"]
    T -- "No" --> V["Cancel background selection warmup"]

    W["Playback pauses before selection is ready"] --> X["Resume paused selection warmup from selection start"]
```

## Export Source Selection Tree

```mermaid
flowchart TD
    A["User opens Export"] --> A1{"Selected preference is available?"}
    A1 -- "No" --> A2["Treat preference as Auto"]
    A1 -- "Yes" --> B{"Effective export source preference"}
    A2 --> B
    B -- "Direct/original" --> C{"Session has directSource?"}
    C -- "Yes" --> D["Use direct source, local file, or local URL for export"]
    C -- "No" --> E["No exportable stream"]

    B -- "HLS playback" --> F{"Session has hlsSource?"}
    F -- "Yes" --> G["Use HLS source for export"]
    F -- "No" --> E

    B -- "Auto" --> H{"exportFallbackSource set?"}
    H -- "Yes" --> H1["Use fallback source as HLS or direct based on source type"]
    H -- "No" --> I{"Session has hlsSource?"}
    I -- "Yes" --> G
    I -- "No" --> C
    H1 --> J["Build export label/message from source and fallback reason"]
    D --> J
    G --> J
```

## Timeline Normalization Tree

```mermaid
flowchart TD
    A["Preview or export needs a source timestamp"] --> B{"Any selected track uses Unix-epoch or live timeline?"}
    B -- "No" --> C["Use UI time directly as source time"]
    B -- "Yes" --> D["Read the earliest selected track first timestamp"]
    D --> E["Store it as timelineOffsetSeconds"]
    E --> F["Preview duration = source end time - timeline offset"]
    E --> G["Preview seek/read time = UI time + timeline offset"]
    E --> H["Export trim.start/end = UI time + timeline offset"]
    E --> I["Frame stepping and warmup use source timeline conversion"]
```

## Playlist Rewrite Tree

```mermaid
flowchart TD
    A["Proxy rewrites HLS playlist line"] --> Z{"Blank line?"}
    Z -- "Yes" --> Z1["Preserve blank line"]
    Z -- "No" --> B{"Comment line?"}
    B -- "Yes" --> C{"EXT-X-START?"}
    C -- "Yes" --> C1["Strip start hint"]
    C -- "No" --> C2["Rewrite each URI attribute value when present"]
    B -- "No" --> D1["Rewrite full media line URI"]

    C2 --> E["resolvePlaylistUri(basePath, uri)"]
    D1 --> E

    E --> F{"URI absolute?"}
    F -- "Yes" --> G["Preserve full absolute URL as nextPath"]
    F -- "No" --> H["Resolve relative URI against current playlist basePath"]

    G --> I["Create provider or local-url proxy handle with basePath = playlistBasePath(nextPath)"]
    H --> I
    I --> J["Nested relative URIs continue from the correct host/path"]
```

## Local URL Media Flow

```mermaid
flowchart TD
    A["LocalVideoOpenDialog receives media URL"] --> B["localMediaRegistry validates absolute HTTP(S) URL"]
    B --> C["POST /api/media/local-url"]
    C --> D["Server parses URL and builds local-url media handle"]
    D --> E["assertAllowedMediaHandleRequestUrl rejects unsafe protocol, credentials, localhost/private hosts, or unsafe DNS results"]
    E --> F["Return proxied mediaUrl and hls flag"]
    F --> G["Create EditorUrlMediaSource with role direct-url"]
    G --> H{"URL is HLS playlist?"}
    H -- "Yes" --> I["buildLocalEditorSession stores source as hlsSource"]
    H -- "No" --> J["buildLocalEditorSession stores source as directSource"]

    K["GET /api/media/local-url/:handleId"] --> L["Resolve local-url handle"]
    L --> M["Forward Range only when request is not an HLS playlist"]
    M --> N["proxyProviderMediaResponse without provider auth"]
    N --> O["Nested HLS URIs create new local-url handles"]
```

## Proxy Media Request Tree

```mermaid
flowchart TD
    A["Client requests /api/media/:handleId or /api/media/local-url/:handleId"] --> B["Resolve handle and request URL"]
    B --> C{"Request origin matches provider baseUrl origin?"}
    C -- "Yes" --> D["Attach provider auth/session headers"]
    C -- "No" --> E["Do not attach provider auth headers"]

    D --> F{"Range request or not HLS-derived?"}
    E --> F

    F -- "Yes" --> G["Fetch upstream with retry policy"]
    G --> G0["Validate upstream URL before each fetch/redirect"]
    G0 --> G4{"Redirect crosses origin?"}
    G4 -- "Yes" --> G5["Strip sensitive auth headers before following"]
    G4 -- "No" --> G1{"Upstream response is HLS playlist?"}
    G5 --> G1
    G1 -- "Yes" --> G2["Rewrite playlist and send response"]
    G1 -- "No" --> G3["Stream response body directly"]
    F -- "No" --> H["Build short-lived cache key"]
    H --> I{"Cached response exists?"}
    I -- "Yes" --> J["Serve cached response"]
    I -- "No" --> K{"Matching in-flight response exists?"}
    K -- "Yes" --> L["Wait for in-flight response and reuse it"]
    K -- "No" --> M["Fetch upstream with retry policy, URL validation, and snapshot response"]
    M --> N{"Upstream response is HLS playlist?"}
    N -- "Yes" --> O["Rewrite playlist body before caching/serving"]
    N -- "No" --> P["Cache small media response body when eligible"]
```

## Export Output Flow

```mermaid
flowchart TD
    A["Export dialog opens"] --> A1["useEditorExport computes immediate approximate output size from duration, dimensions, format, quality, source size, direct provider bitrate metadata, HLS manifest bandwidth, audio, and GIF settings"]
    A1 --> A2["Summary panel shows estimate as the bottom summary card"]
    A2 --> A3["Sharp video estimates may use source or HLS bitrate; Compact and Balanced use forced-transcode codec heuristics"]
    A3 --> B["User clicks Export"]
    B --> B1["useEditorExport resolves source/options and lazy-loads exportClip"]
    B1 --> C{"Output format is GIF?"}
    C -- "Yes" --> D["Build fresh Mediabunny input and CanvasSink from export source"]
    D --> E["Apply shared Quality control as GIF max height, frame rate, color count, and palette mode"]
    E --> F["Draw frames with high-quality canvas scaling and burn subtitles when enabled"]
    F --> G{"Preset uses a stable sampled palette?"}
    G -- "Yes" --> G1["Sample frames first and quantize one shared palette"]
    G -- "No" --> G2["Quantize each encoded frame independently"]
    G1 --> G3["Encode frames with gifenc and report encoding progress"]
    G2 --> G3
    G3 --> G4["Return image/gif Blob"]

    C -- "No" --> H["exportClip builds fresh Mediabunny input from export source URL"]
    H --> I["exportMetadata builds tags and artwork when metadata exists"]
    I --> J["Create Output(BufferTarget)"]
    J --> K["Build conversion options for source video, selected audio, trim, resolution, tags, optional subtitles, and video quality"]
    K --> K1{"Video quality is Compact or Balanced?"}
    K1 -- "Yes" --> K2["Force video transcode with lower target bitrate"]
    K1 -- "No" --> K3["Sharp leaves copy/remux available when possible"]
    K2 --> L["Conversion.init validates selected tracks and output plan"]
    K3 --> L
    L --> M{"Conversion valid?"}
    M -- "No" --> N["Surface conversion/discard error"]
    M -- "Yes" --> O{"Audio requested, source had audio, but no audio track utilized?"}
    O -- "Yes" --> P["Surface audio discard error before execute"]
    O -- "No" --> Q["Execute conversion"]
    Q --> R["Patch MP4/MOV metadata boxes when needed"]
    R --> S["Log actual output bytes with estimate basis, delta, and ratio"]
    S --> T["Return video Blob from target buffer"]
    T --> U["Do not reopen the finished Blob just to recheck audio"]
```

## End-To-End Summary

```mermaid
flowchart LR
    A["Provider or local session data"] --> B["session.hlsSource"]
    A --> C["session.directSource"]
    A --> S["subtitle tracks / selected subtitle"]
    B --> D["useEditorPlayback"]
    C --> D
    D --> E["Preview source chosen"]
    D --> F["Optional exportFallbackSource"]
    D --> I["Optional timelineOffsetSeconds"]
    D --> J["Source tracks for duration/export alignment"]
    D --> K["Preview tracks for browser playback"]
    D --> L["Optional playbackReadyRange for provider HLS stream preview only"]
    L --> M["EditorTimeline Preview Ready overlay and note"]
    D --> P["Preview canvas with optional subtitles"]
    P --> Q["Framegrab dialog"]
    Q --> R["PNG clipboard or image download"]
    S --> T["useEditorSubtitles loads and clips subtitle cues"]
    T --> P
    T --> U["Export subtitle burn-in readiness"]
    B --> G["useEditorExport source selection"]
    C --> G
    F --> G
    U --> G
    G --> H["exportClip input URL"]
    H --> N["exportClip builds a fresh input"]
    I --> N
    N --> O["exportMetadata applies tags/artwork/MP4 or MOV metadata patching"]
```
