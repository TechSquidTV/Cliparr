# Diagrams

This file captures the current Canvas Timeline editor, Mediabunny adapter,
export, local media, and proxy decision trees. It reflects the v2 editor's
engine-owned in/out range and viewport, HLS-first adapter loading, timeline
normalization, alternate track selection, playlist rewrite, proxy auth/cache
handling, export memory fixes, local file/URL support, subtitle burn-in, and
framegrabs.

## Frontend Responsibility Map

```mermaid
flowchart TD
    A["EditorScreen creates TimelineEngine"] --> A0["TimelineProvider"]
    A0 --> A1["EditorHeader / EditorLayout / EditorPreview"]
    A0 --> A2["EditorControls / Canvas Timeline surface and track headers"]
    A --> A3["EditorPlaybackSourcePanel / EditorSubtitlePanel"]
    A0 --> B["useEditorTimelineMedia"]
    A0 --> C["useEditorExport"]
    A0 --> E["useEditorKeyboardShortcuts"]
    A0 --> J["useEditorSubtitles"]
    A0 --> K["useEditorFramegrab"]

    B --> B1["editorPlaybackSources track/source analysis"]
    B --> B2["Mediabunny adapter"]
    B --> B3["useTimelineMediaSync"]
    B --> B4["TimelineEngine media clip sourceStart/duration"]
    A2 --> D["CanvasRenderer / RangeSelector / ViewportScrollbar"]
    D --> D1["TimelineEngine playhead/in/out/zoom/scroll"]
    A2 --> D2["Source mute / Sub 1 visibility headers"]

    C --> C1["lazy EditorExportDialog"]
    C --> C2["exportFileName"]
    C --> C3["subtitleExportSummary"]
    C --> C4["exportClip"]
    C4 --> C5["exportMetadata"]
    C4 --> C6["subtitle burn-in processor"]

    K --> H["lazy EditorFramegrabDialog"]
    K --> H1["framegrab canvas helpers"]
    K --> C2

    E --> E1["editorShortcutCommands"]
    J --> J1["useSubtitleCues"]
    J --> J2["selectPreferredSubtitleTrack"]
    J --> J3["Parsed SRT/VTT cues synchronize into Canvas subtitle clips"]
    J3 --> J4["Editable engine subtitle clips feed preview, framegrabs, and export"]

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
    C --> D["Use skipLiveWait for duration discovery"]
    C --> E["Compute timelineOffsetSeconds"]
    C --> F["Compute duration and source timeline end"]
    C --> G["Read source dimensions for export sizing"]

    B -- "Browser preview" --> H["Use previewVideoTrack/previewAudioTrack"]
    H --> I["Override input primary tracks for adapter"]
    I --> J["Mediabunny adapter owns CanvasSink / AudioBufferSink"]
    J --> K["useTimelineMediaSync drives external timeline clock"]

    C --> N["Keep export/editor range aligned"]
```

## Playback Fallback Tree

```mermaid
flowchart TD
    A["Adapter receives ordered descriptors sharing one sourceId"] --> B["Try HLS descriptor first"]
    B --> C{"Input, primary tracks, and sinks load?"}
    C -- "Yes" --> D["Keep HLS controller; skip duplicate direct sourceId"]
    C -- "No" --> E{"Direct/local/url descriptor exists?"}
    E -- "Yes" --> F["Try direct descriptor under same logical sourceId"]
    E -- "No" --> G["Surface adapter load error"]
    F --> H{"Direct descriptor loads?"}
    H -- "Yes" --> I["Remember direct source for Auto export and show fallback message"]
    H -- "No" --> G
    D --> J["Preview succeeds with HLS"]
    I --> K["Preview succeeds with direct media"]
    L["Runtime decode failure after adapter ready"] --> M["Surface playback error"]
    M --> N["Published adapter cannot switch controllers at runtime; second-pass gap"]
```

## Adapter Readiness Tree

