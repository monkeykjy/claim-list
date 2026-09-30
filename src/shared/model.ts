export const limits = {
  title: 200,
  name: 60,
  batch: 200,
  listName: 80,
  description: 300,
  label: 24,
} as const;
export type Identity = { ip: string; uuid: string; participantToken?: string };
export type Participant = { id: string; name: string };
export type Config = {
  listName: string;
  description: string;
  titleLabel: string;
  claimantLabel: string;
  statusLabel: string;
};
export type Item = {
  id: string;
  title: string;
  claimant: string | null;
  claimedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  revision: number;
  canComplete: boolean;
  accountBound: boolean;
  isMine: boolean;
};
export type ListData = {
  config: Config;
  items: Item[];
  participant: Participant | null;
};
export type AdminData = {
  initialized: boolean;
  authenticated: boolean;
  list?: ListData;
};
export const defaultConfig: Config = {
  listName: "认领清单",
  description: "",
  titleLabel: "条目",
  claimantLabel: "认领人",
  statusLabel: "状态",
};
export function statusOf(item: Item) {
  return item.completedAt ? "已完成" : item.claimant ? "进行中" : "待认领";
}
