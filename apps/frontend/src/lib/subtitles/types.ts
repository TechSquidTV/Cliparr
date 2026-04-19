export interface SubtitleCue {
  id?: string;
  startTime: number;
  endTime: number;
  text: string;
  lines: string[];
}

export interface SubtitleStyleSettings {
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetY: number;
  strokeColor: string;
  strokeWidth: number;
  bottomMargin: number;
  lineHeight: number;
}
