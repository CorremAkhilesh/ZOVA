import type { PublicProfile, ReportTarget } from '@zuvo/protocol';
import { create } from 'zustand';

export interface ReportRequest {
  target: ReportTarget;
  /** Who the report is about, for the title and for "Report and block". Null for a group. */
  person: PublicProfile | null;
  /** The group's name, when reporting a group. */
  groupName?: string;
}

interface Moderation {
  report: ReportRequest | null;
  /** Asking "Block X?" before blocking. */
  confirmBlock: PublicProfile | null;
  openReport: (request: ReportRequest) => void;
  askBlock: (person: PublicProfile) => void;
  close: () => void;
}

/** Report and block dialogs, opened from menus anywhere and shown once by `ModerationDialogs`. */
export const useModeration = create<Moderation>()((set) => ({
  report: null,
  confirmBlock: null,
  openReport: (report) => set({ report, confirmBlock: null }),
  askBlock: (confirmBlock) => set({ confirmBlock, report: null }),
  close: () => set({ report: null, confirmBlock: null }),
}));
