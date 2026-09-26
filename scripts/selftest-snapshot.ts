// 赛事快照导入 / 导出校验自测：规范化迁移、全量校验、错误路径与禁止部分导入
import assert from 'node:assert';
import type { TournamentState } from '../src/types';
import {
  buildSnapshot,
  parseSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
  type ImportIssue,
} from '../src/snapshot';

const paths = (errors: ImportIssue[]) => errors.map((e) => e.path).sort();

/** 一个合法的基准赛事：5 人 2 轮，含轮空、缺席快照与未录入赛果 */
function sampleState(): TournamentState {
  return {
    players: [
      { id: 'p1', name: '甲', team: '红队' },
      { id: 'p2', name: '乙', team: '红队' },
      { id: 'p3', name: '丙' },
      { id: 'p4', name: '丁' },
      { id: 'p5', name: '戊' },
    ],
    rounds: [
      {
        id: 'r1',
        matches: [
          { id: 'm1', playerAId: 'p1', playerBId: 'p3', resultA: 'win', bye: false },
          { id: 'm2', playerAId: 'p2', playerBId: 'p4', resultA: 'draw', bye: false },
          { id: 'm3', playerAId: 'p5', playerBId: null, resultA: 'win', bye: true },
        ],
        absentIds: [],
      },
      {
        id: 'r2',
        matches: [
          { id: 'm4', playerAId: 'p1', playerBId: 'p2', resultA: null, bye: false },
          { id: 'm5', playerAId: 'p3', playerBId: 'p5', resultA: null, bye: false },
        ],
        absentIds: ['p4'],
      },
    ],
  };
}

const parseObj = (obj: unknown) => parseSnapshot(JSON.stringify(obj));

// 1. 导出 → 导入往返：内容完整，预览统计正确
{
  const state = sampleState();
  const snap = buildSnapshot(state);
  assert.strictEqual(snap.schemaVersion, SNAPSHOT_SCHEMA_VERSION, '导出必须带 schemaVersion');
  assert.ok(typeof snap.exportedAt === 'string' && snap.exportedAt.length > 0);
  assert.strictEqual(snap.players.length, 5);
  assert.strictEqual(snap.rounds.length, 2);
  assert.deepStrictEqual(snap.rounds[1].absentIds, ['p4'], '缺席快照必须导出');
  assert.ok(!('whiteId' in snap.rounds[0].matches[0]), '不得写出兼容残留字段');

  const result = parseSnapshot(JSON.stringify(snap));
  assert.ok(result.ok, '往返导入应成功');
  assert.deepStrictEqual(result.preview.state, state, '往返后赛事数据必须一致');
  assert.strictEqual(result.preview.playerCount, 5);
  assert.strictEqual(result.preview.roundCount, 2);
  assert.strictEqual(result.preview.matchCount, 5);
  assert.strictEqual(result.preview.pendingResults, 2);
  assert.strictEqual(result.preview.byeCount, 1);
  assert.strictEqual(result.preview.absentRounds, 1);
  assert.ok(
    result.preview.warnings.some((w) => w.includes('尚未录入赛果')),
    '未录入赛果应进入问题预览',
  );
  console.log('✓ 导出/导入往返一致，预览统计正确');
}

// 2. 旧版迁移：缺少 schemaVersion / absentIds / bye / resultA 时按规则补全
{
  const legacy = {
    // 无 schemaVersion
    players: [
      { id: 'p1', name: '甲', team: '  ' }, // 空队伍名 → 无队伍
      { id: 'p2', name: '乙' },
      { id: 'p3', name: '丙' },
    ],
    rounds: [
      {
        id: 'r1',
        // 无 absentIds
        matches: [
          { id: 'm1', playerAId: 'p1', playerBId: 'p2' }, // 无 resultA / bye
          { id: 'm2', playerAId: 'p3', playerBId: null }, // 轮空：无 bye / resultA
        ],
      },
    ],
  };
  const result = parseObj(legacy);
  assert.ok(result.ok, `旧版文件应迁移导入：${!result.ok ? JSON.stringify(result.errors) : ''}`);
  const st = result.preview.state;
  assert.deepStrictEqual(st.rounds[0].absentIds, [], '旧版缺少 absentIds 应迁移为空数组');
  assert.strictEqual(st.players[0].team, undefined, '空队伍名应规范化为无队伍');
  assert.strictEqual(st.rounds[0].matches[0].resultA, null, '缺省赛果视为未录入');
  assert.strictEqual(st.rounds[0].matches[0].bye, false);
  assert.strictEqual(st.rounds[0].matches[1].bye, true, '轮空场应补 bye');
  assert.strictEqual(st.rounds[0].matches[1].resultA, 'win', '轮空场应补赛果 win');
  assert.ok(result.preview.warnings.some((w) => w.includes('schemaVersion')));
  assert.ok(result.preview.warnings.some((w) => w.includes('缺席名单')));
  console.log('✓ 旧版迁移：absentIds 补空、轮空补全、空队伍名规范化');
}

