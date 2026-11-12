/* eslint-disable @next/next/no-img-element -- This static, pre-sized product screenshot is optimized before deployment. */
/* eslint-disable @next/next/no-html-link-for-pages -- Full document navigation avoids the deployed Vinext RSC transition failure. */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Hahmlet, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import { Activity, ArrowRight, ArrowUpRight, CalendarClock, ChartNoAxesCombined, Check, ChevronDown, ClipboardList, Fingerprint, LayoutGrid, Link2, Quote, ShieldCheck, Target } from 'lucide-react';
import './home.css';
import { AnalyticsConsent } from '@/components/analytics-consent';
import { LumenMark } from '@/components/lumen-mark';
import { AgentRunDemo } from '@/components/landing/agent-run-demo';
import { AnswerField } from '@/components/landing/answer-field';
import { LandingMotion } from '@/components/landing/landing-motion';
import { AGENTS, agentById } from '@/lib/agents/catalog';
import { AGENT_CATEGORY_LABELS, type AgentCategory } from '@/lib/agents/types';

// Self-hosted at build time: the content security policy only allows fonts from this origin.
const displayFont = Hahmlet({ subsets: ['latin'], display: 'swap', variable: '--font-display' });
const accentFont = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], display: 'swap', variable: '--font-accent' });
const monoFont = JetBrains_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-mono' });

