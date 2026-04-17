/**
 * GET /api/agents
 * bot/src/strategies/*.js 파일에서 AGENT_INFO를 읽어 에이전트 목록 반환.
 * 새 전략 파일을 추가하면 자동으로 목록에 나타남.
 *
 * 각 전략 파일에 아래 형식의 정적 속성이 있어야 함:
 *   StrategyClass.AGENT_INFO = { id, name, description, version }
 */

const REPO        = 'openclaw4286-code/Coin_Market_Trading';
const BOT_BRANCH  = process.env.BOT_BRANCH ?? 'claude/gateio-trading-bot-SDKao';
const STRAT_PATH  = 'src/strategies';

interface AgentDef {
  id:          string;
  name:        string;
  description: string;
  version?:    string;
}

/** GitHub API로 strategies 디렉토리의 .js 파일 목록 조회 */
async function listStrategyFiles(): Promise<{ name: string; download_url: string }[]> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }

  const url = `https://api.github.com/repos/${REPO}/contents/${STRAT_PATH}?ref=${encodeURIComponent(BOT_BRANCH)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);

  const files: any[] = await res.json();
  return files.filter((f) => f.type === 'file' && f.name.endsWith('.js'));
}

/** 파일 내용에서 AGENT_INFO 블록을 정규식으로 파싱 */
function parseAgentInfo(content: string, filename: string): AgentDef {
  // ClassName.AGENT_INFO = { ... } 블록 추출
  const match = content.match(/AGENT_INFO\s*=\s*\{([\s\S]*?)\};/);
  if (!match) {
    // AGENT_INFO 없으면 파일명으로 폴백
    const id = filename.replace('.js', '');
    return { id, name: id, description: '' };
  }

  const block = match[1];
  const str = (key: string) => block.match(new RegExp(`${key}:\\s*['"\`]([^'"\`]+)['"\`]`))?.[1] ?? '';

  return {
    id:          str('id')          || filename.replace('.js', ''),
    name:        str('name')        || filename.replace('.js', ''),
    description: str('description') || '',
    version:     str('version')     || undefined,
  };
}

async function fetchAgentsFromGitHub(): Promise<AgentDef[]> {
  const files  = await listStrategyFiles();
  const agents: AgentDef[] = [];

  for (const file of files) {
    try {
      const res     = await fetch(file.download_url);
      const content = await res.text();
      agents.push(parseAgentInfo(content, file.name));
    } catch {
      // 파일 읽기 실패 시 파일명으로 폴백
      agents.push({ id: file.name.replace('.js', ''), name: file.name.replace('.js', ''), description: '' });
    }
  }

  return agents;
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const agents = await fetchAgentsFromGitHub();
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
    res.status(200).json(agents);
  } catch (err: any) {
    // GitHub API 실패 시 빈 배열 (에이전트 없음으로 표시)
    console.error('[agents] GitHub fetch failed:', err?.message);
    res.status(200).json([]);
  }
}
