// The shape of Flask's successful answer from POST /api/detect.
// These types describe fields the server really sends (checked against the
// running API and the original page's checkResponse). lib/api.ts verifies the
// shape at run time before anything is displayed, so a wrong answer becomes
// an error message instead of a crash.

export type DetectStatus = "NO_DEADLOCK" | "DEADLOCK_DETECTED";

export type Shortage = {
  resource: string; // "R2"
  requested: number;
  available: number;
  shortfall: number;
};

export type BlockedInfo = {
  explanation: string;
  allocation: number[]; // what the process holds
  request: number[]; // what it still asks for
  shortages: Shortage[];
};

export type ConsideredItem = {
  process: string;
  request: number[];
  can_satisfy: boolean;
};

export type TraceStep = {
  iteration: number;
  work_before: number[];
  work_after: number[];
  finish_before: Record<string, boolean>;
  considered: ConsideredItem[];
  selected: string | null; // null on the final "nothing fits" scan
  selected_request: number[] | null;
  allocation_released: number[] | null;
};

export type DetectResponse = {
  success: true;
  status: DetectStatus;
  message: string;
  process_count: number;
  resource_count: number;
  completion_sequence: string[]; // order in which processes finished during the scans
  finished_processes: string[]; // everyone who finished, including those that held nothing
  initially_finished: string[]; // processes that hold nothing and start finished
  deadlocked_processes: string[];
  finish_status: Record<string, boolean>;
  initial_work: number[];
  final_work: number[];
  stop_reason: string;
  blocked_explanations: Record<string, BlockedInfo>;
  trace: TraceStep[];
};