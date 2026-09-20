let counter = 0;

/** 生成本地唯一 id（时间戳 + 递增计数 + 随机后缀） */
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}
