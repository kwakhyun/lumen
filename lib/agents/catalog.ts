import type { AgentDefinition } from './types';

const scopeStep = { id: 'scope', label: '분석 범위 확정' };
const writeStep = { id: 'write', label: '결과 작성' };
const proposeStep = { id: 'propose', label: '다음 조치 제안' };

/** Templates are data, shared by the server engine and the gallery. */
export const AGENTS: AgentDefinition[] = [
  {
    id: 'brand-health', category: 'reporting', icon: 'pulse', name: '브랜드 가시성 리포트',
    outcome: '언급률·점유율·인용률의 현재 상태와 가장 먼저 볼 지점을 정리해요',
    description: '선택한 기간의 답변을 집계해 모델별, 주제별로 나누고 경쟁사와 비교해요. 수치마다 분자와 분모를 함께 적고, 근거가 된 질문을 연결해요.',
    inputs: [],
    steps: [scopeStep, { id: 'aggregate', label: '핵심 지표 집계' }, { id: 'breakdown', label: '모델·주제별 분해' }, { id: 'read', label: '근거 답변 확인' }, writeStep, proposeStep],
    produces: ['report', 'tasks'], documentKind: 'report',
  },
  {
    id: 'weekly-report', category: 'reporting', icon: 'calendar', name: '주간 AEO 리포트',
    outcome: '최근 7일과 그 전 7일을 비교해 달라진 점을 보고해요',
    description: '같은 질문 묶음에서 두 기간의 언급률과 경쟁사 순위를 비교해요. 표본이 부족한 지표는 비교하지 않고 그 사실을 적어요.',
    inputs: [],
    steps: [scopeStep, { id: 'aggregate', label: '이번 주와 지난주 집계' }, { id: 'breakdown', label: '변화가 큰 질문 찾기' }, { id: 'read', label: '근거 답변 확인' }, writeStep, proposeStep],
    produces: ['report', 'tasks'], documentKind: 'report',
  },
  {
    id: 'fact-check', category: 'reporting', icon: 'shield', name: '답변 정확도 점검',
    outcome: 'AI가 우리 브랜드를 설명한 문장을 브랜드 정보와 대조해요',
    description: '브랜드가 언급된 답변에서 설명 문장을 모으고, 워크스페이스에 등록한 브랜드 정보와 어긋나거나 확인이 필요한 내용을 표시해요.',
    inputs: [],
    steps: [scopeStep, { id: 'aggregate', label: '브랜드 언급 답변 수집' }, { id: 'read', label: '설명 문장 대조' }, writeStep, proposeStep],
    produces: ['report', 'tasks'], documentKind: 'report',
  },
  {
    id: 'gap-analysis', category: 'research', icon: 'target', name: '질문 격차 분석',
    outcome: '경쟁사만 언급되는 질문을 골라 원인과 메울 방법을 제안해요',
    description: '경쟁사는 나오고 우리 브랜드는 빠진 답변이 많은 질문을 순서대로 정리해요. 답변 원문에서 경쟁사가 어떻게 소개되는지 읽고 보완할 내용을 제안해요.',
    inputs: [{ key: 'promptId', label: '집중할 질문', type: 'prompt', hint: '비워 두면 격차가 큰 질문 3개를 골라요.' }],
    steps: [scopeStep, { id: 'aggregate', label: '질문별 언급 집계' }, { id: 'breakdown', label: '격차가 큰 질문 선정' }, { id: 'read', label: '경쟁사 소개 문장 읽기' }, writeStep, proposeStep],
    produces: ['report', 'tasks'], documentKind: 'report',
  },
  {
    id: 'competitor-insight', category: 'research', icon: 'users', name: '경쟁사 인사이트',
    outcome: '경쟁사가 강한 질문과 소개되는 방식을 비교해요',
    description: '브랜드별 언급률, 점유율, 등장 순서를 나란히 놓고 경쟁사가 앞서는 주제를 찾아요. 한 경쟁사를 지정하면 그 브랜드를 중심으로 봐요.',
    inputs: [{ key: 'competitor', label: '집중할 경쟁사', type: 'competitor', hint: '비워 두면 언급률이 가장 높은 경쟁사를 봐요.' }],
    steps: [scopeStep, { id: 'aggregate', label: '브랜드별 지표 집계' }, { id: 'breakdown', label: '경쟁사가 앞서는 주제 찾기' }, { id: 'read', label: '소개 문장 읽기' }, writeStep, proposeStep],
    produces: ['report', 'tasks'], documentKind: 'report',
  },
  {
    id: 'prompt-discovery', category: 'research', icon: 'compass', name: '질문 발굴',
    outcome: '아직 추적하지 않는 고객 질문을 제안해요',
    description: '지금 추적하는 질문의 주제와 의도 분포를 보고 비어 있는 영역을 찾아요. 제안한 질문은 승인한 것만 추적 목록에 추가돼요.',
    inputs: [{ key: 'topic', label: '넓힐 주제', type: 'text', placeholder: '예: 가격, 도입 사례', hint: '비워 두면 질문이 적은 주제부터 채워요.' }],
    steps: [scopeStep, { id: 'aggregate', label: '주제·의도 분포 확인' }, { id: 'breakdown', label: '비어 있는 영역 찾기' }, writeStep, proposeStep],
    produces: ['report', 'prompts'], documentKind: 'report',
  },
  {
    id: 'content-brief', category: 'content', icon: 'clipboard', name: '콘텐츠 브리프',
    outcome: '격차가 큰 주제 하나를 골라 작성 브리프를 만들어요',
    description: '답해야 할 질문, 다뤄야 할 내용, 근거로 쓸 관측 결과, 확인이 필요한 주장을 한 장에 정리해요. 초안 작성 전 검토용이에요.',
    inputs: [{ key: 'topic', label: '주제', type: 'topic', hint: '비워 두면 언급률이 가장 낮은 주제를 골라요.' }],
    steps: [scopeStep, { id: 'aggregate', label: '주제별 언급 집계' }, { id: 'breakdown', label: '브리프 주제 선정' }, { id: 'read', label: '답변에서 다뤄진 내용 읽기' }, writeStep, proposeStep],
    produces: ['report', 'tasks'], documentKind: 'content',
  },
  {
    id: 'content-draft', category: 'content', icon: 'pen', name: '콘텐츠 초안',
    outcome: '주제를 받아 게시 전 검토용 초안을 작성해요',
    description: '수집한 답변에서 고객이 궁금해한 점을 뽑아 글의 구조를 잡고 초안과 FAQ를 써요. 확인되지 않은 수치나 기능은 만들지 않고 표시해 둬요.',
    inputs: [{ key: 'topic', label: '글의 주제', type: 'text', placeholder: '예: 20명 규모 팀의 협업 도구 선택 기준', required: true }],
    steps: [scopeStep, { id: 'aggregate', label: '관련 질문 모으기' }, { id: 'read', label: '답변에서 다뤄진 내용 읽기' }, writeStep, proposeStep],
    produces: ['report', 'tasks'], documentKind: 'content',
  },
  {
    id: 'faq-schema', category: 'content', icon: 'list', name: 'FAQ와 구조화 데이터',
    outcome: '추적 중인 질문으로 FAQ와 FAQPage JSON-LD를 만들어요',
    description: '고객 질문을 FAQ 문항으로 다듬고 답변 초안과 붙여 넣을 수 있는 JSON-LD를 함께 만들어요. 답변은 브랜드 정보에 있는 내용만 사용해요.',
    inputs: [{ key: 'topic', label: '주제', type: 'topic', hint: '비워 두면 전체 질문에서 골라요.' }],
    steps: [scopeStep, { id: 'aggregate', label: 'FAQ 후보 질문 선정' }, { id: 'read', label: '답변에서 다뤄진 내용 읽기' }, writeStep, proposeStep],
    produces: ['report', 'tasks'], documentKind: 'content',
  },
  {
    id: 'source-playbook', category: 'outreach', icon: 'link', name: '인용 출처 공략',
    outcome: 'AI가 자주 인용하는 출처와 우리가 빠진 출처를 정리해요',
    description: '답변에 인용된 도메인을 자사, 경쟁사, 제3자로 나누고 경쟁사만 인용된 출처를 찾아요. 출처별로 시도할 수 있는 조치를 제안해요.',
    inputs: [],
    steps: [scopeStep, { id: 'aggregate', label: '인용 출처 집계' }, { id: 'breakdown', label: '자사·경쟁사·제3자 분류' }, { id: 'read', label: '인용된 맥락 읽기' }, writeStep, proposeStep],
    produces: ['report', 'tasks'], documentKind: 'report',
  },
];

export const agentById = (id: string) => AGENTS.find(agent => agent.id === id);
