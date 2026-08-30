import { requireNativeModule } from "expo-modules-core";

/** Which of iMin's two printer SDKs this terminal actually answered on. */
export type Generation = "NEO" | "LEGACY" | "NONE";

export type PrinterStatus = {
  generation: Generation;
  model: string;
  manufacturer: string;
  code: number;
  text: string;
  ready: boolean;
};

export const ALIGN_LEFT = 0;
export const ALIGN_CENTER = 1;
export const ALIGN_RIGHT = 2;

export type Hardware = {
  generation: Generation;
  supported: boolean;
  serialNumber?: string | null;
  modelName?: string | null;
  firmware?: string | null;
  /** Millimetres of paper this head has ever fed. Advances only on real print. */
  paperDistance?: string | null;
  cutTimes?: string | null;
  lastPrintResult?: number;
};

type Native = {
  getStatus(): Promise<PrinterStatus>;
  hardware(): Promise<Hardware>;
  beginDocument(): Promise<void>;
  endDocument(): Promise<void>;
  printText(text: string, size: number, align: number, bold: boolean): Promise<void>;
  printColumns(texts: string[], widths: number[], aligns: number[], size: number): Promise<void>;
  /** One line in the head's built-in monospace font. 32 columns on a 58mm roll. */
  printMono(text: string, align: number): Promise<void>;
  printQrCode(data: string, size: number, align: number): Promise<void>;
  printBitmap(base64: string, align: number): Promise<void>;
  feedAndCut(lines: number): Promise<void>;
};

// Absent on any build that is not running on iMin hardware — a phone, the
// simulator, web. Callers check `available` rather than trapping a throw.
let native: Native | null = null;
try {
  native = requireNativeModule<Native>("IminPrinter");
} catch {
  native = null;
}

export const available = native !== null;

export const printer: Native = native ?? {
  getStatus: async () => {
    throw new Error("There is no iMin printer in this build.");
  },
  hardware: async () => { throw new Error("There is no iMin printer in this build."); },
  beginDocument: async () => { throw new Error("There is no iMin printer in this build."); },
  endDocument: async () => { throw new Error("There is no iMin printer in this build."); },
  printText: async () => { throw new Error("There is no iMin printer in this build."); },
  printColumns: async () => { throw new Error("There is no iMin printer in this build."); },
  printMono: async () => { throw new Error("There is no iMin printer in this build."); },
  printQrCode: async () => { throw new Error("There is no iMin printer in this build."); },
  printBitmap: async () => { throw new Error("There is no iMin printer in this build."); },
  feedAndCut: async () => { throw new Error("There is no iMin printer in this build."); },
};
