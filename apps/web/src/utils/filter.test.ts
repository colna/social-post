import { describe, expect, it } from 'vitest';
import { filterAccounts, type AccountLike } from './filter';

const accounts: AccountLike[] = [
  { handle: 'colna_zheng', displayName: 'COLNA', lastCrawledAt: '2026-08-06T12:39:55Z' },
  { handle: 'smartgroupuk', displayName: 'The SMART Group', lastCrawledAt: '2026-08-06T13:09:21Z' },
  { handle: 'intros_medical_laser', displayName: null, lastCrawledAt: '2026-07-20T00:00:00Z' },
  { handle: 'zaijianmosaic', displayName: null, lastCrawledAt: null },
];

describe('filterAccounts', () => {
  it('空筛选返回全部', () => {
    expect(filterAccounts(accounts, {})).toHaveLength(4);
  });

  it('按 handle 子串匹配、忽略大小写与首尾空格', () => {
    expect(filterAccounts(accounts, { handle: '  SMART ' }).map((a) => a.handle)).toEqual([
      'smartgroupuk',
    ]);
  });

  it('按展示名子串匹配,null 展示名不误命中', () => {
    const r = filterAccounts(accounts, { displayName: 'smart' });
    expect(r.map((a) => a.handle)).toEqual(['smartgroupuk']);
  });

  it('handle 与展示名同时给出时取交集', () => {
    expect(filterAccounts(accounts, { handle: 'colna', displayName: 'nope' })).toHaveLength(0);
    expect(
      filterAccounts(accounts, { handle: 'colna', displayName: 'colna' }).map((a) => a.handle),
    ).toEqual(['colna_zheng']);
  });

  it('按最近抓取时间段筛选(含边界当天)', () => {
    const r = filterAccounts(accounts, { lastCrawledAt: ['2026-08-06', '2026-08-06'] });
    expect(r.map((a) => a.handle).sort()).toEqual(['colna_zheng', 'smartgroupuk']);
  });

  it('时间段筛选排除从未抓取(lastCrawledAt=null)', () => {
    const r = filterAccounts(accounts, { lastCrawledAt: ['2026-01-01', '2026-12-31'] });
    expect(r.map((a) => a.handle)).not.toContain('zaijianmosaic');
    expect(r).toHaveLength(3);
  });

  it('不完整的时间段(缺一端)视为不筛选时间', () => {
    expect(filterAccounts(accounts, { lastCrawledAt: ['2026-08-06', ''] })).toHaveLength(4);
    expect(filterAccounts(accounts, { lastCrawledAt: null })).toHaveLength(4);
  });
});
