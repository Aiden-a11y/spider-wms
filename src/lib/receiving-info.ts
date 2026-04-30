export type ReceivingInfo = {
  orderCode: string;
  receivingDate: string;       // "YYYY-MM-DD"
  pltReceived: number;
  ctnReceived: number;
  pltPutAway: number;
  ctnPutAway: number;
  noBreakdown: boolean;
  breakdownReason: string;
  dimensionalHours: number;
  containerSize: string;
  updatedAt: string;
};

export const CONTAINER_SIZES = [
  { value: "floor_20",   label: "Floor Loaded — 20'" },
  { value: "floor_40",   label: "Floor Loaded — 40'" },
  { value: "floor_40hc", label: "Floor Loaded — 40' HC" },
  { value: "plt_20",     label: "Palletized — 20'" },
  { value: "plt_40",     label: "Palletized — 40'" },
  { value: "plt_40hc",   label: "Palletized — 40' HC" },
  { value: "ltl",        label: "LTL / LCL" },
  { value: "other",      label: "Other" },
];

export function emptyRecvInfo(orderCode: string): ReceivingInfo {
  return {
    orderCode,
    receivingDate: "",
    pltReceived: 0,
    ctnReceived: 0,
    pltPutAway: 0,
    ctnPutAway: 0,
    noBreakdown: false,
    breakdownReason: "",
    dimensionalHours: 0,
    containerSize: "",
    updatedAt: "",
  };
}

/** Returns true if at least one meaningful field has been filled */
export function hasRecvInfo(info: ReceivingInfo | undefined | null): boolean {
  if (!info) return false;
  return !!(
    info.receivingDate ||
    info.pltReceived > 0 ||
    info.ctnReceived > 0 ||
    info.pltPutAway > 0 ||
    info.ctnPutAway > 0 ||
    info.containerSize ||
    info.dimensionalHours > 0 ||
    info.breakdownReason
  );
}

/** Format receiving info as plain text to append to a WMS comment */
export function formatRecvInfoText(info: ReceivingInfo): string {
  const cs = CONTAINER_SIZES.find((c) => c.value === info.containerSize)?.label ?? info.containerSize;
  const lines = [
    "--- RECEIVING INFO ---",
    info.receivingDate   ? `Receiving Date: ${info.receivingDate}` : "",
    cs                   ? `Container Size: ${cs}` : "",
    (info.pltReceived || info.ctnReceived)
      ? `Pallets Received: ${info.pltReceived} PLT / ${info.ctnReceived} CTN` : "",
    (info.pltPutAway || info.ctnPutAway)
      ? `Pallets Put Away: ${info.pltPutAway} PLT / ${info.ctnPutAway} CTN` : "",
    info.noBreakdown
      ? "Reason for Breakdown: No Breakdown"
      : info.breakdownReason
      ? `Reason for Breakdown: ${info.breakdownReason}` : "",
    info.dimensionalHours > 0
      ? `Dimensional Total Hours: ${info.dimensionalHours}` : "",
    "--- END ---",
  ].filter(Boolean);
  return lines.join("\n");
}