// 3. ID 唯一：选手 / 轮次 / 对局（跨轮）重复均报错并给出路径
{
  const dup = (patch: (s: ReturnType<typeof buildSnapshot>) => void, expectPath: string) => {
    const snap = buildSnapshot(sampleState());
    patch(snap);
    const result = parseObj(snap);
    assert.ok(!result.ok, `${expectPath} 重复应被拒绝`);
    assert.ok(
      result.errors.some((e) => e.path === expectPath),
      `应报告路径 ${expectPath}，实际：${paths(result.errors).join(', ')}`,
    );
  };
  dup((s) => {
    s.players[1].id = 'p1';
  }, 'players[1].id');
  dup((s) => {
    s.rounds[1].id = 'r1';
  }, 'rounds[1].id');
  dup((s) => {
    s.rounds[1].matches[0].id = 'm1'; // 跨轮重复
  }, 'rounds[1].matches[0].id');
  console.log('✓ ID 唯一：选手/轮次/对局重复均按路径报错');
}

// 4. 对局引用存在：playerAId / playerBId / absentIds 引用不存在的选手
{
  const badRef = (patch: (s: ReturnType<typeof buildSnapshot>) => void, expectPath: string) => {
    const snap = buildSnapshot(sampleState());
    patch(snap);
    const result = parseObj(snap);
    assert.ok(!result.ok);
    assert.ok(
      result.errors.some((e) => e.path === expectPath && e.message.includes('不存在')),
      `应报告 ${expectPath} 引用不存在，实际：${JSON.stringify(result.errors)}`,
    );
  };
  badRef((s) => {
    s.rounds[0].matches[0].playerAId = 'ghost';
  }, 'rounds[0].matches[0].playerAId');
  badRef((s) => {
    s.rounds[0].matches[0].playerBId = 'ghost';
  }, 'rounds[0].matches[0].playerBId');
  badRef((s) => {
    s.rounds[1].absentIds = ['ghost'];
  }, 'rounds[1].absentIds[0]');
  console.log('✓ 引用校验：对局与缺席名单引用不存在的选手均报错');
}

// 5. 同轮选手不重复（含轮空者）
{
  const snap = buildSnapshot(sampleState());
  // 第 1 轮：m1 改为 p1 vs p3，m2 改为 p1 vs p4 => p1 同轮两场
  snap.rounds[0].matches[1].playerAId = 'p1';
  const result = parseObj(snap);
  assert.ok(!result.ok);
  assert.ok(
    result.errors.some(
      (e) => e.path === 'rounds[0].matches[1]' && e.message.includes('同一轮'),
    ),
    `应在重复对局处报错，实际：${JSON.stringify(result.errors)}`,
  );

  // 轮空者与对局选手重复
  const snap2 = buildSnapshot(sampleState());
  snap2.rounds[0].matches[2].playerAId = 'p1'; // 轮空场改为 p1
  const result2 = parseObj(snap2);
  assert.ok(!result2.ok);
  assert.ok(result2.errors.some((e) => e.path === 'rounds[0].matches[2]'));
  console.log('✓ 同轮选手不重复（含轮空者）');
}

// 6. 轮空结构合法：bye 与 playerBId 矛盾、轮空赛果非 win 均报错
{
  // bye: true 却填写了 B 方
  const s1 = buildSnapshot(sampleState());
  s1.rounds[0].matches[0].bye = true;
  const r1 = parseObj(s1);
  assert.ok(!r1.ok);
  assert.ok(r1.errors.some((e) => e.path === 'rounds[0].matches[0].playerBId'));

  // bye: false 却 playerBId: null
  const s2 = buildSnapshot(sampleState());
  s2.rounds[0].matches[2].bye = false;
  const r2 = parseObj(s2);
  assert.ok(!r2.ok);
  assert.ok(r2.errors.some((e) => e.path === 'rounds[0].matches[2].bye'));

  // 轮空场赛果不是 win
  const s3 = buildSnapshot(sampleState());
  s3.rounds[0].matches[2].resultA = 'draw';
  const r3 = parseObj(s3);
  assert.ok(!r3.ok);
  assert.ok(
    r3.errors.some(
      (e) => e.path === 'rounds[0].matches[2].resultA' && e.message.includes('win'),
    ),
  );
  console.log('✓ 轮空结构：bye 与 playerBId 矛盾、轮空赛果非 win 均报错');
}

// 7. 赛果取值有效：非法字符串 / 非字符串均报错；双方同人报错
{
  const s1 = buildSnapshot(sampleState());
  (s1.rounds[0].matches[0] as { resultA: unknown }).resultA = 'won';
  const r1 = parseObj(s1);
  assert.ok(!r1.ok);
  assert.ok(r1.errors.some((e) => e.path === 'rounds[0].matches[0].resultA'));

  const s2 = buildSnapshot(sampleState());
  (s2.rounds[0].matches[0] as { resultA: unknown }).resultA = 1;
  const r2 = parseObj(s2);
  assert.ok(!r2.ok);
  assert.ok(r2.errors.some((e) => e.path === 'rounds[0].matches[0].resultA'));

  const s3 = buildSnapshot(sampleState());
  s3.rounds[0].matches[0].playerBId = s3.rounds[0].matches[0].playerAId;
  const r3 = parseObj(s3);
  assert.ok(!r3.ok);
  assert.ok(
    r3.errors.some(
      (e) =>
        e.path === 'rounds[0].matches[0].playerBId' && e.message.includes('同一名选手'),
    ),
  );
  console.log('✓ 赛果取值与对局双方校验');
}