const siteUrl = 'https://lumen-nine-rose.vercel.app';
const faq = [
  ['누가 이용할 수 있나요?', '대한민국에서 이용하는 만 18세 이상의 업무 사용자를 위한 서비스예요. AI 기능을 처음 사용하기 전에 이용 조건을 확인해요. 무료 Gemini의 입력과 응답은 Google의 제품 개선 및 인적 검토에 사용될 수 있으니 공개된 업무 정보만 사용하고 개인정보, 민감정보와 기밀정보는 입력하지 마세요.'],
  ['무료로 어디까지 사용할 수 있나요?', 'AI 호출의 기본 한도는 계정당 하루 10회, 월 100회이고, 모든 사용자가 함께 쓰는 공용 한도는 하루 50회, 월 500회예요. 질문 하나를 모델 하나에 보내면 1회를 사용하고 콘텐츠 생성과 AI 상담도 포함돼요. 에이전트는 모델이 결과를 작성할 때 2회를 사용해요. 검색 관측 저장과 GA4 기준 자료 가져오기는 AI 호출을 사용하지 않아요. 실제 잔여량과 UTC 기준 초기화 시각은 사용량 화면에서 확인하세요.'],
  ['ChatGPT와 Perplexity의 실제 검색 결과도 추적할 수 있나요?', '각 서비스의 검색 화면에서 직접 확인한 결과를 Lumen에 기록할 수 있어요. 질문과 검색 조건을 고정하고 답변 발췌, 원래 인용, 관측 시각을 저장해요. 관측 JSON은 한 번에 최대 20건, 64 KiB까지 가져올 수 있어요. Lumen이 두 서비스의 검색 화면을 자동으로 실행하거나 무료 Gemini 답변으로 대체하지는 않아요.'],
  ['에이전트는 무엇을 하나요?', '수집한 답변을 집계하고 읽은 뒤 가시성 리포트, 질문 격차 분석, 콘텐츠 브리프 같은 결과물을 만들어요. 진행 단계를 화면에서 볼 수 있고, 결과에는 근거가 된 수치와 답변이 함께 남아요. 에이전트가 제안한 작업과 질문은 승인한 것만 워크스페이스에 추가되고, 외부 사이트에 게시하거나 변경하지 않아요.'],
  ['어떤 AI 모델을 사용하나요?', '연결 메뉴에서 사용 가능한 모델을 확인하고 선택할 수 있어요. Claude Opus 5.5와 GPT-6.1 Terra는 웹 검색 답변과 인용을, Gemini는 웹 검색과 인용 출처가 없는 일반 답변을 수집해요. 에이전트와 문서 초안은 연결된 모델 중 Claude, GPT, Gemini 순으로 사용해요. 실패한 수집은 다른 모델로 자동 전환하지 않고, 샘플 화면은 합성 데이터예요.'],
  ['자동 수집은 어떻게 동작하나요?', '수집할 질문과 모델, 시간대를 선택하고 매일 또는 매주 실행할 일정을 저장해요. 서버 수집기가 실행되면 예정된 작업을 처리하고 실행 결과를 남겨요. 무료 한도를 초과하면 중단하고, 자동 수집 화면에서 최근 실행과 수집기 상태를 확인할 수 있어요.'],
  ['GA4를 연결하면 매출 효과까지 알 수 있나요?', 'GA4 기준 자료는 선택한 속성에서 브랜드 사이트의 세션, AI 추천 세션과 페이지 조회를 읽어 와요. 같은 조회 조건의 최근 자료는 최대 24시간 재사용해요. 전환 세션, 주문과 매출은 이 기능에서 측정하지 않고, 사이트 전체 방문 자료를 콘텐츠 전후 성과 비교에 자동으로 넣지 않아요.'],
  ['검색 노출이나 매출 상승을 보장하나요?', '보장하지 않아요. 같은 질문과 조건에서 전후 모두 확인한 답변을 비교하고, 개선 대상과 비교 대상의 변화도 대조해요. 이는 관측된 변화이고 전체 이용자의 노출 빈도나 콘텐츠 개선의 인과효과를 증명하지 않아요. 방문, 전환과 매출은 각각 같은 범위의 자료로 확인해야 해요.'],
] as const;
const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      '@id': `${siteUrl}/#lumen`,
      name: 'Lumen',
      url: `${siteUrl}/`,
      sameAs: 'https://github.com/kwakhyun/lumen',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      inLanguage: 'ko',
      description: 'AI 답변에서 브랜드 언급과 인용을 측정하고, 에이전트가 격차 분석과 리포트, 콘텐츠 초안을 만들어 제안하는 무료 GEO 워크스페이스입니다.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'KRW' },
    },
    {
      '@type': 'FAQPage',
      '@id': `${siteUrl}/#faq`,
      inLanguage: 'ko',
      mainEntity: faq.map(([name, text]) => ({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } })),
    },
  ],
};
export const metadata: Metadata = {
  title: { absolute: 'Lumen — 에이전트와 함께 관리하는 AI 가시성(GEO)' },
  description: 'AI 답변에서 우리 브랜드의 언급과 인용을 측정하고, 에이전트가 격차 분석·리포트·콘텐츠 초안을 만들어 제안합니다. 로그인 없이 샘플을 볼 수 있습니다.',
  alternates: { canonical: siteUrl },
  openGraph: { type: 'website', url: siteUrl, siteName: 'Lumen', locale: 'ko_KR', title: 'Lumen — 에이전트와 함께 관리하는 AI 가시성(GEO)', description: 'AI 답변 속 브랜드 언급과 인용을 측정하고, 에이전트가 만든 분석과 초안을 검토해 반영하세요.', images: [{ url: `${siteUrl}/og-image.jpg`, width: 1200, height: 630, alt: 'Lumen 홈 화면: 에이전트 실행과 브랜드 언급 지표' }] },
  twitter: { card: 'summary_large_image', images: [`${siteUrl}/og-image.jpg`] },
};

