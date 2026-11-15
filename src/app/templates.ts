// Starting points for a new map. Each one shows a structure at work; the
// texts are placeholders to write over.

import type { LayoutKind, NodeData } from '../core/model.ts';
import { getLang } from '../i18n.ts';

export interface Template {
  id: string;
  name: string;
  layout: LayoutKind;
  root: NodeData;
}

const n = (text: string, ...children: NodeData[]): NodeData => (children.length ? { text, children } : { text });
const todo = (text: string): NodeData => ({ text, todo: false });

/** The templates in the language of the interface, the blank map first. */
export function templates(): Template[] {
  const ja = getLang() === 'ja';
  const w = (j: string, e: string): string => (ja ? j : e);
  return [
    { id: 'blank', name: w('白紙', 'Blank'), layout: 'map', root: n(w('中心トピック', 'Central Topic')) },
    {
      id: 'meeting',
      name: w('議事メモ', 'Meeting Notes'),
      layout: 'logic',
      root: n(
        w('議事メモ', 'Meeting notes'),
        n(w('日時・参加者', 'When and who'), n(w('日時', 'Date')), n(w('参加者', 'Attendees'))),
        {
          text: w('議題', 'Agenda'),
          numbering: { format: 'arabic' },
          children: [n(w('議題', 'Item')), n(w('議題', 'Item')), n(w('議題', 'Item'))],
        },
        n(w('決定事項', 'Decisions'), n(w('決まったこと', 'What was decided'))),
        n(
          w('宿題', 'Action items'),
          todo(w('担当と期限を書く', 'Who does what by when')),
          todo(w('担当と期限を書く', 'Who does what by when')),
        ),
        n(w('次回', 'Next meeting')),
      ),
    },
    {
      id: 'project',
      name: w('プロジェクト計画', 'Project Plan'),
      layout: 'timeline',
      root: n(
        w('プロジェクト', 'Project'),
        n(w('企画', 'Plan'), todo(w('目的を決める', 'Set the goal')), todo(w('体制を決める', 'Form the team'))),
        n(w('設計', 'Design'), todo(w('要件をまとめる', 'Gather requirements')), todo(w('仕様を書く', 'Write the spec'))),
        n(w('開発', 'Build'), todo(w('作る', 'Make it')), todo(w('レビューする', 'Review it'))),
        n(w('テスト', 'Test'), todo(w('確認する', 'Check it')), todo(w('直す', 'Fix it'))),
        n(w('リリース', 'Launch'), todo(w('公開する', 'Ship it')), todo(w('振り返る', 'Look back'))),
      ),
    },
    {
      id: 'swot',
      name: w('SWOT 分析', 'SWOT Analysis'),
      layout: 'map',
      root: n(
        'SWOT',
        {
          text: w('強み', 'Strengths'),
          side: 'r',
          labels: [w('内部', 'internal')],
          children: [n(w('得意なこと', 'What we do well')), n(w('持っている資源', 'What we have'))],
        },
        {
          text: w('機会', 'Opportunities'),
          side: 'r',
          labels: [w('外部', 'external')],
          children: [n(w('追い風', 'Tailwinds')), n(w('まだない市場', 'Open markets'))],
        },
        {
          text: w('弱み', 'Weaknesses'),
          side: 'l',
          labels: [w('内部', 'internal')],
          children: [n(w('苦手なこと', 'What we lack')), n(w('足りない資源', 'What we miss'))],
        },
        {
          text: w('脅威', 'Threats'),
          side: 'l',
          labels: [w('外部', 'external')],
          children: [n(w('向かい風', 'Headwinds')), n(w('競合', 'Competitors'))],
        },
      ),
    },
    {
      id: 'org',
      name: w('組織図', 'Org Chart'),
      layout: 'org',
      root: n(
        w('代表', 'Director'),
        n(w('営業', 'Sales'), n(w('国内', 'Domestic')), n(w('海外', 'Overseas'))),
        n(w('開発', 'Engineering'), n(w('製品', 'Product')), n(w('基盤', 'Platform'))),
        n(w('管理', 'Operations'), n(w('人事', 'People')), n(w('経理', 'Finance'))),
      ),
    },
    {
      id: 'cause',
      name: w('原因分析', 'Cause Analysis'),
      layout: 'fishbone',
      root: n(
        w('問題', 'Problem'),
        n(w('人', 'People'), n(w('要因', 'Cause')), n(w('要因', 'Cause'))),
        n(w('方法', 'Methods'), n(w('要因', 'Cause')), n(w('要因', 'Cause'))),
        n(w('設備', 'Machines'), n(w('要因', 'Cause')), n(w('要因', 'Cause'))),
        n(w('材料', 'Materials'), n(w('要因', 'Cause')), n(w('要因', 'Cause'))),
        n(w('環境', 'Environment'), n(w('要因', 'Cause'))),
        n(w('測定', 'Measurement'), n(w('要因', 'Cause'))),
      ),
    },
    {
      id: 'logic',
      name: w('ロジックツリー', 'Logic Tree'),
      layout: 'logic',
      root: n(
        w('課題', 'Question'),
        n(w('論点 A', 'Issue A'), n(w('打ち手', 'Option')), n(w('打ち手', 'Option'))),
        n(w('論点 B', 'Issue B'), n(w('打ち手', 'Option')), n(w('打ち手', 'Option'))),
        n(w('論点 C', 'Issue C'), n(w('打ち手', 'Option')), n(w('打ち手', 'Option'))),
      ),
    },
    {
      id: 'proposal',
      name: w('企画書', 'Proposal'),
      layout: 'tree',
      root: {
        text: w('企画書', 'Proposal'),
        numbering: { format: 'arabic' },
        children: [
          n(w('背景', 'Background')),
          n(w('目的', 'Goal')),
          {
            text: w('提案内容', 'What we propose'),
            numbering: { format: 'arabic', tiered: true },
            children: [n(w('概要', 'Overview')), n(w('特長', 'Strong points')), n(w('進め方', 'How we get there'))],
          },
          n(w('スケジュール', 'Schedule')),
          n(w('予算', 'Budget')),
          n(w('リスクと対策', 'Risks and answers')),
        ],
      },
    },
    {
      id: 'week',
      name: w('週間プラン', 'Weekly Plan'),
      layout: 'org-tree',
      root: n(
        w('今週', 'This week'),
        n(w('月', 'Mon'), todo(w('やること', 'To do')), todo(w('やること', 'To do'))),
        n(w('火', 'Tue'), todo(w('やること', 'To do'))),
        n(w('水', 'Wed'), todo(w('やること', 'To do'))),
        n(w('木', 'Thu'), todo(w('やること', 'To do'))),
        n(w('金', 'Fri'), todo(w('やること', 'To do')), todo(w('振り返り', 'Review'))),
      ),
    },
  ];
}