```mermaid
flowchart TD
    A["Mediabunny adapter loads at least one source"] --> B["adapter.ready = true"]
    B --> C["useTimelineMediaSync schedules initial paused seek"]
    C --> D["Adapter decodes and paints active media frame"]
    D --> E["Framegrab and playback controls become available"]
    F["User presses Play"] --> G["Resume AudioContext without blocking transport"]
    G --> H["Adapter starts external media clock"]
    H --> I["TimelineEngine playhead follows adapter clock"]
    I --> J{"Playhead reaches engine outPoint?"}
    J -- "Yes" --> K["Pause adapter and reset playhead to inPoint"]
    J -- "No" --> I
    L["Legacy HLS selection warmup / Preview Ready band"] --> M["Removed in v2; adapter exposes no equivalent readiness range"]
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
    E --> G["Set engine media clip.sourceStart = timeline offset"]
    G --> G1["Adapter maps engine timeline time to source time"]
    E --> H["Export trim.start/end = UI time + timeline offset"]
    E --> I["Frame stepping uses engine timeline time"]
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
    L --> M["Forward Range only when request is not HLS-derived"]
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
    A1 --> A2["Dialog footer shows a compact estimate opposite the export action"]
    A2 --> A3["Sharp video estimates may use source or HLS bitrate; Compact and Balanced use forced-transcode codec heuristics"]
    A3 --> B["User clicks Export"]
    B --> B1["useEditorExport resolves source/options and lazy-loads exportClip"]
    B1 --> C{"Output format is GIF?"}
    C -- "Yes" --> D["Build fresh Mediabunny input and assert source video is decodable before CanvasSink setup"]
    D --> E["Apply GIF Quality control as max height, frame rate, color count, palette mode, and dither settings"]
    E --> F["Draw frames with high-quality canvas scaling and burn subtitles when enabled"]
    F --> G{"Preset uses a stable sampled palette?"}
    G -- "Yes" --> G1["Sample frames first and quantize one shared palette"]
    G -- "No" --> G2["Use a per-frame palette"]
    G1 --> G3["Send RGBA frame data to the @techsquidtv/gifenc worker encoder"]
    G2 --> G3
    G3 --> G4["Workers quantize/apply palette, including spatial and temporal dithering when enabled, and return encoded frame chunks"]
    G4 --> G5["Main thread concatenates chunks in frame order, appends GIF trailer, and reports progress"]
    G5 --> G6["Return image/gif Blob"]

    C -- "No" --> H["exportClip builds fresh Mediabunny input from export source URL"]
    H --> H1["Assert selected source video is decodable when conversion needs decoded frames"]
    H1 --> I["exportMetadata builds tags and artwork when metadata exists"]
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

## Subtitle Timeline Invariants

- Canvas Timeline contains one editable subtitle track. The existing text-track
  detection and SRT/VTT parser populate that track once after media duration is
  resolved; user changes are never overwritten by later toggle state.
- `useSubtitleCues` owns selected-track download and parsing only. Parsed cues
  are synchronized into the engine, then read back from engine clips for
  clipping and subtitle export so there is no parallel editable cue model.
- Clip labels are the canonical multiline cue text and timeline start/end values
  are the canonical cue timing values. Source cue identity remains in metadata.
- Track headers use stable `Source` and `Sub 1` labels. Source mute controls the
  preview audio output without hiding video; Sub 1 visibility is engine-owned
  and gates subtitle preview, framegrabs, and export.
- The side panel edits the selected engine clip's text and timing, while
  overlap-safe command previews and commits drive timeline dragging and trims.
- Export and framegrab actions remain blocked while parsed cues are waiting for
  their one-time engine import. Turning subtitles off preserves customized cues.
- Export subtitle burn-in consumes cues reconstructed from engine state.
- The Mediabunny adapter owns media painting. Cliparr draws active engine cues
  on a transparent preview canvas using the adapter's last rendered frame time
  and composites that layer into framegrabs; video and GIF export use the same
  cue conversion and style settings.
- Adding cues, provider-side subtitle writes, and sidecar export/persistence
  remain deferred. Existing imported cues support selection, text editing,
  move, trim, navigation, seek, and deletion.

## End-To-End Summary

```mermaid
flowchart LR
    A["Provider or local session data"] --> B["session.hlsSource"]
    A --> C["session.directSource"]
    A --> S["subtitle tracks / selected subtitle"]
    A --> T0["TimelineEngine + TimelineProvider"]
    T0 --> T1["Engine owns playhead, in/out, zoom, and scroll"]
    B --> D["useEditorTimelineMedia"]
    C --> D
    D --> E["HLS-first adapter descriptors share one logical sourceId"]
    D --> F["Optional exportFallbackSource"]
    D --> I["Optional timelineOffsetSeconds"]
    D --> J["Source tracks for duration/export alignment"]
    D --> K["Preview tracks for browser playback"]
    D --> L["Mediabunny adapter"]
    L --> M["useTimelineMediaSync external clock"]
    M --> T1
    T1 --> TS["CanvasRenderer / RangeSelector / ViewportScrollbar"]
    D --> P["Adapter preview canvas"]
    P --> Q["Framegrab dialog"]
    Q --> R["PNG clipboard or image download"]
    S --> T["useEditorSubtitles parses detected SRT/VTT cues"]
    T --> T2["Canvas subtitle clips own cue timing and text"]
    T2 --> T3["Side panel and overlap-safe timeline commands customize cues"]
    T3 --> T4["Active cues render on preview and framegrab overlay"]
    T3 --> U["Engine cues are clipped for export subtitle burn-in"]
    B --> G["useEditorExport source selection"]
    C --> G
    F --> G
    U --> G
    G --> H["exportClip input URL"]
    H --> N["exportClip builds a fresh input"]
    T1 --> X["Engine in/out seconds"]
    X --> N
    I --> N
    N --> O["exportMetadata applies tags/artwork/MP4 or MOV metadata patching"]
```