// 8. 缺席名单与本轮对局冲突
{
  const snap = buildSnapshot(sampleState());
  snap.rounds[0].absentIds = ['p1']; // p1 在第 1 轮有对局
  const result = parseObj(snap);
  assert.ok(!result.ok);
  assert.ok(
    result.errors.some(
      (e) => e.path === 'rounds[0].absentIds' && e.message.includes('缺席'),
    ),
  );
  console.log('✓ 缺席名单与本轮对局冲突报错');
}

// 9. 多错误一次收集：全部按 JSON 路径列出，禁止部分导入
{
  const bad = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    players: [
      { id: 'p1', name: '甲' },
      { id: 'p1', name: '乙' }, // 重复 id
    ],
    rounds: [
      {
        id: 'r1',
        matches: [
          { id: 'm1', playerAId: 'p1', playerBId: 'p9', resultA: 'win', bye: false }, // 引用不存在
          { id: 'm1', playerAId: 'p1', playerBId: null, resultA: 'win', bye: true }, // id 重复 + 同轮重复
        ],
        absentIds: ['p8'], // 缺席引用不存在
      },
    ],
  };
  const result = parseObj(bad);
  assert.ok(!result.ok, '存在错误必须整体拒绝（禁止部分导入）');
  assert.deepStrictEqual(
    paths(result.errors),
    [
      'players[1].id',
      'rounds[0].absentIds[0]',
      'rounds[0].matches[0].playerBId',
      'rounds[0].matches[1]',
      'rounds[0].matches[1].id',
    ].sort(),
    `应一次收集全部 5 处错误，实际：${JSON.stringify(result.errors)}`,
  );
  console.log('✓ 多错误一次收集，按 JSON 路径列出，禁止部分导入');
}

// 10. 顶层结构与版本：非 JSON / 非对象 / 缺字段 / 版本过新
{
  const r1 = parseSnapshot('{ 不是 JSON');
  assert.ok(!r1.ok && r1.errors[0].path === '$');

  const r2 = parseObj([1, 2, 3]);
  assert.ok(!r2.ok && r2.errors[0].path === '$');

  const r3 = parseObj({ schemaVersion: 1 });
  assert.ok(!r3.ok);
  assert.deepStrictEqual(paths(r3.errors), ['players', 'rounds']);

  const r4 = parseObj({ schemaVersion: SNAPSHOT_SCHEMA_VERSION + 1, players: [], rounds: [] });
  assert.ok(!r4.ok && r4.errors.some((e) => e.path === 'schemaVersion'));

  const r5 = parseObj({ schemaVersion: '1', players: [], rounds: [] });
  assert.ok(!r5.ok && r5.errors.some((e) => e.path === 'schemaVersion'));

  // 空赛事是合法快照
  const r6 = parseObj({ schemaVersion: SNAPSHOT_SCHEMA_VERSION, players: [], rounds: [] });
  assert.ok(r6.ok);
  assert.strictEqual(r6.preview.playerCount, 0);
  console.log('✓ 顶层结构与 schemaVersion 校验');
}

// 11. 选手人数上限与字段类型
{
  const tooMany = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    players: Array.from({ length: 33 }, (_, i) => ({ id: `p${i}`, name: `选手${i}` })),
    rounds: [],
  };
  const r1 = parseObj(tooMany);
  assert.ok(!r1.ok && r1.errors.some((e) => e.path === 'players' && e.message.includes('上限')));

  const badTeam = parseObj({
    players: [{ id: 'p1', name: '甲', team: 5 }],
    rounds: [],
  });
  assert.ok(!badTeam.ok && badTeam.errors.some((e) => e.path === 'players[0].team'));

  const badAbsent = parseObj({
    players: [{ id: 'p1', name: '甲' }],
    rounds: [{ id: 'r1', matches: [], absentIds: 'p1' }],
  });
  assert.ok(!badAbsent.ok && badAbsent.errors.some((e) => e.path === 'rounds[0].absentIds'));
  console.log('✓ 人数上限与字段类型校验');
}

// 12. 缺席名单重复 id 规范化去重（不视为错误）
{
  const snap = buildSnapshot(sampleState());
  snap.rounds[1].absentIds = ['p4', 'p4'];
  const result = parseObj(snap);
  assert.ok(result.ok, '重复缺席 id 应规范化去重而非报错');
  assert.deepStrictEqual(result.preview.state.rounds[1].absentIds, ['p4']);
  console.log('✓ 缺席名单重复 id 规范化去重');
}

console.log('\n快照导入/导出校验自测通过 ✅');