const answerSources = ['Claude Opus 5.5', 'GPT-6.1 Terra', 'Gemini 3.8 Flash', 'Perplexity Sonar', 'ChatGPT 검색 관측', 'Perplexity 검색 관측'];
const statement = '숫자만 보여주지 않아요. 어떤 답변에서 나온 숫자인지, 원문과 측정 기준을 함께 남겨요.'.split(' ');
const principles = [
  [Fingerprint, '답변 원문 보관', '수집한 답변을 모델, 수집 시각과 함께 보관해요.'],
  [ShieldCheck, '측정 범위 표시', '실제 결과와 샘플, 인용과 언급을 구분해요.'],
  [CalendarClock, '변화 기록', '개선 작업을 기록하고 같은 질문의 답변을 다시 수집해요.'],
] as const;
const agentGroups: Array<{ category: AgentCategory; Icon: typeof Activity; lead: string; copy: string }> = [
  { category: 'reporting', Icon: Activity, lead: '브랜드 가시성 리포트', copy: '언급률·점유율·인용률을 모델과 주제별로 나누고 먼저 볼 지점을 정리해요.' },
  { category: 'research', Icon: Target, lead: '질문 격차 분석', copy: '경쟁사만 언급되는 질문을 골라 답변 원문을 읽고 메울 방법을 제안해요.' },
  { category: 'content', Icon: ClipboardList, lead: '콘텐츠 브리프', copy: '언급이 약한 주제 하나를 골라 답해야 할 질문과 구성, 확인할 사실을 정리해요.' },
  { category: 'outreach', Icon: Link2, lead: '인용 출처 공략', copy: 'AI가 인용한 출처를 자사·경쟁사·제3자로 나누고 우리가 빠진 곳을 찾아요.' },
];
const flow = ['에이전트 선택', '범위 확정과 지표 집계', '근거 답변 읽기', '결과 작성', '제안 검토 후 반영'];
const heatmap = {
  brands: ['Northstar', 'Orbit', 'Tandem', 'Boardly'],
  rows: [['가격 비교', 28, 71, 64, 22], ['문서 협업', 81, 46, 38, 30], ['원격 근무', 54, 77, 25, 41], ['온보딩', 73, 35, 44, 19]] as Array<[string, ...number[]]>,
};
/** Five-step scale; each step pairs a fill with a text colour that keeps the figure readable. */
const heatColor = (value: number): React.CSSProperties => {
  const [background, color] = value >= 75 ? ['#4441c9', '#fff'] : value >= 60 ? ['#6562e3', '#fff'] : value >= 45 ? ['#aeabf4', '#1d1b52'] : value >= 30 ? ['#d5d3fa', '#2c2a66'] : ['#ecebfd', '#3d3d47'];
  return { background, color };
};
const ranking = [['Northstar', 62], ['Orbit', 55], ['Tandem', 43], ['Boardly', 27]] as const;
const week = ['월', '화', '수', '목', '금', '토', '일'];
const steps = [
  ['브랜드를 등록하세요', '브랜드 이름과 웹사이트 주소를 입력해요. 비교할 브랜드와 외부 서비스는 나중에 추가해도 돼요.'],
  ['질문을 추가하세요', '고객이 제품을 찾거나 비교할 때 물을 만한 질문을 직접 입력해요. 질문을 저장하는 단계에서는 AI 사용량이 차감되지 않아요.'],
  ['답변을 수집하고 확인하세요', '질문과 모델, 사용할 횟수를 확인한 뒤 수집을 시작하세요. 질문 하나를 모델 하나에 보내면 1회를 사용해요. 수집이 끝나면 답변 원문을 확인할 수 있어요.'],
] as const;
const freeItems = ['기본 하루 10회, 월 100회 AI API 호출', '질문과 브랜드 비교, 답변 원문 확인', '정기 수집과 실행 이력', `에이전트 ${AGENTS.length}종, 콘텐츠 초안과 리포트, 개선 작업`, '실제 검색 관측 JSON 가져오기와 전후 비교', 'CSV 내보내기와 GA4 방문 집계(선택)'];

export default async function Home() {
  const nonce = (await headers()).get('x-lumen-csp-nonce') || undefined;
  const demoAgent = agentById('brand-health');
  return <main className={`hm ${displayFont.variable} ${accentFont.variable} ${monoFont.variable}`}>
    <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
    <LandingMotion />
    <div className="hm-progress" aria-hidden="true" />
    <a className="hm-skip" href="#main">본문으로 이동</a>

    <header className="hm-nav">
      <a href="/" className="hm-logo" aria-label="Lumen 홈"><LumenMark size={28} /><span>lumen</span></a>
      <nav aria-label="주 메뉴">
        <a href="#agents">에이전트</a><a href="#product">답변 분석</a><a href="#search-tracking">검색 관측</a><a href="/guides/free-ai-brand-tracking">활용 가이드</a><a href="#free">무료 사용</a><a href="#faq">자주 묻는 질문</a>
      </nav>
      <a className="hm-nav-cta" href="/dashboard">워크스페이스 열기<ArrowUpRight size={16} /></a>
    </header>

    <section className="hm-hero" id="main">
      <AnswerField />
      <div className="hm-hero-backdrop" aria-hidden="true" />
      <div className="hm-hero-inner">
        <p className="hm-eyebrow"><span className="hm-pulse" aria-hidden="true" />에이전트가 일하는 GEO 워크스페이스</p>
        <h1 className="hm-title">
          <span className="hm-title-line"><span>AI가 답할 때,</span></span>{' '}
          <span className="hm-title-line"><span>우리 브랜드는</span></span>{' '}
          <span className="hm-title-line"><span><em>보이나요?</em></span></span>
        </h1>
        <p className="hm-lede">Lumen은 AI 답변을 수집해 브랜드 언급과 인용을 측정해요.{' '}<br />에이전트가 격차를 찾고 리포트와 콘텐츠 초안을 제안하면, 검토해서 반영하면 돼요.</p>
        <div className="hm-actions">
          <a className="hm-btn primary" href="/dashboard?start=1">내 브랜드 등록하기<ArrowRight size={18} /></a>
          <a className="hm-btn ghost" href="/demo">로그인 없이 샘플 보기<ArrowUpRight size={17} /></a>
        </div>
        <p className="hm-note">샘플은 로그인 없이 볼 수 있고, 내 브랜드를 등록하려면 Google 로그인이 필요해요.{' '}<br />대한민국에서 이용하는 만 18세 이상 업무 사용자 대상 · 카드 등록 없음</p>
        <a className="hm-hero-guide" href="/guides/free-ai-brand-tracking">실제 AI 검색을 추적하는 방법<ArrowRight size={16} /></a>
      </div>
      <div className="hm-shot-wrap">
        <span className="hm-float a" aria-hidden="true"><i />브랜드 언급 확인</span>
        <span className="hm-float b" aria-hidden="true"><i />에이전트 실행 완료</span>
        <span className="hm-float c" aria-hidden="true"><i />근거 답변 연결</span>
        <a href="/demo" className="hm-shot" data-tilt aria-label="샘플 워크스페이스 열기">
          <span className="hm-shot-bar" aria-hidden="true"><i /><i /><i /><span>lumen · 샘플 워크스페이스</span><em>합성 데이터</em></span>
          <img src="/product-preview.jpg" alt="Lumen 샘플 홈 화면. 질문 입력창과 에이전트, 브랜드 언급 지표, 다음에 할 일을 한 화면에서 확인해요." width="1440" height="1000" fetchPriority="high" />
        </a>
      </div>
    </section>

    <section className="hm-sources" aria-label="Lumen이 살펴보는 AI 답변">
      <p className="hm-kicker">Lumen이 살펴보는 답변</p>
      <div className="hm-marquee" aria-hidden="true">
        {[0, 1].map(copy => <div key={copy}>{answerSources.map((name, index) => <span key={name} data-outline={index % 2 ? '' : undefined}>{name}<i>✦</i></span>)}</div>)}
      </div>
      <p className="hm-sr">{answerSources.join(', ')}</p>
      <p className="hm-sources-note">사용할 수 있는 모델은 운영 설정에 따라 달라져요. 무료 기본 모델은 Gemini예요.</p>
    </section>

    <section className="hm-statement" aria-label="제품 원칙">
      <p className="hm-statement-text" data-words>{statement.map((word, index) => <span data-w="" key={index}>{word} </span>)}</p>
      <div className="hm-principles">
        {principles.map(([Icon, title, copy]) => <div key={title} data-reveal><Icon size={22} /><h2>{title}</h2><p>{copy}</p></div>)}
      </div>
      <dl className="hm-stats">
        <div data-reveal><dt><span data-count={AGENTS.length}>{AGENTS.length}</span><small>가지</small></dt><dd>리포트부터 콘텐츠 초안까지 맡길 수 있는 에이전트</dd></div>
        <div data-reveal><dt><span data-count="3">3</span><small>가지</small></dt><dd>분자와 분모를 함께 보여주는 지표: 언급률, 점유율, 인용률</dd></div>
        <div data-reveal><dt><span>0</span><small>원</small></dt><dd>카드 등록 없이 무료 한도 안에서 시작</dd></div>
      </dl>
    </section>

    <section className="hm-section hm-light hm-agents" id="agents">
      <div className="hm-wrap">
        <header className="hm-head" data-reveal>
          <div><span className="hm-kicker">01 — 에이전트</span><h2>분석과 초안은 맡기고,{' '}<br />판단에 집중하세요</h2></div>
          <p>에이전트는 수집한 답변을 집계하고 읽은 뒤 결과물을 만들어요. 진행 단계와 근거가 화면에 남고, 제안은 승인한 것만 반영돼요.</p>
        </header>
        <div className="hm-bento">
          <article className="hm-card hm-card-demo" data-reveal>
            {demoAgent && <AgentRunDemo name={demoAgent.name} steps={demoAgent.steps.map(step => step.label)} />}
          </article>
          {agentGroups.map(({ category, Icon, lead, copy }) => (
            <article className="hm-card hm-agent" data-reveal data-glow key={category}>
              <span className="hm-agent-icon"><Icon size={20} /></span>
              <span className="hm-tag">{AGENT_CATEGORY_LABELS[category]}</span>
              <h3>{lead}</h3>
              <p>{copy}</p>
              <ul aria-label={`${AGENT_CATEGORY_LABELS[category]} 에이전트`}>{AGENTS.filter(agent => agent.category === category).map(agent => <li key={agent.id}>{agent.name}</li>)}</ul>
            </article>
          ))}
        </div>
        <ol className="hm-flow" aria-label="에이전트 실행 과정" data-reveal>{flow.map((label, index) => <li key={label}><span>{String(index + 1).padStart(2, '0')}</span>{label}</li>)}</ol>
        <div className="hm-strip" data-reveal>
          <div><h3>{AGENTS.length}가지 에이전트를 샘플 데이터로 바로 실행해 보세요</h3><p>샘플 워크스페이스에서는 합성 데이터를 집계해 결과를 만들고 AI 사용량을 쓰지 않아요.</p></div>
          <a className="hm-btn solid" href="/demo">샘플에서 실행해 보기<ArrowRight size={17} /></a>
        </div>
      </div>
    </section>

    <section className="hm-section hm-light hm-tint" id="product">
      <div className="hm-wrap">
        <header className="hm-head" data-reveal>
          <div><span className="hm-kicker">02 — 답변 분석</span><h2>브랜드 언급 현황부터{' '}<br />질문별 답변까지</h2></div>
          <p>전체 언급률과 질문별 답변을 함께 확인하세요. AI 모델이 브랜드를 어떻게 설명하는지 답변 원문에서 살펴볼 수 있어요.</p>
        </header>
        <div className="hm-evidence">
          <article className="hm-evidence-copy" data-reveal>
            <Quote size={30} />
            <h3>브랜드를 소개한{' '}<br />답변 원문을 확인하세요</h3>
            <p>같은 질문의 답변을 모아 브랜드의 등장 순서와 설명을 확인하세요. 무료 Gemini 응답은 웹 검색을 사용하지 않고 인용 출처를 제공하지 않아요. 실패한 수집도 기록해요.</p>
            <a className="hm-link" href="/demo">샘플 대시보드 열기<ArrowRight size={17} /></a>
          </article>
          <article className="hm-answer" data-reveal>
            <div className="hm-answer-top"><span>답변 미리보기</span><span className="hm-tag">설명을 위한 예시</span></div>
            <h3>작은 팀을 위한 협업 도구를 추천해 줘.</h3>
            <div className="hm-answer-body"><span>답변 예시</span><p>프로젝트와 문서를 함께 관리하려면 <mark>Northstar</mark>를 비교해 보세요. 팀의 작업 방식과 필요한 연동을 기준으로 선택하는 것이 좋습니다.</p></div>
            <footer><span><Check size={15} /> 브랜드 언급 확인</span><span>원문과 측정 조건을 함께 확인</span></footer>
          </article>
        </div>
        <div className="hm-trio">
          <article className="hm-card hm-feature" data-reveal data-glow>
            <div className="hm-visual hm-heat" role="img" aria-label="주제별 브랜드 언급률 예시 표. 문서 협업과 온보딩에서는 Northstar가, 가격 비교와 원격 근무에서는 Orbit이 더 자주 언급돼요.">
              <div className="hm-heat-head"><span />{heatmap.brands.map(brand => <span key={brand}>{brand}</span>)}</div>
              {heatmap.rows.map(([topic, ...values], row) => <div key={topic}><span>{topic}</span>{values.map((value, column) => <i key={column} style={{ ...heatColor(value), '--d': `${(row * 4 + column) * 45}ms` } as React.CSSProperties}>{value}</i>)}</div>)}
            </div>
            <span className="hm-tag"><LayoutGrid size={14} />주제 × 브랜드</span>
            <h3>어느 주제에서 밀리는지 한눈에</h3>
            <p>주제별로 어떤 브랜드가 얼마나 언급되는지 표로 비교해요. 우리 브랜드의 언급률이 낮은 주제부터 보여줘요.</p>
          </article>
          <article className="hm-card hm-feature" data-reveal data-glow>
            <div className="hm-visual hm-rank" role="img" aria-label="브랜드별 언급률 예시. Northstar 62%, Orbit 55%, Tandem 43%, Boardly 27%.">
              {ranking.map(([brand, value], index) => <div key={brand} data-own={index === 0 ? '' : undefined}><span>{brand}</span><i style={{ '--v': value / 100, '--d': `${index * 110}ms` } as React.CSSProperties} /><b>{value}%</b></div>)}
            </div>
            <span className="hm-tag"><ChartNoAxesCombined size={14} />브랜드 비교</span>
            <h3>우리 브랜드와 경쟁 브랜드 비교</h3>
            <p>수집한 답변에서 브랜드별 언급률과 등장 순서를 비교하세요. 질문별로 어떤 브랜드가 언급됐는지도 확인할 수 있어요.</p>
            <a className="hm-link" href="/demo">샘플 대시보드 열기<ArrowUpRight size={17} /></a>
          </article>
          <article className="hm-card hm-feature" data-reveal data-glow>
            <div className="hm-visual hm-week" role="img" aria-label="매일 오전 9시에 답변을 수집하는 일정 예시. 월요일부터 금요일까지 수집을 마쳤어요.">
              <p>매일 오전 9:00 · 질문 12개 · 모델 1개</p>
              <div>{week.map((day, index) => <span key={day} data-done={index < 5 ? '' : undefined} style={{ '--d': `${index * 90}ms` } as React.CSSProperties}><i>{index < 5 ? <Check size={13} strokeWidth={3} /> : null}</i>{day}</span>)}</div>
            </div>
            <span className="hm-tag"><CalendarClock size={14} />자동 수집</span>
            <h3>답변 수집을 예약하세요</h3>
            <p>매일 또는 매주 답변을 수집하도록 예약하고 실행 결과를 확인하세요. 한도 초과나 제공자 오류가 생기면 운영 화면에 이유와 다음 조치를 표시해요.</p>
            <a className="hm-link" href="#workflow">첫 답변 수집 방법 보기<ArrowRight size={17} /></a>
          </article>
        </div>
      </div>
    </section>

    <section className="hm-section hm-light" id="search-tracking">
      <div className="hm-wrap">
        <header className="hm-head" data-reveal>
          <div><span className="hm-kicker">03 — 실제 검색 관측</span><h2>ChatGPT·Perplexity{' '}<br />검색 결과를 기록하세요</h2></div>
          <p>각 서비스의 검색 화면에서 직접 확인한 답변을 남겨 두세요. 같은 질문의 브랜드 언급과 원래 인용을 기록하고, 콘텐츠를 바꾼 뒤 무엇이 달라졌는지 확인할 수 있어요.</p>
        </header>
        <div className="hm-pair">
          <article className="hm-card" data-reveal data-glow>
            <span className="hm-tag">직접 확인한 검색 결과</span>
            <h3>관측한 답변을 한 번에 가져오기</h3>
            <p>실제 검색 화면에서 답변과 인용을 확인한 뒤 JSON으로 가져오세요. 한 번에 최대 20건, 64 KiB까지 저장할 수 있어요. 저장 전 미리보기에서 질문, 시각과 근거를 검토해요.</p>
            <p>원래 답변에 표시된 인용과 나중에 별도로 찾은 링크를 구분하고, AI 답변이 없거나 확인에 실패한 경우도 기록해요.</p>
          </article>
          <article className="hm-card" data-reveal data-glow>
            <span className="hm-tag">변경 전후 비교</span>
            <h3>먼저 기준값을 남기세요</h3>
            <p>콘텐츠를 바꾸기 전의 언급률과 인용률을 분자와 분모까지 확인하세요. 미관측과 측정 결과 0을 구분하므로, 아직 확인하지 않은 답변이 성과에 섞이지 않아요.</p>
            <p>변경 후에는 같은 질문과 조건에서 확인한 결과를 짝지어 비교해요. 개선 대상과 그대로 둔 비교 대상의 변화도 함께 확인할 수 있어요.</p>
          </article>
        </div>
        <div className="hm-table-wrap" role="region" aria-label="Lumen 자동 처리와 직접 확인 범위 비교. 좁은 화면에서는 좌우로 이동하세요." tabIndex={0} data-reveal>
          <table className="hm-table">
            <caption>무료 기능별로 확인할 수 있는 것</caption>
            <thead><tr><th scope="col">자료</th><th scope="col">Lumen이 처리하는 일</th><th scope="col">직접 확인할 일</th></tr></thead>
            <tbody>
              <tr><th scope="row">Gemini API 답변</th><td>무료 한도 내 수집, 정기 실행, 브랜드 언급 분석</td><td>일반 응답의 내용과 정확성. 웹 검색 결과가 아니에요.</td></tr>
              <tr><th scope="row">ChatGPT와 Perplexity 검색</th><td>관측 JSON 가져오기, 근거 보관, 변경 전후 비교</td><td>각 서비스에서 검색 실행, 답변과 원래 인용 확인</td></tr>
              <tr><th scope="row">GA4 방문 기준 자료</th><td>선택한 연결에서 버튼으로 집계 조회, 같은 조건의 최근 자료를 최대 24시간 재사용</td><td>실제 조회 기간, 시간대와 유입 범위. 전환, 주문과 매출은 측정하지 않아요.</td></tr>
            </tbody>
          </table>
        </div>
        <div className="hm-strip" data-reveal>
          <div><h3>검색 관측부터 콘텐츠 개선까지</h3><p>질문을 정하는 방법, 지표의 분모와 GA4 자료의 해석 범위를 가이드에서 확인하세요.</p></div>
          <a className="hm-btn line" href="/guides/free-ai-brand-tracking">무료 브랜드 추적 가이드<ArrowRight size={17} /></a>
        </div>
      </div>
    </section>

    <section className="hm-workflow" id="workflow">
      <div className="hm-wrap">
        <div className="hm-workflow-head" data-reveal>
          <span className="hm-kicker">04 — 첫 답변 수집</span>
          <h2>세 단계로{' '}<br />첫 답변을 확인하세요</h2>
          <p>브랜드와 질문을 등록한 뒤 원할 때 답변 수집을 시작할 수 있어요. GA4나 다른 서비스 연결은 필요하지 않아요.</p>
          <a className="hm-btn primary" href="/dashboard?start=1">내 브랜드 등록하기<ArrowRight size={18} /></a>
        </div>
        <ol className="hm-steps" data-line>
          {steps.map(([title, copy], index) => <li key={title} data-reveal><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{title}</h3><p>{copy}</p></div></li>)}
        </ol>
      </div>
    </section>

    <section className="hm-section hm-light" id="free">
      <div className="hm-wrap hm-free">
        <div data-reveal>
          <span className="hm-kicker">05 — 무료 사용</span>
          <h2>무료로 시작하는{' '}<br />AI 답변 분석</h2>
          <p>제공되는 무료 한도 안에서 답변을 수집하고 분석하세요. 결제 정보 입력이나 자동 유료 전환은 없어요.</p>
          <a href="#faq" className="hm-link">무료 이용 안내 확인하기<ArrowRight size={17} /></a>
        </div>
        <article className="hm-free-card" data-reveal>
          <div className="hm-free-top"><span className="hm-tag">LUMEN FREE</span><LumenMark size={30} /></div>
          <h3>무료 워크스페이스</h3>
          <p className="hm-price">₩0<span>카드 등록 없음</span></p>
          <ul>{freeItems.map(item => <li key={item}><Check size={17} />{item}</li>)}</ul>
          <a className="hm-btn solid" href="/dashboard?start=1">내 브랜드 등록하기<ArrowRight size={18} /></a>
          <small>AI 기능은 개인 한도와 서비스 공용 한도(하루 50회, 월 500회)를 함께 사용해요. 실제 잔여량과 제한은 사용량 화면에서 확인하세요. 검색 관측 저장과 GA4 조회는 AI 호출을 사용하지 않아요. 무료 Gemini API에는 웹 검색이 없어요.</small>
        </article>
      </div>
    </section>

    <section className="hm-section hm-light hm-tint" id="faq">
      <div className="hm-wrap hm-faq">
        <div data-reveal><span className="hm-kicker">자주 묻는 질문</span><h2>이용 전에{' '}<br />확인해 주세요</h2></div>
        <div>{faq.map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={18} /></summary><p>{answer}</p></details>)}</div>
      </div>
    </section>

    <section className="hm-closing">
      <div className="hm-closing-inner" data-reveal>
        <h2>이제, 우리 브랜드를{' '}<br /><em>비춰 볼</em> 차례예요</h2>
        <p>샘플로 먼저 둘러보고, 준비되면 브랜드와 질문을 등록하세요.</p>
        <div className="hm-actions">
          <a className="hm-btn primary" href="/dashboard?start=1">내 브랜드 등록하기<ArrowRight size={18} /></a>
          <a className="hm-btn ghost" href="/demo">로그인 없이 샘플 보기<ArrowUpRight size={17} /></a>
        </div>
      </div>
      {/* The logo mark without its tile: the ring draws itself and the spark breaks through the gap. */}
      <svg className="hm-closing-mark" viewBox="0 0 320 320" aria-hidden="true" focusable="false">
        <defs><linearGradient id="hm-closing-stroke" x1="40" y1="290" x2="290" y2="40" gradientUnits="userSpaceOnUse"><stop stopColor="#6d6aff" /><stop offset=".55" stopColor="#b17cff" /><stop offset="1" stopColor="#ff6fbd" /></linearGradient></defs>
        <circle cx="150" cy="170" r="104" pathLength="100" />
        <path d="M232 26c5.4 37.2 25.2 57 62.4 62.4-37.2 5.4-57 25.2-62.4 62.4-5.4-37.2-25.2-57-62.4-62.4 37.2-5.4 57-25.2 62.4-62.4Z" />
      </svg>
    </section>

    <footer className="hm-footer">
      <div className="hm-footer-top">
        <a href="/" className="hm-logo" aria-label="Lumen 홈"><LumenMark size={26} /><span>lumen</span></a>
        <p>AI 답변으로 살펴보는 우리 브랜드</p>
      </div>
      <div className="hm-footer-links">
        <a href="/guides/free-ai-brand-tracking">무료 추적 가이드</a><a href="/methodology">측정 방법</a><a href="/privacy">개인정보 처리 안내</a><a href="/terms">이용 안내</a><a href="mailto:khyun9685@gmail.com">문의</a><a href="https://github.com/kwakhyun/lumen">GitHub</a><AnalyticsConsent/>
      </div>
      <small className="hm-operator">운영자 곽현 · 지원 <a href="mailto:khyun9685@gmail.com">khyun9685@gmail.com</a> · © {new Date().getFullYear()} Lumen</small>
    </footer>
  </main>;
}
